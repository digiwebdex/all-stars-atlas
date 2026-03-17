import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { FileText, AlertCircle, RefreshCw, DollarSign, Calendar, Clock } from "lucide-react";
import { api } from "@/lib/api";

interface FareRulesModalProps {
  origin: string;
  destination: string;
  departureDate: string;
  airlineCode: string;
  flightNumber: string;
  fareBasis?: string;
  bookingClass?: string;
  trigger?: React.ReactNode;
}

interface PenaltyInfo {
  type: string;
  amount?: string;
  percentage?: string;
  applicability?: string;
  description?: string;
}

interface FareRulesData {
  success: boolean;
  fareRules?: {
    categories?: number;
    penalties?: PenaltyInfo[];
    rules?: Array<{
      category: string;
      title: string;
      text: string;
    }>;
    rawText?: string;
  };
  error?: string;
}

const penaltyIcons: Record<string, typeof AlertCircle> = {
  exchange: RefreshCw,
  refund: DollarSign,
  noshow: Calendar,
  cancellation: AlertCircle,
};

const penaltyColors: Record<string, string> = {
  exchange: "bg-warning/10 text-warning border-warning/20",
  refund: "bg-accent/10 text-accent border-accent/20",
  noshow: "bg-destructive/10 text-destructive border-destructive/20",
  cancellation: "bg-destructive/10 text-destructive border-destructive/20",
};

const FareRulesModal = ({
  origin, destination, departureDate, airlineCode, flightNumber,
  fareBasis, bookingClass = "Y", trigger,
}: FareRulesModalProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FareRulesData | null>(null);

  // Strip airline code prefix from flight number if present (e.g. "WY318" → "318")
  const cleanFlightNum = String(flightNumber || "").replace(/^[A-Z]{2}/i, "");

  const fetchRules = async () => {
    if (data) return;
    setLoading(true);
    try {
      const result = await api.get<FareRulesData>("/flights/fare-rules", {
        origin, destination, departureDate, airlineCode, flightNumber: cleanFlightNum,
        fareBasis: fareBasis || "", bookingClass,
      });
      if (!result || typeof result !== 'object') {
        setData({ success: false, error: "Empty response from fare rules service" });
      } else {
        setData(result);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to fetch fare rules";
      setData({ success: false, error: msg.includes("JSON") ? "Fare rules not available for this flight" : msg });
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) fetchRules();
  };

  const penalties = data?.fareRules?.penalties || [];
  const rules = data?.fareRules?.rules || [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-muted-foreground hover:text-foreground">
            <FileText className="w-3 h-3" /> Fare Rules
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-accent" />
            Fare Rules — {airlineCode}{flightNumber}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{origin} → {destination} · {departureDate}{fareBasis ? ` · ${fareBasis}` : ""}</p>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !data?.success ? (
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{data?.error || "Fare rules not available for this flight"}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Contact support for detailed fare conditions</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Penalties Summary */}
            {penalties.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-muted-foreground">Penalty Summary</p>
                <div className="grid gap-2">
                  {penalties.map((p, i) => {
                    const Icon = penaltyIcons[p.type] || AlertCircle;
                    const color = penaltyColors[p.type] || "bg-muted text-muted-foreground";
                    return (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${color}`}>
                        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold capitalize">{p.type.replace(/_/g, " ")}</p>
                          {p.amount && <p className="text-xs">Fee: {p.amount}</p>}
                          {p.percentage && <p className="text-xs">{p.percentage}% penalty</p>}
                          {p.description && <p className="text-xs opacity-80">{p.description}</p>}
                          {p.applicability && <p className="text-[10px] opacity-60 mt-1">{p.applicability}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {penalties.length === 0 && rules.length === 0 && (
              <div className="text-center py-6">
                <Clock className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No structured fare rules returned by the airline</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Standard fare conditions apply — contact your airline for details</p>
              </div>
            )}

            {/* Detailed Rules */}
            {rules.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase text-muted-foreground">Detailed Fare Conditions</p>
                  {rules.map((rule, i) => (
                    <details key={i} className="border border-border rounded-lg">
                      <summary className="px-3 py-2 text-sm font-medium cursor-pointer hover:bg-muted/30">
                        {rule.category}: {rule.title}
                      </summary>
                      <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50 whitespace-pre-wrap">
                        {rule.text}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            )}

            <div className="text-[10px] text-muted-foreground/50 text-center pt-2">
              Fare rules sourced from {airlineCode} via Sabre GDS · Subject to change
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FareRulesModal;
