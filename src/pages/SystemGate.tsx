import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { config } from "@/lib/config";
import { ShieldAlert, Power, RotateCcw } from "lucide-react";

/**
 * Hidden master control panel — kill / recover the entire system.
 * Not linked anywhere, no index, no follow.
 */
const SystemGate = () => {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    document.title = "System Control";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow, noarchive, nosnippet";
    document.head.appendChild(meta);
    fetch(`${config.apiBaseUrl}/system/status`)
      .then((r) => r.json())
      .then((d) => setMode(d.mode))
      .catch(() => {});
    return () => { meta.remove(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${config.apiBaseUrl}/system/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Invalid key");
      setMode(data.mode);
      setMsg({ ok: true, text: data.message });
      setKey("");
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "Invalid key" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldAlert className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold tracking-wide">SYSTEM CONTROL</span>
        </div>

        <div className="text-xs text-muted-foreground">
          Current state:{" "}
          <span className={mode === "killed" ? "text-destructive font-bold" : "text-primary font-bold"}>
            {mode ? mode.toUpperCase() : "…"}
          </span>
        </div>

        <Input
          type="password"
          autoComplete="off"
          placeholder="Enter control key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="font-mono"
        />

        <Button type="submit" disabled={busy} className="w-full font-bold">
          {mode === "killed" ? <RotateCcw className="w-4 h-4 mr-2" /> : <Power className="w-4 h-4 mr-2" />}
          {busy ? "Working…" : "Execute"}
        </Button>

        {msg && (
          <p className={`text-xs ${msg.ok ? "text-primary" : "text-destructive"}`}>{msg.text}</p>
        )}
      </form>
    </div>
  );
};

export default SystemGate;
