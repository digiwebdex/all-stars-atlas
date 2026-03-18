import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, ArrowRight, CheckCircle2, Plane, TrendingUp, TrendingDown } from "lucide-react";

interface FareComparison {
  label: string;
  searchValue: number;
  revalidatedValue: number;
}

interface PriceChangeModalProps {
  open: boolean;
  onClose: () => void;
  onAccept: () => void;
  loading?: boolean;
  searchBaseFare: number;
  searchTaxes: number;
  searchTotal: number;
  searchClass?: string;
  revalidatedBaseFare: number;
  revalidatedTaxes: number;
  revalidatedTotal: number;
  revalidatedClass?: string;
  currency?: string;
  airline?: string;
  route?: string;
}

const PriceChangeModal = ({
  open, onClose, onAccept, loading,
  searchBaseFare, searchTaxes, searchTotal, searchClass,
  revalidatedBaseFare, revalidatedTaxes, revalidatedTotal, revalidatedClass,
  currency = "৳", airline, route,
}: PriceChangeModalProps) => {
  const totalDiff = revalidatedTotal - searchTotal;
  const isIncrease = totalDiff > 0;
  const classChanged = revalidatedClass && searchClass && revalidatedClass !== searchClass;

  const comparisons: FareComparison[] = [
    { label: "Base Fare", searchValue: searchBaseFare, revalidatedValue: revalidatedBaseFare },
    { label: "Taxes & Fees", searchValue: searchTaxes, revalidatedValue: revalidatedTaxes },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Fare Updated by Airline
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Route info */}
          {(airline || route) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Plane className="w-3.5 h-3.5" />
              <span>{airline}{route ? ` · ${route}` : ""}</span>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            The airline has updated the fare since your search. Please review the adjusted pricing below.
          </p>

          {/* Class change warning */}
          {classChanged && (
            <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-destructive">Booking Class Changed</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  <span className="font-mono font-bold">{searchClass}</span>
                  <ArrowRight className="w-3 h-3 inline mx-1" />
                  <span className="font-mono font-bold">{revalidatedClass}</span>
                  {" "}— This may affect fare rules and refundability.
                </p>
              </div>
            </div>
          )}

          {/* Fare comparison table */}
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 px-3 py-2">
              <span>Component</span>
              <span className="text-right">Search Price</span>
              <span className="text-right">Updated Price</span>
            </div>
            {comparisons.map((c) => {
              const diff = c.revalidatedValue - c.searchValue;
              return (
                <div key={c.label} className="grid grid-cols-3 items-center px-3 py-2 text-sm border-t">
                  <span className="text-muted-foreground text-xs">{c.label}</span>
                  <span className="text-right font-mono text-xs line-through text-muted-foreground/60">
                    {currency}{c.searchValue.toLocaleString()}
                  </span>
                  <span className={`text-right font-mono text-xs font-bold ${diff !== 0 ? (diff > 0 ? "text-destructive" : "text-accent") : ""}`}>
                    {currency}{c.revalidatedValue.toLocaleString()}
                    {diff !== 0 && (
                      <span className="text-[9px] ml-1">
                        ({diff > 0 ? "+" : ""}{currency}{diff.toLocaleString()})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            <Separator />
            <div className="grid grid-cols-3 items-center px-3 py-2.5 bg-muted/30">
              <span className="font-bold text-xs">Total</span>
              <span className="text-right font-mono text-xs line-through text-muted-foreground/60">
                {currency}{searchTotal.toLocaleString()}
              </span>
              <span className={`text-right font-mono text-sm font-black ${isIncrease ? "text-destructive" : "text-accent"}`}>
                {currency}{revalidatedTotal.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Net difference */}
          <div className={`flex items-center justify-between p-3 rounded-lg border ${
            isIncrease ? "bg-destructive/5 border-destructive/20" : "bg-accent/5 border-accent/20"
          }`}>
            <div className="flex items-center gap-2">
              {isIncrease ? (
                <TrendingUp className="w-4 h-4 text-destructive" />
              ) : (
                <TrendingDown className="w-4 h-4 text-accent" />
              )}
              <span className="text-xs font-bold">
                {isIncrease ? "Price Increased" : "Price Decreased"}
              </span>
            </div>
            <Badge variant={isIncrease ? "destructive" : "default"} className="font-mono text-xs">
              {totalDiff > 0 ? "+" : ""}{currency}{totalDiff.toLocaleString()}
            </Badge>
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            Airline fares are dynamic and may change. The updated fare reflects the latest available price from the booking system.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Cancel Booking
          </Button>
          <Button
            onClick={onAccept}
            disabled={loading}
            className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
          >
            {loading ? "Processing..." : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Accept & Book at {currency}{revalidatedTotal.toLocaleString()}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PriceChangeModal;
