import "server-only";
import { createClient } from "@supabase/supabase-js";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Full-access database client (server only). Uses the secret service_role key. */
export function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new HttpError(500, "The server is missing its Supabase secret key. Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.");
  return createClient(url, key, opts);
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** Returns the signed-in user's profile, or throws 401. */
export async function requireUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");

  // Check who's signing in with the public key, so a sign-in never depends on the secret key.
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
  const { data, error } = await pub.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");

  const db = adminDb();
  const { data: profile, error: pe } = await db.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (pe) {
    console.error("Service key rejected:", pe.message);
    throw new HttpError(500, "The server's Supabase secret key isn't valid. Re-copy the service_role key into Vercel (SUPABASE_SERVICE_ROLE_KEY) and redeploy.");
  }
  if (!profile || !profile.active) throw new HttpError(403, "This account is turned off. Ask your manager.");
  return { db, user: data.user, profile };
}

export async function requireAdmin(req: Request) {
  const ctx = await requireUser(req);
  if (ctx.profile.role !== "admin") throw new HttpError(403, "Managers only.");
  return ctx;
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try { return await fn(req); }
    catch (e: any) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: e?.message || "Something went wrong." }, { status });
    }
  };
}
