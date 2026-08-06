import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { config } from "@/lib/config";
import { OPS_PATH } from "@/lib/status-monitor";
import { AlertTriangle } from "lucide-react";

const StatusMonitor = ({ children }: { children: React.ReactNode }) => {
  const [down, setDown] = useState(false);
  const { pathname } = useLocation();
  const isOps = pathname.startsWith(OPS_PATH);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch(`${config.apiBaseUrl}/_hm/ping`, { cache: "no-store" });
        const d = await r.json();
        if (alive) setDown(!!d.k);
      } catch { /* ignore transient errors */ }
    };
    check();
    const id = setInterval(check, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (down && !isOps) {
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

export default StatusMonitor;
