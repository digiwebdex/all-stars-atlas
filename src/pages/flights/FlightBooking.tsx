import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Plane, ArrowRight, User, Clock, Luggage, Shield, CreditCard,
  UtensilsCrossed, Plus, Briefcase, Users, FileText,
  AlertCircle, CheckCircle2, Timer, AlertTriangle, Package,
  ScanLine, Search, Share2, Save, Upload, X, Eye,
  Accessibility, Heart, Dog, Baby, MessageSquare, Star,
  Armchair, Info, Gift, Ticket, Copy, Check,
} from "lucide-react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { usePrefixedNavigate } from "@/hooks/useRoutePrefix";
import { useCmsPageContent } from "@/hooks/useCmsContent";
import { NATIONALITY_OPTIONS, COUNTRY_OPTIONS } from "@/lib/countries";
import { useAuth } from "@/hooks/useAuth";
import AuthGateModal from "@/components/AuthGateModal";
import { api } from "@/lib/api";
import type { BookingFormField } from "@/lib/cms-defaults";
import PassportScanner from "@/components/PassportScanner";
import SearchPassengerModal from "@/components/SearchPassengerModal";
import { formatApiDate, formatApiTime } from "@/lib/flight-time";
import ShareItineraryModal from "@/components/ShareItineraryModal";
import SeatMap from "@/components/flights/SeatMap";
import { motion, AnimatePresence } from "framer-motion";
import PriceChangeModal from "@/components/flights/PriceChangeModal";

// ─── Bangladesh domestic airports ───
const BD_AIRPORTS = ["DAC", "CXB", "CGP", "ZYL", "JSR", "RJH", "SPD", "BZL", "IRD", "TKR"];

function isDomesticRoute(origin?: string, destination?: string): boolean {
  if (!origin || !destination) return true;
  return BD_AIRPORTS.includes(origin.toUpperCase()) && BD_AIRPORTS.includes(destination.toUpperCase());
}

function isBimanAirline(airlineCode?: string): boolean {
  return airlineCode?.toUpperCase() === "BG";
}

/** API-only deadline: uses airline-provided timeLimit from GDS. No hardcoded fallbacks. */
function resolveDeadlineInfo(flight: any): { deadline: Date; label: string } | null {
  if (!flight?.timeLimit) return null;
  const tl = new Date(flight.timeLimit);
  if (isNaN(tl.getTime()) || tl <= new Date()) return null;
  const now = new Date();
  const hoursLeft = Math.max(1, Math.floor((tl.getTime() - now.getTime()) / (1000 * 60 * 60)));
  const deadlineDateLabel = formatApiDate(flight.timeLimit, { year: "numeric" });
  const deadlineTimeLabel = formatApiTime(flight.timeLimit, { withGMT: true });
  const label = hoursLeft > 24
    ? `Pay within ${Math.ceil(hoursLeft / 24)} days (by ${deadlineDateLabel} ${deadlineTimeLabel})`
    : `Pay within ${hoursLeft} hours (by ${deadlineTimeLabel})`;
  return { deadline: tl, label };
}

function getAirlineLogo(code?: string): string | null {
  if (!code) return null;
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}
function fmtTime(dt?: string) { return dt ? formatApiTime(dt, { withGMT: true }) : "—"; }
function fmtDate(dt?: string) { return dt ? formatApiDate(dt, { year: "numeric" }) : "—"; }

/* ─── No hardcoded defaults — extras only from real API data ─── */

/* ─── Airline Support Info Dialog ─── */
const AirlineSupportDialog = ({ 
  airline, airlineCode, hasBaggage, hasHandBaggage, hasSeatMap, hasExtras, seatMapSource, ancillarySource 
}: { 
  airline?: string; airlineCode?: string; hasBaggage: boolean; hasHandBaggage: boolean; 
  hasSeatMap: boolean; hasExtras: boolean; seatMapSource: string; ancillarySource: string;
}) => {
  const [allAirlines, setAllAirlines] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (showAll && allAirlines.length === 0) {
      api.get<any>("/flights/airline-capabilities")
        .then((res) => setAllAirlines(res?.airlines || []))
        .catch(() => {});
    }
  }, [showAll, allAirlines.length]);

  const features = [
    { 
      label: "Checked Baggage Info", 
      available: hasBaggage, 
      source: "BFM Search",
      desc: hasBaggage ? "Baggage allowance provided by the airline's booking system" : "Not provided in this fare — check airline website",
    },
    { 
      label: "Hand Baggage Info", 
      available: hasHandBaggage, 
      source: "BFM Search",
      desc: hasHandBaggage ? "Cabin baggage allowance included in fare data" : "Not provided in this fare — typically 7kg for Economy",
    },
    { 
      label: "Seat Map / Seat Selection", 
      available: hasSeatMap, 
      source: seatMapSource === "sabre" ? "Sabre SOAP (Live)" : seatMapSource,
      desc: hasSeatMap ? "Real-time seat availability from the airline's system" : "Not available — seats will be assigned at check-in",
    },
    { 
      label: "Extra Baggage (Paid)", 
      available: hasExtras && ancillarySource !== "none" && ancillarySource !== "bfm", 
      source: ancillarySource === "sabre" ? "Sabre GAO" : ancillarySource === "tti" ? "TTI" : "Post-booking",
      desc: "Extra baggage and meal options are available after booking (requires PNR). You can add extras from your dashboard after confirming your booking.",
      postBooking: true,
    },
    { 
      label: "Meal Selection (Paid)", 
      available: hasExtras && ancillarySource !== "none" && ancillarySource !== "bfm", 
      source: ancillarySource === "sabre" ? "Sabre GAO" : ancillarySource === "tti" ? "TTI" : "Post-booking",
      desc: "Premium meal options become available after PNR creation. Free SSR meal requests (Halal, Vegetarian, etc.) can be added in Step 2.",
      postBooking: true,
    },
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="text-xs text-accent hover:underline inline-flex items-center gap-1">
          <Info className="w-3 h-3" /> Airline data availability
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {airlineCode && (
              <img src={`https://images.kiwi.com/airlines/64/${airlineCode}.png`} alt="" className="w-6 h-6 object-contain" 
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            {airline || "Airline"} — Data Availability
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <p className="text-xs text-muted-foreground">
            Data availability depends on what the airline provides through its booking system. Features marked as unavailable are not provided by this airline for this specific fare.
          </p>
          {features.map((f, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${f.available ? "border-accent/20 bg-accent/5" : "border-border bg-muted/30"}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${f.available ? "bg-accent/20" : "bg-muted"}`}>
                {f.available ? <CheckCircle2 className="w-3.5 h-3.5 text-accent" /> : <X className="w-3 h-3 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{f.label}</p>
                  {(f as any).postBooking && <Badge variant="outline" className="text-[9px] h-4">After Booking</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{f.desc}</p>
                {f.available && <p className="text-[10px] text-accent mt-1">Source: {f.source}</p>}
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg border border-primary/10">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground">
              <strong>SSR services (meal preference, wheelchair, extra baggage request)</strong> are available for ALL airlines during Step 2 of the booking process — no PNR needed.
            </p>
          </div>

          {/* All Airlines Capability Matrix */}
          <Separator />
          <button 
            onClick={() => setShowAll(!showAll)}
            className="w-full text-xs font-semibold text-accent hover:underline flex items-center justify-center gap-1.5 py-1"
          >
            <Plane className="w-3.5 h-3.5" />
            {showAll ? "Hide" : "View"} All Airlines Capability Matrix
          </button>

          {showAll && (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr,auto,auto,auto,auto] gap-x-2 text-[10px] font-bold text-muted-foreground px-2 py-1.5 bg-muted/50 rounded-t-lg border-b">
                <span>Airline</span>
                <span className="text-center w-12">Seat Map</span>
                <span className="text-center w-12">Baggage</span>
                <span className="text-center w-8">SSR</span>
                <span className="text-center w-12">Extras</span>
              </div>
              {allAirlines.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Loading...</div>
              ) : (
                allAirlines.map((a: any) => {
                  const isCurrentAirline = a.airlineCode === airlineCode;
                  return (
                    <div 
                      key={a.airlineCode} 
                      className={`grid grid-cols-[1fr,auto,auto,auto,auto] gap-x-2 items-center text-[11px] px-2 py-1.5 rounded ${
                        isCurrentAirline ? "bg-accent/10 border border-accent/20 font-semibold" : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <img 
                          src={`https://images.kiwi.com/airlines/64/${a.airlineCode}.png`} 
                          alt="" 
                          className="w-4 h-4 object-contain shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span className="truncate">{a.airline}</span>
                        <span className="text-[9px] text-muted-foreground font-mono">{a.airlineCode}</span>
                        {isCurrentAirline && <Badge variant="default" className="text-[8px] h-3.5 px-1 bg-accent">Current</Badge>}
                      </div>
                      <div className="text-center w-12">
                        {a.seatMap?.available ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-accent mx-auto" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />
                        )}
                      </div>
                      <div className="text-center w-12">
                        {a.baggage?.hasChecked ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-accent mx-auto" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-muted-foreground/40 mx-auto" />
                        )}
                      </div>
                      <div className="text-center w-8">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent mx-auto" />
                      </div>
                      <div className="text-center w-12">
                        {a.gaoAncillaries ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-accent mx-auto" />
                        ) : (
                          <span className="text-[9px] text-muted-foreground">SSR Only</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div className="text-[9px] text-muted-foreground px-2 pt-2 space-y-1 border-t mt-1">
                <p><strong>Seat Map:</strong> Real-time seat layout via Sabre SOAP (pre-booking, no PNR needed)</p>
                <p><strong>Baggage:</strong> Checked & hand baggage info from search results</p>
                <p><strong>SSR:</strong> Meal preferences, wheelchair, extra baggage requests — works for ALL airlines</p>
                <p><strong>Extras:</strong> Paid ancillaries (meals/baggage purchase) via Sabre GAO — requires EMD entitlement</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Add-on Card ─── */
const AddOnCard = ({ item, selected, onSelect, multi }: { item: { id: string; name: string; price: number; desc: string; icon?: string }; selected: boolean; onSelect: () => void; multi?: boolean }) => (
  <label className={`flex items-center gap-3 p-3 sm:p-4 rounded-xl border cursor-pointer transition-all ${
    selected ? "border-accent bg-accent/5 shadow-sm" : "border-border hover:border-accent/40"
  }`}>
    <Checkbox checked={selected} onCheckedChange={onSelect} />
    {item.icon && <span className="text-lg shrink-0">{item.icon}</span>}
    <div className="flex-1 min-w-0"><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
    <span className={`text-sm font-bold shrink-0 ${item.price === 0 ? "text-accent" : "text-foreground"}`}>
      {item.price === 0 ? "Free" : `৳${item.price.toLocaleString()}`}
    </span>
  </label>
);

/* ─── Session countdown timer — redirects to search on expiry ─── */
const SessionTimer = ({ minutes = 20, onExpired }: { minutes?: number; onExpired?: () => void }) => {
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60);
  const expiredRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => setSecondsLeft(prev => {
      if (prev <= 1 && !expiredRef.current) {
        expiredRef.current = true;
        onExpired?.();
        return 0;
      }
      return prev > 0 ? prev - 1 : 0;
    }), 1000);
    return () => clearInterval(interval);
  }, [onExpired]);
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const isUrgent = secondsLeft < 300;
  return (
    <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold ${isUrgent ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
      <Timer className="w-4 h-4 shrink-0" />
      <span className="hidden sm:inline">Session Timeout in</span>
      <span className="sm:hidden">Timeout</span>
      <span className="font-mono text-sm sm:text-base">{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</span>
    </div>
  );
};

/* ─── Compact flight segment card ─── */
const FlightSegmentCard = ({ flight, label, searchedCabinClass }: { flight: any; label: string; searchedCabinClass?: string }) => {
  const logo = getAirlineLogo(flight?.airlineCode);
  if (!flight) return (
    <Card className="border-dashed"><CardContent className="py-8 text-center">
      <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No {label.toLowerCase()} flight selected</p>
    </CardContent></Card>
  );

  return (
    <Card className="overflow-hidden border-accent/20">
      <div className={`px-4 py-2.5 flex items-center gap-2 ${
        label === "Return" 
          ? "bg-amber-500/15 border-b border-amber-400/30" 
          : label.startsWith("Segment") 
            ? "bg-blue-500/15 border-b border-blue-400/30"
            : "bg-accent/15 border-b border-accent/30"
      }`}>
        <Plane className={`w-4 h-4 ${label === "Return" ? "rotate-180 text-amber-700 dark:text-amber-300" : label.startsWith("Segment") ? "text-blue-700 dark:text-blue-300" : "text-accent"}`} />
        <span className={`text-xs sm:text-sm font-bold ${
          label === "Return" ? "text-amber-700 dark:text-amber-300" : label.startsWith("Segment") ? "text-blue-700 dark:text-blue-300" : "text-accent"
        }`}>{label}: {flight.origin} → {flight.destination}</span>
        <span className="flight-date text-[10px] sm:text-xs ml-auto">· {fmtDate(flight.departureTime)}</span>
      </div>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-3 sm:gap-4">
          {logo && <img src={logo} alt={flight.airline} className="w-8 h-8 sm:w-10 sm:h-10 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
          <div className="flex-1 flex items-center gap-2 sm:gap-4 min-w-0">
            <div className="text-center shrink-0">
              <p className="text-lg sm:text-xl font-black flight-time">{fmtTime(flight.departureTime)}</p>
              <p className="text-[10px] text-muted-foreground font-semibold">{flight.origin}</p>
            </div>
            <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
              <p className="text-[10px] text-muted-foreground">{flight.duration}</p>
              <div className="w-full flex items-center"><div className="w-2 h-2 rounded-full bg-accent shrink-0" /><div className="flex-1 h-px bg-accent/30" /><div className="w-2 h-2 rounded-full bg-accent shrink-0" /></div>
              <p className="text-[10px] text-accent font-semibold">{flight.stops === 0 ? "Non-stop" : `${flight.stops} Stop`}</p>
            </div>
            <div className="text-center shrink-0">
              <p className="text-lg sm:text-xl font-black flight-time">{fmtTime(flight.arrivalTime)}</p>
              <p className="text-[10px] text-muted-foreground font-semibold">{flight.destination}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 border border-border/60 text-[10px] sm:text-[11px] font-semibold text-muted-foreground">
            {flight.airline} · {flight.flightNumber}
          </span>
          {(flight.handBaggage || "7KG") && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              <Package className="w-3 h-3" /> {flight.handBaggage || "7KG"}
            </span>
          )}
          {flight.baggage && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              <Luggage className="w-3 h-3" /> {flight.baggage}
            </span>
          )}
          {(searchedCabinClass || flight.cabinClass) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 border border-border/60 text-[10px] sm:text-[11px] font-semibold text-muted-foreground">
              <Plane className="w-3 h-3" /> {searchedCabinClass || flight.cabinClass}
            </span>
          )}
          {flight.refundable !== undefined && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-bold ${
              flight.refundable
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400"
                : "bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40 text-destructive"
            }`}>
              {flight.refundable ? "Refundable" : "Non-Refundable"}
            </span>
          )}
          {flight.aircraft && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 border border-border/60 text-[10px] sm:text-[11px] font-semibold text-muted-foreground">
              Aircraft: {flight.aircraft}
            </span>
          )}
          {/* Sabre capability indicators */}
          {(() => {
            const isSabre = String(flight.source || '').toLowerCase().includes('sabre') || !!flight._sabreSource || !!flight._sabreSeqNumber;
            if (!isSabre) return null;
            return (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
                  💺 Seat Map
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
                  🍽 Meal Options
                </span>
              </>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
};

const FlightBooking = () => {
  const [sessionExpired, setSessionExpired] = useState(false);
  const [step, setStep] = useState(1);
  const [authOpen, setAuthOpen] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingResult, setBookingResult] = useState<any>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);

  // ── Pre-book price revalidation guard ──
  const [priceChangeOpen, setPriceChangeOpen] = useState(false);
  const [revalidatedFare, setRevalidatedFare] = useState<{
    baseFare: number; taxes: number; total: number; bookingClass?: string;
    currency?: string;
  } | null>(null);
  const [pendingPayLater, setPendingPayLater] = useState(true);


  // ── Coupon / Reward Points ──
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; amount: number } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponCopied, setCouponCopied] = useState(false);

  // Fetch user's available coupons for auto-suggest
  const { data: userCoupons } = useQuery({
    queryKey: ["rewards", "coupons"],
    queryFn: () => api.get<any>("/rewards/coupons"),
    staleTime: 30000,
  });
  const activeCoupons = (userCoupons as any)?.data?.filter((c: any) => c.status === "active") || [];

  const handleApplyCoupon = async (code?: string) => {
    const codeToApply = (code || couponCode).trim().toUpperCase();
    if (!codeToApply) { toast({ title: "Enter Coupon Code", description: "Please enter or select a coupon code.", variant: "destructive" }); return; }
    setCouponLoading(true);
    try {
      const result = await api.post<any>("/rewards/validate-coupon", { code: codeToApply });
      if (result.valid) {
        setAppliedCoupon({ code: result.code, amount: parseFloat(result.amount) });
        setCouponCode(result.code);
        toast({ title: "Coupon Applied! 🎉", description: `BDT ${parseFloat(result.amount).toLocaleString()} discount applied.` });
      }
    } catch (err: any) {
      toast({ title: "Invalid Coupon", description: err.message || "Could not validate coupon.", variant: "destructive" });
      setAppliedCoupon(null);
    } finally { setCouponLoading(false); }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode("");
  };
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const navigate = usePrefixedNavigate();
  const { isAuthenticated } = useAuth();
  const { data: page, isLoading } = useCmsPageContent("/flights/book");
  const { toast } = useToast();

  const [selectedMeal, setSelectedMeal] = useState("");
  const [selectedBaggage, setSelectedBaggage] = useState<string[]>([]);

  // Read passenger counts from URL — MUST be before any state that depends on paxTypes
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const locationState = location.state as any;

  const adultCount = parseInt(searchParams.get("adults") || "1");
  const childCount = parseInt(searchParams.get("children") || "0");
  const infantCount = parseInt(searchParams.get("infants") || "0");
  const searchCabin = searchParams.get("cabin") || "economy";
  const totalPaxCount = adultCount + childCount + infantCount;

  // Build passenger type labels
  const paxTypes: { type: "adult" | "child" | "infant"; label: string }[] = [];
  for (let i = 0; i < adultCount; i++) paxTypes.push({ type: "adult", label: `Adult ${adultCount > 1 ? i + 1 : ""}`.trim() });
  for (let i = 0; i < childCount; i++) paxTypes.push({ type: "child", label: `Child ${childCount > 1 ? i + 1 : ""}`.trim() });
  for (let i = 0; i < infantCount; i++) paxTypes.push({ type: "infant", label: `Infant ${infantCount > 1 ? i + 1 : ""}`.trim() });

  const emptyPax = () => ({ title: "", firstName: "", lastName: "", dob: "", nationality: "Bangladeshi", passport: "", passportExpiry: "", email: "", phone: "", gender: "", documentCountry: "BD" });

  const [passengers, setPassengers] = useState(() => paxTypes.map(() => emptyPax()));
  const [passportScanOpen, setPassportScanOpen] = useState(false);
  const [searchPaxOpen, setSearchPaxOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activePaxIndex, setActivePaxIndex] = useState(0);

  // ── Seat Selection State ──
  const [selectedSeats, setSelectedSeats] = useState<Record<number, string>>({});
  const [seatPrices, setSeatPrices] = useState<Record<number, number>>({});
  const [seatMapData, setSeatMapData] = useState<any>(null);
  const [seatMapLoading, setSeatMapLoading] = useState(false);
  const [seatMapSource, setSeatMapSource] = useState("none");

  const handleSeatSelect = (paxIndex: number, seatId: string, price: number) => {
    setSelectedSeats(prev => ({ ...prev, [paxIndex]: seatId }));
    setSeatPrices(prev => ({ ...prev, [paxIndex]: price }));
  };
  const handleSeatDeselect = (paxIndex: number) => {
    setSelectedSeats(prev => { const n = { ...prev }; delete n[paxIndex]; return n; });
    setSeatPrices(prev => { const n = { ...prev }; delete n[paxIndex]; return n; });
  };
  const totalSeatCost = Object.values(seatPrices).reduce((sum, p) => sum + p, 0);

  // ── Special Services (SSR) — sent to GDS for all airlines ──
  const MEAL_CODES = [
    { code: "none", label: "No Preference", icon: "🍽️" },
    { code: "AVML", label: "Asian Vegetarian", icon: "🥗" },
    { code: "VGML", label: "Vegetarian (Lacto-Ovo)", icon: "🥬" },
    { code: "MOML", label: "Muslim / Halal", icon: "🍖" },
    { code: "KSML", label: "Kosher", icon: "✡️" },
    { code: "DBML", label: "Diabetic", icon: "💊" },
    { code: "CHML", label: "Child Meal", icon: "🧒" },
    { code: "BBML", label: "Baby Meal", icon: "👶" },
    { code: "GFML", label: "Gluten-Free", icon: "🌾" },
    { code: "LFML", label: "Low Fat", icon: "🥗" },
    { code: "LCML", label: "Low Calorie", icon: "🍃" },
    { code: "NLML", label: "Low Salt", icon: "🧂" },
    { code: "SFML", label: "Seafood", icon: "🦐" },
    { code: "FPML", label: "Fruit Platter", icon: "🍎" },
    { code: "RVML", label: "Raw Vegetarian", icon: "🥒" },
    { code: "SPML", label: "Special (Notify Airline)", icon: "⭐" },
  ];
  const WHEELCHAIR_OPTIONS = [
    { code: "none", label: "No assistance needed" },
    { code: "WCHR", label: "Wheelchair to aircraft door (can climb stairs)" },
    { code: "WCHS", label: "Wheelchair to seat (cannot climb stairs)" },
    { code: "WCHC", label: "Wheelchair — fully immobile (carried to seat)" },
  ];

  interface PaxSpecialServices {
    meal: string;
    wheelchair: string;
    medical: boolean;
    medicalDetails: string;
    blind: boolean;
    deaf: boolean;
    unaccompaniedMinor: boolean;
    umnrAge: string;
    pet: string;
    petDetails: string;
    frequentFlyer: { airline: string; number: string };
    specialRequest: string;
    destinationAddress: string;
  }

  const emptySSR = (): PaxSpecialServices => ({
    meal: "none", wheelchair: "none", medical: false, medicalDetails: "",
    blind: false, deaf: false, unaccompaniedMinor: false, umnrAge: "",
    pet: "none", petDetails: "", frequentFlyer: { airline: "", number: "" },
    specialRequest: "", destinationAddress: "",
  });

  const [paxSpecialServices, setPaxSpecialServices] = useState<PaxSpecialServices[]>(() => paxTypes.map(() => emptySSR()));
  const [ssrExpanded, setSsrExpanded] = useState<number | null>(null);

  const updatePaxSSR = (pi: number, field: string, value: any) => {
    setPaxSpecialServices(prev => {
      const updated = [...prev];
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        (updated[pi] as any)[parent] = { ...(updated[pi] as any)[parent], [child]: value };
      } else {
        (updated[pi] as any)[field] = value;
      }
      return updated;
    });
  };

  const hasAnySSR = paxSpecialServices.some(s =>
    s.meal !== "none" || s.wheelchair !== "none" || s.medical || s.blind || s.deaf ||
    s.unaccompaniedMinor || s.pet !== "none" || s.frequentFlyer.number || s.specialRequest.trim()
  );

  // Ancillary data from real API ONLY — no fake fallbacks
  const [mealOptions, setMealOptions] = useState<{ id: string; name: string; price: number; desc: string; icon?: string }[]>([]);
  const [baggageOptions, setBaggageOptions] = useState<{ id: string; name: string; price: number; desc: string; icon?: string }[]>([]);
  const [ancillarySource, setAncillarySource] = useState("none");
  const [ancillaryLoading, setAncillaryLoading] = useState(false);

  // Travel document uploads (passport copy + visa copy) for international flights
  const [travelDocs, setTravelDocs] = useState<Record<string, { file: File; url?: string; uploading?: boolean }>>({});
  const [travelDocsUploaded, setTravelDocsUploaded] = useState<Record<string, { url: string; originalName: string; fieldname: string }>>({});

  const isRoundTrip = searchParams.get("roundTrip") === "true" || !!locationState?.returnFlight;

  const outboundFlight = locationState?.outboundFlight || null;
  const returnFlight = locationState?.returnFlight || null;

  // Multi-city flights support
  const multiCityFlights: any[] = locationState?.multiCityFlights || [];
  const isMultiCity = multiCityFlights.length >= 2;

  // Session expired → show modal overlay (no redirect)
  const handleSessionExpired = useCallback(() => {
    setSessionExpired(true);
  }, []);

  const handleNewSearch = useCallback(() => {
    const origin = outboundFlight?.origin || searchParams.get("from") || "";
    const dest = outboundFlight?.destination || searchParams.get("to") || "";
    const p = new URLSearchParams();
    if (origin) p.set("from", origin);
    if (dest) p.set("to", dest);
    const cabin = searchParams.get("cabin");
    if (cabin) p.set("cabin", cabin);
    const adts = searchParams.get("adults");
    if (adts) p.set("adults", adts);
    const chd = searchParams.get("children");
    if (chd && chd !== "0") p.set("children", chd);
    const inf = searchParams.get("infants");
    if (inf && inf !== "0") p.set("infants", inf);
    navigate(`/flights?${p.toString()}`);
  }, [outboundFlight, searchParams, navigate]);

  const serviceFlight = useMemo(() => {
    if (multiCityFlights.length > 0) return multiCityFlights[0];
    if (outboundFlight?.segments?.length > 0) return outboundFlight.segments[0];
    return outboundFlight;
  }, [multiCityFlights, outboundFlight]);

  const bookingFlightData = useMemo(() => {
    if (isMultiCity && multiCityFlights.length > 1) {
      const first = multiCityFlights[0];
      const last = multiCityFlights[multiCityFlights.length - 1];
      return {
        ...first,
        destination: last?.destination || first?.destination,
        arrivalTime: last?.arrivalTime || first?.arrivalTime,
        legs: multiCityFlights,
        isMultiCity: true,
      };
    }

    if (outboundFlight?.segments?.length > 0 && !outboundFlight?.legs?.length) {
      const first = outboundFlight.segments[0];
      const last = outboundFlight.segments[outboundFlight.segments.length - 1];
      return {
        ...outboundFlight,
        ...first,
        destination: last?.destination || first?.destination,
        arrivalTime: last?.arrivalTime || first?.arrivalTime,
        legs: outboundFlight.segments,
      };
    }

    return outboundFlight;
  }, [isMultiCity, multiCityFlights, outboundFlight]);

  const getFlightDateTimeParts = (dateTime?: string) => {
    if (!dateTime) return { date: null as string | null, time: null as string | null };
    const raw = String(dateTime);
    const isoLike = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
    if (isoLike) return { date: isoLike[1], time: isoLike[2] };

    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return { date: null as string | null, time: null as string | null };

    const localDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const localTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    return { date: localDate, time: localTime };
  };

  const isBiman = isBimanAirline(bookingFlightData?.airlineCode) || isBimanAirline(returnFlight?.airlineCode);
  const domestic = isDomesticRoute(serviceFlight?.origin, serviceFlight?.destination);

  // Fetch ancillaries from API
  useEffect(() => {
    if (!serviceFlight) return;
    const fetchAncillaries = async () => {
      try {
        const params: Record<string, string> = {
          airlineCode: serviceFlight.airlineCode || "",
          origin: serviceFlight.origin || "",
          destination: serviceFlight.destination || "",
        };
        // Sabre SOAP needs these for EnhancedSeatMap & GetAncillaryOffers
        if (serviceFlight.flightNumber) params.flightNumber = String(serviceFlight.flightNumber).replace(/^[A-Z]{2}/i, '');
        if (serviceFlight.departureTime) {
          const { date, time } = getFlightDateTimeParts(serviceFlight.departureTime);
          if (date) params.departureDate = date;
          if (time) params.departureTime = time;
        }
        if (serviceFlight._ttiItineraryRef) params.itineraryRef = serviceFlight._ttiItineraryRef;
        if (serviceFlight.cabinClass) params.cabinClass = serviceFlight.cabinClass;
        params.adults = String(adultCount);
        if (childCount > 0) params.children = String(childCount);
        if (serviceFlight.baggage) params.checkedBaggage = serviceFlight.baggage;
        if (serviceFlight.handBaggage) params.handBaggage = serviceFlight.handBaggage;

        const data = await api.get<any>("/flights/ancillaries", params);
        if (data?.source) {
          setAncillarySource(data.source);
          if (data.meals?.length > 0) {
            setMealOptions(data.meals.map((m: any) => ({
              id: m.id, name: m.name, price: m.price || 0, desc: m.description || "", icon: m.category === "dietary" ? "🥗" : m.category === "premium" ? "🦐" : "🍽️",
            })));
          }
          if (data.baggage?.length > 0) {
            setBaggageOptions(data.baggage.map((b: any) => ({
              id: b.id, name: b.name, price: b.price || 0, desc: b.description || "", icon: b.type === "special" ? "📦" : "🧳",
            })));
          }
        }
      } catch {
        // No API available — no extras shown
      }
    };
    fetchAncillaries();
  }, [serviceFlight, adultCount, childCount]);

  // ── Fetch seat map from API ──
  useEffect(() => {
    if (!serviceFlight) return;
    const fetchSeatMap = async () => {
      setSeatMapLoading(true);
      try {
        const params: Record<string, string> = {
          airlineCode: serviceFlight.airlineCode || "",
          origin: serviceFlight.origin || "",
          destination: serviceFlight.destination || "",
          aircraft: serviceFlight.aircraft || "A320",
          cabinClass: serviceFlight.cabinClass || searchCabin || "Economy",
        };
        if (serviceFlight.flightNumber) params.flightNumber = String(serviceFlight.flightNumber).replace(/^[A-Z]{2}/i, '');
        if (serviceFlight.departureTime) {
          const { date } = getFlightDateTimeParts(serviceFlight.departureTime);
          if (date) params.departureDate = date;
        }
        if (serviceFlight._ttiItineraryRef) params.itineraryRef = serviceFlight._ttiItineraryRef;
        const data = await api.get<any>("/flights/seat-map", params);
        if (data) {
          setSeatMapData(data);
          setSeatMapSource(data.source || "none");
        }
      } catch {
        setSeatMapSource("none");
      } finally {
        setSeatMapLoading(false);
      }
    };
    fetchSeatMap();
  }, [serviceFlight, searchCabin]);

  const mealCost = mealOptions.find(m => m.id === selectedMeal)?.price || 0;
  const baggageCost = selectedBaggage.reduce((sum, id) => sum + (baggageOptions.find(b => b.id === id)?.price || 0), 0);
  const addOnTotal = (mealCost + baggageCost) * totalPaxCount + totalSeatCost;

  // ── Payable fare calculation (matches FlightResults logic) ──
  // Applies discount + AIT VAT to derive what the customer actually pays
  const calcFlightPayable = (f: any) => {
    if (!f) return { grossPrice: 0, baseFare: 0, taxes: 0, discount: 0, aitVat: 0, payable: 0 };
    const gross = f.price || 0;
    const tx = f.taxes ?? 0;
    const bf = Math.max(0, Math.round(gross - tx));
    const discPct = f.fareRules?.discount ?? 0;
    const aitPct = f.fareRules?.aitVat ?? 0;
    const disc = Math.round(bf * discPct / 100);
    const ait = Math.round(bf * aitPct / 100);
    return { grossPrice: gross, baseFare: bf, taxes: tx, discount: disc, aitVat: ait, payable: bf - disc + tx + ait, discPct, aitPct };
  };

  const outboundCalc = calcFlightPayable(outboundFlight);
  const returnCalc = calcFlightPayable(returnFlight);
  const multiCityCalcs = isMultiCity ? multiCityFlights.map((f: any) => calcFlightPayable(f)) : [];
  const multiCityPayable = multiCityCalcs.reduce((sum: number, c: any) => sum + c.payable, 0);

  const perPaxBaseFare = isMultiCity 
    ? multiCityCalcs.reduce((s: number, c: any) => s + c.baseFare, 0) 
    : (outboundCalc.baseFare + returnCalc.baseFare);
  const baseFare = perPaxBaseFare * totalPaxCount;
  
  const perPaxTaxes = isMultiCity
    ? multiCityCalcs.reduce((s: number, c: any) => s + c.taxes, 0)
    : (outboundCalc.taxes + returnCalc.taxes);
  const taxes = perPaxTaxes * totalPaxCount;

  const perPaxDiscount = isMultiCity
    ? multiCityCalcs.reduce((s: number, c: any) => s + c.discount, 0)
    : (outboundCalc.discount + returnCalc.discount);
  const totalDiscount = perPaxDiscount * totalPaxCount;

  const perPaxAitVat = isMultiCity
    ? multiCityCalcs.reduce((s: number, c: any) => s + c.aitVat, 0)
    : (outboundCalc.aitVat + returnCalc.aitVat);
  const totalAitVat = perPaxAitVat * totalPaxCount;

  const serviceCharge = outboundFlight?.serviceCharge ?? 0;
  const perPaxPayable = isMultiCity ? multiCityPayable : (outboundCalc.payable + returnCalc.payable);
  const couponDiscount = appliedCoupon ? Math.min(appliedCoupon.amount, (perPaxPayable * totalPaxCount) + serviceCharge + addOnTotal) : 0;
  const grandTotal = (perPaxPayable * totalPaxCount) + serviceCharge + addOnTotal - couponDiscount;

  // Discount/AIT percentages for display
  const DISCOUNT_PCT = outboundFlight?.fareRules?.discount ?? 0;
  const AIT_VAT_PCT = outboundFlight?.fareRules?.aitVat ?? 0;

  const deadlineInfo = resolveDeadlineInfo(bookingFlightData);

  // ─── Partial-payment eligibility (admin-configurable rules) ───
  const [partialRules, setPartialRules] = useState({ enabled: true, minHours: 96, upfrontPct: 30 });
  useEffect(() => {
    api.get<any>('/admin/settings').then(d => {
      const s = d?.settings || {};
      setPartialRules({
        enabled: s.b2c_partial_enabled === undefined ? true : String(s.b2c_partial_enabled).toLowerCase() === 'true',
        minHours: Number(s.partial_min_hours ?? 96),
        upfrontPct: Number(s.partial_upfront_pct ?? 30),
      });
    }).catch(() => {});
  }, []);

  const partialEligible = useMemo(() => {
    if (!partialRules.enabled) return false;
    const origin = (bookingFlightData?.origin || '').toUpperCase();
    const dest = (bookingFlightData?.destination || '').toUpperCase();
    if (BD_AIRPORTS.includes(origin) && BD_AIRPORTS.includes(dest)) return false; // domestic
    if (bookingFlightData?.refundable === false) return false;
    const depRaw = bookingFlightData?.departureTime || bookingFlightData?.legs?.[0]?.departureTime;
    if (!depRaw) return false;
    const hoursToDep = (new Date(depRaw).getTime() - Date.now()) / 3600000;
    return hoursToDep >= partialRules.minHours;
  }, [partialRules, bookingFlightData]);

  // Always 4 steps: Flight Details → Passenger Info → Seat & Extras → Review & Pay
  const STEPS = [
    { label: "Flight Details", icon: Plane },
    { label: "Passenger Info", icon: Users },
    { label: "Seat & Extras", icon: Armchair },
    { label: "Review & Pay", icon: CreditCard },
  ];
  const totalSteps = 4;
  const reviewStep = 4;
  const seatExtrasStep = 3;

  const validateStep = (currentStep: number): boolean => {
    const errors: Record<string, string> = {};
    if (currentStep === 1 && !outboundFlight) { toast({ title: "No Flight Selected", description: "Please go back and select a flight.", variant: "destructive" }); return false; }
    if (currentStep === 2) {
      for (let pi = 0; pi < passengers.length; pi++) {
        const p = passengers[pi];
        const paxLabel = paxTypes[pi]?.label || `Passenger ${pi + 1}`;
        if (!p.title) { errors[`title_${pi}`] = `${paxLabel}: Title is required`; }
        if (!p.firstName?.trim()) { errors[`firstName_${pi}`] = `${paxLabel}: First name is required`; }
        else if (p.firstName.trim().length < 2) { errors[`firstName_${pi}`] = `${paxLabel}: First name too short`; }
        if (!p.lastName?.trim()) { errors[`lastName_${pi}`] = `${paxLabel}: Last name is required`; }
        else if (p.lastName.trim().length < 2) { errors[`lastName_${pi}`] = `${paxLabel}: Last name too short`; }
        if (!p.dob) { errors[`dob_${pi}`] = `${paxLabel}: Date of birth is required`; }
        else { const dobDate = new Date(p.dob); if (dobDate >= new Date()) errors[`dob_${pi}`] = `${paxLabel}: Date of birth must be in the past`; }
        if (!p.nationality?.trim()) { errors[`nationality_${pi}`] = `${paxLabel}: Nationality is required`; }
        // Contact info — first passenger only
        if (pi === 0) {
          if (!p.email?.trim()) { errors[`email_${pi}`] = "Email is required"; }
          else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { errors[`email_${pi}`] = "Invalid email format"; }
          if (!p.phone?.trim()) { errors[`phone_${pi}`] = "Phone number is required"; }
          else if (!/^01[3-9]\d{8}$/.test(p.phone.replace(/[\s\-+]/g, "").replace(/^880/, "").replace(/^\+880/, ""))) { errors[`phone_${pi}`] = "Invalid Bangladesh phone number (01X-XXXXXXXX)"; }
        }
        // ─── Document expiry: reject expired documents on ALL flights ───
        if (p.passportExpiry) {
          const expiry = new Date(p.passportExpiry);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (expiry < today) {
            errors[`passportExpiry_${pi}`] = `${paxLabel}: Travel document has expired (${p.passportExpiry}). Passengers cannot travel with an expired document.`;
          }
        }

        // ─── Passport/document required for INTERNATIONAL flights only ───
        if (!domestic) {
          if (!p.passport?.trim()) { errors[`passport_${pi}`] = `${paxLabel}: Passport/document number is required`; }
          else if (p.passport.trim().length < 5) { errors[`passport_${pi}`] = `${paxLabel}: Invalid passport/document number`; }

          if (!p.passportExpiry) {
            errors[`passportExpiry_${pi}`] = `${paxLabel}: Document expiry date is required`;
          } else if (!errors[`passportExpiry_${pi}`]) {
            // 6-month validity rule for international flights
            const expiry = new Date(p.passportExpiry);
            const departureDate = outboundFlight?.departureTime ? new Date(outboundFlight.departureTime) : new Date();
            const sixMonthsFromDeparture = new Date(departureDate);
            sixMonthsFromDeparture.setMonth(sixMonthsFromDeparture.getMonth() + 6);
            if (expiry < sixMonthsFromDeparture) {
              const monthsLeft = Math.max(0, Math.round((expiry.getTime() - departureDate.getTime()) / (1000 * 60 * 60 * 24 * 30)));
              errors[`passportExpiry_${pi}`] = `${paxLabel}: Passport must be valid for at least 6 months beyond departure date. Your passport expires in ~${monthsLeft} month(s). Please renew before booking.`;
            }
          }
        }
      }
      // Travel document uploads moved to Review & Pay step — not required here
      if (Object.keys(errors).length > 0) { setFieldErrors(errors); toast({ title: "Missing Passenger Info", description: Object.values(errors)[0], variant: "destructive" }); return false; }
    }
    setFieldErrors({}); return true;
  };

  const handleContinue = () => { if (validateStep(step)) setStep(step + 1); };

  const handlePassportScan = (data: any) => {
    const updated = [...passengers];
    const pi = activePaxIndex;
    if (data.title) {
      const titleMap: Record<string, string> = { MR: "Mr", MRS: "Mrs", MS: "Ms", MISS: "Miss", MASTER: "Master" };
      updated[pi].title = titleMap[data.title.toUpperCase()] || data.title;
    }
    if (data.firstName) updated[pi].firstName = data.firstName;
    if (data.lastName) updated[pi].lastName = data.lastName;
    if (data.gender) updated[pi].gender = data.gender;
    if (data.birthDate) updated[pi].dob = data.birthDate;
    if (data.passportNumber) updated[pi].passport = data.passportNumber;
    if (data.expiryDate) updated[pi].passportExpiry = data.expiryDate;
    // Nationality — directly from OCR (full demonym like "Bangladeshi")
    if (data.nationality) updated[pi].nationality = data.nationality;
    // Phone — from NID or passport personal data page
    if (data.phone && pi === 0) updated[pi].phone = data.phone;
    // Email — not extractable from documents, skip
    if (data.countryCode || data.country) {
      const code3to2: Record<string, string> = {
        BGD:'BD',IND:'IN',USA:'US',GBR:'GB',PAK:'PK',NPL:'NP',LKA:'LK',MMR:'MM',
        MYS:'MY',SGP:'SG',ARE:'AE',SAU:'SA',KWT:'KW',QAT:'QA',BHR:'BH',OMN:'OM',
        CAN:'CA',AUS:'AU',JPN:'JP',KOR:'KR',CHN:'CN',THA:'TH',IDN:'ID',PHL:'PH',
        TUR:'TR',EGY:'EG',DEU:'DE',FRA:'FR',ITA:'IT',ESP:'ES',NLD:'NL',CHE:'CH',
      };
      const iso2 = data.countryCode ? (code3to2[data.countryCode] || data.countryCode.substring(0, 2)) : "BD";
      updated[pi].documentCountry = iso2;
      // Fallback nationality from country if OCR didn't extract demonym
      if (!updated[pi].nationality && data.nationality) {
        updated[pi].nationality = data.nationality;
      } else if (!updated[pi].nationality) {
        const code3toNationality: Record<string, string> = {
          BGD:'Bangladeshi',IND:'Indian',USA:'American',GBR:'British',PAK:'Pakistani',
          NPL:'Nepalese',LKA:'Sri Lankan',MMR:'Myanmar',MYS:'Malaysian',SGP:'Singaporean',
          ARE:'Emirati',SAU:'Saudi',KWT:'Kuwaiti',QAT:'Qatari',BHR:'Bahraini',OMN:'Omani',
          CAN:'Canadian',AUS:'Australian',JPN:'Japanese',KOR:'Korean',CHN:'Chinese',
          THA:'Thai',IDN:'Indonesian',PHL:'Filipino',TUR:'Turkish',EGY:'Egyptian',
          DEU:'German',FRA:'French',ITA:'Italian',ESP:'Spanish',NLD:'Dutch',CHE:'Swiss',
        };
        updated[pi].nationality = data.countryCode ? (code3toNationality[data.countryCode] || "") : "Bangladeshi";
      }
    }
    setPassengers(updated);
    setFieldErrors({});
  };

  const handleSelectExistingPax = (t: any) => {
    const updated = [...passengers];
    const pi = activePaxIndex;
    updated[pi] = {
      title: t.title || updated[pi].title,
      firstName: t.firstName || "",
      lastName: t.lastName || "",
      dob: t.dob || "",
      nationality: t.nationality || "",
      passport: t.passport || "",
      passportExpiry: t.passportExpiry || "",
      email: t.email || updated[pi].email,
      phone: t.phone || updated[pi].phone,
      gender: t.gender || "",
      documentCountry: t.documentCountry || "BD",
    };
    setPassengers(updated);
    setFieldErrors({});
  };

  // Handle travel document file selection
  const handleTravelDocSelect = async (key: string, file: File) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!allowed.includes(ext)) { toast({ title: "Invalid File", description: "Only JPG, PNG, WebP, and PDF files are accepted.", variant: "destructive" }); return; }
    if (file.size > 10 * 1024 * 1024) { toast({ title: "File Too Large", description: "Maximum file size is 10MB.", variant: "destructive" }); return; }
    setTravelDocs(prev => ({ ...prev, [key]: { file, uploading: true } }));
    try {
      const formData = new FormData();
      formData.append(key, file);
      const result = await api.upload<any>("/flights/upload-travel-docs", formData);
      if (result.documents?.length > 0) {
        const doc = result.documents[0];
        setTravelDocsUploaded(prev => ({ ...prev, [key]: { url: doc.url, originalName: doc.originalName, fieldname: doc.fieldname } }));
        setTravelDocs(prev => ({ ...prev, [key]: { file, url: doc.url, uploading: false } }));
      }
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message || "Could not upload document.", variant: "destructive" });
      setTravelDocs(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
  };

  const removeTravelDoc = (key: string) => {
    setTravelDocs(prev => { const n = { ...prev }; delete n[key]; return n; });
    setTravelDocsUploaded(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const createBooking = async (payLater: boolean, overrideFare?: { baseFare: number; taxes: number; total: number }) => {
    setBookingLoading(true);
    try {
      const finalBaseFare = overrideFare ? overrideFare.baseFare : baseFare;
      const finalTaxes = overrideFare ? overrideFare.taxes : taxes;
      const finalTotal = overrideFare ? (overrideFare.total + serviceCharge + addOnTotal - couponDiscount) : grandTotal;

      const bookingData = {
        flightData: bookingFlightData,
        returnFlightData: returnFlight,
        multiCityFlights: isMultiCity ? multiCityFlights : undefined,
        passengers, isRoundTrip, isMultiCity, isDomestic: domestic, payLater,
        paymentMethod: "pay_later",
        totalAmount: finalTotal, baseFare: finalBaseFare, taxes: finalTaxes, serviceCharge,
        discount: overrideFare ? Math.round((finalBaseFare * DISCOUNT_PCT) / 100) : totalDiscount,
        aitVat: overrideFare ? Math.round((finalBaseFare * AIT_VAT_PCT) / 100) : totalAitVat,
        fareRules: { discount: DISCOUNT_PCT, aitVat: AIT_VAT_PCT },
        couponCode: appliedCoupon?.code || undefined, couponDiscount: couponDiscount || undefined,
        priceRevalidated: !!overrideFare,
        addOns: {
          meal: mealOptions.find(m => m.id === selectedMeal)?.name || undefined,
          baggage: selectedBaggage.map(id => baggageOptions.find(b => b.id === id)?.name).filter(Boolean),
          total: addOnTotal,
          seats: Object.entries(selectedSeats).map(([paxIdx, seatId]) => ({
            passengerIndex: Number(paxIdx),
            seatId,
            price: seatPrices[Number(paxIdx)] || 0,
          })),
        },
        contactInfo: { email: passengers[0]?.email, phone: passengers[0]?.phone },
        travelDocuments: Object.entries(travelDocsUploaded).map(([key, doc]) => ({ ...doc, passengerIndex: parseInt(key.split('_')[1] || '0'), docType: key.split('_')[0] })),
        specialServices: {
          perPassenger: paxSpecialServices.map(ss => ({
            meal: ss.meal !== "none" ? ss.meal : undefined,
            wheelchair: ss.wheelchair !== "none" ? ss.wheelchair : undefined,
            medical: ss.medical || undefined,
            medicalDetails: ss.medicalDetails || undefined,
            blind: ss.blind || undefined,
            deaf: ss.deaf || undefined,
            unaccompaniedMinor: ss.unaccompaniedMinor || undefined,
            umnrAge: ss.umnrAge || undefined,
            pet: ss.pet !== "none" ? ss.pet : undefined,
            petDetails: ss.petDetails || undefined,
            frequentFlyer: ss.frequentFlyer.number ? ss.frequentFlyer : undefined,
            specialRequest: ss.specialRequest.trim() || undefined,
            destinationAddress: ss.destinationAddress.trim() || undefined,
          })),
        },
      };
      const result = await api.post<any>("/flights/book", bookingData);
      setBookingResult(result);
      setBookingComplete(true);
      toast({
        title: "Booking Confirmed — No Payment Required",
        description: `Booking Ref: ${result.bookingRef}. Deposit later and submit an issue request to get your ticket.`,
      });


    } catch (err: any) {
      const reason = err?.gdsError || err?.details || err?.message || "Something went wrong";
      const stale = /reprice|no longer available|expired|uniqueTransID|session/i.test(String(reason));
      toast({
        title: "Booking Failed",
        description: stale
          ? `${reason}. Your search session has expired — please search again and re-select the flight.`
          : reason,
        variant: "destructive",
      });
    } finally { setBookingLoading(false); }
  };

  // ── Pre-book revalidation: compare GDS truth vs search price ──
  const revalidateBeforeBooking = async (payLater: boolean) => {
    setBookingLoading(true);
    setPendingPayLater(payLater);

    try {
      // Build segments for revalidation
      const segments: any[] = [];
      const allFlights = isMultiCity ? multiCityFlights : [outboundFlight, ...(returnFlight ? [returnFlight] : [])];

      for (const f of allFlights) {
        if (!f) continue;
        const legs = f.legs || f.segments || [f];
        for (const leg of legs) {
          segments.push({
            origin: leg.origin || f.origin,
            destination: leg.destination || f.destination,
            departureTime: leg.departureTime || f.departureTime,
            arrivalTime: leg.arrivalTime || f.arrivalTime,
            flightNumber: leg.flightNumber || f.flightNumber,
            airlineCode: leg.airlineCode || f.airlineCode,
            bookingClass: leg.bookingClass || f.bookingClass || f._sabreBookingClass,
          });
        }
      }

      // Only revalidate for Sabre flights
      const isSabre = allFlights.some((f: any) => f && (
        String(f.source || '').toLowerCase().includes('sabre') || f._sabreSource || f._sabreSeqNumber
      ));

      if (!isSabre || segments.length === 0) {
        // Non-Sabre: skip revalidation, book directly
        await createBooking(payLater);
        return;
      }

      const revalResult = await api.post<any>("/flights/revalidate-price", {
        flights: segments,
        adults: adultCount,
        children: childCount,
        infants: infantCount,
        cabinClass: searchCabin,
      });

      if (!revalResult?.success || !revalResult?.pricedItineraries?.length) {
        // Revalidation API failed — allow booking with warning
        toast({ title: "Price Check Unavailable", description: "Could not verify fare with airline. Proceeding with search price.", variant: "default" });
        await createBooking(payLater);
        return;
      }

      const revalPricing = revalResult.pricedItineraries[0];
      
      // If grouped format with no price details, proceed
      if (revalPricing.format === 'grouped' || !revalPricing.totalFare) {
        await createBooking(payLater);
        return;
      }

      const revalBaseFare = Math.round(revalPricing.baseFare || 0);
      const revalTaxes = Math.round(revalPricing.taxes || 0);
      const revalTotal = Math.round(revalPricing.totalFare || 0);

      // Compare search-time gross fare vs revalidated fare (per-pax values)
      const searchGrossPerPax = isMultiCity
        ? multiCityCalcs.reduce((s: number, c: any) => s + c.grossPrice, 0)
        : (outboundCalc.grossPrice + returnCalc.grossPrice);
      const searchBaseFarePerPax = isMultiCity
        ? multiCityCalcs.reduce((s: number, c: any) => s + c.baseFare, 0)
        : (outboundCalc.baseFare + returnCalc.baseFare);
      const searchTaxesPerPax = isMultiCity
        ? multiCityCalcs.reduce((s: number, c: any) => s + c.taxes, 0)
        : (outboundCalc.taxes + returnCalc.taxes);

      // Tolerance: 2% or ৳50, whichever is larger
      const tolerance = Math.max(searchGrossPerPax * 0.02, 50);
      const baseDiff = Math.abs(revalBaseFare - searchBaseFarePerPax);
      const taxDiff = Math.abs(revalTaxes - searchTaxesPerPax);
      const totalDiff = Math.abs(revalTotal - searchGrossPerPax);

      if (totalDiff <= tolerance && baseDiff <= tolerance && taxDiff <= tolerance) {
        // Prices match within tolerance — book directly
        await createBooking(payLater);
        return;
      }

      // MISMATCH detected — self-heal: apply discount/AIT to revalidated fare
      const discPct = outboundFlight?.fareRules?.discount ?? 0;
      const aitPct = outboundFlight?.fareRules?.aitVat ?? 0;
      const adjustedDiscount = Math.round(revalBaseFare * discPct / 100);
      const adjustedAit = Math.round(revalBaseFare * aitPct / 100);
      const adjustedPayablePerPax = revalBaseFare - adjustedDiscount + revalTaxes + adjustedAit;

      setRevalidatedFare({
        baseFare: revalBaseFare,
        taxes: revalTaxes,
        total: adjustedPayablePerPax * totalPaxCount,
        bookingClass: revalPricing.bookingClass || undefined,
        currency: revalPricing.currency || "BDT",
      });
      setPriceChangeOpen(true);
      setBookingLoading(false);

    } catch (err: any) {
      console.error('[Revalidation] Error:', err);
      // On revalidation failure, still allow booking with warning
      toast({ title: "Price Check Failed", description: "Could not verify fare. Proceeding with search price.", variant: "default" });
      await createBooking(payLater);
    }
  };

  const handleAcceptRevalidatedPrice = async () => {
    setPriceChangeOpen(false);
    if (revalidatedFare) {
      await createBooking(pendingPayLater, {
        baseFare: revalidatedFare.baseFare * totalPaxCount,
        taxes: revalidatedFare.taxes * totalPaxCount,
        total: revalidatedFare.total,
      });
    }
  };

  const handleConfirmBooking = () => {
    const allFilled = passengers.every(p => p.firstName && p.lastName);
    if (!allFilled) { toast({ title: "Missing Info", description: "Please fill in all passenger details.", variant: "destructive" }); setStep(2); return; }
    if (!agreedTerms) { toast({ title: "Terms Required", description: "Please agree to the Terms & Conditions.", variant: "destructive" }); return; }
    if (!isAuthenticated) { setAuthOpen(true); return; }

    // Travel documents are now verified at payment time from the dashboard — not required at booking

    // Booking never collects payment — always create the reservation only.
    revalidateBeforeBooking(true);
  };

  const handlePayNow = () => {
    navigate("/dashboard/payments", { state: { bookingRef: bookingResult?.bookingRef, amount: grandTotal } });
  };


  if (isLoading) return <div className="min-h-screen bg-muted/30 pt-36 lg:pt-48 pb-10"><div className="container mx-auto px-4"><Skeleton className="h-96 w-full rounded-xl" /></div></div>;

  // STEPS already defined above dynamically based on hasRealExtras

  // ─── POST-BOOKING SUCCESS ───
  if (bookingComplete && bookingResult) {
    return (
      <div className="min-h-screen bg-muted/30 pt-36 lg:pt-48 pb-10">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="border-accent/30 shadow-lg">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-accent" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black">Booking Confirmed ✓</h2>
              <p className="text-sm text-muted-foreground">
                Your seat is reserved. No payment was taken — deposit the fare and submit an issue request to get your ticket.
              </p>
              <div className="bg-muted/50 rounded-xl p-4 text-left space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Booking ID</span><span className="font-bold font-mono">{bookingResult.bookingRef}</span></div>
                {bookingResult.airlinePnr && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Airlines PNR</span><span className="font-bold font-mono text-accent">{bookingResult.airlinePnr}</span></div>
                )}
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Status</span>
                  <Badge className="bg-warning/10 text-warning border-warning/20">Reserved — Not Issued</Badge>
                </div>


                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total Amount</span><span className="font-bold text-accent">৳{grandTotal.toLocaleString()}</span></div>
                {bookingResult.payLater && bookingResult.paymentDeadline && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payment Deadline</span>
                    <span className="font-bold text-destructive flex items-center gap-1"><Timer className="w-3.5 h-3.5" />
                      {new Date(bookingResult.paymentDeadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
              </div>
              {/* Post-booking extras notice */}
              {(bookingResult.airlinePnr || bookingResult.pnr || bookingResult.gdsPnr) && (
                <div className="flex items-start gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl text-left">
                  <Package className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold">Add Extra Baggage & Meals</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your PNR <strong className="font-mono text-accent">{bookingResult.airlinePnr || bookingResult.pnr || bookingResult.gdsPnr}</strong> has been generated. You can now purchase extra baggage, premium meals, and other add-ons from your <strong>Dashboard → Bookings</strong>.
                    </p>
                  </div>
                </div>
              )}
              {bookingResult.payLater && bookingResult.paymentDeadline && (
                <div className="flex items-start gap-3 p-4 bg-destructive/5 border border-destructive/20 rounded-xl text-left">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-destructive">Payment Required</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your booking will be cancelled if payment is not received by{" "}
                      <strong className="text-destructive">{new Date(bookingResult.paymentDeadline).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>.
                      {outboundFlight?.timeLimit ? " Deadline set by the airline." : ""}
                    </p>
                  </div>
                </div>
              )}
              <Separator />
              <div className="flex flex-col sm:flex-row gap-3">
                <Button className="flex-1 font-bold bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => navigate("/dashboard/bookings")}>
                  <Plane className="w-4 h-4 mr-1.5" /> View My Bookings
                </Button>
                <Button variant="outline" className="flex-1" onClick={handlePayNow}>
                  <CreditCard className="w-4 h-4 mr-1.5" /> Deposit & Request Issue
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-left">
                Deposit ৳{grandTotal.toLocaleString()} to your account balance, then submit an <strong>Issue Request</strong> from Dashboard → Bookings. The status will show <strong>In Progress</strong> until the ticket is issued.
              </p>


            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
      <div className="min-h-screen bg-muted/30 pt-24 sm:pt-36 lg:pt-48 pb-10 overflow-x-hidden">
      <div className="container mx-auto px-4">
        {/* Session timer + Progress */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto w-full sm:w-auto scrollbar-none">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="flex items-center gap-1 sm:gap-2 shrink-0">
                  <button onClick={() => i + 1 < step && setStep(i + 1)}
                    className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-[11px] sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                      step > i + 1 ? "bg-accent/10 text-accent cursor-pointer" :
                      step === i + 1 ? "bg-accent text-accent-foreground" :
                      "bg-muted text-muted-foreground"
                    }`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{i + 1}</span>
                  </button>
                  {i < STEPS.length - 1 && <div className="w-3 sm:w-8 h-px bg-border" />}
                </div>
              );
            })}
          </div>
          <SessionTimer minutes={20} onExpired={handleSessionExpired} />
        </div>

        {/* Biman notice */}
        {isBiman && step === reviewStep && (
          <div className="flex items-start gap-3 p-4 mb-6 bg-warning/10 border border-warning/20 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold">Biman Bangladesh Airlines — Immediate Payment Required</p>
              <p className="text-xs text-muted-foreground mt-1">Biman does not support hold. Payment must be made immediately.</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4 sm:space-y-5 min-w-0">
            {/* STEP 1: Flight Details */}
            {step === 1 && (
              <>
                {isMultiCity ? (
                  multiCityFlights.map((mcFlight: any, idx: number) => (
                    <FlightSegmentCard key={idx} flight={mcFlight} label={`Flight ${idx + 1}: ${mcFlight?.origin || "—"} → ${mcFlight?.destination || "—"}`} searchedCabinClass={searchCabin ? searchCabin.charAt(0).toUpperCase() + searchCabin.slice(1) : undefined} />
                  ))
                ) : (
                  <>
                    <FlightSegmentCard flight={outboundFlight} label="Outbound" searchedCabinClass={searchCabin ? searchCabin.charAt(0).toUpperCase() + searchCabin.slice(1) : undefined} />
                    {isRoundTrip && <FlightSegmentCard flight={returnFlight} label="Return" searchedCabinClass={searchCabin ? searchCabin.charAt(0).toUpperCase() + searchCabin.slice(1) : undefined} />}
                  </>
                )}
                {/* Baggage summary + airline support link */}
                {outboundFlight && (
                  <Card className="border-border">
                    <CardContent className="p-3 sm:p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold flex items-center gap-2"><Luggage className="w-4 h-4 text-accent" /> Baggage Allowance</p>
                        <AirlineSupportDialog
                          airline={outboundFlight.airline} airlineCode={outboundFlight.airlineCode}
                          hasBaggage={!!outboundFlight.baggage} hasHandBaggage={!!outboundFlight.handBaggage}
                          hasSeatMap={seatMapData?.available === true} hasExtras={ancillarySource !== "none"}
                          seatMapSource={seatMapSource} ancillarySource={ancillarySource}
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className={`flex items-start gap-3 p-3 rounded-lg border ${outboundFlight.baggage ? "border-accent/20 bg-accent/5" : "border-border bg-muted/30"}`}>
                          <Briefcase className={`w-4 h-4 shrink-0 mt-0.5 ${outboundFlight.baggage ? "text-accent" : "text-muted-foreground"}`} />
                          <div>
                            <p className="text-xs font-semibold">Checked Baggage</p>
                            <p className="text-[11px] text-muted-foreground">{outboundFlight.baggage || "Not provided by airline booking system"}</p>
                          </div>
                        </div>
                        <div className={`flex items-start gap-3 p-3 rounded-lg border ${outboundFlight.handBaggage ? "border-accent/20 bg-accent/5" : "border-border bg-muted/30"}`}>
                          <Package className={`w-4 h-4 shrink-0 mt-0.5 ${outboundFlight.handBaggage ? "text-accent" : "text-muted-foreground"}`} />
                          <div>
                            <p className="text-xs font-semibold">Hand Baggage</p>
                            <p className="text-[11px] text-muted-foreground">{outboundFlight.handBaggage || "Not provided by airline booking system"}</p>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Cabin Class: {searchCabin ? searchCabin.charAt(0).toUpperCase() + searchCabin.slice(1) : outboundFlight.cabinClass || "Economy"}</p>
                    </CardContent>
                  </Card>
                )}
                {!isMultiCity && !isRoundTrip && !outboundFlight && (
                  <Card className="border-dashed"><CardContent className="py-8 text-center"><p className="text-sm text-muted-foreground">Loading flight details...</p></CardContent></Card>
                )}
              </>
            )}

            {/* STEP 2: Passenger Info */}
            {step === 2 && (
              <Card>
                <CardHeader className="bg-accent/5 border-b border-border">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                      <Users className="w-5 h-5 text-accent" /> Enter Traveler Details
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => { setActivePaxIndex(0); setPassportScanOpen(true); }}>
                        <ScanLine className="w-3.5 h-3.5 mr-1" /> Passport Scan
                      </Button>
                      {isAuthenticated && (
                        <Button variant="outline" size="sm" className="text-xs h-8 border-accent/30 text-accent hover:bg-accent/10" onClick={() => { setActivePaxIndex(0); setSearchPaxOpen(true); }}>
                          <Search className="w-3.5 h-3.5 mr-1" /> Saved Passenger
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Enter details exactly as they appear on your passport/ID</p>
                </CardHeader>
                <CardContent className="p-3 sm:p-5 space-y-0">
                  {passengers.map((pax, pi) => {
                    const paxTypeColors: Record<string, { border: string; bg: string; badge: string; badgeText: string }> = {
                      adult: { border: "border-accent/30", bg: "bg-accent/[0.03]", badge: "bg-accent/10 text-accent border-accent/20", badgeText: "text-accent" },
                      child: { border: "border-blue-400/30", bg: "bg-blue-50/50 dark:bg-blue-950/20", badge: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800", badgeText: "text-blue-700 dark:text-blue-300" },
                      infant: { border: "border-purple-400/30", bg: "bg-purple-50/50 dark:bg-purple-950/20", badge: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800", badgeText: "text-purple-700 dark:text-purple-300" },
                    };
                    const paxType = paxTypes[pi]?.type || "adult";
                    const colors = paxTypeColors[paxType] || paxTypeColors.adult;

                    return (
                    <div key={pi} className={`space-y-3 sm:space-y-4 rounded-xl border-2 ${colors.border} ${colors.bg} p-3 sm:p-5 ${pi > 0 ? "mt-4" : ""}`}>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className={`text-xs font-semibold ${colors.badge}`}>
                          {paxTypes[pi]?.label || `Passenger ${pi + 1}`} Traveler
                        </Badge>
                        {pi > 0 ? (
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setActivePaxIndex(pi); setPassportScanOpen(true); }}>
                              <ScanLine className="w-3 h-3 mr-1" /> Scan
                            </Button>
                            {isAuthenticated && (
                              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { setActivePaxIndex(pi); setSearchPaxOpen(true); }}>
                                <Search className="w-3 h-3 mr-1" /> Saved
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {/* Row 1: Title + Gender + DOB + Nationality */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                        <div className="space-y-1.5">
                          <Label className={`text-xs sm:text-sm ${fieldErrors[`title_${pi}`] ? "text-destructive" : ""}`}>Title *</Label>
                          <Select value={pax.title} onValueChange={(v) => {
                            const updated = [...passengers]; updated[pi].title = v;
                            if (v === "Mr" || v === "Master") updated[pi].gender = "Male";
                            else updated[pi].gender = "Female";
                            setPassengers(updated); setFieldErrors(prev => { const n = {...prev}; delete n[`title_${pi}`]; return n; });
                          }}>
                            <SelectTrigger className={`h-10 sm:h-11 ${fieldErrors[`title_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`}><SelectValue placeholder="Title" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Mr">Mr</SelectItem><SelectItem value="Mrs">Mrs</SelectItem>
                              <SelectItem value="Ms">Ms</SelectItem><SelectItem value="Master">Master</SelectItem><SelectItem value="Miss">Miss</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs sm:text-sm">Gender *</Label>
                          <div className="flex gap-2 h-10 sm:h-11">
                            {["Male", "Female"].map(g => (
                              <button key={g} onClick={() => { const updated = [...passengers]; updated[pi].gender = g; setPassengers(updated); }}
                                className={`flex-1 rounded-md border text-xs sm:text-sm font-medium transition-colors ${
                                  pax.gender === g ? "bg-accent text-accent-foreground border-accent" : "bg-card border-border hover:border-accent/40"
                                }`}>{g}</button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className={`text-xs sm:text-sm ${fieldErrors[`dob_${pi}`] ? "text-destructive" : ""}`}>Date of Birth *</Label>
                          <Input type="date" value={pax.dob} onChange={(e) => {
                            const updated = [...passengers]; updated[pi].dob = e.target.value; setPassengers(updated);
                            setFieldErrors(prev => { const n = {...prev}; delete n[`dob_${pi}`]; return n; });
                          }} className={`h-10 sm:h-11 ${fieldErrors[`dob_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className={`text-xs sm:text-sm ${fieldErrors[`nationality_${pi}`] ? "text-destructive" : ""}`}>Nationality *</Label>
                          <Select value={pax.nationality} onValueChange={(v) => {
                            const updated = [...passengers]; updated[pi].nationality = v; setPassengers(updated);
                            setFieldErrors(prev => { const n = {...prev}; delete n[`nationality_${pi}`]; return n; });
                          }}>
                            <SelectTrigger className={`h-10 sm:h-11 ${fieldErrors[`nationality_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`}>
                              <SelectValue placeholder="Select Nationality" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {NATIONALITY_OPTIONS.map(c => (
                                <SelectItem key={c.code} value={c.nationality}>{c.nationality}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Row 2: Names */}
                      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="space-y-1.5">
                          <Label className={`text-xs sm:text-sm ${fieldErrors[`firstName_${pi}`] ? "text-destructive" : ""}`}>First/Given Name *</Label>
                          <Input value={pax.firstName} onChange={(e) => {
                            const updated = [...passengers]; updated[pi].firstName = e.target.value; setPassengers(updated);
                            setFieldErrors(prev => { const n = {...prev}; delete n[`firstName_${pi}`]; return n; });
                          }} placeholder="As on passport" className={`h-10 sm:h-11 ${fieldErrors[`firstName_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                        </div>
                        <div className="space-y-1.5">
                          <Label className={`text-xs sm:text-sm ${fieldErrors[`lastName_${pi}`] ? "text-destructive" : ""}`}>Surname/Family/Last Name *</Label>
                          <Input value={pax.lastName} onChange={(e) => {
                            const updated = [...passengers]; updated[pi].lastName = e.target.value; setPassengers(updated);
                            setFieldErrors(prev => { const n = {...prev}; delete n[`lastName_${pi}`]; return n; });
                          }} placeholder="As on passport" className={`h-10 sm:h-11 ${fieldErrors[`lastName_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                        </div>
                      </div>

                      {/* Row 3: Document info — international only */}
                      <div className={`grid gap-3 sm:gap-4 ${domestic ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
                        <div className="space-y-1.5">
                          <Label className="text-xs sm:text-sm">Document Issue Country</Label>
                          <Select value={pax.documentCountry || "BD"} onValueChange={(v) => { const updated = [...passengers]; updated[pi].documentCountry = v; setPassengers(updated); }}>
                            <SelectTrigger className="h-10 sm:h-11"><SelectValue placeholder="Select Country" /></SelectTrigger>
                            <SelectContent className="max-h-60">
                              {COUNTRY_OPTIONS.map(c => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        {!domestic && (
                          <>
                            <div className="space-y-1.5">
                              <Label className={`text-xs sm:text-sm ${fieldErrors[`passport_${pi}`] ? "text-destructive" : ""}`}>Document Number *</Label>
                              <Input value={pax.passport} onChange={(e) => {
                                const updated = [...passengers]; updated[pi].passport = e.target.value; setPassengers(updated);
                                setFieldErrors(prev => { const n = {...prev}; delete n[`passport_${pi}`]; return n; });
                              }} placeholder="e.g. A0123456789" className={`h-10 sm:h-11 ${fieldErrors[`passport_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className={`text-xs sm:text-sm ${fieldErrors[`passportExpiry_${pi}`] ? "text-destructive" : ""}`}>Expiration Date *</Label>
                              <Input type="date" value={pax.passportExpiry} onChange={(e) => {
                                const updated = [...passengers]; updated[pi].passportExpiry = e.target.value; setPassengers(updated);
                                setFieldErrors(prev => { const n = {...prev}; delete n[`passportExpiry_${pi}`]; return n; });
                              }} className={`h-10 sm:h-11 ${fieldErrors[`passportExpiry_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                            </div>
                          </>
                        )}
                      </div>

                      {/* Travel Document Uploads moved to Review & Pay step */}

                      {/* Row 5: Contact */}
                      {pi === 0 && (
                        <>
                          <Separator />
                          <p className="text-sm font-semibold flex items-center gap-2"><User className="w-4 h-4 text-accent" /> Enter Contact Details</p>
                          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="space-y-1.5">
                              <Label className={`text-xs sm:text-sm ${fieldErrors[`phone_${pi}`] ? "text-destructive" : ""}`}>Mobile Number *</Label>
                              <Input type="tel" value={pax.phone} onChange={(e) => {
                                const updated = [...passengers]; updated[pi].phone = e.target.value; setPassengers(updated);
                                setFieldErrors(prev => { const n = {...prev}; delete n[`phone_${pi}`]; return n; });
                              }} placeholder="01XXX-XXXXXXXX" className={`h-10 sm:h-11 ${fieldErrors[`phone_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                              {fieldErrors[`phone_${pi}`] && <p className="text-[11px] text-destructive">{fieldErrors[`phone_${pi}`]}</p>}
                            </div>
                            <div className="space-y-1.5">
                              <Label className={`text-xs sm:text-sm ${fieldErrors[`email_${pi}`] ? "text-destructive" : ""}`}>E-mail *</Label>
                              <Input type="email" value={pax.email} onChange={(e) => {
                                const updated = [...passengers]; updated[pi].email = e.target.value; setPassengers(updated);
                                setFieldErrors(prev => { const n = {...prev}; delete n[`email_${pi}`]; return n; });
                              }} placeholder="email@example.com" className={`h-10 sm:h-11 ${fieldErrors[`email_${pi}`] ? "border-destructive ring-destructive/20 ring-2" : ""}`} />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    );
                  })}
                </CardContent>
              </Card>
             )}

            {/* ── SPECIAL SERVICES (SSR) — Always shown in Step 2 for all airlines ── */}
            {step === 2 && (
              <Card>
                <CardHeader className="bg-accent/5 border-b border-border">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Star className="w-5 h-5 text-accent" /> Special Services
                    <Badge className="bg-accent/10 text-accent border-0 text-[9px] ml-2">All Airlines</Badge>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Request meals, wheelchair, medical assistance, frequent flyer, pets, and more — sent directly to the airline.</p>
                </CardHeader>
                <CardContent className="p-3 sm:p-5 space-y-3">
                  {paxTypes.map((paxType, pi) => {
                    const ss = paxSpecialServices[pi] || emptySSR();
                    const isExpanded = ssrExpanded === pi;
                    const paxHasSSR = ss.meal !== "none" || ss.wheelchair !== "none" || ss.medical || ss.blind || ss.deaf || ss.unaccompaniedMinor || ss.pet !== "none" || ss.frequentFlyer.number || ss.specialRequest.trim();
                    return (
                      <div key={pi} className="border border-border rounded-lg overflow-hidden">
                        <button
                          onClick={() => setSsrExpanded(isExpanded ? null : pi)}
                          className="w-full flex items-center justify-between p-3 sm:p-4 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-accent" />
                            <span className="text-sm font-semibold">{passengers[pi]?.firstName || paxType.label}</span>
                            <Badge variant="outline" className="text-[10px]">{paxType.label}</Badge>
                            {paxHasSSR && <Badge className="bg-accent/10 text-accent border-0 text-[9px]">SSR Added</Badge>}
                          </div>
                          <ArrowRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                        </button>

                        {isExpanded && (
                          <div className="p-3 sm:p-4 space-y-4 border-t border-border">
                            {/* Meal Preference */}
                            <div className="space-y-1.5">
                              <Label className="text-xs sm:text-sm flex items-center gap-1.5">
                                <UtensilsCrossed className="w-3.5 h-3.5 text-accent" /> Meal Preference
                              </Label>
                              <Select value={ss.meal} onValueChange={(v) => updatePaxSSR(pi, "meal", v)}>
                                <SelectTrigger className="h-10 sm:h-11"><SelectValue placeholder="Select meal" /></SelectTrigger>
                                <SelectContent className="max-h-60">
                                  {MEAL_CODES.map(m => (
                                    <SelectItem key={m.code} value={m.code}>{m.icon} {m.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Wheelchair / Mobility Assistance */}
                            <div className="space-y-1.5">
                              <Label className="text-xs sm:text-sm flex items-center gap-1.5">
                                <Accessibility className="w-3.5 h-3.5 text-accent" /> Wheelchair / Mobility Assistance
                              </Label>
                              <Select value={ss.wheelchair} onValueChange={(v) => updatePaxSSR(pi, "wheelchair", v)}>
                                <SelectTrigger className="h-10 sm:h-11"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {WHEELCHAIR_OPTIONS.map(w => (
                                    <SelectItem key={w.code} value={w.code}>{w.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Medical, Blind, Deaf toggles */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${ss.medical ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
                                <Checkbox checked={ss.medical} onCheckedChange={(v) => updatePaxSSR(pi, "medical", !!v)} />
                                <div>
                                  <p className="text-xs font-medium flex items-center gap-1"><Heart className="w-3 h-3 text-destructive" /> Medical</p>
                                  <p className="text-[10px] text-muted-foreground">MEDA assistance</p>
                                </div>
                              </label>
                              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${ss.blind ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
                                <Checkbox checked={ss.blind} onCheckedChange={(v) => updatePaxSSR(pi, "blind", !!v)} />
                                <div>
                                  <p className="text-xs font-medium flex items-center gap-1"><Eye className="w-3 h-3" /> Blind</p>
                                  <p className="text-[10px] text-muted-foreground">BLND — visual impairment</p>
                                </div>
                              </label>
                              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${ss.deaf ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
                                <Checkbox checked={ss.deaf} onCheckedChange={(v) => updatePaxSSR(pi, "deaf", !!v)} />
                                <div>
                                  <p className="text-xs font-medium flex items-center gap-1">👂 Deaf</p>
                                  <p className="text-[10px] text-muted-foreground">DEAF — hearing impairment</p>
                                </div>
                              </label>
                            </div>

                            {/* Medical Details */}
                            {ss.medical && (
                              <div className="space-y-1.5">
                                <Label className="text-xs">Medical Details (optional)</Label>
                                <Input value={ss.medicalDetails} onChange={(e) => updatePaxSSR(pi, "medicalDetails", e.target.value)} placeholder="e.g. Requires oxygen, stretcher, medical clearance" className="h-10" />
                              </div>
                            )}

                            {/* Unaccompanied Minor */}
                            {paxType.type === "child" && (
                              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${ss.unaccompaniedMinor ? "border-accent bg-accent/5" : "border-border hover:border-accent/30"}`}>
                                <Checkbox checked={ss.unaccompaniedMinor} onCheckedChange={(v) => updatePaxSSR(pi, "unaccompaniedMinor", !!v)} />
                                <div className="flex-1">
                                  <p className="text-xs font-medium flex items-center gap-1"><Baby className="w-3 h-3 text-accent" /> Unaccompanied Minor (UMNR)</p>
                                  <p className="text-[10px] text-muted-foreground">Child travelling alone — airline will escort</p>
                                </div>
                              </label>
                            )}

                            {/* Pet */}
                            <div className="space-y-1.5">
                              <Label className="text-xs sm:text-sm flex items-center gap-1.5">
                                <Dog className="w-3.5 h-3.5 text-accent" /> Travelling with Pet
                              </Label>
                              <Select value={ss.pet} onValueChange={(v) => updatePaxSSR(pi, "pet", v)}>
                                <SelectTrigger className="h-10 sm:h-11"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No pet</SelectItem>
                                  <SelectItem value="PETC">🐕 Pet in Cabin (PETC)</SelectItem>
                                  <SelectItem value="AVIH">📦 Pet in Cargo Hold (AVIH)</SelectItem>
                                </SelectContent>
                              </Select>
                              {ss.pet !== "none" && (
                                <Input value={ss.petDetails} onChange={(e) => updatePaxSSR(pi, "petDetails", e.target.value)} placeholder="e.g. Small dog, 5kg, carrier dimensions 40x30x20cm" className="h-10 mt-1.5" />
                              )}
                            </div>

                            {/* Frequent Flyer */}
                            <div className="space-y-1.5">
                              <Label className="text-xs sm:text-sm flex items-center gap-1.5">
                                <Star className="w-3.5 h-3.5 text-accent" /> Frequent Flyer Number
                              </Label>
                              <div className="grid grid-cols-3 gap-2">
                                <Input value={ss.frequentFlyer.airline} onChange={(e) => updatePaxSSR(pi, "frequentFlyer.airline", e.target.value.toUpperCase().slice(0, 2))} placeholder="Airline (EK)" maxLength={2} className="h-10 uppercase" />
                                <div className="col-span-2">
                                  <Input value={ss.frequentFlyer.number} onChange={(e) => updatePaxSSR(pi, "frequentFlyer.number", e.target.value)} placeholder="FF Number" className="h-10" />
                                </div>
                              </div>
                            </div>

                            {/* Destination Address (DOCA) — international */}
                            {!domestic && (
                              <div className="space-y-1.5">
                                <Label className="text-xs sm:text-sm">Destination Address (for immigration)</Label>
                                <Input value={ss.destinationAddress} onChange={(e) => updatePaxSSR(pi, "destinationAddress", e.target.value)} placeholder="e.g. Hilton Dubai Creek, Baniyas Rd, Dubai" className="h-10" />
                              </div>
                            )}

                            {/* Free-text Special Request */}
                            <div className="space-y-1.5">
                              <Label className="text-xs sm:text-sm flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5 text-accent" /> Special Request (free text)
                              </Label>
                              <Input value={ss.specialRequest} onChange={(e) => updatePaxSSR(pi, "specialRequest", e.target.value)} placeholder="e.g. Bassinet needed, adjacent seats, extra pillow" maxLength={70} className="h-10" />
                              <p className="text-[10px] text-muted-foreground">{ss.specialRequest.length}/70 characters — sent as OSI to the airline</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {hasAnySSR && (
                    <div className="flex items-center gap-2 p-3 bg-accent/5 rounded-lg border border-accent/10">
                      <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                      <p className="text-xs text-muted-foreground">Your special service requests will be submitted to the airline upon booking confirmation.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            {/* STEP 3: Seat Selection & Extras — Always visible */}
            {step === seatExtrasStep && (
              <>
                {/* ── SEAT SELECTION ── */}
                <Card>
                  <CardHeader className="bg-accent/5 border-b border-border">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                        <Armchair className="w-5 h-5 text-accent" /> Select Your Seats
                      </CardTitle>
                      <AirlineSupportDialog
                        airline={outboundFlight?.airline} airlineCode={outboundFlight?.airlineCode}
                        hasBaggage={!!serviceFlight?.baggage} hasHandBaggage={!!serviceFlight?.handBaggage}
                        hasSeatMap={seatMapData?.available === true} hasExtras={ancillarySource !== "none"}
                        seatMapSource={seatMapSource} ancillarySource={ancillarySource}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Choose preferred seats for each passenger. Seat assignments are subject to airline confirmation. Seat prices are per passenger per segment.</p>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-5">
                    <SeatMap
                      flightNumber={`${serviceFlight?.airlineCode || ""}${serviceFlight?.flightNumber || ""}`}
                      aircraft={seatMapData?.aircraft || serviceFlight?.aircraft}
                      cabinClass={serviceFlight?.cabinClass || searchCabin || "Economy"}
                      passengers={passengers.map((p, i) => ({
                        firstName: p.firstName || paxTypes[i]?.label || `Pax ${i + 1}`,
                        lastName: p.lastName || "",
                        title: p.title || "",
                      }))}
                      selectedSeats={selectedSeats}
                      onSeatSelect={handleSeatSelect}
                      onSeatDeselect={handleSeatDeselect}
                      isDomestic={domestic}
                      seatMapData={seatMapData}
                      seatMapSource={seatMapSource}
                      seatMapLoading={seatMapLoading}
                    />
                  </CardContent>
                </Card>

                {/* ── EXTRA BAGGAGE & MEALS ── */}
                <Card>
                  <CardHeader className="bg-accent/5 border-b border-border">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                        <Plus className="w-5 h-5 text-accent" /> Extra Baggage & Meals
                        <Badge className="bg-warning/10 text-warning border-0 text-[9px] ml-1">After Booking</Badge>
                      </CardTitle>
                      <AirlineSupportDialog
                        airline={serviceFlight?.airline} airlineCode={serviceFlight?.airlineCode}
                        hasBaggage={!!serviceFlight?.baggage} hasHandBaggage={!!serviceFlight?.handBaggage}
                        hasSeatMap={seatMapData?.available === true} hasExtras={ancillarySource !== "none"}
                        seatMapSource={seatMapSource} ancillarySource={ancillarySource}
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-5">
                    <Tabs defaultValue="baggage" className="w-full">
                      <TabsList className="w-full grid grid-cols-2 mb-4 h-auto">
                        <TabsTrigger value="baggage" className="gap-1 sm:gap-1.5 text-[11px] sm:text-sm py-2"><Luggage className="w-3.5 h-3.5" /> Extra Baggage</TabsTrigger>
                        <TabsTrigger value="meal" className="gap-1 sm:gap-1.5 text-[11px] sm:text-sm py-2"><UtensilsCrossed className="w-3.5 h-3.5" /> Meal Selection</TabsTrigger>
                      </TabsList>

                      <TabsContent value="baggage" className="space-y-3">
                        <div className="flex items-center gap-2 p-3 bg-accent/5 rounded-lg border border-accent/10">
                          <Briefcase className="w-4 h-4 text-accent shrink-0" />
                          <div>
                            <p className="text-sm font-medium">Included: {serviceFlight?.baggage || "Check airline website for baggage details"}</p>
                            <p className="text-xs text-muted-foreground">{serviceFlight?.baggage ? "Your fare includes this baggage allowance." : "Baggage information was not provided by the airline's booking system."}</p>
                          </div>
                        </div>
                        {baggageOptions.length > 0 ? (
                          <div className="space-y-2">
                            {baggageOptions.map(bag => (
                              <AddOnCard key={bag.id} item={bag} multi
                                selected={selectedBaggage.includes(bag.id)}
                                onSelect={() => setSelectedBaggage(prev => prev.includes(bag.id) ? prev.filter(x => x !== bag.id) : [...prev, bag.id])} />
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 bg-muted/30 rounded-lg border border-border text-center space-y-2">
                            <Package className="w-8 h-8 mx-auto text-muted-foreground/40" />
                            <p className="text-sm font-medium text-muted-foreground">Extra baggage options available after booking</p>
                            <p className="text-xs text-muted-foreground">Once your booking is confirmed and a PNR is generated, you can purchase extra baggage from your <strong>Dashboard → Bookings</strong>.</p>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="meal" className="space-y-3">
                        {mealOptions.length > 0 ? (
                          <>
                            <p className="text-sm text-muted-foreground">Select your preferred meal for this flight.</p>
                            <div className="space-y-2">
                              {mealOptions.map(meal => (
                                <AddOnCard key={meal.id} item={meal}
                                  selected={selectedMeal === meal.id}
                                  onSelect={() => setSelectedMeal(meal.id)} />
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="p-4 bg-muted/30 rounded-lg border border-border text-center space-y-2">
                            <UtensilsCrossed className="w-8 h-8 mx-auto text-muted-foreground/40" />
                            <p className="text-sm font-medium text-muted-foreground">Paid meal options available after booking</p>
                            <p className="text-xs text-muted-foreground">Premium meal purchases require a PNR. You can add paid meals from your <strong>Dashboard → Bookings</strong> after confirmation.</p>
                            <p className="text-xs text-accent">💡 Free meal requests (Halal, Vegetarian, etc.) can be set in Step 2 — Special Services.</p>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </>
            )}

            {/* REVIEW STEP: Review & Booking */}
            {step === reviewStep && (
              <>
                <Card>
                  <CardHeader className="bg-accent/5 border-b border-border">
                    <CardTitle className="text-sm sm:text-base flex items-center gap-2"><FileText className="w-5 h-5 text-accent" /> Booking Review</CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 sm:p-5 space-y-4">
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Flight Itinerary</h4>
                      <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                        {isMultiCity ? (
                          multiCityFlights.map((mcf: any, idx: number) => (
                            <div key={idx} className="flex flex-wrap items-center gap-2 sm:gap-3">
                              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-bold">
                                <Plane className="w-3.5 h-3.5" />
                                <span>Flight {idx + 1}: {mcf?.origin} → {mcf?.destination}</span>
                                <span className="text-[10px] opacity-70 font-semibold">· {fmtDate(mcf?.departureTime)}</span>
                              </div>
                              <span className="text-xs">{fmtTime(mcf?.departureTime)} – {fmtTime(mcf?.arrivalTime)}</span>
                              <span className="text-xs text-muted-foreground sm:ml-auto">{mcf?.airline} {mcf?.flightNumber}</span>
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 text-xs font-bold shadow-sm">
                                <Plane className="w-4 h-4" />
                                <span>Outbound: {outboundFlight?.origin} → {outboundFlight?.destination}</span>
                                <span className="flight-date text-xs ml-1">· {fmtDate(outboundFlight?.departureTime)}</span>
                              </div>
                              <span className="text-xs">{fmtTime(outboundFlight?.departureTime)} – {fmtTime(outboundFlight?.arrivalTime)}</span>
                              <span className="text-xs text-muted-foreground sm:ml-auto">{outboundFlight?.airline} {outboundFlight?.flightNumber}</span>
                            </div>
                            {isRoundTrip && returnFlight && (
                              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30 text-xs font-bold shadow-sm">
                                  <Plane className="w-4 h-4 rotate-180" />
                                  <span>Return: {returnFlight.origin} → {returnFlight.destination}</span>
                                  <span className="flight-date text-xs ml-1">· {fmtDate(returnFlight.departureTime)}</span>
                                </div>
                                <span className="text-xs">{fmtTime(returnFlight.departureTime)} – {fmtTime(returnFlight.arrivalTime)}</span>
                                <span className="text-xs text-muted-foreground sm:ml-auto">{returnFlight.airline} {returnFlight.flightNumber}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Passengers</h4>
                      {passengers.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 text-sm p-2 bg-muted/30 rounded-lg">
                          <User className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{p.title} {p.firstName} {p.lastName}</span>
                          {p.passport && <span className="text-xs text-muted-foreground hidden sm:inline">Passport: {p.passport}</span>}
                        </div>
                      ))}
                    </div>
                    {/* Selected Seats */}
                    {Object.keys(selectedSeats).length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Selected Seats</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedSeats).map(([paxIdx, seatId]) => (
                            <Badge key={paxIdx} variant="outline" className="text-xs">
                              <Armchair className="w-3 h-3 mr-1" />
                              {passengers[Number(paxIdx)]?.firstName || `Pax ${Number(paxIdx) + 1}`}: Seat {seatId}
                              {seatPrices[Number(paxIdx)] > 0 && ` (৳${seatPrices[Number(paxIdx)].toLocaleString()})`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {(addOnTotal > 0 || selectedMeal || selectedBaggage.length > 0) && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Selected Extras</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedMeal && <Badge variant="outline" className="text-xs"><UtensilsCrossed className="w-3 h-3 mr-1" />{mealOptions.find(m => m.id === selectedMeal)?.name}</Badge>}
                          {selectedBaggage.map(id => <Badge key={id} variant="outline" className="text-xs"><Luggage className="w-3 h-3 mr-1" />{baggageOptions.find(b => b.id === id)?.name}</Badge>)}
                        </div>
                      </div>
                    )}
                    {hasAnySSR && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Special Services (SSR)</h4>
                        <div className="space-y-1.5">
                          {paxSpecialServices.map((ss, pi) => {
                            const items: string[] = [];
                            if (ss.meal !== "none") items.push(MEAL_CODES.find(m => m.code === ss.meal)?.label || ss.meal);
                            if (ss.wheelchair !== "none") items.push(WHEELCHAIR_OPTIONS.find(w => w.code === ss.wheelchair)?.label?.split("(")[0]?.trim() || ss.wheelchair);
                            if (ss.medical) items.push("Medical (MEDA)");
                            if (ss.blind) items.push("Blind (BLND)");
                            if (ss.deaf) items.push("Deaf (DEAF)");
                            if (ss.unaccompaniedMinor) items.push("Unaccompanied Minor");
                            if (ss.pet !== "none") items.push(ss.pet === "PETC" ? "Pet in Cabin" : "Pet in Cargo");
                            if (ss.frequentFlyer.number) items.push(`FF: ${ss.frequentFlyer.airline || ""}${ss.frequentFlyer.number}`);
                            if (ss.specialRequest.trim()) items.push(`"${ss.specialRequest.trim()}"`);
                            if (items.length === 0) return null;
                            return (
                              <div key={pi} className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-medium">{passengers[pi]?.firstName || `Pax ${pi + 1}`}:</span>
                                {items.map((item, idx) => <Badge key={idx} variant="outline" className="text-[10px]">{item}</Badge>)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* International flights — info about document requirement */}
                {!domestic && (
                  <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                    <FileText className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Passport & Visa Upload Required for Ticketing</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        You can complete your booking now. To issue your ticket, you'll need to upload passport and visa copies for all passengers from your <strong>Dashboard → Bookings</strong>. Documents will be automatically verified using Machine Readable Zone (MRZ) data.
                      </p>
                    </div>
                  </div>
                )}

                <Card className="border-accent/20 bg-accent/[0.02]">
                  <CardContent className="pt-5 pb-5">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><Timer className="w-5 h-5 text-accent" /></div>
                      <div>
                        <p className="font-bold text-sm">Book now — no payment required</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Your seat is reserved instantly. Deposit the fare to your account balance later, then submit an <strong>Issue Request</strong> from <strong>Dashboard → Bookings</strong> — it will show as <strong>In Progress</strong> until our team issues the ticket.
                          {deadlineInfo && <span className="text-destructive font-semibold"> {deadlineInfo.label}.</span>}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>


                {/* ── Coupon / Reward Points Section ── */}
                <Card className="border-warning/20 bg-warning/[0.02]">
                  <CardContent className="pt-5 pb-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-warning" />
                      <h3 className="text-sm font-bold">Apply Reward Coupon</h3>
                    </div>

                    {appliedCoupon ? (
                      <div className="flex items-center justify-between p-3 rounded-xl bg-accent/5 border border-accent/20">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
                            <Ticket className="w-4 h-4 text-accent" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm">{appliedCoupon.code}</span>
                              <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Applied</Badge>
                            </div>
                            <p className="text-xs text-accent font-semibold">-৳{appliedCoupon.amount.toLocaleString()} discount</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemoveCoupon} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/* Auto-suggest available coupons */}
                        {activeCoupons.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Your available coupons:</p>
                            <div className="space-y-1.5">
                              {activeCoupons.slice(0, 3).map((c: any) => (
                                <button
                                  key={c.id}
                                  onClick={() => handleApplyCoupon(c.code)}
                                  className="w-full flex items-center justify-between p-2.5 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors text-left"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-warning/20 flex items-center justify-center">
                                      <Ticket className="w-4 h-4 text-warning" />
                                    </div>
                                    <div>
                                      <span className="font-mono font-bold text-xs">{c.code}</span>
                                      <p className="text-[10px] text-muted-foreground">
                                        BDT {parseFloat(c.amount).toLocaleString()} • Expires {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "Never"}
                                      </p>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] text-accent border-accent/40">Apply</Badge>
                                </button>
                              ))}
                            </div>
                            <Separator className="my-2" />
                          </div>
                        )}
                        {/* Manual coupon entry */}
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter coupon code"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            className="flex-1 font-mono text-sm"
                          />
                          <Button
                            variant="outline"
                            onClick={() => handleApplyCoupon()}
                            disabled={couponLoading || !couponCode.trim()}
                            className="shrink-0"
                          >
                            {couponLoading ? "Checking..." : "Apply"}
                          </Button>
                        </div>
                        {activeCoupons.length === 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            Earn reward points on every booking! Redeem points for coupons from your <Link to="/dashboard/rewards" className="text-accent hover:underline">Dashboard → Rewards</Link>.
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <div className="flex items-start gap-2">
                  <Checkbox id="agree" className="mt-0.5" checked={agreedTerms} onCheckedChange={(v) => setAgreedTerms(!!v)} />
                  <label htmlFor="agree" className="text-xs text-muted-foreground">
                    I have read and accept all <Link to="/terms" className="text-accent hover:underline">Terms & Conditions</Link> and <Link to="/refund-policy" className="text-accent hover:underline">Cancellation Policies</Link>
                  </label>
                </div>
              </>
            )}

            {/* Navigation */}
            <div className="flex flex-wrap gap-3">
              {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)} className="shrink-0">Back</Button>}
              {step < totalSteps ? (
                <Button onClick={handleContinue} className="font-bold bg-accent text-accent-foreground hover:bg-accent/90 shrink-0">Continue <ArrowRight className="w-4 h-4 ml-1" /></Button>
              ) : (
                <Button className="font-bold bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shrink-0 text-xs sm:text-sm" onClick={handleConfirmBooking} disabled={bookingLoading}>
                  {bookingLoading ? "Processing..." : <><CheckCircle2 className="w-4 h-4 mr-1 shrink-0" /> <span className="truncate">Confirm Booking — No Payment Now</span></>}
                </Button>
              )}

            </div>
          </div>

          {/* ─── FARE SUMMARY SIDEBAR ─── */}
          <div className="order-first lg:order-last">
            <Card className="sticky top-28 border-accent/20">
              <CardHeader className="bg-accent/5 border-b border-border pb-3">
                <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent" /> Fare Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-4 space-y-3 text-sm">
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Fare/Pax Type</p>
                  {totalPaxCount > 1 && (
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">Passengers</span><span className="font-semibold">{adultCount > 0 ? `${adultCount} Adult` : ""}{childCount > 0 ? `, ${childCount} Child` : ""}{infantCount > 0 ? `, ${infantCount} Infant` : ""}</span></div>
                  )}
                  {isMultiCity ? (
                    <>
                      {multiCityFlights.map((mcf: any, idx: number) => {
                        const mc = calcFlightPayable(mcf);
                        return <div key={idx} className="flex justify-between text-xs"><span className="text-muted-foreground">Flight {idx + 1}{totalPaxCount > 1 ? ` × ${totalPaxCount}` : ""}</span><span className="font-semibold">৳{(mc.payable * totalPaxCount).toLocaleString()}</span></div>;
                      })}
                      <Separator />
                    </>
                  ) : isRoundTrip ? (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Outbound{totalPaxCount > 1 ? ` × ${totalPaxCount}` : ""}</span><span className="font-semibold">৳{(outboundCalc.payable * totalPaxCount).toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Return{totalPaxCount > 1 ? ` × ${totalPaxCount}` : ""}</span><span className="font-semibold">৳{(returnCalc.payable * totalPaxCount).toLocaleString()}</span></div>
                      <Separator />
                    </>
                  ) : null}
                  <div className="flex justify-between"><span className="text-muted-foreground">Base Fare{totalPaxCount > 1 ? ` × ${totalPaxCount}` : ""}</span><span className="font-semibold">৳{baseFare.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax{totalPaxCount > 1 ? ` × ${totalPaxCount}` : ""}</span><span className="font-semibold">{taxes > 0 ? `৳${taxes.toLocaleString()}` : "Included"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount ({DISCOUNT_PCT}%)</span><span className="font-semibold text-accent">-৳{totalDiscount.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">AIT VAT</span><span className="font-semibold">৳{totalAitVat.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Service Charge</span><span className="font-semibold">{serviceCharge > 0 ? `৳${serviceCharge}` : "Free"}</span></div>
                  {couponDiscount > 0 && (
                    <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><Ticket className="w-3 h-3" /> Coupon</span><span className="font-semibold text-accent">-৳{couponDiscount.toLocaleString()}</span></div>
                  )}
                </div>

                {addOnTotal > 0 && (
                  <>
                    <Separator />
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Add-ons</p>
                    {totalSeatCost > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Seat Selection ({Object.keys(selectedSeats).length} seat{Object.keys(selectedSeats).length > 1 ? "s" : ""})</span><span>৳{totalSeatCost.toLocaleString()}</span></div>}
                    {mealCost > 0 && <div className="flex justify-between text-xs"><span className="text-muted-foreground">{mealOptions.find(m => m.id === selectedMeal)?.name}</span><span>৳{(mealCost * totalPaxCount).toLocaleString()}</span></div>}
                    {baggageCost > 0 && selectedBaggage.map(id => { const bag = baggageOptions.find(b => b.id === id); return bag ? <div key={id} className="flex justify-between text-xs"><span className="text-muted-foreground">{bag.name}</span><span>৳{(bag.price * totalPaxCount).toLocaleString()}</span></div> : null; })}
                  </>
                )}

                <Separator />
                <div className="flex justify-between text-base"><span className="font-bold">Total Payable</span><span className="font-black text-accent">৳{grandTotal.toLocaleString()}</span></div>
                <p className="text-[10px] text-muted-foreground text-center">{isMultiCity ? "Multi-city" : isRoundTrip ? "Round-trip" : "One-way"} fare for {totalPaxCount} passenger{totalPaxCount > 1 ? "s" : ""} · {searchCabin ? searchCabin.charAt(0).toUpperCase() + searchCabin.slice(1) : "Economy"}</p>

                {!isBiman && deadlineInfo && step === reviewStep && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-xs text-destructive font-semibold"><Timer className="w-3.5 h-3.5" />{deadlineInfo.label}</div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AuthGateModal open={authOpen} onOpenChange={setAuthOpen} onAuthenticated={() => { setAuthOpen(false); handleConfirmBooking(); }} title="Sign in to complete your booking" />
      <PassportScanner open={passportScanOpen} onOpenChange={setPassportScanOpen} onConfirm={handlePassportScan} />
      <SearchPassengerModal open={searchPaxOpen} onOpenChange={setSearchPaxOpen} onSelect={handleSelectExistingPax} />
      <PriceChangeModal
        open={priceChangeOpen}
        onClose={() => { setPriceChangeOpen(false); setBookingLoading(false); }}
        onAccept={handleAcceptRevalidatedPrice}
        loading={bookingLoading}
        searchBaseFare={perPaxBaseFare}
        searchTaxes={perPaxTaxes}
        searchTotal={perPaxPayable}
        searchClass={outboundFlight?.bookingClass || outboundFlight?._sabreBookingClass}
        revalidatedBaseFare={revalidatedFare?.baseFare || 0}
        revalidatedTaxes={revalidatedFare?.taxes || 0}
        revalidatedTotal={revalidatedFare ? Math.round(revalidatedFare.total / totalPaxCount) : 0}
        revalidatedClass={revalidatedFare?.bookingClass}
        airline={outboundFlight?.airline}
        route={`${outboundFlight?.origin} → ${outboundFlight?.destination}${returnFlight ? ` → ${returnFlight.destination}` : ""}`}
      />
      <ShareItineraryModal open={shareOpen} onOpenChange={setShareOpen} bookingRef={bookingResult?.bookingRef} itinerarySummary={outboundFlight ? `${outboundFlight.origin} → ${outboundFlight.destination}, ${outboundFlight.airline}` : ""} />

      {/* Session Expired Modal Overlay */}
      <AnimatePresence>
        {sessionExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="bg-card border border-border rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center"
            >
              {/* Animated search illustration */}
              <div className="mb-6 space-y-3">
                <div className="bg-muted/50 rounded-xl p-4 inline-block">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 rounded-full bg-muted-foreground/20" />
                    <div className="w-3 h-3 rounded-full bg-primary/30" />
                    <div className="flex-1" />
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                      <Search className="w-4 h-4 text-primary-foreground" />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { color: "bg-primary/20", barColor: "bg-primary/40", barWidth: "w-2/3" },
                      { color: "bg-accent/20", barColor: "bg-accent/50", barWidth: "w-3/4" },
                      { color: "bg-warning/20", barColor: "bg-warning/40", barWidth: "w-1/2" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className={`w-6 h-6 rounded-md ${item.color}`} />
                        <div className="flex-1 space-y-1">
                          <div className={`h-2.5 rounded ${item.barColor} ${item.barWidth}`} />
                          <div className="h-1.5 rounded bg-muted-foreground/10 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <h3 className="text-xl font-black text-foreground mb-2">Your Session has Expired</h3>
              <p className="text-sm text-muted-foreground mb-6">
                To see the latest availability and prices, please start a new search.
              </p>

              <Button
                size="lg"
                className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold rounded-xl px-8 h-12 text-base"
                onClick={handleNewSearch}
              >
                <Search className="w-4 h-4 mr-2" />
                Start a new Search
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlightBooking;
