import { handle, HttpError, requireAdmin } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DOMAIN = process.env.NEXT_PUBLIC_USERNAME_EMAIL_DOMAIN || "drivers.cbasroutes.app";
const cleanUser = (u: string) => String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

/** Driver accounts: create, edit, reset password, turn off, delete. */
export const POST = handle(async (req) => {
  const { db, profile: me } = await requireAdmin(req);
  const b = await req.json();

  switch (b.action) {
    case "create": {
      const username = cleanUser(b.username);
      if (!username || username.length < 3) throw new HttpError(400, "Usernames need at least 3 letters or numbers.");
      if (!b.password || String(b.password).length < 8) throw new HttpError(400, "Passwords need at least 8 characters.");
      const email = b.email?.trim() || `${username}@${DOMAIN}`;
      const { data, error } = await db.auth.admin.createUser({
        email, password: b.password, email_confirm: true,
        user_metadata: { full_name: b.fullName || username, username },
      });
      if (error) throw new HttpError(400, /already/i.test(error.message) ? "That username is taken." : error.message);
      const { error: pe } = await db.from("profiles").upsert({
        id: data.user.id, full_name: b.fullName || username, username,
        role: b.role === "admin" ? "admin" : "driver", driver_key: (b.driverKey || b.fullName || "").trim() || null, active: true,
      });
      if (pe) throw pe;
      return Response.json({ ok: true, id: data.user.id });
    }
    case "update": {
      const patch: Record<string, unknown> = {};
      if (b.fullName !== undefined) patch.full_name = String(b.fullName).trim();
      if (b.driverKey !== undefined) patch.driver_key = String(b.driverKey).trim() || null;
      if (b.role !== undefined) {
        if (b.id === me.id && b.role !== "admin") throw new HttpError(400, "You can't remove your own manager access.");
        patch.role = b.role === "admin" ? "admin" : "driver";
      }
      if (b.active !== undefined) {
        if (b.id === me.id && !b.active) throw new HttpError(400, "You can't turn off your own account.");
        patch.active = !!b.active;
        await db.auth.admin.updateUserById(b.id, { ban_duration: b.active ? "none" : "876000h" });
      }
      const { error } = await db.from("profiles").update(patch).eq("id", b.id);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    case "username": {
      const username = cleanUser(b.username);
      if (!username || username.length < 3) throw new HttpError(400, "Usernames need at least 3 letters or numbers.");
      const { data: taken } = await db.from("profiles").select("id").eq("username", username).neq("id", b.id).maybeSingle();
      if (taken) throw new HttpError(400, "That username is taken.");
      const { error } = await db.auth.admin.updateUserById(b.id, { email: `${username}@${DOMAIN}`, email_confirm: true });
      if (error) throw new HttpError(400, error.message);
      await db.from("profiles").update({ username }).eq("id", b.id);
      return Response.json({ ok: true });
    }
    case "password": {
      if (!b.password || String(b.password).length < 8) throw new HttpError(400, "Passwords need at least 8 characters.");
      const { error } = await db.auth.admin.updateUserById(b.id, { password: b.password });
      if (error) throw new HttpError(400, error.message);
      return Response.json({ ok: true });
    }
    case "delete": {
      if (b.id === me.id) throw new HttpError(400, "You can't delete your own account.");
      const { error } = await db.auth.admin.deleteUser(b.id);
      if (error) throw new HttpError(400, error.message);
      return Response.json({ ok: true });
    }
  }
  throw new HttpError(400, "Unknown action.");
});
