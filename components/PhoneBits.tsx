"use client";
import { useEffect, useState } from "react";
import { onQueueChange, readQueue, flushQueue } from "@/lib/offline";
import { useAuth } from "./Auth";
import { APP_NAME } from "./Brand";

/** Offline / waiting-to-sync strip shown above driver screens. */
export function SyncStatus() {
  const { profile } = useAuth();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!profile) return;
    const upd = () => { setOnline(navigator.onLine); setPending(readQueue(profile.id).length); };
    upd();
    const off = onQueueChange(upd);
    const on = () => { upd(); flushQueue(profile.id).then(upd); };
    window.addEventListener("online", on); window.addEventListener("offline", upd);
    return () => { off(); window.removeEventListener("online", on); window.removeEventListener("offline", upd); };
  }, [profile]);
  if (online && !pending) return null;
  return (
    <div className="sync" role="status">
      {!online ? "No signal. " : "Syncing… "}
      {pending ? `${pending} check-off${pending === 1 ? "" : "s"} saved on this phone${online ? "" : " — they'll sync when you're back online"}.` : "You can keep checking off sections."}
    </div>
  );
}

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Install the app" nudge: a real install button on Android, instructions on iPhone. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    let dismissed = false; try { dismissed = localStorage.getItem("cbas-install-dismissed") === "1"; } catch {}
    if (standalone || dismissed) return;
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) { setIos(true); setHidden(false); }
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); setHidden(false); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (hidden) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem("cbas-install-dismissed", "1"); } catch {} };
  return (
    <div className="install">
      <div className="grow">
        <b>Put {APP_NAME} on your home screen</b>
        <div className="small">{ios
          ? <>In Safari, tap <b>Share</b> <ShareIcon /> then <b>Add to Home Screen</b>. It opens full screen and works with no signal.</>
          : "It opens full screen, stays signed in, and works with no signal."}</div>
      </div>
      {evt && <button className="btn primary sm" onClick={async () => { await evt.prompt(); await evt.userChoice; setHidden(true); }}>Install</button>}
      <button className="btn ghost sm" onClick={dismiss} aria-label="Dismiss">Not now</button>
    </div>
  );
}
const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: "-2px" }} aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" /></svg>
);
