"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REMEMBER_KEY = "cbas-remember";

/** "Keep me signed in" decides where the session lives: localStorage survives closing the app,
 *  sessionStorage is cleared when the app or tab closes. */
function pickStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(REMEMBER_KEY) === "0" ? sessionStorage : localStorage; } catch { return null; }
}
const storage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { pickStore()?.setItem(k, v); } catch {} },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};

export function setRemember(on: boolean) {
  try { localStorage.setItem(REMEMBER_KEY, on ? "1" : "0"); } catch {}
}
export function getRemember() {
  try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storage, storageKey: "cbas-auth" },
    });
  }
  return client;
}

export const USERNAME_DOMAIN = process.env.NEXT_PUBLIC_USERNAME_EMAIL_DOMAIN || "drivers.cbasroutes.app";
/** Drivers sign in with a username; it maps to a private email address under the hood. */
export function loginEmail(id: string) {
  const v = id.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${USERNAME_DOMAIN}`;
}

/** fetch() to our own API with the signed-in user's token attached. */
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
