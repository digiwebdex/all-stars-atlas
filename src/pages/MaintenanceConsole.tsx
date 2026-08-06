import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { config } from "@/lib/config";

const MaintenanceConsole = () => {
  const [t, setT] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>("");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    document.title = "Console";
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow, noarchive, nosnippet";
    document.head.appendChild(m);
    fetch(`${config.apiBaseUrl}/_hm/ping`).then(r => r.json()).then(d => setMode(d.k ? "killed" : "online")).catch(() => {});
    return () => { m.remove(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!t.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${config.apiBaseUrl}/_hm/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: t.trim() }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error("Rejected");
      setMode(d.m);
      setMsg(d.m === "killed" ? "System offline." : "System online.");
      setT("");
    } catch { setMsg("Rejected"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="text-xs text-muted-foreground">
          State: <span className={mode === "killed" ? "text-destructive font-bold" : "text-primary font-bold"}>{mode ? mode.toUpperCase() : "…"}</span>
        </div>
        <Input type="password" autoComplete="off" value={t} onChange={e => setT(e.target.value)} className="font-mono" placeholder="Token" />
        <Button type="submit" disabled={busy} className="w-full font-bold">{busy ? "…" : "Submit"}</Button>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </form>
    </div>
  );
};

export default MaintenanceConsole;
