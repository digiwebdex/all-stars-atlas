import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plane, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatApiTime } from "@/lib/flight-time";

interface FlightStatusProps {
  airlineCode: string;
  flightNumber: string;
  date: string;
  compact?: boolean;
}

interface FlightStatusData {
  success: boolean;
  method?: string;
  flights?: Array<{
    origin?: string;
    destination?: string;
    scheduledDeparture?: string;
    estimatedDeparture?: string;
    actualDeparture?: string;
    scheduledArrival?: string;
    estimatedArrival?: string;
    actualArrival?: string;
    status?: string;
    equipment?: string;
  }>;
  error?: string;
}

const statusConfig: Record<string, { icon: typeof Plane; color: string; label: string }> = {
  SCHEDULED: { icon: Clock, color: "bg-primary/10 text-primary", label: "Scheduled" },
  ON_TIME: { icon: CheckCircle2, color: "bg-accent/10 text-accent", label: "On Time" },
  DEPARTED: { icon: Plane, color: "bg-accent/10 text-accent", label: "Departed" },
  IN_FLIGHT: { icon: Plane, color: "bg-primary/10 text-primary", label: "In Flight" },
  ARRIVED: { icon: CheckCircle2, color: "bg-accent/10 text-accent", label: "Arrived" },
  DELAYED: { icon: AlertTriangle, color: "bg-warning/10 text-warning", label: "Delayed" },
  CANCELLED: { icon: XCircle, color: "bg-destructive/10 text-destructive", label: "Cancelled" },
  DIVERTED: { icon: AlertTriangle, color: "bg-warning/10 text-warning", label: "Diverted" },
  UNKNOWN: { icon: Clock, color: "bg-muted text-muted-foreground", label: "Unknown" },
};

function fmtDT(dt?: string | null) {
  if (!dt) return "—";
  return formatApiTime(dt, { withGMT: true });
}

const FlightStatusBadge = ({ airlineCode, flightNumber, date, compact = false }: FlightStatusProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FlightStatusData | null>(null);

  const numericFlight = String(flightNumber).replace(/\D/g, "");

  const fetchStatus = async () => {
    setLoading(true);
    setData(null);
    try {
      const result = await api.get<FlightStatusData>("/flights/status", {
        airlineCode, flightNumber: numericFlight, date,
      });
      if (!result || typeof result !== 'object') {
        setData({ success: false, error: "Empty response from flight status service" });
      } else {
        setData(result);
      }
    } catch (err: any) {
      const msg = err?.message || "Status unavailable";
      setData({ success: false, error: msg.includes("JSON") ? "Flight status data not available for this route" : msg });
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) fetchStatus();
  };

  const flight = data?.flights?.[0];
  const rawStatus = (flight?.status || "UNKNOWN").toUpperCase();
  const cfg = statusConfig[rawStatus] || statusConfig.UNKNOWN;
  const StatusIcon = cfg.icon;

  if (compact) {
    return (
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-muted-foreground hover:text-foreground">
            <Plane className="w-3 h-3" /> Live Status
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <FlightStatusContent
            loading={loading} data={data} flight={flight} cfg={cfg} StatusIcon={StatusIcon}
            airlineCode={airlineCode} flightNumber={flightNumber} date={date}
            onRefresh={fetchStatus}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Badge className={`${cfg.color} border-0 text-[10px] cursor-pointer hover:opacity-80`}>
          <StatusIcon className="w-3 h-3 mr-1" /> Flight Status
        </Badge>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <FlightStatusContent
          loading={loading} data={data} flight={flight} cfg={cfg} StatusIcon={StatusIcon}
          airlineCode={airlineCode} flightNumber={flightNumber} date={date}
          onRefresh={fetchStatus}
        />
      </DialogContent>
    </Dialog>
  );
};

function FlightStatusContent({ loading, data, flight, cfg, StatusIcon, airlineCode, flightNumber, date, onRefresh }: any) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Plane className="w-5 h-5 text-accent" />
          {airlineCode}{String(flightNumber).replace(/\D/g, "")} — {date}
        </DialogTitle>
      </DialogHeader>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : !data?.success ? (
        <div className="text-center py-6">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{data?.error || "Flight status unavailable"}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">FLIFO may not be available for this route</p>
        </div>
      ) : flight ? (
        <div className="space-y-4">
          <div className={`flex items-center gap-2 p-3 rounded-lg ${cfg.color}`}>
            <StatusIcon className="w-5 h-5" />
            <span className="font-bold text-sm">{cfg.label}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Departure</p>
              <p className="text-lg font-black">{flight.origin || "—"}</p>
              <div className="space-y-0.5 text-xs">
                <p>Scheduled: {fmtDT(flight.scheduledDeparture)}</p>
                {flight.estimatedDeparture && <p className="text-warning">Estimated: {fmtDT(flight.estimatedDeparture)}</p>}
                {flight.actualDeparture && <p className="text-accent font-semibold">Actual: {fmtDT(flight.actualDeparture)}</p>}
              </div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Arrival</p>
              <p className="text-lg font-black">{flight.destination || "—"}</p>
              <div className="space-y-0.5 text-xs">
                <p>Scheduled: {fmtDT(flight.scheduledArrival)}</p>
                {flight.estimatedArrival && <p className="text-warning">Estimated: {fmtDT(flight.estimatedArrival)}</p>}
                {flight.actualArrival && <p className="text-accent font-semibold">Actual: {fmtDT(flight.actualArrival)}</p>}
              </div>
            </div>
          </div>

          {flight.equipment && (
            <p className="text-xs text-muted-foreground text-center">Aircraft: {flight.equipment}</p>
          )}

          <Button variant="outline" size="sm" className="w-full text-xs" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3 mr-1" /> Refresh Status
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-6">No status data available</p>
      )}
    </>
  );
}

export default FlightStatusBadge;
