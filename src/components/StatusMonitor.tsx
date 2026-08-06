import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { config } from "@/lib/config";
import { SYSTEM_GATE_PATH } from "@/lib/system-gate";
import { AlertTriangle } from "lucide-react";

/**
 * Global gate: when the master kill switch is active, the whole site is replaced
 * by an offline screen. The hidden control route stays reachable.
 */
const SystemKillGate = ({ children }: { children: React.ReactNode }) => {
  const [killed, setKilled] = useState(false);
  const { pathname } = useLocation();
  const isGate = pathname.startsWith(SYSTEM_GATE_PATH);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await fetch(`${config.apiBaseUrl}/system/status`, { cache: "no-store" });
        const data = await res.json();
        if (active) setKilled(!!data.killed);
      } catch { /* network issues shouldn't lock the site */ }
    };
    check();
    const id = setInterval(check, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (killed && !isGate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6 text-center">
        <div className="max-w-md space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Service Unavailable</h1>
          <p className="text-muted-foreground text-sm">
            Seven Trip is temporarily offline for maintenance. Please check back shortly.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SystemKillGate;
