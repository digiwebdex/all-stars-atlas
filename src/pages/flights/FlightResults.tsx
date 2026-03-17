import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { AIRPORT_COORDS } from "@/lib/airport-coords";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Plane, Clock, ArrowRight, Filter, X, Luggage,
  SlidersHorizontal, ChevronDown, ChevronUp, Shield, Timer,
  CircleDot, Zap, TrendingUp, Check, Info, FileText,
  ChevronLeft, ChevronRight, Star, Sun, Moon, Sunrise, Sunset,
  ArrowLeftRight, Users, Search, CalendarDays, MapPin,
  Navigation, Package, Armchair, Briefcase,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { usePrefixedNavigate } from "@/hooks/useRoutePrefix";
import { AnimatePresence, motion } from "framer-motion";
import AnimatedFlightArc from "@/components/flights/AnimatedFlightArc";
import { useFlightSearch } from "@/hooks/useApiData";
import { useCmsPageContent } from "@/hooks/useCmsContent";
import DataLoader from "@/components/DataLoader";
import { AIRPORTS } from "@/lib/airports";
import { api } from "@/lib/api";
import { API_ENDPOINTS } from "@/lib/constants";
import { format } from "date-fns";
import { formatApiDate, formatApiShortDate, formatApiTime, extractApiGMT, getApiLocalHour, isApiNextDay } from "@/lib/flight-time";

/* ─── Airline logo — dynamic CDN, no hardcoded map ─── */
function getAirlineLogo(code?: string): string | null {
  if (!code) return null;
  return `https://images.kiwi.com/airlines/64/${code}.png`;
}

/* ─── Airport names & cities — from airports.ts registry (no hardcoded map) ─── */
const AIRPORT_NAME_MAP = new Map(AIRPORTS.map(a => [a.code, a.name]));
const AIRPORT_CITY_MAP = new Map(AIRPORTS.map(a => [a.code, a.city]));
function getAirportName(code: string): string {
  return AIRPORT_NAME_MAP.get(code) || `${code} Airport`;
}
function getAirportCity(code: string): string {
  return AIRPORT_CITY_MAP.get(code) || code;
}

/* ─── Airline Alliance Mapping — real IATA memberships ─── */
const AIRLINE_ALLIANCES: Record<string, string> = {
  TK:'Star Alliance',SQ:'Star Alliance',AI:'Star Alliance',TG:'Star Alliance',NH:'Star Alliance',
  UA:'Star Alliance',LH:'Star Alliance',AC:'Star Alliance',ET:'Star Alliance',MS:'Star Alliance',
  TP:'Star Alliance',SK:'Star Alliance',CA:'Star Alliance',NZ:'Star Alliance',OZ:'Star Alliance',
  SA:'Star Alliance',AV:'Star Alliance',CM:'Star Alliance',OU:'Star Alliance',LO:'Star Alliance',
  SN:'Star Alliance',OS:'Star Alliance',A3:'Star Alliance',ZH:'Star Alliance',
  MU:'SkyTeam',CZ:'SkyTeam',KE:'SkyTeam',GA:'SkyTeam',VN:'SkyTeam',SV:'SkyTeam',
  AF:'SkyTeam',KL:'SkyTeam',DL:'SkyTeam',AZ:'SkyTeam',AR:'SkyTeam',AM:'SkyTeam',
  CI:'SkyTeam',RO:'SkyTeam',ME:'SkyTeam',SU:'SkyTeam',
  QR:'oneworld',BA:'oneworld',CX:'oneworld',MH:'oneworld',JL:'oneworld',AA:'oneworld',
  IB:'oneworld',AY:'oneworld',QF:'oneworld',RJ:'oneworld',UL:'oneworld',S7:'oneworld',
  LA:'oneworld',FJ:'oneworld',AT:'oneworld',
};

function fmtDurationMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function parseDurationToMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== "string") return 0;

  const text = value.trim();
  if (!text) return 0;

  const hoursMatch = text.match(/(\d+)\s*h/i);
  const minsMatch = text.match(/(\d+)\s*m/i);
  if (hoursMatch || minsMatch) {
    const hours = Number(hoursMatch?.[1] || 0);
    const mins = Number(minsMatch?.[1] || 0);
    const total = hours * 60 + mins;
    if (total > 0) return total;
  }

  const clockMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clockMatch) {
    const hours = Number(clockMatch[1]);
    const mins = Number(clockMatch[2]);
    const total = hours * 60 + mins;
    if (total > 0) return total;
  }

  const numeric = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function getFlightDurationMinutes(flight: any): number {
  const direct = [flight?.durationMinutes, flight?.durationMins, flight?.totalDurationMinutes]
    .map((v) => Number(v))
    .find((v) => Number.isFinite(v) && v > 0);
  if (direct) return Math.round(direct);

  const textDuration = [flight?.duration, flight?.totalDuration, flight?.elapsedTime]
    .map(parseDurationToMinutes)
    .find((v) => v > 0);
  if (textDuration) return textDuration;

  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  if (legs.length > 0) {
    const firstDep = legs[0]?.departureTime ? new Date(legs[0].departureTime).getTime() : 0;
    const lastArr = legs[legs.length - 1]?.arrivalTime ? new Date(legs[legs.length - 1].arrivalTime).getTime() : 0;
    if (firstDep > 0 && lastArr > firstDep) {
      return Math.round((lastArr - firstDep) / 60000);
    }
  }

  const dep = flight?.departureTime ? new Date(flight.departureTime).getTime() : 0;
  const arr = flight?.arrivalTime ? new Date(flight.arrivalTime).getTime() : 0;
  return dep > 0 && arr > dep ? Math.round((arr - dep) / 60000) : 0;
}

function getPairDurationMinutes(pair: { outbound: any; returnFlight: any }): number {
  return getFlightDurationMinutes(pair.outbound) + getFlightDurationMinutes(pair.returnFlight);
}

/* ─── Per-airline fare calculation helper ─── */
function getAirlineFareParams(
  airlineCode: string,
  markupSettings: { discount: number; aitVat: number; airlineMarkups?: Record<string, any> }
): { discountPct: number; aitVatPct: number } {
  const airlineMarkups = markupSettings.airlineMarkups || {};
  const entry = airlineMarkups[airlineCode];
  if (entry && !entry.useGlobal) {
    return {
      discountPct: entry.discount ?? markupSettings.discount,
      aitVatPct: markupSettings.aitVat, // AIT VAT is always global
    };
  }
  return { discountPct: markupSettings.discount, aitVatPct: markupSettings.aitVat };
}

function formatTime(datetime?: string): string {
  if (!datetime) return "--:--";
  return formatApiTime(datetime);
}

function formatGMT(datetime?: string): string {
  if (!datetime) return "";
  return extractApiGMT(datetime);
}

function formatDate(datetime?: string): string {
  if (!datetime) return "";
  return formatApiDate(datetime, { year: "2-digit" });
}

function formatShortDate(datetime?: string): string {
  if (!datetime) return "";
  return formatApiShortDate(datetime);
}

function isNextDay(depart?: string, arrive?: string): boolean {
  return isApiNextDay(depart, arrive);
}

function getBestFareDetail(flight: any) {
  const fareDetails = Array.isArray(flight?.fareDetails) ? flight.fareDetails : [];
  if (fareDetails.length === 0) return null;
  return [...fareDetails].sort((a, b) => (a?.price || 0) - (b?.price || 0))[0] || null;
}

function getDisplayBookingClass(flight: any): string {
  const best = getBestFareDetail(flight);
  return best?.bookingClass || flight?.bookingClass || "";
}

function getDisplayAvailableSeats(flight: any): number | null {
  const fareDetails = Array.isArray(flight?.fareDetails) ? flight.fareDetails : [];
  const fareSeats = fareDetails
    .map((d: any) => d?.availableSeats)
    .filter((v: any) => v !== null && v !== undefined)
    .map((v: any) => Number(v))
    .filter((v: number) => !Number.isNaN(v));
  if (fareSeats.length > 0) return Math.min(...fareSeats);
  const top = flight?.availableSeats;
  return top !== null && top !== undefined ? Number(top) : null;
}



function calcDistanceKm(from: string, to: string): number | null {
  const c1 = AIRPORT_COORDS[from], c2 = AIRPORT_COORDS[to];
  if (!c1 || !c2) return null;
  const R = 6371;
  const dLat = (c2[0] - c1[0]) * Math.PI / 180;
  const dLon = (c2[1] - c1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[0] * Math.PI / 180) * Math.cos(c2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Smart distance: if flight has legs/stops, sum segment-by-segment distances; otherwise use origin→destination */
function calcRouteDistance(flight: any): number | null {
  const legs = flight?.legs || [];
  if (legs.length > 1) {
    let total = 0;
    let allResolved = true;
    for (const leg of legs) {
      const d = calcDistanceKm(leg.origin, leg.destination);
      if (d) { total += d; } else { allResolved = false; }
    }
    if (total > 0) return total;
    if (!allResolved) {
      // Fallback: try origin→stop→stop→destination using stopCodes
      const stops = flight.stopCodes || [];
      const points = [flight.origin, ...stops, flight.destination].filter(Boolean);
      let sum = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const d = calcDistanceKm(points[i], points[i + 1]);
        if (d) sum += d;
      }
      if (sum > 0) return sum;
    }
  }
  // Direct or fallback
  const from = flight?.origin || "";
  const to = flight?.destination || "";
  return calcDistanceKm(from, to);
}

/* ─── Session Timer Component — with expiry callback ─── */
const SessionTimer = ({ startTime, onExpired }: { startTime: number; onExpired?: () => void }) => {
  const [elapsed, setElapsed] = useState(0);
  const expiredRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Math.floor((Date.now() - startTime) / 1000);
      setElapsed(now);
      if (now >= 20 * 60 && !expiredRef.current) {
        expiredRef.current = true;
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, onExpired]);
  const remaining = Math.max(0, 20 * 60 - elapsed);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining < 120;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-bold tabular-nums ${isLow ? "text-destructive" : "text-muted-foreground"}`}>
      <Timer className="w-3.5 h-3.5" />
      <span>{mins} min</span>
      <span className="animate-pulse">:</span>
      <span>{String(secs).padStart(2, '0')} sec</span>
    </div>
  );
};

/* ─── Results Outdated Modal ─── */
const ResultsOutdatedModal = ({ onNewSearch }: { onNewSearch: () => void }) => (
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
      <h3 className="text-xl font-black text-foreground mb-2">Your Results are Outdated</h3>
      <p className="text-sm text-muted-foreground mb-6">
        To see the latest availability and prices, please refresh results.
      </p>
      <button
        className="text-sm font-bold text-primary hover:text-primary/80 underline underline-offset-4 transition-colors"
        onClick={onNewSearch}
      >
        Start a new Search
      </button>
    </motion.div>
  </motion.div>
);

/* ─── Filter panel — BDFare-grade advanced filters ─── */
const FilterPanel = ({
  flights, priceRange, setPriceRange, maxPrice,
  selectedAirlines, toggleAirline,
  stopsFilter, setStopsFilter,
  departTimeRange, setDepartTimeRange,
  arrivalTimeRange, setArrivalTimeRange,
  durationRange, setDurationRange,
  selectedAlliances, toggleAlliance,
  refundableOnly, setRefundableOnly,
  selectedLayoverAirports, toggleLayoverAirport,
  layoverDurationRange, setLayoverDurationRange,
  isRoundTrip, originCode, destCode,
  selectedBaggage, toggleBaggage,
  onReset,
}: any) => {
  // Compute all stats from real flight data
  const popularFilterStats = useMemo(() => {
    const stats: { key: string; label: string; count: number; cheapest: number }[] = [];
    const cheapestOf = (arr: any[]) => arr.length > 0 ? Math.min(...arr.map((f: any) => flightPayable(f) || Infinity)) : 0;
    const nonStop = flights.filter((f: any) => (f.stops ?? 0) === 0);
    const oneStop = flights.filter((f: any) => (f.stops ?? 0) === 1);
    const multiStop = flights.filter((f: any) => (f.stops ?? 0) > 1);
    const earlyMorning = flights.filter((f: any) => { const h = getApiLocalHour(f.departureTime); return h !== null && h < 6; });
    const lateDep = flights.filter((f: any) => { const h = getApiLocalHour(f.departureTime); return h !== null && h >= 18; });
    const refundable = flights.filter((f: any) => f.refundable === true);
    if (nonStop.length > 0) stats.push({ key: 'nonstop', label: 'Non Stop', count: nonStop.length, cheapest: cheapestOf(nonStop) });
    if (oneStop.length > 0) stats.push({ key: '1stop', label: '1 Stop', count: oneStop.length, cheapest: cheapestOf(oneStop) });
    if (multiStop.length > 0) stats.push({ key: '1+stop', label: '1+ Stop', count: multiStop.length, cheapest: cheapestOf(multiStop) });
    if (earlyMorning.length > 0) stats.push({ key: 'early', label: 'Early Morning Departures', count: earlyMorning.length, cheapest: cheapestOf(earlyMorning) });
    if (lateDep.length > 0) stats.push({ key: 'late', label: 'Late Departures', count: lateDep.length, cheapest: cheapestOf(lateDep) });
    if (refundable.length > 0) stats.push({ key: 'refundable', label: 'Refundable', count: refundable.length, cheapest: cheapestOf(refundable) });
    return stats;
  }, [flights]);

  const allianceStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of flights) { const a = AIRLINE_ALLIANCES[f.airlineCode]; if (a) map[a] = (map[a] || 0) + 1; }
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [flights]);

  const durationBounds = useMemo(() => {
    const ds = flights.map((f: any) => getFlightDurationMinutes(f)).filter((d: number) => d > 0);
    return { min: ds.length > 0 ? Math.min(...ds) : 0, max: ds.length > 0 ? Math.max(...ds) : 1440 };
  }, [flights]);

  const timeSlotStats = useMemo(() => {
    const slots = [
      { key: 'before6', label: 'Before 6 AM', minH: 0, maxH: 6 },
      { key: '6to12', label: '6 AM - 12 PM', minH: 6, maxH: 12 },
      { key: '12to18', label: '12 PM - 6 PM', minH: 12, maxH: 18 },
      { key: 'after18', label: 'After 6 PM', minH: 18, maxH: 24 },
    ];
    const depart: any[] = [], arrive: any[] = [];
    for (const slot of slots) {
      const df = flights.filter((f: any) => { const h = getApiLocalHour(f.departureTime); return h !== null && h >= slot.minH && h < slot.maxH; });
      const af = flights.filter((f: any) => { const h = getApiLocalHour(f.arrivalTime); return h !== null && h >= slot.minH && h < slot.maxH; });
      if (df.length > 0) depart.push({ ...slot, count: df.length, cheapest: Math.min(...df.map((f: any) => flightPayable(f) || Infinity)) });
      if (af.length > 0) arrive.push({ ...slot, count: af.length, cheapest: Math.min(...af.map((f: any) => flightPayable(f) || Infinity)) });
    }
    return { depart, arrive };
  }, [flights]);

  const layoverAirportStats = useMemo(() => {
    const map: Record<string, { code: string; name: string; count: number; cheapest: number }> = {};
    for (const f of flights) {
      const codes = (f.stopCodes || []).length > 0 ? f.stopCodes : (f.legs || []).slice(0, -1).map((l: any) => l.destination).filter(Boolean);
      for (const code of codes) {
        if (!code) continue;
        if (!map[code]) map[code] = { code, name: getAirportName(code), count: 0, cheapest: Infinity };
        map[code].count++;
        const payable = flightPayable(f);
        if (payable < map[code].cheapest) map[code].cheapest = payable;
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [flights]);

  const layoverDurationBounds = useMemo(() => {
    const ds: number[] = [];
    for (const f of flights) {
      const legs = f.legs || [];
      for (let i = 0; i < legs.length - 1; i++) {
        if (legs[i].arrivalTime && legs[i + 1].departureTime) {
          const m = Math.round((new Date(legs[i + 1].departureTime).getTime() - new Date(legs[i].arrivalTime).getTime()) / 60000);
          if (m > 0) ds.push(m);
        }
      }
    }
    return { min: ds.length > 0 ? Math.min(...ds) : 0, max: ds.length > 0 ? Math.max(...ds) : 0 };
  }, [flights]);

  // Baggage stats — extract unique baggage values from API data
  const baggageStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of flights) {
      const bag = f.baggage || null;
      if (bag) {
        const key = String(bag).trim();
        map[key] = (map[key] || 0) + 1;
      }
    }
    return Object.entries(map).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [flights]);

  const airlineList = useMemo(() => {
    const map: Record<string, { name: string; code: string; count: number; cheapest: number }> = {};
    for (const f of flights) {
      const name = f.airline || ''; const code = f.airlineCode || ''; if (!name) continue;
      if (!map[name]) map[name] = { name, code, count: 0, cheapest: Infinity };
      map[name].count++;
      const payable = flightPayable(f);
      if (payable < map[name].cheapest) map[name].cheapest = payable;
    }
    return Object.values(map).sort((a, b) => a.cheapest - b.cheapest);
  }, [flights]);

  const slotIcons: Record<string, any> = { before6: Moon, '6to12': Sunrise, '12to18': Sun, after18: Sunset };
  const isPopularActive = (key: string) => {
    if (key === 'nonstop') return stopsFilter === '0';
    if (key === '1stop') return stopsFilter === '1';
    if (key === '1+stop') return stopsFilter === '2+';
    if (key === 'refundable') return refundableOnly;
    if (key === 'early') return departTimeRange[0] === 0 && departTimeRange[1] === 6;
    if (key === 'late') return departTimeRange[0] === 18 && departTimeRange[1] === 24;
    return false;
  };
  const handlePopularToggle = (key: string) => {
    if (key === 'nonstop') setStopsFilter(stopsFilter === '0' ? 'all' : '0');
    else if (key === '1stop') setStopsFilter(stopsFilter === '1' ? 'all' : '1');
    else if (key === '1+stop') setStopsFilter(stopsFilter === '2+' ? 'all' : '2+');
    else if (key === 'refundable') setRefundableOnly(!refundableOnly);
    else if (key === 'early') setDepartTimeRange(departTimeRange[0] === 0 && departTimeRange[1] === 6 ? [0, 24] : [0, 6]);
    else if (key === 'late') setDepartTimeRange(departTimeRange[0] === 18 ? [0, 24] : [18, 24]);
  };

  return (
    <div className="space-y-5">
      {/* Popular Filter */}
      {popularFilterStats.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Popular Filter</h4>
          <div className="space-y-2">
            {popularFilterStats.map(pf => (
              <label key={pf.key} className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2 min-w-0">
                  <Checkbox checked={isPopularActive(pf.key)} onCheckedChange={() => handlePopularToggle(pf.key)} />
                  <span className="text-xs group-hover:text-foreground text-muted-foreground transition-colors truncate">
                    {pf.label} ({pf.count})
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground font-medium shrink-0 ml-2">BDT {pf.cheapest.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Alliances */}
      {allianceStats.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Alliances</h4>
          <div className="space-y-2">
            {allianceStats.map(a => (
              <label key={a.name} className="flex items-center gap-2 cursor-pointer group">
                <Checkbox checked={selectedAlliances.includes(a.name)} onCheckedChange={() => toggleAlliance(a.name)} />
                <span className="text-xs group-hover:text-foreground text-muted-foreground transition-colors">{a.name} ({a.count})</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Price Range */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Price range</h4>
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Minimum Price</span><span>Maximum Price</span></div>
        <div className="flex justify-between text-xs font-semibold mb-2"><span>{priceRange[0].toLocaleString()}</span><span>{priceRange[1].toLocaleString()}</span></div>
        <Slider min={0} max={maxPrice} step={100} value={priceRange} onValueChange={setPriceRange} />
      </div>

      {/* By Duration */}
      {durationBounds.max > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">By Duration</h4>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Minimum Time</span><span>Maximum Time</span></div>
          <div className="flex justify-between text-xs font-semibold mb-2"><span>{fmtDurationMins(durationRange[0])}</span><span>{fmtDurationMins(durationRange[1])}</span></div>
          <Slider min={durationBounds.min} max={durationBounds.max} step={5} value={durationRange} onValueChange={setDurationRange} />
        </div>
      )}

      {/* Onward Journey label for round trips */}
      {isRoundTrip && <Separator className="my-1" />}
      {isRoundTrip && <h4 className="text-sm font-bold text-foreground">Onward Journey</h4>}

      {/* Departure From [Origin] */}
      {timeSlotStats.depart.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Departure {originCode ? `From ${originCode}` : ''}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {timeSlotStats.depart.map((slot: any) => {
              const Icon = slotIcons[slot.key] || Clock;
              const isActive = departTimeRange[0] === slot.minH && departTimeRange[1] === slot.maxH;
              return (
                <button key={slot.key} onClick={() => setDepartTimeRange(isActive ? [0, 24] : [slot.minH, slot.maxH])}
                  className={`flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-all ${isActive ? 'border-accent bg-accent/5' : 'border-border hover:border-foreground/30'}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium leading-tight">{slot.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">BDT {slot.cheapest.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Arrival At [Destination] */}
      {timeSlotStats.arrive.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Arrival {destCode ? `At ${destCode}` : ''}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {timeSlotStats.arrive.map((slot: any) => {
              const Icon = slotIcons[slot.key] || Clock;
              const isActive = arrivalTimeRange[0] === slot.minH && arrivalTimeRange[1] === slot.maxH;
              return (
                <button key={slot.key} onClick={() => setArrivalTimeRange(isActive ? [0, 24] : [slot.minH, slot.maxH])}
                  className={`flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-all ${isActive ? 'border-accent bg-accent/5' : 'border-border hover:border-foreground/30'}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium leading-tight">{slot.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">BDT {slot.cheapest.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Return Journey label */}
      {isRoundTrip && <Separator className="my-1" />}
      {isRoundTrip && <h4 className="text-sm font-bold text-foreground">Return Journey</h4>}

      {/* Layover Airports */}
      {layoverAirportStats.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Layover Airports</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {layoverAirportStats.map(la => (
              <label key={la.code} className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-2 min-w-0">
                  <Checkbox checked={selectedLayoverAirports.includes(la.code)} onCheckedChange={() => toggleLayoverAirport(la.code)} />
                  <span className="text-[10px] group-hover:text-foreground text-muted-foreground transition-colors leading-tight truncate">
                    {la.name} ({la.count})
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground font-medium shrink-0 ml-1">BDT {la.cheapest.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Layover Duration */}
      {layoverDurationBounds.max > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Layover duration</h4>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Minimum Time</span><span>Maximum Time</span></div>
          <div className="flex justify-between text-xs font-semibold mb-2"><span>{fmtDurationMins(layoverDurationRange[0])}</span><span>{fmtDurationMins(layoverDurationRange[1])}</span></div>
          <Slider min={layoverDurationBounds.min} max={layoverDurationBounds.max} step={5} value={layoverDurationRange} onValueChange={setLayoverDurationRange} />
        </div>
      )}

      {/* Baggage Filter — chip buttons from real API data */}
      {baggageStats.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Baggage Filter</h4>
          <div className="flex flex-wrap gap-1.5">
            {baggageStats.map(b => {
              const isActive = selectedBaggage.includes(b.label);
              return (
                <button key={b.label} onClick={() => toggleBaggage(b.label)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${
                    isActive
                      ? "bg-accent/10 border-accent text-accent"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}>
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preferred Airlines — with logos */}
      {airlineList.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Preferred Airlines</h4>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {airlineList.map((a: any) => (
              <label key={a.name} className="flex items-center gap-2.5 cursor-pointer group">
                <Checkbox checked={selectedAirlines.includes(a.name)} onCheckedChange={() => toggleAirline(a.name)} />
                <img
                  src={getAirlineLogo(a.code) || ''}
                  alt={a.name}
                  className="w-5 h-5 rounded-full object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <span className="text-xs group-hover:text-foreground text-muted-foreground transition-colors truncate">{a.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Transit Info Tooltip — BDFare-style layover popup ─── */
const TransitTooltipContent = ({ flight, stopIndex }: { flight: any; stopIndex: number }) => {
  const legs = flight.legs || [];
  const stopCodes = flight.stopCodes || [];
  
  // Get transit airport from legs or stopCodes
  let transitCode = "";
  let transitName = "";
  let layoverMins = 0;
  
  if (legs.length > stopIndex + 1) {
    const arrLeg = legs[stopIndex];
    const depLeg = legs[stopIndex + 1];
    transitCode = arrLeg?.destination || stopCodes[stopIndex] || "";
    if (arrLeg?.arrivalTime && depLeg?.departureTime) {
      layoverMins = Math.round((new Date(depLeg.departureTime).getTime() - new Date(arrLeg.arrivalTime).getTime()) / 60000);
    }
  } else if (stopCodes[stopIndex]) {
    transitCode = stopCodes[stopIndex];
  }
  
  transitName = transitCode ? getAirportName(transitCode) : "Transit Airport";
  const h = Math.floor(Math.abs(layoverMins) / 60);
  const m = Math.abs(layoverMins) % 60;
  
  return (
    <div className="text-sm">
      <p className="font-bold text-background mb-2">Transit (Plane Change)</p>
      <p className="text-background/70 text-xs mb-1">{stopIndex + 1}{stopIndex === 0 ? "st" : stopIndex === 1 ? "nd" : "rd"} Transit</p>
      <p className="text-background font-medium text-xs">{transitCode ? `${transitName} (${transitCode})` : "Transit Airport"}</p>
      {layoverMins > 0 && (
        <p className="text-accent font-bold text-xs mt-2">Layover Time: {h > 0 ? `${h}h` : ""}{m > 0 ? `${m}m` : ""}</p>
      )}
    </div>
  );
};

/* ─── Stop Dots with Transit Tooltips ─── */
const StopDotsWithTooltip = ({ flight, stops }: { flight: any; stops: number }) => {
  if (stops === 0) return null;
  
  return (
    <TooltipProvider delayDuration={200}>
      {Array.from({ length: Math.min(stops, 3) }).map((_, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-warning/80 border-2 border-card cursor-pointer hover:scale-150 transition-transform z-10"
              style={{ left: `${((i + 1) / (stops + 1)) * 100}%`, transform: "translate(-50%, -50%)" }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="bg-foreground border-foreground/80 text-background p-3 rounded-xl shadow-2xl max-w-[260px]">
            <TransitTooltipContent flight={flight} stopIndex={i} />
          </TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  );
};

/* ─── Fare Options Panel — BDFare-inspired but unique design ─── */
const FareOptionsPanel = ({ flights, onBook, searchedCabin }: { flights: any[]; onBook: (flight: any) => void; searchedCabin?: string }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Build fare options from the flight's fareDetails or generate from the flight itself
  const fareOptions = useMemo(() => {
    if (flights.length === 0) return [];
    const primary = flights[0];
    const fd = primary.fareDetails || [];
    const isSabreSource = String(primary.source || '').toLowerCase().includes('sabre') || !!primary._sabreSeqNumber || !!primary._sabreSource;
    
    const deriveFareBrandName = (fareDetail: any, bookingCls: string, idx: number, single: boolean): string => {
      // 1) If GDS provides a brand name, use it
      if (fareDetail.brandName) {
        return fareDetail.brandName.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      }
      if (fareDetail.label && !fareDetail.label.startsWith('Fare Option')) return fareDetail.label;

      // 2) Derive from booking class letter → branded cabin tier
      const cls = (fareDetail.bookingClass || fareDetail.cabinClass || bookingCls || '').charAt(0).toUpperCase();
      const cabinRaw = String(fareDetail.cabin || fareDetail.cabinClass || primary.cabinClass || '').toLowerCase();

      // Business / First class letters
      const businessClasses: Record<string, string> = { C: 'Business Saver', J: 'Business Flex', D: 'Business Value', I: 'Business Classic', Z: 'Business Promo' };
      const firstClasses: Record<string, string> = { F: 'First Class', A: 'First Saver', P: 'Premium First', R: 'First Suite' };
      const premEconClasses: Record<string, string> = { W: 'Premium Economy', E: 'Premium Economy Saver' };

      if (businessClasses[cls]) return businessClasses[cls];
      if (firstClasses[cls]) return firstClasses[cls];
      if (premEconClasses[cls]) return premEconClasses[cls];
      if (cabinRaw.includes('business')) return `Business ${cls || 'Class'}`;
      if (cabinRaw.includes('first')) return `First ${cls || 'Class'}`;
      if (cabinRaw.includes('premium')) return `Premium Economy ${cls || ''}`.trim();

      // 3) Economy tiers — map by booking class letter
      const econTiers: Record<string, string> = {
        Y: 'Economy Flex', B: 'Economy Standard', M: 'Economy Standard',
        H: 'Economy Comfort', K: 'Economy Value', L: 'Economy Light',
        Q: 'Economy Saver', T: 'Economy Super Saver', N: 'Economy Promo',
        V: 'Economy Convenience', S: 'Economy Smart', G: 'Economy Basic',
        X: 'Economy Discount', U: 'Economy Budget', O: 'Economy Special',
      };
      if (econTiers[cls]) return econTiers[cls];

      // 4) Final fallback
      if (single) return 'Available Fare';
      return `Economy ${cls || `Option ${idx + 1}`}`;
    };

    const buildOption = (f: any, i: number, isSingle: boolean) => {
      const label = deriveFareBrandName(f, primary.bookingClass || '', i, isSingle);

      // Determine meal/seat status — 'available' means "can be added as SSR/ancillary"
      const mealStatus = f.mealIncluded === true ? 'included' 
        : f.mealIncluded === 'available' || isSabreSource ? 'available' 
        : f.mealIncluded === false ? 'not_included' : null;
      const seatStatus = f.seatSelection === true ? 'included'
        : f.seatSelection === 'available' || isSabreSource ? 'available'
        : f.seatSelection === false ? 'not_available' : null;

      return {
        id: `option-${i}`,
        label,
        fareBasis: f.fareBasis || '',
        bookingClass: f.bookingClass || f.cabinClass || (f.fareBasis ? f.fareBasis.charAt(0).toUpperCase() : '') || primary.bookingClass || "",
        handBaggage: f.handBaggage || primary.handBaggage || "7KG",
        checkedBaggage: f.baggage || f.checkedBaggage || primary.baggage || null,
        meal: mealStatus,
        seatSelection: seatStatus,
        rebooking: typeof f.rebookingAllowed === 'boolean' ? f.rebookingAllowed : (isSabreSource ? true : null),
        cancellation: typeof f.cancellationAllowed === 'boolean' ? f.cancellationAllowed : (typeof primary.refundable === 'boolean' ? primary.refundable : null),
        miles: f.milesEarning || primary.milesEarning || null,
        grossFare: f.price || f.amount || f.total || primary.price || 0,
        flight: (() => {
          const selectedClass = f.bookingClass || f.cabinClass || primary.bookingClass || '';
          const baseFlight = {
            ...primary,
            price: f.price ?? primary.price,
            taxes: f.taxes ?? primary.taxes,
            bookingClass: selectedClass,
            fareDetails: [f],
          };
          // CRITICAL: Propagate selected fare's bookingClass to every leg
          if (selectedClass && Array.isArray(baseFlight.legs)) {
            baseFlight.legs = baseFlight.legs.map((leg: any) => ({
              ...leg,
              bookingClass: leg.bookingClass || selectedClass,
            }));
          }
          return baseFlight;
        })(),
        isBestValue: i === 0,
        isSabre: isSabreSource,
      };
    };

    if (fd.length > 1) {
      // Sort: searched cabin class first, then by price
      const searchedCab = (searchedCabin || primary.cabinClass || 'economy').toLowerCase();
      const getCabinForClass = (cls: string) => {
        const c = cls.charAt(0).toUpperCase();
        if ('CJDIZ'.includes(c)) return 'business';
        if ('FAPR'.includes(c)) return 'first';
        if ('WE'.includes(c)) return 'premium economy';
        return 'economy';
      };
      const sorted = [...fd].sort((a: any, b: any) => {
        const aCab = getCabinForClass(a.bookingClass || a.cabinClass || '');
        const bCab = getCabinForClass(b.bookingClass || b.cabinClass || '');
        const aMatch = aCab === searchedCab ? 0 : 1;
        const bMatch = bCab === searchedCab ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return (a.price || a.amount || 0) - (b.price || b.amount || 0);
      });
      return sorted.map((f: any, i: number) => buildOption(f, i, false));
    } else if (fd.length === 1) {
      return [buildOption(fd[0], 0, true)];
    }
    
    // Generate from flight data
    return [buildOption({
      bookingClass: primary.bookingClass || primary.cabinClass?.charAt(0) || "",
      handBaggage: primary.handBaggage || "7KG",
      baggage: primary.baggage,
      mealIncluded: primary.mealIncluded ?? (isSabreSource ? 'available' : null),
      seatSelection: primary.seatSelection ?? (isSabreSource ? 'available' : null),
      rebookingAllowed: typeof primary.rebookingAllowed === 'boolean' ? primary.rebookingAllowed : (isSabreSource ? true : null),
      cancellationAllowed: typeof primary.refundable === 'boolean' ? primary.refundable : null,
    }, 0, true)];
  }, [flights]);

  const fareTypeLabels = [
    { key: "handBaggage", label: "Hand Baggage", icon: Package },
    { key: "checkedBaggage", label: "Checked Baggage", icon: Luggage },
    { key: "meal", label: "Meal", icon: () => <span className="text-base">🍽</span> },
    { key: "seatSelection", label: "Seat Selection", icon: () => <span className="text-base">💺</span> },
    { key: "rebooking", label: "Rebooking", icon: FileText },
    { key: "cancellation", label: "Cancellation", icon: Shield },
    { key: "miles", label: "Miles", icon: Star },
    { key: "bookingClass", label: "Booking Class", icon: () => <span className="text-base">🎫</span> },
  ];

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
      className="overflow-hidden border-t border-border">
      <div className="p-4 sm:p-5 bg-muted/10">
        <div className="flex gap-0">
          {/* Left: Fare Type Labels */}
          <div className="w-40 shrink-0">
            <div className="h-12 flex items-center px-3">
              <span className="text-sm font-bold text-foreground">Fare Type</span>
            </div>
            {fareTypeLabels.map((ft) => {
              const Icon = ft.icon;
              return (
                <div key={ft.key} className="h-11 flex items-center gap-2 px-3">
                  <span className="text-accent"><Icon className="w-4 h-4" /></span>
                  <span className="text-xs font-medium text-foreground">{ft.label}</span>
                </div>
              );
            })}
            <div className="h-16 flex items-start px-3 pt-2">
              <button className="text-xs font-semibold text-accent hover:underline flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" /> Fare Terms & Policies
              </button>
            </div>
          </div>

          {/* Right: Scrollable fare options */}
          <div className="flex-1 relative min-w-0">
            {fareOptions.length > 2 && (
              <>
                <button className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-card border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
                  onClick={() => scrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-card border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors"
                  onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-none px-1">
              {fareOptions.map((opt, idx) => (
                <div key={opt.id}
                  className={`shrink-0 w-52 rounded-xl border transition-all hover:shadow-md ${
                    opt.isBestValue ? "border-accent/40 bg-card shadow-sm" : "border-border bg-card"
                  }`}>
                  {/* Header */}
                  <div className="h-12 flex flex-col items-center justify-center px-4">
                    <p className="text-sm font-bold text-foreground">{opt.label}</p>
                    {opt.fareBasis && opt.label !== `Fare ${opt.fareBasis}` && (
                      <p className="text-[9px] text-muted-foreground font-mono">{opt.fareBasis}</p>
                    )}
                  </div>

                  {/* Values */}
                  <div>
                    {fareTypeLabels.map((ft) => {
                      const val = opt[ft.key as keyof typeof opt];
                      let display: React.ReactNode;

                      if (ft.key === "handBaggage" || ft.key === "checkedBaggage") {
                        display = val ? <span className="text-xs font-semibold text-foreground">{String(val)}</span> : <span className="text-xs text-muted-foreground italic">Not provided</span>;
                      } else if (ft.key === "meal") {
                        display = val === 'included' 
                          ? <span className="text-xs font-medium text-accent">Included</span>
                          : val === 'available'
                            ? <span className="text-xs font-medium text-accent">Available to add</span>
                            : val === 'not_included' 
                              ? <span className="text-xs text-muted-foreground">Not included</span> 
                              : <span className="text-xs text-muted-foreground italic">Not provided</span>;
                      } else if (ft.key === "bookingClass") {
                        const bkCls = String(val || "");
                        const cabLabel = ({ C: 'Business', J: 'Business', D: 'Business', I: 'Business', Z: 'Business', F: 'First', A: 'First', P: 'First', R: 'First', W: 'Prem Econ', E: 'Prem Econ' } as Record<string, string>)[bkCls.charAt(0)] || 'Economy';
                        display = bkCls ? <span className="text-xs font-bold text-foreground">{bkCls.charAt(0)} <span className="font-normal text-muted-foreground">({cabLabel})</span></span> : <span className="text-xs text-muted-foreground">—</span>;
                      } else if (ft.key === "seatSelection") {
                        display = val === 'included'
                          ? <span className="text-xs font-medium text-accent">Included</span>
                          : val === 'available'
                            ? <span className="text-xs font-medium text-accent">Available to add</span>
                            : val === 'not_available' ? <X className="w-4 h-4 text-destructive/60 mx-auto" />
                            : <span className="text-xs text-muted-foreground italic">Not provided</span>;
                      } else if (ft.key === "rebooking" || ft.key === "cancellation") {
                        display = val === true
                          ? <span className="text-xs font-medium text-orange-500">Penalties Apply</span>
                          : val === false ? <X className="w-4 h-4 text-destructive/60 mx-auto" />
                          : <span className="text-xs text-muted-foreground italic">Not provided</span>;
                      } else if (ft.key === "miles") {
                        display = val ? <span className="text-xs font-medium text-foreground">{String(val)}</span> : <span className="text-xs text-muted-foreground italic">Not provided</span>;
                      } else {
                        display = val ? <span className="text-xs font-medium text-foreground">{String(val)}</span> : <span className="text-xs text-muted-foreground">—</span>;
                      }

                      return (
                        <div key={ft.key} className="h-11 flex items-center justify-center px-3 border-t border-border/30 text-center">
                          {display}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer: Payable Fare + Book */}
                  <div className="px-4 py-3 border-t border-border/50 text-center space-y-2">
                    <p className="text-[10px] text-muted-foreground">Payable Fare</p>
                    <p className="text-base font-black text-foreground">BDT {flightPayable(opt.flight).toLocaleString()}</p>
                    <Button size="sm" className="w-full font-bold rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground h-9"
                      onClick={() => onBook(opt.flight)}>
                      Book Now
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Reward Points Calculator — 1% of fare ─── */
function calcRewardPoints(price: number): number {
  return Math.round(price * 0.01);
}

/* ─── Payable Price from gross — applies discount + AIT VAT ─── */
function calcPayableFromGross(grossPrice: number, taxes: number, discountPct = 6.30, aitVatPct = 0.3): number {
  const baseFare = Math.max(0, Math.round(grossPrice - taxes));
  const discount = Math.round(baseFare * discountPct / 100);
  const aitVat = Math.round(baseFare * aitVatPct / 100);
  return baseFare - discount + taxes + aitVat;
}

/* ─── API-first fare extraction (prevents zero-price leakage) ─── */
function getApiFareTotals(f: any): { grossPrice: number; taxes: number } {
  const toNum = (v: any): number => {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const cleaned = v.replace(/,/g, "").replace(/\s+/g, "").replace(/[^\d.-]/g, "");
      if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return 0;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof v === "object") {
      const candidates = [
        v.amount,
        v.value,
        v.total,
        v.totalAmount,
        v.totalPrice,
        v.equivalentAmount,
        v.equivalentPrice,
        v.baseFare,
        v.baseFareAmount,
        v.tax,
        v.taxAmount,
        v.totalTaxAmount,
      ];
      for (const c of candidates) {
        const n = toNum(c);
        if (n > 0) return n;
      }
    }
    return 0;
  };

  const pickPositive = (...values: any[]) => {
    for (const v of values) {
      const n = toNum(v);
      if (n > 0) return n;
    }
    return 0;
  };

  const directGross = pickPositive(
    f?.price,
    f?.totalPrice,
    f?.totalRoundTripPrice,
    f?.grossPrice,
    f?.amount,
    f?.total,
    f?.publishedFare,
    f?.fareTotal,
  );
  const directTaxes = pickPositive(
    f?.taxes,
    f?.taxAmount,
    f?.totalTaxAmount,
    f?.tax,
  );

  let grossPrice = directGross;
  let taxes = directTaxes;

  // Top-level base + tax fallback
  if (grossPrice <= 0) {
    const baseFare = pickPositive(f?.baseFare, f?.adultBaseFare);
    const taxFare = pickPositive(f?.taxes, f?.taxAmount, f?.totalTaxAmount, f?.tax);
    if (baseFare > 0) {
      grossPrice = baseFare + taxFare;
      if (taxes <= 0) taxes = taxFare;
    }
  }

  // Fare options fallback
  if (grossPrice <= 0 && Array.isArray(f?.fareDetails) && f.fareDetails.length > 0) {
    const priced = f.fareDetails
      .map((d: any) => ({
        price: pickPositive(d?.price, d?.totalPrice, d?.grossPrice, d?.amount, d?.total, d?.fareTotal),
        taxes: pickPositive(d?.taxes, d?.totalTaxAmount, d?.taxAmount, d?.tax),
      }))
      .filter((d: any) => d.price > 0)
      .sort((a: any, b: any) => a.price - b.price);

    if (priced.length > 0) {
      grossPrice = priced[0].price;
      if (taxes <= 0 && priced[0].taxes > 0) taxes = priced[0].taxes;
    }
  }

  // Pax pricing fallback
  if ((grossPrice <= 0 || taxes <= 0) && Array.isArray(f?.paxPricing) && f.paxPricing.length > 0) {
    const paxGross = f.paxPricing.reduce((sum: number, p: any) => {
      const count = Math.max(1, Number(p?.count) || 1);
      const total = pickPositive(p?.total, p?.price, p?.grossPrice, p?.amount);
      return sum + (total * count);
    }, 0);
    const paxTaxes = f.paxPricing.reduce((sum: number, p: any) => {
      const count = Math.max(1, Number(p?.count) || 1);
      const tax = pickPositive(p?.taxes, p?.taxAmount, p?.totalTaxAmount, p?.tax);
      return sum + (tax * count);
    }, 0);

    if (grossPrice <= 0 && paxGross > 0) grossPrice = paxGross;
    if (taxes <= 0 && paxTaxes > 0) taxes = paxTaxes;
  }

  // Combined flight fallback (sum segment API prices)
  if (grossPrice <= 0 && Array.isArray(f?.segments) && f.segments.length > 0) {
    const segmentGross = f.segments.reduce(
      (sum: number, seg: any) => sum + pickPositive(seg?.price, seg?.totalPrice, seg?.grossPrice, seg?.amount, seg?.total),
      0,
    );
    const segmentTaxes = f.segments.reduce(
      (sum: number, seg: any) => sum + pickPositive(seg?.taxes, seg?.taxAmount, seg?.totalTaxAmount, seg?.tax),
      0,
    );

    if (segmentGross > 0) {
      grossPrice = segmentGross;
      if (taxes <= 0 && segmentTaxes > 0) taxes = segmentTaxes;
    }
  }

  if (grossPrice > 0 && taxes > grossPrice) {
    taxes = Math.max(0, grossPrice);
  }

  return { grossPrice, taxes };
}

/* ─── Shortcut: payable from a flight object ─── */
function flightPayable(f: any): number {
  const apiFare = getApiFareTotals(f);
  return calcPayableFromGross(apiFare.grossPrice, apiFare.taxes, f?.fareRules?.discount ?? 6.30, f?.fareRules?.aitVat ?? 0.3);
}

/* ─── Build fare rows from real API per-pax pricing (no fabricated multipliers) ─── */
function buildFareRows(
  paxPricing: any[] | undefined,
  baseFare: number, taxes: number,
  paxAdults: number, paxChildren: number, paxInfants: number,
  discountPct: number, aitVatPct: number,
  /** For round-trip combined view, pass outbound + return paxPricing arrays */
  paxPricing2?: any[]
): { paxType: string; baseFare: number; tax: number; other: number; discount: number; aitVat: number; count: number; amount: number }[] {
  const fareRows: { paxType: string; baseFare: number; tax: number; other: number; discount: number; aitVat: number; count: number; amount: number }[] = [];

  // Card-level gross (already in BDT) = baseFare + taxes
  const cardGross = baseFare + taxes;

  // Merge two paxPricing arrays (outbound + return) by summing per-type
  const mergedPax = mergePaxPricingArrays(paxPricing, paxPricing2);

  // Validate paxPricing: sum must match card-level gross within 5%
  // If paxPricing baseFare is in foreign currency (e.g. USD from Sabre), it won't match → fall back
  let usePaxPricing = false;
  if (mergedPax && mergedPax.length > 0 && cardGross > 0) {
    const paxGrossSum = mergedPax.reduce((sum: number, pp: any) => {
      const count = Math.max(1, Number(pp.count) || 1);
      return sum + ((pp.baseFare || 0) + (pp.taxes || 0)) * count;
    }, 0);
    usePaxPricing = paxGrossSum > 0 && Math.abs(paxGrossSum - cardGross) / cardGross <= 0.05;
  }

  if (usePaxPricing && mergedPax) {
    // Use real API per-pax-type pricing (values confirmed in BDT)
    for (const pp of mergedPax) {
      const ppBase = pp.baseFare || 0;
      const ppTax = pp.taxes || 0;
      const disc = Math.round(ppBase * discountPct / 100);
      const aitVat = Math.round(ppBase * aitVatPct / 100);
      const count = pp.count || 1;
      fareRows.push({
        paxType: pp.label || pp.type || 'Adult',
        baseFare: ppBase,
        tax: ppTax,
        other: 0,
        discount: disc,
        aitVat,
        count,
        amount: (ppBase - disc + ppTax + aitVat) * count,
      });
    }
  } else {
    // Fallback: use card-level baseFare/taxes (guaranteed BDT)
    if (paxAdults > 0) {
      const perAdultBase = paxAdults > 0 ? Math.round(baseFare / paxAdults) : baseFare;
      const perAdultTax = paxAdults > 0 ? Math.round(taxes / paxAdults) : taxes;
      const disc = Math.round(perAdultBase * discountPct / 100);
      const aitVat = Math.round(perAdultBase * aitVatPct / 100);
      fareRows.push({ paxType: "Adult", baseFare: perAdultBase, tax: perAdultTax, other: 0, discount: disc, aitVat, count: paxAdults, amount: (perAdultBase - disc + perAdultTax + aitVat) * paxAdults });
    }
    if (paxChildren > 0) {
      const childBase = paxAdults > 0 ? Math.round((baseFare / paxAdults) * 0.75) : Math.round(baseFare * 0.75);
      const childTax = paxAdults > 0 ? Math.round(taxes / paxAdults) : taxes;
      const disc = Math.round(childBase * discountPct / 100);
      const aitVat = Math.round(childBase * aitVatPct / 100);
      fareRows.push({ paxType: "Child", baseFare: childBase, tax: childTax, other: 0, discount: disc, aitVat, count: paxChildren, amount: (childBase - disc + childTax + aitVat) * paxChildren });
    }
    if (paxInfants > 0) {
      const infantBase = paxAdults > 0 ? Math.round((baseFare / paxAdults) * 0.1) : Math.round(baseFare * 0.1);
      const infantTax = paxAdults > 0 ? Math.round((taxes / paxAdults) * 0.5) : Math.round(taxes * 0.5);
      const disc = Math.round(infantBase * discountPct / 100);
      const aitVat = Math.round(infantBase * aitVatPct / 100);
      fareRows.push({ paxType: "Infant", baseFare: infantBase, tax: infantTax, other: 0, discount: disc, aitVat, count: paxInfants, amount: (infantBase - disc + infantTax + aitVat) * paxInfants });
    }
  }
  return fareRows;
}

/* ─── Merge two paxPricing arrays (outbound + return) by summing per type ─── */
function mergePaxPricingArrays(arr1?: any[], arr2?: any[]): any[] | null {
  if (!arr1 || arr1.length === 0) return arr2 && arr2.length > 0 ? arr2 : null;
  if (!arr2 || arr2.length === 0) return arr1;
  // Sum by type
  const map: Record<string, any> = {};
  for (const pp of arr1) {
    const key = pp.type || pp.label || 'ADT';
    map[key] = { ...pp, baseFare: pp.baseFare || 0, taxes: pp.taxes || 0, total: pp.total || 0 };
  }
  for (const pp of arr2) {
    const key = pp.type || pp.label || 'ADT';
    if (map[key]) {
      map[key].baseFare += pp.baseFare || 0;
      map[key].taxes += pp.taxes || 0;
      map[key].total += pp.total || 0;
    } else {
      map[key] = { ...pp, baseFare: pp.baseFare || 0, taxes: pp.taxes || 0, total: pp.total || 0 };
    }
  }
  return Object.values(map);
}

/* ─── Leg Mini — compact leg display for grouped cards ─── */
const LegMini = ({ flight, label, labelColor }: { flight: any; label: string; labelColor: string }) => {
  const departTime = formatTime(flight.departureTime);
  const arriveTime = formatTime(flight.arrivalTime);
  const departGmt = formatGMT(flight.departureTime);
  const arriveGmt = formatGMT(flight.arrivalTime);
  const duration = flight.duration || "";
  const stops = flight.stops ?? 0;
  const stopsLabel = stops === 0 ? "Non-Stop" : `${stops} Stop${stops > 1 ? "s" : ""}`;
  const nextDay = isNextDay(flight.departureTime, flight.arrivalTime);
  const fromCode = flight.origin || "";
  const toCode = flight.destination || "";
  const isReturn = label === "Return";
  const legs = flight.legs || [];
  const stopCodes = flight.stopCodes || [];

  return (
    <div className="flex-1 min-w-0">
      {/* Route label badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md mb-3 text-[11px] font-bold ${
        isReturn 
          ? "bg-amber-50/80 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300" 
          : "bg-accent/10 dark:bg-accent/20 text-accent"
      }`}>
        <Plane className={`w-3.5 h-3.5 ${isReturn ? "rotate-180" : ""}`} />
        <span>{isReturn ? "RETURN" : "DEPARTURE"}</span>
        <span className={isReturn ? "text-amber-300 dark:text-amber-600 font-normal" : "text-accent/40 font-normal"}>|</span>
        <span>{fromCode} → {toCode}</span>
        <span className={isReturn ? "text-amber-300 dark:text-amber-600 font-normal" : "text-accent/40 font-normal"}>|</span>
        <span className="flight-date">{formatShortDate(flight.departureTime)}</span>
      </div>

      {/* Time + Arc row */}
      <div className="flex items-center gap-3">
        {/* Origin */}
        <div className="text-center shrink-0">
          <p className="text-sm font-bold text-foreground">{fromCode}</p>
          <p className="text-base sm:text-lg font-black tracking-tight flight-time leading-tight">{departTime}</p>
          {departGmt && <p className="text-[10px] text-muted-foreground leading-tight">{departGmt}</p>}
        </div>

        {/* Duration arc */}
        <div className="flex-1 flex flex-col items-center gap-0.5 min-w-[60px]">
          {stops > 0 && legs.length > 1 ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full cursor-pointer">
                    <AnimatedFlightArc compact direction={isReturn ? "return" : "departure"} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs p-3 space-y-2">
                  <p className="font-semibold text-xs mb-1.5">Layover Details</p>
                  {legs.map((leg: any, li: number) => {
                    if (li === 0) return null;
                    const prevLeg = legs[li - 1];
                    const prevArr = prevLeg?.arrivalTime ? new Date(prevLeg.arrivalTime).getTime() : 0;
                    const curDep = leg?.departureTime ? new Date(leg.departureTime).getTime() : 0;
                    const layoverMins = prevArr && curDep ? Math.round((curDep - prevArr) / 60000) : 0;
                    const layoverStr = layoverMins > 0 ? fmtDurationMins(layoverMins) : "";
                    const stopCity = prevLeg?.destination || stopCodes[li - 1] || "";
                    const stopName = stopCity ? getAirportCity(stopCity) : "";
                    return (
                      <div key={li} className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full bg-warning shrink-0" />
                        <span className="font-medium">{stopCity}{stopName && stopName !== stopCity ? ` (${stopName})` : ""}</span>
                        {layoverStr && <span className="text-muted-foreground">— {layoverStr} layover</span>}
                      </div>
                    );
                  })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <AnimatedFlightArc compact direction={isReturn ? "return" : "departure"} />
          )}
          <p className="text-[10px] text-muted-foreground font-medium">{duration}</p>
          <div className="flex items-center gap-1.5">
            <p className={`text-[10px] font-semibold ${stops === 0 ? "text-foreground" : "text-warning"}`}>{stopsLabel}</p>
            {(() => { const d = calcRouteDistance(flight); return d ? (
              <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" /> {d.toLocaleString()} Km
              </span>
            ) : null; })()}
          </div>
        </div>

        {/* Destination */}
        <div className="text-center shrink-0">
          <p className="text-sm font-bold text-foreground">{toCode}</p>
          <p className="text-base sm:text-lg font-black tracking-tight flight-time leading-tight">
            {arriveTime}
            {nextDay && <sup className="text-[8px] text-destructive font-bold ml-0.5">+1</sup>}
          </p>
          {arriveGmt && <p className="text-[10px] text-muted-foreground leading-tight">{arriveGmt}</p>}
        </div>
      </div>
    </div>
  );
};

/* ─── Round Trip Grouped Card — both legs in one card ─── */
const RoundTripFlightCard = ({
  outbound, returnFlight, cheapest, isExpanded, onToggleExpand,
}: {
  outbound: any; returnFlight: any; cheapest: number; isExpanded: boolean; onToggleExpand: () => void;
}) => {
  const cardNavigate = useNavigate();
  const [cardSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("itinerary");
  const [showFareOptions, setShowFareOptions] = useState(false);
  const logo = getAirlineLogo(outbound.airlineCode);
  const outboundApiFare = getApiFareTotals(outbound);
  const returnApiFare = getApiFareTotals(returnFlight);
  const apiRoundTripGross = outboundApiFare.grossPrice + returnApiFare.grossPrice;
  const grossTotalPrice = Number(outbound?.totalRoundTripPrice) > 0 ? Number(outbound.totalRoundTripPrice) : apiRoundTripGross;
  const totalPrice = flightPayable(outbound) + flightPayable(returnFlight);
  const refundable = outbound.refundable ?? false;
  const fareType = outbound.fareType || (refundable ? "Refundable" : "Non-Refundable");
  const flightNo = [outbound.flightNumber, returnFlight.flightNumber].filter(Boolean).join(", ");

  const roundTripFarePanelFlights = useMemo(() => {
    // Always sum per-direction API prices (BDFare-style cross-product pairing)
    const totalGross = outboundApiFare.grossPrice + returnApiFare.grossPrice;
    const totalTaxes = outboundApiFare.taxes + returnApiFare.taxes;

    const outboundFareDetails = Array.isArray(outbound?.fareDetails) && outbound.fareDetails.length > 0
      ? outbound.fareDetails
      : [{
          brandName: "Round Trip Package",
          bookingClass: outbound.bookingClass,
          cabinClass: outbound.cabinClass,
          handBaggage: outbound.handBaggage,
          baggage: outbound.baggage,
          refundable: outbound.refundable,
          price: outboundApiFare.grossPrice,
          taxes: outboundApiFare.taxes,
        }];

    const combinedFareDetails = outboundFareDetails.map((fare: any) => {
      const farePrice = Number(fare?.price ?? fare?.amount ?? outboundApiFare.grossPrice ?? 0) || 0;
      const fareTaxes = Number(fare?.taxes ?? outboundApiFare.taxes ?? 0) || 0;

      // For cross-product pairs, always sum outbound fare + return API fare
      const combinedPrice = farePrice + returnApiFare.grossPrice;
      const combinedTaxes = fareTaxes + returnApiFare.taxes;

      return {
        ...fare,
        price: combinedPrice,
        taxes: combinedTaxes,
        _outboundGrossPrice: outboundApiFare.grossPrice,
        _outboundTaxes: outboundApiFare.taxes,
        _outboundFareDetail: fare,
        _isRoundTripCombinedFare: true,
      };
    });

    return [{
      ...outbound,
      price: totalGross,
      taxes: totalTaxes,
      baggage: outbound?.baggage || returnFlight?.baggage,
      handBaggage: outbound?.handBaggage || returnFlight?.handBaggage,
      fareDetails: combinedFareDetails,
      _baseOutboundFlight: outbound,
      _baseReturnFlight: returnFlight,
    }];
  }, [outbound, returnFlight]);

  return (
    <Card className={`overflow-hidden transition-all border ${isExpanded ? "border-accent/30 shadow-md" : "border-border hover:shadow-md"}`}>
      <CardContent className="p-0">
        <div className="flex flex-col xl:flex-row min-w-0">
          {/* Airline section */}
          <div className="flex items-center gap-2.5 p-2.5 sm:p-3 xl:w-36 2xl:w-40 shrink-0 border-b xl:border-b-0 xl:border-r border-border/50">
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              {logo ? (
                <img src={logo} alt={outbound.airline} className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center"><span class="text-[10px] font-bold text-muted-foreground">${(outbound.airlineCode || "").toUpperCase()}</span></div>`; }} />
              ) : (
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-[10px] font-bold text-muted-foreground">{(outbound.airlineCode || "").toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-tight truncate">{outbound.airline}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{flightNo}</p>
            </div>
            {/* Mobile-only price */}
            <div className="xl:hidden text-right ml-auto shrink-0">
              <p className="text-base sm:text-lg font-black leading-none whitespace-nowrap">BDT {totalPrice.toLocaleString()}</p>
              {grossTotalPrice > totalPrice && (
                <p className="text-[10px] font-bold text-amber-500 line-through">BDT {grossTotalPrice.toLocaleString()}</p>
              )}
            </div>
          </div>

          {/* Both legs — stack on mobile/tablet, side-by-side on lg+ */}
          <div className="flex-1 flex flex-col md:flex-row p-2.5 sm:p-3 gap-2.5 sm:gap-3 min-w-0">
            <LegMini flight={outbound} label="Departure" labelColor="text-foreground" />
            <div className="hidden md:block w-px bg-border/60 self-stretch shrink-0" />
            <div className="md:hidden h-px bg-border/60" />
            <LegMini flight={returnFlight} label="Return" labelColor="text-foreground" />
          </div>

          {/* Price + Airline info — hidden on mobile (shown inline above) */}
          <div className="hidden xl:flex flex-col items-end justify-center gap-1 p-3 xl:w-44 2xl:w-52 shrink-0 border-l border-border/50 bg-muted/20">
            <div className="flex items-center gap-1.5">
              {totalPrice === cheapest && totalPrice > 0 && (
                <Badge className="bg-accent/10 text-accent border-0 text-[8px] font-bold px-1.5 py-0">Cheapest</Badge>
              )}
              {totalPrice > 0 && (
                <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300/50 dark:border-amber-700/50 text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full">
                  <span className="text-[11px]">🪙</span> +{calcRewardPoints(totalPrice).toLocaleString()} Points
                </Badge>
              )}
            </div>
            <p className="text-lg xl:text-2xl font-black leading-none whitespace-nowrap">BDT {totalPrice.toLocaleString()}</p>
            {grossTotalPrice > totalPrice && (
              <p className="text-[11px] font-bold text-amber-500 line-through">BDT {grossTotalPrice.toLocaleString()}</p>
            )}
            <p className="text-[10px] text-muted-foreground">Price for {parseInt(new URLSearchParams(window.location.search).get("adults") || "1")} traveller{parseInt(new URLSearchParams(window.location.search).get("adults") || "1") > 1 ? "s" : ""}</p>
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-[11px] text-accent font-semibold flex items-center gap-1 hover:underline">
                  Price Breakdown <ChevronRight className="w-3 h-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" className="w-64 p-3">
                <p className="text-xs font-bold mb-2">Fare Breakdown</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Outbound</span><span className="font-medium">BDT {flightPayable(outbound).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Return</span><span className="font-medium">BDT {flightPayable(returnFlight).toLocaleString()}</span></div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-bold"><span>Total Payable</span><span>BDT {totalPrice.toLocaleString()}</span></div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Mobile/tablet points + price breakdown row */}
        <div className="xl:hidden flex items-center justify-between px-2.5 sm:px-3 py-1.5 border-t border-border/30 bg-muted/10">
          <div className="flex items-center gap-1.5">
            {totalPrice === cheapest && totalPrice > 0 && (
              <Badge className="bg-accent/10 text-accent border-0 text-[8px] font-bold px-1.5 py-0">Cheapest</Badge>
            )}
            {totalPrice > 0 && (
              <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300/50 dark:border-amber-700/50 text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full">
                <span className="text-[11px]">🪙</span> +{calcRewardPoints(totalPrice).toLocaleString()} Points
              </Badge>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-[10px] sm:text-[11px] text-accent font-semibold flex items-center gap-1 hover:underline">
                Price Breakdown <ChevronRight className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" className="w-64 p-3">
              <p className="text-xs font-bold mb-2">Fare Breakdown</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Outbound</span><span className="font-medium">BDT {flightPayable(outbound).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Return</span><span className="font-medium">BDT {flightPayable(returnFlight).toLocaleString()}</span></div>
                <Separator className="my-1" />
                <div className="flex justify-between font-bold"><span>Total Payable</span><span>BDT {totalPrice.toLocaleString()}</span></div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Baggage + Seats + Class info row */}
        <div className="flex items-center flex-wrap gap-1.5 px-3 sm:px-4 py-2 border-t border-border/30">
          {(() => {
            const hb = outbound.handBaggage || "7KG";
            return hb ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                <Briefcase className="w-3 h-3" /> {hb}
              </span>
            ) : null;
          })()}
          {outbound.baggage && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              <Luggage className="w-3 h-3" /> {outbound.baggage}
            </span>
          )}
          {(() => {
            const seats = getDisplayAvailableSeats(outbound);
            return seats !== null ? (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-bold ${
                seats <= 4
                  ? "bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40 text-destructive"
                  : seats <= 9
                    ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200/60 dark:border-orange-800/40 text-orange-600 dark:text-orange-400"
                    : "bg-accent/5 border-accent/20 text-accent"
              }`}>
                <Armchair className="w-3 h-3" /> {seats} Seats Left
              </span>
            ) : null;
          })()}
          {(() => {
            const cabin = outbound.cabinClass || "";
            const bClass = getDisplayBookingClass(outbound);
            const cabinDisplay = cabin && bClass ? `${cabin}-${bClass} Class` : cabin || bClass || "";
            return cabinDisplay ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/60 border border-border/60 text-[10px] sm:text-[11px] font-semibold text-muted-foreground">
                <Plane className="w-3 h-3" /> {cabinDisplay}
              </span>
            ) : null;
          })()}
          {(() => {
            const best = getBestFareDetail(outbound);
            const isRefundable = best?.refundable ?? outbound.refundable ?? false;
            return (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-bold ${
                isRefundable
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40 text-destructive"
              }`}>
                {isRefundable ? "Refundable" : "Non-Refundable"}
              </span>
            );
          })()}
          {(outbound.stops ?? 0) === 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
              Direct
            </span>
          )}
        </div>

        {/* Info bar */}
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 bg-muted/30 border-t border-border/50">
          <button className="order-1 flex items-center gap-1 text-accent font-bold text-xs hover:underline shrink-0" onClick={onToggleExpand}>
            Flight Details {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <div className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1 flex items-center justify-start sm:justify-center gap-3 sm:gap-5">
            {outbound.airlineCode?.toUpperCase() !== "BG" && (
              <span className="text-emerald-800 dark:text-emerald-300 font-bold text-xs">Book &amp; Hold</span>
            )}
          </div>
          <div className="order-2 sm:order-3 ml-auto sm:ml-0 shrink-0">
            <Button size="sm" className="font-bold h-8 sm:h-9 px-4 sm:px-5 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground text-xs"
              onClick={() => setShowFareOptions(!showFareOptions)}>
              <span className="hidden sm:inline">View Round-Trip Prices</span>
              <span className="sm:hidden">View Prices</span>
              {roundTripFarePanelFlights[0]?.fareDetails?.length > 1 && (
                <Badge className="ml-1 bg-accent-foreground/20 text-accent-foreground border-0 text-[9px] px-1 py-0">
                  {roundTripFarePanelFlights[0].fareDetails.length}
                </Badge>
              )}
              {showFareOptions ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
            </Button>
          </div>
        </div>

        {/* Fare Options Panel */}
        <AnimatePresence>
          {showFareOptions && (
            <FareOptionsPanel
              flights={roundTripFarePanelFlights}
              searchedCabin={cardSearchParams.get("cabin") || cardSearchParams.get("class") || "economy"}
              onBook={(selectedFlight) => {
                const selectedFare = selectedFlight?.fareDetails?.[0];
                const baseOutbound = selectedFlight?._baseOutboundFlight || outbound;
                const selectedClass = selectedFare?.bookingClass || baseOutbound.bookingClass || '';
                const selectedOutbound = selectedFare
                  ? (() => {
                      const ob = {
                        ...baseOutbound,
                        price: selectedFare._outboundGrossPrice ?? baseOutbound.price,
                        taxes: selectedFare._outboundTaxes ?? baseOutbound.taxes,
                        fareDetails: [selectedFare._outboundFareDetail || selectedFare],
                        bookingClass: selectedClass,
                        cabinClass: selectedFare.cabinClass || baseOutbound.cabinClass,
                        handBaggage: selectedFare.handBaggage || baseOutbound.handBaggage,
                        baggage: selectedFare.checkedBaggage || selectedFare.baggage || baseOutbound.baggage,
                        refundable: typeof selectedFare.refundable === 'boolean' ? selectedFare.refundable : baseOutbound.refundable,
                      };
                      // Propagate bookingClass to legs
                      if (selectedClass && Array.isArray(ob.legs)) {
                        ob.legs = ob.legs.map((leg: any) => ({ ...leg, bookingClass: leg.bookingClass || selectedClass }));
                      }
                      return ob;
                    })()
                  : baseOutbound;

                cardNavigate(
                  `/flights/book?roundTrip=true&adults=${cardSearchParams.get("adults") || "1"}&children=${cardSearchParams.get("children") || "0"}&infants=${cardSearchParams.get("infants") || "0"}&cabin=${cardSearchParams.get("cabin") || "economy"}`,
                  { state: { outboundFlight: selectedOutbound, returnFlight: selectedFlight?._baseReturnFlight || returnFlight } },
                );
              }}
            />
          )}
        </AnimatePresence>

        {/* Expanded detail - tabbed view like FlightCard */}
        <AnimatePresence>
          {isExpanded && (() => {
            const paxAdults = parseInt(cardSearchParams.get("adults") || "1");
            const paxChildren = parseInt(cardSearchParams.get("children") || "0");
            const paxInfants = parseInt(cardSearchParams.get("infants") || "0");
            const obBaggage = outbound.baggage || null;
            const retBaggage = returnFlight.baggage || null;

            // Build fare rows from real API per-pax pricing
            const outboundFare = getApiFareTotals(outbound);
            const returnFare = getApiFareTotals(returnFlight);
            const obBase = Math.max(0, Math.round(outboundFare.grossPrice - outboundFare.taxes));
            const retBase = Math.max(0, Math.round(returnFare.grossPrice - returnFare.taxes));
            const combinedBase = obBase + retBase;
            const combinedTax = outboundFare.taxes + returnFare.taxes;

            const DISCOUNT_PCT = outbound.fareRules?.discount ?? 6.30;
            const AIT_VAT_PCT = outbound.fareRules?.aitVat ?? 0.3;

            const fareRows = buildFareRows(
              outbound.paxPricing, combinedBase, combinedTax,
              paxAdults, paxChildren, paxInfants,
              DISCOUNT_PCT, AIT_VAT_PCT,
              returnFlight.paxPricing
            );
            const totalPayable = fareRows.reduce((s, r) => s + r.amount, 0);

            return (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                <div className="border-t border-border">
                  {/* Tabs */}
                  <div className="flex items-center border-b border-border bg-muted/20">
                    <div className="flex overflow-x-auto scrollbar-none">
                      {[
                        { key: "itinerary", label: "Flight Details" },
                        { key: "fare", label: "Fare Summary" },
                        { key: "baggage", label: "Baggage" },
                        { key: "cancellation", label: "Cancellation" },
                        { key: "datechange", label: "Date Change" },
                      ].map(tab => (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                          className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                            activeTab === tab.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}>
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto px-3">
                      <button className="flex items-center gap-1 text-accent text-xs font-semibold hover:underline">
                        <Info className="w-3 h-3" /> Fare terms &amp; policy
                      </button>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    {/* Flight Details */}
                    {activeTab === "itinerary" && (
                      <div className="space-y-6">
                        {[{ leg: outbound, label: "Outbound" }, { leg: returnFlight, label: "Return" }].map(({ leg, label }) => {
                          const legs = leg.legs || [];
                          const legLogo = getAirlineLogo(leg.airlineCode);
                          const cabin = leg.cabinClass || "";
                          const bkClass = leg.bookingClass || leg.fareDetails?.[0]?.bookingClass || "";
                          const cabDisp = cabin && bkClass ? `${cabin} - ${bkClass}` : cabin || bkClass || "";
                          const seats = leg.availableSeats ?? null;
                          const ac = leg.aircraft || legs[0]?.aircraft || "";

                          return (
                            <div key={label}>
                              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl mb-3 text-sm font-bold shadow-sm ${
                                label === "Return"
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30"
                                  : "bg-accent/15 text-accent border border-accent/30"
                              }`}>
                                <Plane className={`w-4 h-4 ${label === "Return" ? "rotate-180" : ""}`} />
                                {label}: {leg.origin} → {leg.destination}
                                <span className="flight-date text-xs ml-1">· {formatDate(leg.departureTime)}</span>
                              </div>
                              {(legs.length > 0 ? legs : [{ origin: leg.origin, destination: leg.destination, departureTime: leg.departureTime, arrivalTime: leg.arrivalTime, duration: leg.duration, flightNumber: leg.flightNumber, airlineCode: leg.airlineCode, aircraft: ac }]).map((segment: any, i: number) => (
                                <div key={i} className="space-y-3 mb-4">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {legLogo && <img src={legLogo} alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                                    <span className="text-sm font-semibold">{leg.airline}</span>
                                    <span className="text-sm text-muted-foreground">{segment.flightNumber || leg.flightNumber}</span>
                                    {(segment.aircraft || ac) && <><span className="text-muted-foreground text-sm">|</span><span className="text-sm text-muted-foreground">{segment.aircraft || ac}</span></>}
                                    <span className="text-muted-foreground text-sm">|</span>
                                    <span className="text-sm font-medium">{cabDisp}</span>
                                    {seats !== null && seats <= 9 && <span className="text-sm text-orange-500 font-bold">{seats} Seat{seats !== 1 ? "s" : ""} Left</span>}
                                  </div>
                                  <div className="flex items-start justify-between pt-2 pb-1">
                                    <div className="text-left shrink-0 max-w-[38%]">
                                      <p className="text-xl font-black flight-time">{formatTime(segment.departureTime)}</p>
                                      <p className="text-xs flight-date mt-0.5">{formatDate(segment.departureTime)}</p>
                                      <p className="text-[11px] text-muted-foreground mt-1">{getAirportName(segment.origin || leg.origin)} ({segment.origin || leg.origin})</p>
                                    </div>
                                    <div className="flex-1 flex flex-col items-center justify-center pt-1 px-4">
                                      <AnimatedFlightArc compact direction={label === "Return" ? "return" : "departure"} />
                                      <p className="text-xs text-muted-foreground font-medium -mt-0.5">{segment.duration || leg.duration}</p>
                                    </div>
                                    <div className="text-right shrink-0 max-w-[38%]">
                                      <p className="text-xl font-black flight-time">{formatTime(segment.arrivalTime)}</p>
                                      <p className="text-xs flight-date mt-0.5">{formatDate(segment.arrivalTime)}</p>
                                      <p className="text-[11px] text-muted-foreground mt-1">{getAirportName(segment.destination || leg.destination)} ({segment.destination || leg.destination})</p>
                                    </div>
                                  </div>
                                  {/* Layover between segments */}
                                  {i < (legs.length > 0 ? legs.length : 1) - 1 && legs.length > 1 && (() => {
                                    const nextSeg = legs[i + 1];
                                    const transitCode = segment.destination || "";
                                    const transitCity = transitCode ? getAirportCity(transitCode) : "";
                                    let layoverStr = "";
                                    if (nextSeg?.departureTime && segment.arrivalTime) {
                                      const layoverMin = Math.round((new Date(nextSeg.departureTime).getTime() - new Date(segment.arrivalTime).getTime()) / 60000);
                                      const h = Math.floor(layoverMin / 60);
                                      const m = layoverMin % 60;
                                      layoverStr = `${h > 0 ? `${h}h ` : ""}${m > 0 ? `${m}m` : ""}`;
                                    }
                                    return (
                                      <div className="flex items-center gap-2 py-3 px-4 my-2">
                                        <div className="flex-1 h-px bg-warning/30" />
                                        <div className="flex items-center gap-2 text-xs bg-warning/10 px-4 py-2 rounded-full border border-warning/20">
                                          <span className="text-destructive font-semibold">Change of planes</span>
                                          <span className="text-foreground font-medium">
                                            {layoverStr && <>{layoverStr} </>}Layover{transitCity ? ` in ${transitCity}` : ""}
                                          </span>
                                        </div>
                                        <div className="flex-1 h-px bg-warning/30" />
                                      </div>
                                    );
                                  })()}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fare Summary */}
                    {activeTab === "fare" && (
                      <div className="space-y-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead>
                              <tr className="bg-muted/50">
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Type</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Base Fare</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Tax</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Other</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Discount</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">AIT VAT</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Count</th>
                                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-xs">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fareRows.map((row, i) => (
                                <tr key={i} className="border-t border-border/50">
                                  <td className="px-3 py-2.5 font-medium">{row.paxType}</td>
                                  <td className="px-3 py-2.5">{row.baseFare.toLocaleString()}</td>
                                  <td className="px-3 py-2.5">{row.tax.toLocaleString()}</td>
                                  <td className="px-3 py-2.5">{row.other}</td>
                                  <td className="px-3 py-2.5">{row.discount}</td>
                                  <td className="px-3 py-2.5">{row.aitVat}</td>
                                  <td className="px-3 py-2.5">{row.count}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold">BDT {row.amount.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex justify-end items-center gap-6 pt-1">
                          <span className="font-bold text-sm">Total Payable</span>
                          <span className="font-black text-base">BDT {totalPayable.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    {/* Baggage — table layout */}
                    {activeTab === "baggage" && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Sector</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Checkin</th>
                              <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Cabin</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border/50">
                              <td className="px-4 py-3 font-semibold text-base"><span className="flex items-center gap-2">{outbound.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {outbound.destination}</span></td>
                              <td className="px-4 py-3 text-muted-foreground">{obBaggage ? `ADT : ${obBaggage}` : "Not provided"}</td>
                              <td className="px-4 py-3 text-muted-foreground">{outbound.handBaggage ? `ADT : ${outbound.handBaggage}` : "ADT : 7KG"}</td>
                            </tr>
                            <tr className="border-t border-border/50">
                              <td className="px-4 py-3 font-semibold text-base"><span className="flex items-center gap-2">{returnFlight.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {returnFlight.destination}</span></td>
                              <td className="px-4 py-3 text-muted-foreground">{retBaggage ? `ADT : ${retBaggage}` : "Not provided"}</td>
                              <td className="px-4 py-3 text-muted-foreground">{returnFlight.handBaggage ? `ADT : ${returnFlight.handBaggage}` : "ADT : 7KG"}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Cancellation — sector-based from API */}
                    {activeTab === "cancellation" && (
                      <div className="space-y-4">
                        {[{ leg: outbound, label: "" }, { leg: returnFlight, label: "" }].map(({ leg }, idx) => (
                          <div key={idx} className="border border-border rounded-lg overflow-hidden">
                            <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                              {leg.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {leg.destination}
                            </div>
                            <table className="w-full text-sm">
                              <thead><tr className="border-t border-border">
                                <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                                <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                              </tr></thead>
                              <tbody><tr className="border-t border-border/50">
                                <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {leg.cancellationPolicy?.beforeDeparture != null
                                    ? `Cancellation allowed with fees + BDT ${Number(leg.cancellationPolicy.beforeDeparture).toLocaleString()}`
                                    : (leg.refundable ?? refundable) ? "Cancellation allowed with fees" : "Non-refundable"}
                                </td>
                              </tr></tbody>
                            </table>
                          </div>
                        ))}
                        <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
                          <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Purchased baggage and seat selections are non-refundable.
                        </div>
                      </div>
                    )}

                    {/* Date Change — sector-based from API */}
                    {activeTab === "datechange" && (
                      <div className="space-y-4">
                        {[{ leg: outbound }, { leg: returnFlight }].map(({ leg }, idx) => (
                          <div key={idx} className="border border-border rounded-lg overflow-hidden">
                            <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                              {leg.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {leg.destination}
                            </div>
                            <table className="w-full text-sm">
                              <thead><tr className="border-t border-border">
                                <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                                <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee + Fare difference<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                              </tr></thead>
                              <tbody><tr className="border-t border-border/50">
                                <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {leg.dateChangePolicy?.changeAllowed === false
                                    ? "Date change not permitted"
                                    : leg.dateChangePolicy?.changeFee != null
                                      ? `Date change allowed with fees + BDT ${Number(leg.dateChangePolicy.changeFee).toLocaleString()}`
                                      : "Date change allowed with fees"}
                                </td>
                              </tr></tbody>
                            </table>
                          </div>
                        ))}
                        <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
                          <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Date change charges are applicable only on selecting the same airline on a new date. The difference in fares between the old and the new booking will also be payable by the user.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};

/* ─── Multi-City Expanded Details Panel — matches one-way/round-trip system ─── */
const MultiCityExpandedDetails = ({ flight, segments }: { flight: any; segments: any[] }) => {
  const [activeTab, setActiveTab] = useState("itinerary");
  const [cardSearchParams] = useSearchParams();
  const price = flight.price ?? 0;
  const taxes = flight.taxes ?? 0;
  const baseFare = Math.max(0, Math.round(price - taxes));
  const refundable = flight.refundable ?? false;

  // Fare calculation matching one-way/round-trip
  const paxAdults = parseInt(cardSearchParams.get("adults") || "1");
  const paxChildren = parseInt(cardSearchParams.get("children") || "0");
  const paxInfants = parseInt(cardSearchParams.get("infants") || "0");
  const DISCOUNT_PCT = flight.fareRules?.discount ?? 6.3;
  const AIT_VAT_PCT = flight.fareRules?.aitVat ?? 0.3;

  const fareRows = buildFareRows(
    flight.paxPricing, baseFare, taxes,
    paxAdults, paxChildren, paxInfants,
    DISCOUNT_PCT, AIT_VAT_PCT
  );
  const totalPayable = fareRows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="border-t border-border/50 bg-muted/10">
      {/* Tabs */}
      <div className="flex border-b border-border/50">
        <div className="flex overflow-x-auto scrollbar-none">
          {[
            { key: "itinerary", label: "Flight Details" },
            { key: "fare", label: "Fare Summary" },
            { key: "baggage", label: "Baggage" },
            { key: "cancellation", label: "Cancellation" },
            { key: "datechange", label: "Date Change" },
          ].map(tab => (
            <button key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-auto px-3 flex items-center">
          <button className="flex items-center gap-1 text-accent text-xs font-semibold hover:underline">
            <Info className="w-3 h-3" /> Fare terms &amp; policy
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {/* Flight Details Tab — full airport names, layover info, seats left */}
        {activeTab === "itinerary" && (
          <div className="space-y-6">
            {segments.map((seg: any, i: number) => {
              const segLegs = seg.legs || [];
              const logo = getAirlineLogo(seg.airlineCode);
              const cabin = seg.cabinClass || flight.cabinClass || "";
              const bkClass = seg.bookingClass || flight.bookingClass || flight.fareDetails?.[0]?.bookingClass || "";
              const cabDisp = cabin && bkClass ? `${cabin} - ${bkClass}` : cabin || bkClass || "";
              const seats = seg.availableSeats ?? flight.availableSeats ?? null;
              const ac = seg.aircraft || "";

              return (
                <div key={i}>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md mb-3 text-[11px] font-bold bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">
                    <Plane className="w-3.5 h-3.5" />
                    <span>Segment {i + 1}</span>
                    <span className="text-blue-300 dark:text-blue-600 font-normal">|</span>
                    <span>{seg.origin} → {seg.destination}</span>
                    <span className="text-blue-300 dark:text-blue-600 font-normal">|</span>
                    <span className="flight-date">{formatShortDate(seg.departureTime)}</span>
                    <span className="text-blue-300 dark:text-blue-600 font-normal">|</span>
                    <span className="opacity-70">{seg.stops === 0 ? "Non-Stop" : `${seg.stops} Stop${seg.stops > 1 ? "s" : ""}`}</span>
                  </div>
                  {(segLegs.length > 0 ? segLegs : [{ origin: seg.origin, destination: seg.destination, departureTime: seg.departureTime, arrivalTime: seg.arrivalTime, duration: seg.duration, flightNumber: seg.flightNumber, airlineCode: seg.airlineCode, aircraft: ac }]).map((leg: any, li: number) => (
                    <div key={li} className="space-y-3 mb-4">
                      {/* Airline info row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {logo && <img src={logo} alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                        <span className="text-sm font-semibold">{seg.airline || flight.airline}</span>
                        <span className="text-sm text-muted-foreground">{leg.flightNumber || seg.flightNumber}</span>
                        {(leg.aircraft || ac) && <><span className="text-muted-foreground text-sm">|</span><span className="text-sm text-muted-foreground">{leg.aircraft || ac}</span></>}
                        <span className="text-muted-foreground text-sm">|</span>
                        <span className="text-sm font-medium">{cabDisp}</span>
                        {seats !== null && seats <= 9 && <span className="text-sm text-orange-500 font-bold">{seats} Seat{seats !== 1 ? "s" : ""} Left</span>}
                      </div>
                      {/* Times with arc and full airport names */}
                      <div className="flex items-start justify-between pt-2 pb-1">
                        <div className="text-left shrink-0 max-w-[38%]">
                          <p className="text-xl font-black flight-time">{formatTime(leg.departureTime || seg.departureTime)}</p>
                          <p className="text-xs flight-date mt-0.5">{formatShortDate(leg.departureTime || seg.departureTime)}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{getAirportName(leg.origin || seg.origin)} ({leg.origin || seg.origin})</p>
                        </div>
                        <div className="flex-1 flex flex-col items-center justify-center pt-1 px-4">
                          <AnimatedFlightArc compact direction="departure" />
                          <p className="text-xs text-muted-foreground font-medium -mt-0.5">{leg.duration || seg.duration}</p>
                        </div>
                        <div className="text-right shrink-0 max-w-[38%]">
                          <p className="text-xl font-black flight-time">{formatTime(leg.arrivalTime || seg.arrivalTime)}</p>
                          <p className="text-xs flight-date mt-0.5">{formatShortDate(leg.arrivalTime || seg.arrivalTime)}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{getAirportName(leg.destination || seg.destination)} ({leg.destination || seg.destination})</p>
                        </div>
                      </div>
                      {/* Layover between legs */}
                      {li < (segLegs.length > 0 ? segLegs.length : 1) - 1 && segLegs.length > 1 && (() => {
                        const nextLeg = segLegs[li + 1];
                        const transitCode = leg.destination || "";
                        const transitCity = transitCode ? getAirportCity(transitCode) : "";
                        let layoverStr = "";
                        if (nextLeg?.departureTime && leg.arrivalTime) {
                          const layoverMin = Math.round((new Date(nextLeg.departureTime).getTime() - new Date(leg.arrivalTime).getTime()) / 60000);
                          const h = Math.floor(layoverMin / 60);
                          const m = layoverMin % 60;
                          layoverStr = `${h > 0 ? `${h}h ` : ""}${m > 0 ? `${m}m` : ""}`;
                        }
                        return (
                          <div className="flex items-center gap-2 py-3 px-4 my-2">
                            <div className="flex-1 h-px bg-warning/30" />
                            <div className="flex items-center gap-2 text-xs bg-warning/10 px-4 py-2 rounded-full border border-warning/20">
                              <span className="text-destructive font-semibold">Change of planes</span>
                              <span className="text-foreground font-medium">
                                {layoverStr && <>{layoverStr} </>}Layover{transitCity ? ` in ${transitCity}` : ""}
                              </span>
                            </div>
                            <div className="flex-1 h-px bg-warning/30" />
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Fare Summary — full table with Discount, AIT VAT matching one-way/round-trip */}
        {activeTab === "fare" && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Type</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Base Fare</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Tax</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Other</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Discount</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">AIT VAT</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Count</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-xs">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {fareRows.map((row, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="px-3 py-2.5 font-medium">{row.paxType}</td>
                      <td className="px-3 py-2.5">{row.baseFare.toLocaleString()}</td>
                      <td className="px-3 py-2.5">{row.tax.toLocaleString()}</td>
                      <td className="px-3 py-2.5">{row.other}</td>
                      <td className="px-3 py-2.5">{row.discount}</td>
                      <td className="px-3 py-2.5">{row.aitVat}</td>
                      <td className="px-3 py-2.5">{row.count}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">BDT {row.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end items-center gap-6 pt-1">
              <span className="font-bold text-sm">Total Payable</span>
              <span className="font-black text-base">BDT {totalPayable.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Baggage — table layout matching one-way/round-trip */}
        {activeTab === "baggage" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Sector</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Checkin</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Cabin</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg: any, i: number) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="px-4 py-3 font-semibold text-base"><span className="flex items-center gap-2">{seg.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {seg.destination}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{seg.baggage ? `ADT : ${seg.baggage}` : "Not provided"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{seg.handBaggage ? `ADT : ${seg.handBaggage}` : "Not provided"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cancellation — sector-based matching one-way/round-trip */}
        {activeTab === "cancellation" && (
          <div className="space-y-4">
            {segments.map((seg: any, i: number) => (
              <div key={i} className="border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                  {seg.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {seg.destination}
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-t border-border">
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                  </tr></thead>
                  <tbody><tr className="border-t border-border/50">
                    <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {seg.cancellationPolicy?.beforeDeparture != null
                        ? `Cancellation allowed with fees + BDT ${Number(seg.cancellationPolicy.beforeDeparture).toLocaleString()}`
                        : refundable ? "Cancellation allowed with fees" : "Non-refundable"}
                    </td>
                  </tr></tbody>
                </table>
              </div>
            ))}
            <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Purchased baggage and seat selections are non-refundable.
            </div>
          </div>
        )}

        {/* Date Change — sector-based matching one-way/round-trip */}
        {activeTab === "datechange" && (
          <div className="space-y-4">
            {segments.map((seg: any, i: number) => (
              <div key={i} className="border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                  {seg.origin} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {seg.destination}
                </div>
                <table className="w-full text-sm">
                  <thead><tr className="border-t border-border">
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                    <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee + Fare difference<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                  </tr></thead>
                  <tbody><tr className="border-t border-border/50">
                    <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {seg.dateChangePolicy?.changeAllowed === false
                        ? "Date change not permitted"
                        : seg.dateChangePolicy?.changeFee != null
                          ? `Date change allowed with fees + BDT ${Number(seg.dateChangePolicy.changeFee).toLocaleString()}`
                          : "Date change allowed with fees"}
                    </td>
                  </tr></tbody>
                </table>
              </div>
            ))}
            <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Date change charges are applicable only on selecting the same airline on a new date. The difference in fares between the old and the new booking will also be payable by the user.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Multi-City Flight Card — combined itinerary with all segments ─── */
const MultiCityFlightCard = ({
  flight, cheapest, isExpanded, onToggleExpand,
}: {
  flight: any; cheapest: number; isExpanded: boolean; onToggleExpand: () => void;
}) => {
  const cardNavigate = useNavigate();
  const [cardSearchParams] = useSearchParams();
  const segments = flight.segments || [];
  const grossPrice = flight.price ?? 0;
  const price = flight.isCombined
    ? (flight.segments || []).reduce((s: number, seg: any) => s + flightPayable(seg), 0) || flightPayable(flight)
    : flightPayable(flight);
  const refundable = flight.refundable ?? false;
  const fareType = flight.fareType || (refundable ? "Refundable" : "Non-Refundable");

  return (
    <Card className={`overflow-hidden transition-all border ${isExpanded ? "border-accent/30 shadow-md" : "border-border hover:shadow-md"}`}>
      <CardContent className="p-0">
        <div className="flex flex-col">
          {/* All segment legs */}
          <div className="flex-1 flex flex-col">
            {segments.map((seg: any, i: number) => {
              const logo = getAirlineLogo(seg.airlineCode);
              const segLegs = seg.legs || [];
              return (
                <div key={i} className={`flex items-center gap-3 sm:gap-5 p-3 sm:p-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                  {/* Airline */}
                  <div className="flex flex-col items-center gap-1 w-20 sm:w-24 shrink-0">
                    {logo ? <img src={logo} alt={seg.airline} className="w-8 h-8 object-contain" /> : <Plane className="w-6 h-6 text-muted-foreground" />}
                    <p className="text-[10px] text-muted-foreground font-medium truncate max-w-full">{seg.airline}</p>
                    <p className="text-[9px] text-muted-foreground">{seg.flightNumber}</p>
                  </div>
                  {/* Times */}
                  <div className="flex-1 flex items-center gap-2 sm:gap-4 min-w-0">
                    <div className="text-center shrink-0">
                      <p className="text-lg sm:text-xl font-black leading-tight flight-time">{formatTime(seg.departureTime)}</p>
                      <p className="text-[10px] flight-date">{formatShortDate(seg.departureTime)}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{seg.origin}</p>
                    </div>
                    <div className="flex-1 flex flex-col items-center gap-0.5 min-w-[80px]">
                      <AnimatedFlightArc compact direction="departure" />
                      <p className="text-xs text-muted-foreground font-medium">{seg.duration}</p>
                      <p className={`text-[10px] font-bold ${seg.stops === 0 ? "text-foreground" : "text-warning"}`}>
                        {seg.stops === 0 ? "Non-Stop" : `${seg.stops} Stop${seg.stops > 1 ? "s" : ""}`}
                      </p>
                      {(() => { const d = calcRouteDistance(seg); return d ? (
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" /> {d.toLocaleString()} Km
                        </span>
                      ) : null; })()}
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-lg sm:text-xl font-black leading-tight flight-time">{formatTime(seg.arrivalTime)}</p>
                      <p className="text-[10px] flight-date">{formatShortDate(seg.arrivalTime)}</p>
                      <p className="text-[10px] font-bold text-muted-foreground">{seg.destination}</p>
                    </div>
                  </div>
                  {/* Baggage + seats + class */}
                  <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 w-28">
                    <div className="flex items-center flex-wrap gap-1.5 text-[10px] justify-end">
                      {seg.handBaggage && <span className="flex items-center gap-0.5 text-accent font-medium"><Package className="w-3 h-3" /> {seg.handBaggage}</span>}
                      {seg.baggage && <span className="flex items-center gap-0.5 text-accent font-medium"><Luggage className="w-3 h-3" /> {seg.baggage}</span>}
                    </div>
                    {seg.availableSeats != null && seg.availableSeats <= 9 && (
                      <span className={`text-[10px] font-bold ${seg.availableSeats <= 4 ? "text-destructive" : "text-orange-500"}`}>
                        <Users className="w-3 h-3 inline mr-0.5" />{seg.availableSeats} Seat{seg.availableSeats !== 1 ? "s" : ""} Left
                      </span>
                    )}
                    {(seg.cabinClass || seg.bookingClass || flight.fareDetails?.[0]?.bookingClass) && (() => {
                      const bkCls = (seg.bookingClass || flight.fareDetails?.[0]?.bookingClass || '').charAt(0).toUpperCase();
                      const cabinFromClass = ({ C: 'Business', J: 'Business', D: 'Business', I: 'Business', Z: 'Business', F: 'First', A: 'First', P: 'First', R: 'First', W: 'Premium Economy', E: 'Premium Economy' } as Record<string, string>)[bkCls] || seg.cabinClass || 'Economy';
                      return <span className="text-[10px] text-muted-foreground">{cabinFromClass}{bkCls ? ` - ${bkCls} Class` : ''}</span>;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Price section */}
          <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 border-t border-border/50 bg-muted/20">
            <div className="flex items-center gap-3">
              {price === cheapest && price > 0 && <Badge className="bg-accent/10 text-accent border-0 text-[9px] font-bold">Cheapest</Badge>}
              {price > 0 && (
                <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-0 text-[9px] font-bold flex items-center gap-1">
                  <span className="text-sm">🪙</span> +{calcRewardPoints(price).toLocaleString()}
                </Badge>
              )}
            </div>
            <div className="text-right">
              <p className="text-xl sm:text-2xl font-black text-accent">BDT {price.toLocaleString()}</p>
              {grossPrice > price && (
                <p className="text-xs font-bold text-amber-500 line-through">BDT {grossPrice.toLocaleString()}</p>
              )}
              <p className="text-[10px] text-muted-foreground">Price for {parseInt(cardSearchParams.get("adults") || "1")} traveller{parseInt(cardSearchParams.get("adults") || "1") > 1 ? "s" : ""}</p>
            </div>
          </div>
        </div>
        {/* Info bar */}
        <div className="flex items-center px-3 sm:px-5 py-2.5 bg-muted/30 border-t border-border/50">
          <button className="flex items-center gap-1 text-accent font-bold text-xs sm:text-sm hover:underline shrink-0" onClick={onToggleExpand}>
            Flight Details {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <div className="flex-1 flex items-center justify-center gap-3 sm:gap-5">
            {flight.airlineCode?.toUpperCase() !== "BG" && (
              <span className="text-emerald-800 dark:text-emerald-300 font-bold text-xs sm:text-sm">Book &amp; Hold</span>
            )}
          </div>
          <Button size="sm" className="font-bold h-9 px-5 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={() => {
              const bookingSegments = flight?.segments?.length > 0 ? flight.segments : [flight];
              cardNavigate(`/flights/book?multiCity=true&adults=${cardSearchParams.get("adults") || "1"}&children=${cardSearchParams.get("children") || "0"}&infants=${cardSearchParams.get("infants") || "0"}&cabin=${cardSearchParams.get("cabin") || "economy"}`, {
                state: { outboundFlight: bookingSegments[0], multiCityFlights: bookingSegments },
              });
            }}>
            Book Now <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        {/* Expanded Details Panel */}
        {isExpanded && (
          <MultiCityExpandedDetails flight={flight} segments={segments} />
        )}
      </CardContent>
    </Card>
  );
};


/* ─── Round-trip pair payable — always sum per-direction payables (BDFare-style) ─── */
function pairPayable(p: { outbound: any; returnFlight: any }): number {
  return flightPayable(p.outbound) + flightPayable(p.returnFlight);
}

function sortRoundTripPairs(pairs: { outbound: any; returnFlight: any }[], sortBy: string) {
  const sorted = [...pairs];
  const pairDur = (p: { outbound: any; returnFlight: any }) => getPairDurationMinutes(p);
  const pairStops = (p: { outbound: any; returnFlight: any }) => (Number(p.outbound?.stops) || 0) + (Number(p.returnFlight?.stops) || 0);
  const pairDepartureTs = (p: { outbound: any; returnFlight: any }) => (p.outbound?.departureTime ? new Date(p.outbound.departureTime).getTime() : Number.MAX_SAFE_INTEGER);
  const pairReturnDepartureTs = (p: { outbound: any; returnFlight: any }) => (p.returnFlight?.departureTime ? new Date(p.returnFlight.departureTime).getTime() : Number.MAX_SAFE_INTEGER);
  const pairStableId = (p: { outbound: any; returnFlight: any }) => `${String(p.outbound?.id ?? "")}_${String(p.returnFlight?.id ?? "")}`;
  const stableOrder = (a: { outbound: any; returnFlight: any }, b: { outbound: any; returnFlight: any }) => {
    const outboundTsDiff = pairDepartureTs(a) - pairDepartureTs(b);
    if (outboundTsDiff !== 0) return outboundTsDiff;

    const returnTsDiff = pairReturnDepartureTs(a) - pairReturnDepartureTs(b);
    if (returnTsDiff !== 0) return returnTsDiff;

    return pairStableId(a).localeCompare(pairStableId(b));
  };

  if (sortBy === "cheapest") {
    return sorted.sort((a, b) => {
      const payableDiff = pairPayable(a) - pairPayable(b);
      if (payableDiff !== 0) return payableDiff;

      const durationDiff = pairDur(a) - pairDur(b);
      if (durationDiff !== 0) return durationDiff;

      const stopsDiff = pairStops(a) - pairStops(b);
      if (stopsDiff !== 0) return stopsDiff;

      return stableOrder(a, b);
    });
  }

  if (sortBy === "fastest") {
    return sorted.sort((a, b) => {
      const dA = pairDur(a) || Number.MAX_SAFE_INTEGER;
      const dB = pairDur(b) || Number.MAX_SAFE_INTEGER;
      if (dA !== dB) return dA - dB;

      const stopsDiff = pairStops(a) - pairStops(b);
      if (stopsDiff !== 0) return stopsDiff;

      const departureDiff = stableOrder(a, b);
      if (departureDiff !== 0) return departureDiff;

      return pairPayable(a) - pairPayable(b);
    });
  }

  if (sortBy === "departure") {
    return sorted.sort((a, b) => stableOrder(a, b));
  }

  // Best = normalized weighted balance: 40% price, 45% duration, 15% stops
  const payables = sorted.map((p) => pairPayable(p));
  const durations = sorted.map((p) => pairDur(p)).filter((d) => d > 0);
  const minP = payables.length > 0 ? Math.min(...payables) : 0;
  const maxP = payables.length > 0 ? Math.max(...payables) : 1;
  const minD = durations.length > 0 ? Math.min(...durations) : 0;
  const maxD = durations.length > 0 ? Math.max(...durations) : 1;
  const priceSpread = maxP - minP || 1;
  const durSpread = maxD - minD || 1;

  return sorted.sort((a, b) => {
    const durA = pairDur(a) || maxD;
    const durB = pairDur(b) || maxD;
    const pA = pairPayable(a);
    const pB = pairPayable(b);
    const scoreA = ((pA - minP) / priceSpread) * 0.4 + ((durA - minD) / durSpread) * 0.45 + pairStops(a) * 0.15;
    const scoreB = ((pB - minP) / priceSpread) * 0.4 + ((durB - minD) / durSpread) * 0.45 + pairStops(b) * 0.15;
    if (scoreA !== scoreB) return scoreA - scoreB;

    const durationDiff = durA - durB;
    if (durationDiff !== 0) return durationDiff;

    const payableDiff = pA - pB;
    if (payableDiff !== 0) return payableDiff;

    const stopsDiff = pairStops(a) - pairStops(b);
    if (stopsDiff !== 0) return stopsDiff;

    return stableOrder(a, b);
  });
}

const FlightCard = ({
  flight, cheapest, isExpanded, onToggleExpand,
  selectionMode = false, isSelected = false, onSelect,
}: {
  flight: any; cheapest: number; isExpanded: boolean; onToggleExpand: () => void;
  selectionMode?: boolean; isSelected?: boolean; onSelect?: () => void;
}) => {
  const cardNavigate = useNavigate();
  const [cardSearchParams] = useSearchParams();
  const searchedCabin = cardSearchParams.get("cabin") || cardSearchParams.get("class") || "";
  const logo = getAirlineLogo(flight.airlineCode);
  const departTime = formatTime(flight.departureTime);
  const arriveTime = formatTime(flight.arrivalTime);
  const departDateStr = formatShortDate(flight.departureTime);
  const arriveDateStr = formatShortDate(flight.arrivalTime);
  const fromCode = flight.origin || "";
  const toCode = flight.destination || "";
  const flightNo = flight.flightNumber || "";
  // Always use the REAL cabin class/class seats from API fare details first
  const cabin = flight.cabinClass || "";
  const bookingClass = getDisplayBookingClass(flight);
  const availableSeats = getDisplayAvailableSeats(flight);
  const duration = flight.duration || "";
  const stops = flight.stops ?? 0;
  const grossPrice = flight.price ?? 0;
  const taxes = flight.taxes ?? 0;
  // CRITICAL: baseFare from API may be in foreign currency (e.g. USD from Sabre).
  // Always derive baseFare in BDT as (price - taxes) to ensure the breakdown sums correctly.
  const baseFare = Math.max(0, Math.round(grossPrice - taxes));
  // Calculate payable price (with discount and AIT VAT applied)
  const DISCOUNT_PCT = flight.fareRules?.discount ?? 6.30;
  const AIT_VAT_PCT = flight.fareRules?.aitVat ?? 0.3;
  const discount = Math.round(baseFare * DISCOUNT_PCT / 100);
  const aitVat = Math.round(baseFare * AIT_VAT_PCT / 100);
  const price = baseFare - discount + taxes + aitVat;
  const refundable = flight.refundable ?? false;
  const fareType = flight.fareType || (refundable ? "Refundable" : "Non-Refundable");
  const nextDay = isNextDay(flight.departureTime, flight.arrivalTime);
  const legs = flight.legs || [];
  const stopCodes = flight.stopCodes || [];
  const aircraft = flight.aircraft || legs[0]?.aircraft || "";
  const source = flight.source || "db";
  const baggage = flight.baggage || null;
  const handBaggage = flight.handBaggage || "7KG";
  const cancellationPolicy = flight.cancellationPolicy || null;
  const dateChangePolicy = flight.dateChangePolicy || null;
  const [activeDetailTab, setActiveDetailTab] = useState("itinerary");
  const [showFareOptions, setShowFareOptions] = useState(false);

  const stopsLabel = stops === 0 ? "Non-Stop" : `${stops} Stop${stops > 1 ? "s" : ""}`;
  const cabinDisplay = cabin && bookingClass ? `${cabin} - ${bookingClass}` : cabin || bookingClass || "";
  const fareDetailsCount = Array.isArray(flight.fareDetails) ? flight.fareDetails.length : 0;
  const distanceKm = calcRouteDistance(flight);
  const [showPriceBreakdown, setShowPriceBreakdown] = useState(false);

  return (
    <Card className={`overflow-hidden transition-all border ${isSelected ? "border-accent ring-2 ring-accent/20 shadow-lg" : isExpanded ? "border-accent/30 shadow-md" : "border-border hover:shadow-md"}`}>
      <CardContent className="p-0">
        {/* ── Main card row ── */}
        <div className="flex flex-col sm:flex-row min-w-0">
          {/* Airline section */}
          <div className="flex items-center gap-2.5 p-3 sm:p-4 sm:w-36 lg:w-40 shrink-0 border-b sm:border-b-0 sm:border-r border-border/50">
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              {logo ? (
                <img src={logo} alt={flight.airline} className="w-8 h-8 sm:w-9 sm:h-9 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = `<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-muted flex items-center justify-center"><span class="text-[10px] font-bold text-muted-foreground">${(flight.airlineCode || "").toUpperCase()}</span></div>`; }} />
              ) : (
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-[10px] font-bold text-muted-foreground">{(flight.airlineCode || "").toUpperCase()}</span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-[13px] font-bold leading-tight truncate">{flight.airline}</p>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">{flightNo}</p>
            </div>
          </div>

          {/* Flight times */}
          <div className="flex-1 p-3 sm:p-4 min-w-0">
            {/* Route label header */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md mb-3 text-[11px] font-bold bg-accent/10 dark:bg-accent/20 text-accent">
              <Plane className="w-3.5 h-3.5" />
              <span>DEPARTURE</span>
              <span className="text-accent/40 font-normal">|</span>
              <span>{fromCode} → {toCode}</span>
              <span className="text-accent/40 font-normal">|</span>
              <span className="flight-date">{departDateStr}</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Departure */}
              <div className="text-center shrink-0">
                <p className="text-sm font-bold text-foreground">{fromCode}</p>
                <p className="text-base sm:text-lg font-black tracking-tight flight-time leading-tight">{departTime}</p>
                {(() => { const g = formatGMT(flight.departureTime); return g ? <p className="text-[10px] text-muted-foreground leading-tight">{g}</p> : null; })()}
              </div>

              {/* Duration arc */}
              <div className="flex-1 flex flex-col items-center gap-0.5 min-w-[60px] sm:min-w-[80px]">
                {stops > 0 && legs.length > 1 ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="w-full cursor-pointer">
                          <AnimatedFlightArc compact direction="departure" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs p-3 space-y-2">
                        <p className="font-semibold text-xs mb-1.5">Layover Details</p>
                        {legs.map((leg: any, li: number) => {
                          if (li === 0) return null;
                          const prevLeg = legs[li - 1];
                          const prevArr = prevLeg?.arrivalTime ? new Date(prevLeg.arrivalTime).getTime() : 0;
                          const curDep = leg?.departureTime ? new Date(leg.departureTime).getTime() : 0;
                          const layoverMins = prevArr && curDep ? Math.round((curDep - prevArr) / 60000) : 0;
                          const layoverStr = layoverMins > 0 ? fmtDurationMins(layoverMins) : "";
                          const stopCity = prevLeg?.destination || stopCodes[li - 1] || "";
                          const stopName = stopCity ? getAirportCity(stopCity) : "";
                          return (
                            <div key={li} className="flex items-center gap-2 text-xs">
                              <div className="w-2 h-2 rounded-full bg-warning shrink-0" />
                              <span className="font-medium">{stopCity}{stopName && stopName !== stopCity ? ` (${stopName})` : ""}</span>
                              {layoverStr && <span className="text-muted-foreground">— {layoverStr} layover</span>}
                            </div>
                          );
                        })}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <AnimatedFlightArc compact direction="departure" />
                )}
                <p className="text-[10px] text-muted-foreground font-medium">{duration}</p>
                <div className="flex items-center gap-1.5">
                  <p className={`text-[10px] font-semibold ${stops === 0 ? "text-foreground" : "text-warning"}`}>{stopsLabel}</p>
                  {distanceKm && (
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <MapPin className="w-2.5 h-2.5" /> {distanceKm.toLocaleString()} Km
                    </span>
                  )}
                </div>
              </div>

              {/* Arrival */}
              <div className="text-center shrink-0">
                <p className="text-sm font-bold text-foreground">{toCode}</p>
                <p className="text-base sm:text-lg font-black tracking-tight flight-time leading-tight">
                  {arriveTime}
                  {nextDay && <sup className="text-[8px] text-destructive font-bold ml-0.5">+1</sup>}
                </p>
                {(() => { const g = formatGMT(flight.arrivalTime); return g ? <p className="text-[10px] text-muted-foreground leading-tight">{g}</p> : null; })()}
              </div>
            </div>
          </div>

          {/* Price section */}
          <div className="flex flex-col items-end justify-center gap-1 p-3 sm:p-4 sm:w-44 lg:w-52 shrink-0 border-t sm:border-t-0 sm:border-l border-border/50 bg-muted/20">
            <div className="flex items-center gap-1.5">
              {grossPrice === cheapest && price > 0 && (
                <Badge className="bg-accent/10 text-accent border-0 text-[8px] font-bold px-1.5 py-0">Cheapest</Badge>
              )}
              {price > 0 && (
                <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300/50 dark:border-amber-700/50 text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full">
                  <span className="text-[11px]">🪙</span> +{calcRewardPoints(price).toLocaleString()} Points
                </Badge>
              )}
            </div>
            <p className="text-lg sm:text-xl lg:text-2xl font-black leading-none whitespace-nowrap">BDT {price.toLocaleString()}</p>
            {discount > 0 && (
              <p className="text-[11px] font-bold text-amber-500 line-through">BDT {grossPrice.toLocaleString()}</p>
            )}
            <p className="text-[10px] text-muted-foreground">Price for {parseInt(new URLSearchParams(window.location.search).get("adults") || "1")} traveller{parseInt(new URLSearchParams(window.location.search).get("adults") || "1") > 1 ? "s" : ""}</p>
            <Popover open={showPriceBreakdown} onOpenChange={setShowPriceBreakdown}>
              <PopoverTrigger asChild>
                <button className="text-[11px] sm:text-xs text-accent font-semibold flex items-center gap-1 hover:underline">
                  Price Breakdown <ChevronRight className="w-3 h-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="left" className="w-72 p-3">
                <p className="text-xs font-bold mb-2">Fare Breakdown</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Base Fare</span><span className="font-medium">BDT {baseFare.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Taxes & Fees</span><span className="font-medium">BDT {taxes.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount ({DISCOUNT_PCT}%)</span><span className="font-medium text-accent">- BDT {discount.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">AIT VAT ({AIT_VAT_PCT}%)</span><span className="font-medium">BDT {aitVat.toLocaleString()}</span></div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-bold"><span>Total Payable</span><span>BDT {price.toLocaleString()}</span></div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Baggage + Seats + Class info row */}
        <div className="flex items-center flex-wrap gap-1.5 px-3 sm:px-4 py-2 border-t border-border/30">
          {handBaggage && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              <Briefcase className="w-3 h-3" /> {handBaggage}
            </span>
          )}
          {baggage && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[10px] sm:text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              <Luggage className="w-3 h-3" /> {baggage}
            </span>
          )}
          {availableSeats !== null && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-bold ${
              availableSeats <= 4
                ? "bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40 text-destructive"
                : availableSeats <= 9
                  ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200/60 dark:border-orange-800/40 text-orange-600 dark:text-orange-400"
                  : "bg-accent/5 border-accent/20 text-accent"
            }`}>
              <Armchair className="w-3 h-3" /> {availableSeats} Seats Left
            </span>
          )}
          {cabinDisplay && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted/60 border border-border/60 text-[10px] sm:text-[11px] font-semibold text-muted-foreground">
              <Plane className="w-3 h-3" /> {cabinDisplay}
            </span>
          )}
          {(() => {
            const best = getBestFareDetail(flight);
            const isRefundable = best?.refundable ?? flight.refundable ?? false;
            return (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] sm:text-[11px] font-bold ${
                isRefundable
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40 text-destructive"
              }`}>
                {isRefundable ? "Refundable" : "Non-Refundable"}
              </span>
            );
          })()}
          {stops === 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
              Direct
            </span>
          )}
          {(() => {
            const isSabre = String(source).toLowerCase().includes('sabre') || !!flight._sabreSource || !!flight._sabreSeqNumber;
            if (!isSabre) return null;
            return (
              <>
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
                  💺 Seat Map
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-accent/5 border border-accent/20 text-[10px] sm:text-[11px] font-bold text-accent">
                  🍽 Meals
                </span>
              </>
            );
          })()}
        </div>

        {/* ── Info bar ── */}
        <div className="flex items-center px-3 sm:px-4 py-2.5 bg-muted/30 border-t border-border/50">
          <button className="flex items-center gap-1 text-accent font-bold text-xs hover:underline shrink-0" onClick={onToggleExpand}>
            Flight Details {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <div className="flex-1 flex items-center justify-center gap-3 sm:gap-5">
            {flight.airlineCode?.toUpperCase() !== "BG" && (
              <span className="text-emerald-800 dark:text-emerald-300 font-bold text-xs hidden sm:inline">Book &amp; Hold</span>
            )}
          </div>
          <div className="shrink-0">
            {selectionMode ? (
              <Button size="sm" className="font-bold h-8 sm:h-9 px-4 sm:px-5 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground text-xs" onClick={onSelect}>
                {isSelected ? <><Check className="w-3 h-3 mr-1" /> Selected</> : "Select"}
              </Button>
            ) : (
              <Button size="sm" className="font-bold h-8 sm:h-9 px-4 sm:px-5 rounded-full bg-accent hover:bg-accent/90 text-accent-foreground text-xs"
                onClick={() => setShowFareOptions(!showFareOptions)}>
                View Prices {fareDetailsCount > 1 && <Badge className="ml-1 bg-accent-foreground/20 text-accent-foreground border-0 text-[9px] px-1 py-0">{fareDetailsCount}</Badge>} {showFareOptions ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
              </Button>
            )}
          </div>
        </div>

        {/* Fare Options Panel */}
        <AnimatePresence>
          {showFareOptions && (
            <FareOptionsPanel
              flights={[flight]}
              searchedCabin={searchedCabin}
              onBook={(selectedFlight) => cardNavigate(
                `/flights/book?adults=${cardSearchParams.get("adults") || "1"}&children=${cardSearchParams.get("children") || "0"}&infants=${cardSearchParams.get("infants") || "0"}&cabin=${cardSearchParams.get("cabin") || "economy"}`,
                { state: { outboundFlight: selectedFlight || flight } },
              )}
            />
          )}
        </AnimatePresence>

        {/* ── Expanded detail panel ── */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
              <div className="border-t border-border">
                {/* Tab headers + Fare terms & policy link */}
                <div className="flex items-center border-b border-border bg-muted/20">
                  <div className="flex overflow-x-auto scrollbar-none">
                    {[
                      { key: "itinerary", label: "Flight Details" },
                      { key: "fare", label: "Fare Summary" },
                      { key: "baggage", label: "Baggage" },
                      { key: "cancellation", label: "Cancellation" },
                      { key: "datechange", label: "Date Change" },
                    ].map(tab => (
                      <button key={tab.key} onClick={() => setActiveDetailTab(tab.key)}
                        className={`px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
                          activeDetailTab === tab.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto px-3">
                    <button className="flex items-center gap-1 text-accent text-xs font-semibold hover:underline">
                      <Info className="w-3 h-3" /> Fare terms &amp; policy
                    </button>
                  </div>
                </div>

                <div className="p-4 sm:p-5">
                  {/* ── Flight Details Tab — exact reference design ── */}
                  {activeDetailTab === "itinerary" && (
                    <div className="space-y-6">
                      {(legs.length > 0 ? legs : [{ origin: fromCode, destination: toCode, departureTime: flight.departureTime, arrivalTime: flight.arrivalTime, duration, durationMinutes: flight.durationMinutes, flightNumber: flightNo, airlineCode: flight.airlineCode, aircraft, originTerminal: "", destinationTerminal: "" }]).map((leg: any, i: number) => {
                        const legLogo = getAirlineLogo(leg.airlineCode || flight.airlineCode);
                        const legDepartDate = formatDate(leg.departureTime);
                        const legStopsLabel = stops === 0 ? "Non-Stop" : `${stops} Stop${stops > 1 ? "s" : ""}`;
                        const legOrigin = leg.origin || fromCode;
                        const legDest = leg.destination || toCode;

                        return (
                          <div key={i} className="space-y-4">
                            {/* Route header — button-style card */}
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold shadow-sm bg-accent/15 text-accent border border-accent/30">
                              <Plane className="w-4 h-4" />
                              <span className="font-bold">{legOrigin} → {legDest}</span>
                              <span className="flight-date text-sm ml-1">· {legDepartDate}</span>
                              <span className="opacity-70">· {legStopsLabel}</span>
                            </div>

                            {/* Airline detail line: logo | AirAstra | 2A 445 | AT7 | Economy - S | 5 Seats Left */}
                            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                              {legLogo && <img src={legLogo} alt="" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                              <span className="text-sm font-semibold">{flight.airline}</span>
                              <span className="text-sm text-muted-foreground">{leg.flightNumber || flightNo}</span>
                              <span className="text-muted-foreground text-sm">|</span>
                              {(leg.aircraft || aircraft) && (
                                <>
                                  <span className="text-sm text-muted-foreground">{leg.aircraft || aircraft}</span>
                                  <span className="text-muted-foreground text-sm">|</span>
                                </>
                              )}
                              <span className="text-sm font-medium">{cabinDisplay}</span>
                              {availableSeats !== null && availableSeats <= 9 && (
                                <span className="text-sm text-orange-500 font-bold">{availableSeats} Seat{availableSeats !== 1 ? "s" : ""} Left</span>
                              )}
                            </div>

                            {/* Timeline arc visual — matching reference exactly */}
                            <div className="flex items-start justify-between pt-3 pb-2">
                              {/* Departure info */}
                              <div className="text-left shrink-0 max-w-[38%]">
                                <p className="text-xl sm:text-2xl font-black flight-time">{formatTime(leg.departureTime)}</p>
                                <p className="text-xs flight-date mt-0.5">{legDepartDate}</p>
                                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                                  {leg.originTerminal ? `Terminal: ${leg.originTerminal}, ` : ""}{getAirportName(legOrigin)} ({legOrigin})
                                </p>
                              </div>

                              {/* Arc */}
                              <div className="flex-1 flex flex-col items-center justify-center pt-1 px-3 sm:px-8">
                                <AnimatedFlightArc compact direction="departure" />
                                <p className="text-xs text-muted-foreground font-medium -mt-1">{leg.duration || duration}</p>
                              </div>

                              {/* Arrival info */}
                              <div className="text-right shrink-0 max-w-[38%]">
                                <p className="text-xl sm:text-2xl font-black flight-time">{formatTime(leg.arrivalTime)}</p>
                                <p className="text-xs flight-date mt-0.5">{formatDate(leg.arrivalTime)}</p>
                                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                                  {leg.destinationTerminal ? `Terminal: ${leg.destinationTerminal}, ` : ""}{getAirportName(legDest)} ({legDest})
                                </p>
                              </div>
                            </div>

                            {/* Transit between legs — BDFare style: "Change of planes Xh Ym Layover in City" */}
                            {i < (legs.length > 0 ? legs.length : 1) - 1 && legs.length > 1 && (
                              <div className="flex items-center gap-2 py-3 px-4 my-2">
                                <div className="flex-1 h-px bg-warning/30" />
                                <div className="flex items-center gap-2 text-xs bg-warning/10 px-4 py-2 rounded-full border border-warning/20">
                                  <span className="text-destructive font-semibold">Change of planes</span>
                                  {(() => {
                                    const transitCode = leg.destination || stopCodes[i] || "";
                                    const transitCity = transitCode ? getAirportCity(transitCode) : "";
                                    let layoverStr = "";
                                    if (legs[i + 1]?.departureTime && leg.arrivalTime) {
                                      const layoverMin = Math.round((new Date(legs[i + 1].departureTime).getTime() - new Date(leg.arrivalTime).getTime()) / 60000);
                                      const h = Math.floor(layoverMin / 60);
                                      const m = layoverMin % 60;
                                      layoverStr = `${h > 0 ? `${h}h ` : ""}${m > 0 ? `${m}m` : ""}`;
                                    }
                                    return (
                                      <span className="text-foreground font-medium">
                                        {layoverStr && <>{layoverStr} </>}Layover{transitCity ? ` in ${transitCity}` : ""}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="flex-1 h-px bg-warning/30" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Fare Summary Tab — real API data, table layout matching reference */}
                  {activeDetailTab === "fare" && (() => {
                    const paxAdults = parseInt(cardSearchParams.get("adults") || "1");
                    const paxChildren = parseInt(cardSearchParams.get("children") || "0");
                    const paxInfants = parseInt(cardSearchParams.get("infants") || "0");
                    // Discount and AIT VAT percentages from server-side per-airline fare rules
                    const DISCOUNT_PCT = flight.fareRules?.discount ?? 6.30;
                    const AIT_VAT_PCT = flight.fareRules?.aitVat ?? 0.3;

                    const fareRows = buildFareRows(
                      flight.paxPricing, baseFare, taxes,
                      paxAdults, paxChildren, paxInfants,
                      DISCOUNT_PCT, AIT_VAT_PCT
                    );
                    const totalPayable = fareRows.reduce((s, r) => s + r.amount, 0);

                    return (
                      <div className="space-y-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                            <thead>
                              <tr className="bg-muted/50">
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Type</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Base Fare</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Tax</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Other</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Discount</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">AIT VAT</th>
                                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-xs">Pax Count</th>
                                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-xs">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fareRows.map((row, i) => (
                                <tr key={i} className="border-t border-border/50">
                                  <td className="px-3 py-2.5 font-medium">{row.paxType}</td>
                                  <td className="px-3 py-2.5">{row.baseFare.toLocaleString()}</td>
                                  <td className="px-3 py-2.5">{row.tax.toLocaleString()}</td>
                                  <td className="px-3 py-2.5">{row.other}</td>
                                  <td className="px-3 py-2.5">{row.discount}</td>
                                  <td className="px-3 py-2.5">{row.aitVat}</td>
                                  <td className="px-3 py-2.5">{row.count}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold">BDT {row.amount.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex justify-end items-center gap-6 pt-1">
                          <span className="font-bold text-sm">Total Payable</span>
                          <span className="font-black text-base">BDT {totalPayable.toLocaleString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground"><Info className="w-3 h-3 inline mr-1" />{refundable ? "This fare is refundable. Cancellation charges may apply." : "This fare is non-refundable. Change and cancellation fees apply as per airline policy."}</p>
                      </div>
                    );
                  })()}

                  {/* Baggage Tab — real API data, table layout */}
                  {activeDetailTab === "baggage" && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Sector</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Checkin</th>
                            <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Cabin</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-border/50">
                            <td className="px-4 py-3 font-semibold text-base flex items-center gap-2">{fromCode} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {toCode}</td>
                            <td className="px-4 py-3 text-muted-foreground">{baggage ? `ADT : ${baggage}` : "Not provided"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{handBaggage ? `ADT : ${handBaggage}` : "ADT : 7KG"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Cancellation Tab — sector-based layout from API */}
                  {activeDetailTab === "cancellation" && (
                    <div className="space-y-4">
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                          {fromCode} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {toCode}
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border">
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border/50">
                              <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {cancellationPolicy?.beforeDeparture != null
                                  ? `Cancellation allowed with fees + BDT ${Number(cancellationPolicy.beforeDeparture).toLocaleString()}`
                                  : refundable ? "Cancellation allowed with fees" : "Non-refundable"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
                        <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Purchased baggage and seat selections are non-refundable.
                      </div>
                    </div>
                  )}

                  {/* Date Change Tab — sector-based layout from API */}
                  {activeDetailTab === "datechange" && (
                    <div className="space-y-4">
                      <div className="border border-border rounded-lg overflow-hidden">
                        <div className="bg-muted/50 px-4 py-3 flex items-center gap-2 text-base font-semibold">
                          {fromCode} <Plane className="w-3.5 h-3.5 text-muted-foreground" /> {toCode}
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border">
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Timeframe<br/><span className="font-normal text-xs text-muted-foreground">(From Scheduled flight departure)</span></th>
                              <th className="text-left px-4 py-2.5 font-semibold text-foreground">Airline Fee + Service Fee + Fare difference<br/><span className="font-normal text-xs text-muted-foreground">(Per passenger)</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-border/50">
                              <td className="px-4 py-3 text-muted-foreground">Any Time</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {dateChangePolicy?.changeAllowed === false
                                  ? "Date change not permitted"
                                  : dateChangePolicy?.changeFee != null
                                    ? `Date change allowed with fees + BDT ${Number(dateChangePolicy.changeFee).toLocaleString()}`
                                    : "Date change allowed with fees"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-muted-foreground">
                        <span className="font-bold text-foreground">*Important:</span> The airline fee is indicative. We do not guarantee the accuracy of this information. All fees mentioned are per passenger. Date change charges are applicable only on selecting the same airline on a new date. The difference in fares between the old and the new booking will also be payable by the user.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};

/* ─── Sort tabs ─── */
const SORT_OPTIONS = [
  { value: "best", label: "Best", icon: Zap },
  { value: "cheapest", label: "Cheapest", icon: TrendingUp },
  { value: "earliest", label: "Earliest", icon: Clock },
  { value: "fastest", label: "Fastest", icon: Timer },
];

function sortFlights(flights: any[], sortBy: string) {
  const sorted = [...flights];
  const payableCache = new Map<any, number>();
  const getPayable = (f: any) => {
    if (!payableCache.has(f)) payableCache.set(f, flightPayable(f));
    return payableCache.get(f)!;
  };
  const getDur = (f: any) => getFlightDurationMinutes(f);
  const getStops = (f: any) => Number(f?.stops) || 0;
  const getDepartureTs = (f: any) => (f?.departureTime ? new Date(f.departureTime).getTime() : Number.MAX_SAFE_INTEGER);
  const getStableId = (f: any) => String(f?.id ?? "");
  const stableOrder = (a: any, b: any) => {
    const departureDiff = getDepartureTs(a) - getDepartureTs(b);
    if (departureDiff !== 0) return departureDiff;
    return getStableId(a).localeCompare(getStableId(b));
  };

  switch (sortBy) {
    case "cheapest":
      return sorted.sort((a, b) => {
        const payableDiff = getPayable(a) - getPayable(b);
        if (payableDiff !== 0) return payableDiff;

        const durationDiff = getDur(a) - getDur(b);
        if (durationDiff !== 0) return durationDiff;

        const stopDiff = getStops(a) - getStops(b);
        if (stopDiff !== 0) return stopDiff;

        return stableOrder(a, b);
      });

    case "earliest":
    case "departure":
      return sorted.sort((a, b) => stableOrder(a, b));

    case "fastest":
      return sorted.sort((a, b) => {
        const dA = getDur(a) || Number.MAX_SAFE_INTEGER;
        const dB = getDur(b) || Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;

        const stopDiff = getStops(a) - getStops(b);
        if (stopDiff !== 0) return stopDiff;

        const departureDiff = stableOrder(a, b);
        if (departureDiff !== 0) return departureDiff;

        return getPayable(a) - getPayable(b);
      });

    case "best":
    default: {
      // Best = normalized weighted balance: 40% price, 45% duration, 15% stops
      const prices = sorted.map((f) => getPayable(f));
      const durations = sorted.map((f) => getDur(f)).filter((d) => d > 0);
      const minP = prices.length > 0 ? Math.min(...prices) : 0;
      const maxP = prices.length > 0 ? Math.max(...prices) : 1;
      const minD = durations.length > 0 ? Math.min(...durations) : 0;
      const maxD = durations.length > 0 ? Math.max(...durations) : 1;
      const priceSpread = maxP - minP || 1;
      const durSpread = maxD - minD || 1;

      return sorted.sort((a, b) => {
        const pA = getPayable(a);
        const pB = getPayable(b);
        const dA = getDur(a) || maxD;
        const dB = getDur(b) || maxD;
        const scoreA = ((pA - minP) / priceSpread) * 0.4 + ((dA - minD) / durSpread) * 0.45 + getStops(a) * 0.15;
        const scoreB = ((pB - minP) / priceSpread) * 0.4 + ((dB - minD) / durSpread) * 0.45 + getStops(b) * 0.15;
        if (scoreA !== scoreB) return scoreA - scoreB;

        const durationDiff = dA - dB;
        if (durationDiff !== 0) return durationDiff;

        const payableDiff = pA - pB;
        if (payableDiff !== 0) return payableDiff;

        const stopDiff = getStops(a) - getStops(b);
        if (stopDiff !== 0) return stopDiff;

        return stableOrder(a, b);
      });
    }
  }
}

/* ─── Similar Flights Grouping — group by airline+stops, expandable ─── */
function groupSimilarFlights(flights: any[]): { primary: any; similar: any[]; totalOptions: number }[] {
  const groups: Record<string, any[]> = {};
  for (const f of flights) {
    const key = `${f.airlineCode || ''}_${f.stops ?? 0}_${f.origin || ''}_${f.destination || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  return Object.values(groups).map(g => {
    const sorted = g.sort((a, b) => flightPayable(a) - flightPayable(b));
    return { primary: sorted[0], similar: sorted.slice(1), totalOptions: sorted.length };
  });
}

/* ─── Main page ─── */
const FlightResults = () => {
  const { data: page } = useCmsPageContent("/flights");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState("best");

  // Fetch admin markup settings for fare calculation
  const [markupSettings, setMarkupSettings] = useState<{ discount: number; aitVat: number; airlineMarkups?: Record<string, any> }>({ discount: 6.30, aitVat: 0.3 });
  useEffect(() => {
    api.get<any>("/admin/settings").then(res => {
      const settings = res?.settings || res?.data || res || {};
      let markupConfig: any = {};
      let airlineMarkupConfig: any = {};
      for (const s of (Array.isArray(settings) ? settings : [])) {
        if (s.setting_key === 'markup_config') try { markupConfig = JSON.parse(s.setting_value); } catch {}
        if (s.setting_key === 'airline_markup_config') try { airlineMarkupConfig = JSON.parse(s.setting_value); } catch {}
      }
      // If settings is object with keys
      if (settings.markup_config) try { markupConfig = typeof settings.markup_config === 'string' ? JSON.parse(settings.markup_config) : settings.markup_config; } catch {}
      if (settings.airline_markup_config) try { airlineMarkupConfig = typeof settings.airline_markup_config === 'string' ? JSON.parse(settings.airline_markup_config) : settings.airline_markup_config; } catch {}
      const flightConfig = markupConfig?.flight || markupConfig || {};
      setMarkupSettings({
        discount: flightConfig.fareSummaryDiscount ?? 6.30,
        aitVat: flightConfig.fareSummaryAitVat ?? 0.3,
        airlineMarkups: airlineMarkupConfig || {},
      });
    }).catch(() => {});
  }, []);
  const [airlineFilter, setAirlineFilter] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState([0, 200000]);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [stopsFilter, setStopsFilter] = useState("all");
  const [departTimeRange, setDepartTimeRange] = useState([0, 24]);
  const [arrivalTimeRange, setArrivalTimeRange] = useState([0, 24]);
  const [durationRange, setDurationRange] = useState([0, 5000]);
  const [selectedAlliances, setSelectedAlliances] = useState<string[]>([]);
  const [refundableOnly, setRefundableOnly] = useState(false);
  const [selectedLayoverAirports, setSelectedLayoverAirports] = useState<string[]>([]);
  const [layoverDurationRange, setLayoverDurationRange] = useState([0, 5000]);
  const [selectedBaggage, setSelectedBaggage] = useState<string[]>([]);
  const airlineBarRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedFlight, setExpandedFlight] = useState<string | null>(null);
  const [selectedOutbound, setSelectedOutbound] = useState<any>(null);
  const [selectedReturn, setSelectedReturn] = useState<any>(null);
  const [searchStartTime] = useState(Date.now());
  const [resultsExpired, setResultsExpired] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(20);
  const LOAD_MORE_COUNT = 20;

  // Inline editing state
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [editDepart, setEditDepart] = useState<Date | undefined>();
  const [editReturn, setEditReturn] = useState<Date | undefined>();
  const [editAdults, setEditAdults] = useState(1);
  const [editChildren, setEditChildren] = useState(0);
  const [editInfants, setEditInfants] = useState(0);
  const [editCabin, setEditCabin] = useState("");
  const [editScope, setEditScope] = useState<"domestic" | "international">("international");
  const [editFareType, setEditFareType] = useState("regular");
  const [editPreferredCarrier, setEditPreferredCarrier] = useState("any");
  const [showModifyPanel, setShowModifyPanel] = useState(false);
  const [showRouteEdit, setShowRouteEdit] = useState(false);
  const [showDateEdit, setShowDateEdit] = useState(false);
  const [showPaxEdit, setShowPaxEdit] = useState(false);
  const [airportSearch, setAirportSearch] = useState("");
  const [editingField, setEditingField] = useState<"from" | "to" | null>(null);
  const [showMultiCityEdit, setShowMultiCityEdit] = useState(false);
  const [mcEditSearch, setMcEditSearch] = useState("");

  // Multi-city state
  const tripType = searchParams.get("tripType") || "";
  const isMultiCity = tripType === "multicity";
  const segmentsParam = searchParams.get("segments") || "";
  const multiCitySegments: { from: string; to: string; date: string }[] = useMemo(() => {
    if (!isMultiCity || !segmentsParam) return [];
    try { return JSON.parse(segmentsParam); } catch { return []; }
  }, [isMultiCity, segmentsParam]);

  // Editable multi-city segments for inline editing
  const [editMcSegments, setEditMcSegments] = useState<{ from: string; to: string; date: string }[]>([]);
  useEffect(() => {
    if (multiCitySegments.length > 0) setEditMcSegments(JSON.parse(JSON.stringify(multiCitySegments)));
  }, [multiCitySegments]);

  const updateMcSegment = (idx: number, field: "from" | "to" | "date", value: string) => {
    setEditMcSegments(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Auto-chain: when setting "to" on segment i, set "from" on segment i+1
      if (field === "to" && idx < next.length - 1) {
        next[idx + 1] = { ...next[idx + 1], from: value };
      }
      return next;
    });
  };
  const addMcSegment = () => {
    if (editMcSegments.length >= 5) return;
    const lastTo = editMcSegments[editMcSegments.length - 1]?.to || "";
    setEditMcSegments(prev => [...prev, { from: lastTo, to: "", date: "" }]);
  };
  const removeMcSegment = (idx: number) => {
    if (editMcSegments.length <= 2) return;
    setEditMcSegments(prev => prev.filter((_, i) => i !== idx));
  };
  const applyMcSearch = () => {
    const valid = editMcSegments.filter(s => s.from && s.to && s.date);
    if (valid.length < 2) return;
    const p = new URLSearchParams({
      tripType: "multicity",
      adults: String(editAdults), children: String(editChildren > 0 ? editChildren : 0), infants: String(editInfants > 0 ? editInfants : 0),
      cabin: editCabin || cabinClass || "economy",
      segments: JSON.stringify(valid),
    });
    navigate(`/flights?${p.toString()}`);
    setShowMultiCityEdit(false);
  };

  const [multiCityResults, setMultiCityResults] = useState<Record<number, any[]>>({});

  const [multiCityLoading, setMultiCityLoading] = useState(false);
  const [multiCityError, setMultiCityError] = useState<string | null>(null);
  const [selectedMultiCityFlights, setSelectedMultiCityFlights] = useState<Record<number, any>>({});

  const fromCode = searchParams.get("from") || "";
  const toCode = searchParams.get("to") || "";
  const departDate = searchParams.get("depart") || "";
  const returnDate = searchParams.get("return") || "";
  const adults = searchParams.get("adults") || "1";
  const children = searchParams.get("children") || "0";
  const infants = searchParams.get("infants") || "0";
  const cabinClass = searchParams.get("cabin") || searchParams.get("class") || "";
  const totalPax = parseInt(adults) + parseInt(children) + parseInt(infants);
  const hasRequiredParams = isMultiCity ? multiCitySegments.length >= 2 : (!!fromCode && !!toCode && !!departDate);
  const isRoundTrip = !!returnDate && !isMultiCity;

  // Sync edit state from URL
  useEffect(() => {
    setEditFrom(fromCode); setEditTo(toCode);
    setEditDepart(departDate ? new Date(departDate) : undefined);
    setEditReturn(returnDate ? new Date(returnDate) : undefined);
    setEditAdults(parseInt(adults)); setEditChildren(parseInt(children)); setEditInfants(parseInt(infants));
    setEditCabin(cabinClass);
    const fromAp = AIRPORTS.find(a => a.code === fromCode);
    const toAp = AIRPORTS.find(a => a.code === toCode);
    setEditScope(fromAp?.country === "BD" && toAp?.country === "BD" ? "domestic" : "international");
  }, [fromCode, toCode, departDate, returnDate, adults, children, infants, cabinClass]);

  const applySearchEdit = useCallback(() => {
    // Validate scope — same rules as homepage SearchWidget
    const fromAp = AIRPORTS.find(a => a.code === editFrom);
    const toAp = AIRPORTS.find(a => a.code === editTo);
    if (editFrom === editTo) return;
    if (editScope === "domestic" && (fromAp?.country !== "BD" || toAp?.country !== "BD")) return;
    if (editScope === "international" && fromAp?.country === "BD" && toAp?.country === "BD") return;

    const p = new URLSearchParams();
    if (editFrom) p.set("from", editFrom);
    if (editTo) p.set("to", editTo);
    if (editDepart) p.set("depart", format(editDepart, "yyyy-MM-dd"));
    if (editReturn) p.set("return", format(editReturn, "yyyy-MM-dd"));
    p.set("adults", String(editAdults));
    if (editChildren > 0) p.set("children", String(editChildren));
    if (editInfants > 0) p.set("infants", String(editInfants));
    if (editCabin) p.set("cabin", editCabin);
    if (editPreferredCarrier && editPreferredCarrier !== "any") p.set("carrier", editPreferredCarrier);
    if (isMultiCity) p.set("tripType", "multicity");
    navigate(`/flights?${p.toString()}`);
    setShowRouteEdit(false); setShowDateEdit(false); setShowPaxEdit(false); setShowModifyPanel(false);
  }, [editFrom, editTo, editDepart, editReturn, editAdults, editChildren, editInfants, editCabin, editPreferredCarrier, isMultiCity, editScope, navigate]);

  const shiftDate = useCallback((days: number) => {
    const p = new URLSearchParams(searchParams.toString());
    if (departDate) {
      const d = new Date(departDate);
      d.setDate(d.getDate() + days);
      if (d >= new Date(new Date().toDateString())) p.set("depart", format(d, "yyyy-MM-dd"));
    }
    if (returnDate && days > 0) {
      const r = new Date(returnDate);
      r.setDate(r.getDate() + days);
      p.set("return", format(r, "yyyy-MM-dd"));
    }
    navigate(`/flights?${p.toString()}`);
  }, [departDate, returnDate, searchParams, navigate]);

  // Scope-aware airport filtering — same logic as homepage SearchWidget
  const domesticAirports = useMemo(() => AIRPORTS.filter(a => a.country === "BD"), []);
  const filteredAirports = useMemo(() => {
    // Apply scope filter: domestic = BD only; international: for "from" show all, for "to" show non-BD if from is BD
    let pool = AIRPORTS;
    if (editScope === "domestic") {
      pool = domesticAirports;
    } else if (editingField === "to") {
      // International: if from is BD, only show non-BD destinations
      const fromAp = AIRPORTS.find(a => a.code === editFrom);
      if (fromAp?.country === "BD") {
        pool = AIRPORTS.filter(a => a.country !== "BD");
      }
    }
    if (!airportSearch) return pool.slice(0, 10);
    const q = airportSearch.toLowerCase();
    return pool.filter(a => a.code.toLowerCase().includes(q) || a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [airportSearch, editScope, editingField, editFrom, domesticAirports]);


  const carrierCode = searchParams.get("carrier") || "";
  // Search params — works for all modes: one-way, round-trip, AND multi-city
  const params = hasRequiredParams ? (() => {
    const p: Record<string, string | undefined> = {
      adults,
      children: children !== "0" ? children : undefined,
      infants: infants !== "0" ? infants : undefined,
      cabinClass: cabinClass || undefined,
      carrier: carrierCode || undefined,
    };
    if (isMultiCity) {
      // Send segments as JSON to backend — single Sabre BFM request
      p.segments = JSON.stringify(multiCitySegments);
    } else {
      p.from = fromCode;
      p.to = toCode;
      p.date = departDate;
      if (returnDate) p.return = returnDate;
    }
    return p;
  })() : undefined;

  const { data: rawData, isLoading: standardLoading, error, refetch } = useFlightSearch(params);
  const apiData = (rawData as any) || {};
  // For multi-city: combined itineraries come back with isMultiCity=true flag
  const flights = apiData.data || apiData.flights || [];
  const multiCityFlights = useMemo(() => isMultiCity ? flights.filter((f: any) => f.isMultiCity || f.direction === 'multicity') : [], [isMultiCity, flights]);
  const hasDirections = flights.some((f: any) => f.direction === "return");
  const isLoading = standardLoading;

  const outboundFlights = useMemo(() => flights.filter((f: any) => f.direction !== "return"), [flights]);
  const returnFlights = useMemo(() => flights.filter((f: any) => f.direction === "return"), [flights]);

  // Round-trip pairing: N×N cross-product by airline (matching BDFare behavior).
  // Every unique outbound schedule × every unique return schedule for the same airline = all valid combos.
  const roundTripPairs = useMemo(() => {
    if (!isRoundTrip || !hasDirections) return [];

    const pairs: { outbound: any; returnFlight: any; totalPrice: number }[] = [];
    const seen = new Set<string>();

    const addPair = (ob: any, rf: any) => {
      const key = `${ob.id}__${rf.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const obFare = getApiFareTotals(ob);
      const rfFare = getApiFareTotals(rf);
      pairs.push({ outbound: ob, returnFlight: rf, totalPrice: obFare.grossPrice + rfFare.grossPrice });
    };

    // 1) Exact itinerary linking from backend (Sabre BFM grouped itineraries)
    const itineraryMap: Record<string, { outbound?: any; returnFlight?: any }> = {};
    for (const f of outboundFlights) {
      if (!f._itineraryId) continue;
      if (!itineraryMap[f._itineraryId]) itineraryMap[f._itineraryId] = {};
      itineraryMap[f._itineraryId].outbound = f;
    }
    for (const f of returnFlights) {
      if (!f._itineraryId) continue;
      if (!itineraryMap[f._itineraryId]) itineraryMap[f._itineraryId] = {};
      itineraryMap[f._itineraryId].returnFlight = f;
    }
    const itineraryPaired = new Set<string>();
    for (const entry of Object.values(itineraryMap)) {
      if (entry.outbound && entry.returnFlight) {
        addPair(entry.outbound, entry.returnFlight);
        itineraryPaired.add(entry.outbound.id);
        itineraryPaired.add(entry.returnFlight.id);
      }
    }

    // 2) N×N cross-product by airline — keep all API options (do not collapse schedules)
    const obByAirline: Record<string, any[]> = {};
    const rtByAirline: Record<string, any[]> = {};

    const sortedOutbound = [...outboundFlights].sort((a, b) => flightPayable(a) - flightPayable(b));
    const sortedReturn = [...returnFlights].sort((a, b) => flightPayable(a) - flightPayable(b));

    for (const f of sortedOutbound) {
      const airline = f.airlineCode || 'unknown';
      if (!obByAirline[airline]) obByAirline[airline] = [];
      obByAirline[airline].push(f);
    }
    for (const f of sortedReturn) {
      const airline = f.airlineCode || 'unknown';
      if (!rtByAirline[airline]) rtByAirline[airline] = [];
      rtByAirline[airline].push(f);
    }

    // Cross-product per airline — 2-pass approach to guarantee ALL airlines appear
    // Pass 1: Give every airline a guaranteed minimum (top 5×5 = 25 pairs each)
    // Pass 2: Fill remaining budget with extra combinations from each airline
    const GUARANTEED_PER_AIRLINE = 5;
    const EXTRA_PER_AIRLINE = 15;
    const MAX_TOTAL_PAIRS = 800;
    const allAirlines = Object.keys(obByAirline).filter(a => (rtByAirline[a] || []).length > 0);

    // Pass 1: guaranteed minimum pairs for every airline
    for (const airline of allAirlines) {
      const obs = (obByAirline[airline] || []).slice(0, GUARANTEED_PER_AIRLINE);
      const rts = (rtByAirline[airline] || []).slice(0, GUARANTEED_PER_AIRLINE);
      for (const ob of obs) {
        for (const rf of rts) {
          addPair(ob, rf);
        }
      }
    }

    // Pass 2: fill up to budget with extra combinations (already sorted by price)
    for (const airline of allAirlines) {
      if (pairs.length >= MAX_TOTAL_PAIRS) break;
      const obs = (obByAirline[airline] || []).slice(0, EXTRA_PER_AIRLINE);
      const rts = (rtByAirline[airline] || []).slice(0, EXTRA_PER_AIRLINE);
      for (const ob of obs) {
        if (pairs.length >= MAX_TOTAL_PAIRS) break;
        for (const rf of rts) {
          if (pairs.length >= MAX_TOTAL_PAIRS) break;
          addPair(ob, rf); // dedup set prevents duplicates from pass 1
        }
      }
    }

    return pairs.sort((a, b) => pairPayable(a) - pairPayable(b));
  }, [isRoundTrip, hasDirections, outboundFlights, returnFlights]);

  // Combine all multi-city flights for filter computation
  const allMultiCityFlights = multiCityFlights;

  const allFlightsForFilters = isMultiCity ? allMultiCityFlights : flights;

  const airlines = useMemo(() => apiData.airlines || [...new Set(allFlightsForFilters.map((f: any) => f.airline).filter(Boolean))], [apiData.airlines, allFlightsForFilters]);
  const cheapest = useMemo(() => allFlightsForFilters.length > 0 ? Math.min(...allFlightsForFilters.map((f: any) => flightPayable(f))) : 0, [allFlightsForFilters]);

  // For round-trip mode, compute price bounds from pair totalPrices; for one-way from individual prices
  const maxPrice = useMemo(() => {
    if (isRoundTrip && hasDirections && roundTripPairs.length > 0) {
      return Math.max(...roundTripPairs.map(p => pairPayable(p)));
    }
    return allFlightsForFilters.length > 0 ? Math.max(...allFlightsForFilters.map((f: any) => flightPayable(f))) : 200000;
  }, [allFlightsForFilters, isRoundTrip, hasDirections, roundTripPairs]);
  const minPrice = useMemo(() => {
    if (isRoundTrip && hasDirections && roundTripPairs.length > 0) {
      return Math.min(...roundTripPairs.map(p => pairPayable(p)));
    }
    return allFlightsForFilters.length > 0 ? Math.min(...allFlightsForFilters.map((f: any) => flightPayable(f))) : 0;
  }, [allFlightsForFilters, isRoundTrip, hasDirections, roundTripPairs]);

  // Duration bounds for slider init
  const maxDuration = useMemo(() => {
    const ds = allFlightsForFilters.map((f: any) => getFlightDurationMinutes(f)).filter((d: number) => d > 0);
    return ds.length > 0 ? Math.max(...ds) : 1440;
  }, [allFlightsForFilters]);
  const minDuration = useMemo(() => {
    const ds = allFlightsForFilters.map((f: any) => getFlightDurationMinutes(f)).filter((d: number) => d > 0);
    return ds.length > 0 ? Math.min(...ds) : 0;
  }, [allFlightsForFilters]);

  // Layover duration bounds
  const maxLayoverDuration = useMemo(() => {
    const ds: number[] = [];
    for (const f of allFlightsForFilters) {
      const legs = f.legs || [];
      for (let i = 0; i < legs.length - 1; i++) {
        if (legs[i].arrivalTime && legs[i + 1].departureTime) {
          const m = Math.round((new Date(legs[i + 1].departureTime).getTime() - new Date(legs[i].arrivalTime).getTime()) / 60000);
          if (m > 0) ds.push(m);
        }
      }
    }
    return ds.length > 0 ? Math.max(...ds) : 0;
  }, [allFlightsForFilters]);

  useEffect(() => {
    if (allFlightsForFilters.length > 0 || (isRoundTrip && roundTripPairs.length > 0)) {
      setPriceRange([Math.max(0, minPrice - 100), maxPrice]);
      setDurationRange([minDuration, maxDuration]);
      if (maxLayoverDuration > 0) setLayoverDurationRange([0, maxLayoverDuration]);
    }
  }, [minPrice, maxPrice, allFlightsForFilters.length, minDuration, maxDuration, maxLayoverDuration, isRoundTrip, roundTripPairs.length]);

  const toggleAirline = useCallback((a: string) => setSelectedAirlines(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]), []);
  const toggleAlliance = useCallback((a: string) => setSelectedAlliances(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]), []);
  const toggleLayoverAirport = useCallback((a: string) => setSelectedLayoverAirports(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]), []);
  const toggleBaggage = useCallback((b: string) => setSelectedBaggage(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]), []);

  // Airline stats for the top bar — count from round-trip pairs for correct display
  const airlineStats = useMemo(() => {
    if (isRoundTrip && hasDirections) {
      const map: Record<string, { code: string; name: string; cheapest: number; count: number }> = {};
      for (const p of roundTripPairs) {
        const code = p.outbound.airlineCode || '';
        const name = p.outbound.airline || code;
        if (!code) continue;
        const payable = pairPayable(p);
        if (!map[code]) map[code] = { code, name, cheapest: payable, count: 0 };
        map[code].count++;
        if (payable < map[code].cheapest) map[code].cheapest = payable;
      }
      return Object.values(map).sort((a, b) => a.cheapest - b.cheapest);
    }
    const relevantFlights = isMultiCity ? allMultiCityFlights : flights;
    const map: Record<string, { code: string; name: string; cheapest: number; count: number }> = {};
    for (const f of relevantFlights) {
      const code = f.airlineCode || '';
      const name = f.airline || code;
      if (!code) continue;
      const payable = flightPayable(f);
      if (!map[code]) map[code] = { code, name, cheapest: payable, count: 0 };
      map[code].count++;
      if (payable < map[code].cheapest) map[code].cheapest = payable;
    }
    return Object.values(map).sort((a, b) => a.cheapest - b.cheapest);
  }, [flights, roundTripPairs, isRoundTrip, hasDirections, isMultiCity, allMultiCityFlights]);


  const applyFilters = useCallback((list: any[]) => {
    return list.filter((f: any) => {
      if (airlineFilter && f.airlineCode !== airlineFilter) return false;
      if (selectedAirlines.length > 0 && !selectedAirlines.includes(f.airline)) return false;
      const payable = flightPayable(f);
      if (payable < priceRange[0] || payable > priceRange[1]) return false;
      if (stopsFilter !== "all") {
        const stops = f.stops ?? 0;
        if (stopsFilter === "0" && stops !== 0) return false;
        if (stopsFilter === "1" && stops !== 1) return false;
        if (stopsFilter === "2+" && stops < 2) return false;
      }
      // Departure time — use getApiLocalHour for airport-local consistency
      if (departTimeRange[0] !== 0 || departTimeRange[1] !== 24) {
        const hour = getApiLocalHour(f.departureTime);
        if (hour !== null && (hour < departTimeRange[0] || hour >= departTimeRange[1])) return false;
      }
      // Arrival time — use getApiLocalHour for airport-local consistency
      if (arrivalTimeRange[0] !== 0 || arrivalTimeRange[1] !== 24) {
        const hour = getApiLocalHour(f.arrivalTime);
        if (hour !== null && (hour < arrivalTimeRange[0] || hour >= arrivalTimeRange[1])) return false;
      }
      // Refundable only
      if (refundableOnly && !f.refundable) return false;
      // Alliance filter
      if (selectedAlliances.length > 0) {
        const alliance = AIRLINE_ALLIANCES[f.airlineCode || ''];
        if (!alliance || !selectedAlliances.includes(alliance)) return false;
      }
      // Duration filter
      if (durationRange[0] > 0 || durationRange[1] < 5000) {
        const dur = getFlightDurationMinutes(f);
        if (dur > 0 && (dur < durationRange[0] || dur > durationRange[1])) return false;
      }
      // Layover airports
      if (selectedLayoverAirports.length > 0) {
        const codes = (f.stopCodes || []).length > 0 ? f.stopCodes : (f.legs || []).slice(0, -1).map((l: any) => l.destination).filter(Boolean);
        if (!codes.some((c: string) => selectedLayoverAirports.includes(c))) return false;
      }
      // Layover duration
      if (layoverDurationRange[0] > 0 || layoverDurationRange[1] < 5000) {
        const legs = f.legs || [];
        if (legs.length > 1) {
          let valid = false;
          for (let i = 0; i < legs.length - 1; i++) {
            if (legs[i].arrivalTime && legs[i + 1].departureTime) {
              const m = Math.round((new Date(legs[i + 1].departureTime).getTime() - new Date(legs[i].arrivalTime).getTime()) / 60000);
              if (m >= layoverDurationRange[0] && m <= layoverDurationRange[1]) { valid = true; break; }
            }
          }
          if (!valid) return false;
        }
      }
      // Baggage filter
      if (selectedBaggage.length > 0) {
        const bag = String(f.baggage || '').trim();
        if (!bag || !selectedBaggage.includes(bag)) return false;
      }
      return true;
    });
  }, [airlineFilter, selectedAirlines, priceRange, stopsFilter, departTimeRange, arrivalTimeRange, refundableOnly, selectedAlliances, durationRange, selectedLayoverAirports, layoverDurationRange, selectedBaggage]);

  const filteredOutbound = useMemo(() => sortFlights(applyFilters(outboundFlights), sortBy), [outboundFlights, sortBy, applyFilters]);
  const filteredReturn = useMemo(() => sortFlights(applyFilters(returnFlights), sortBy), [returnFlights, sortBy, applyFilters]);
  const filteredAll = useMemo(() => sortFlights(applyFilters(flights), sortBy), [flights, sortBy, applyFilters]);

  // Filtered + sorted round-trip pairs
  const filteredPairs = useMemo(() => {
    if (!isRoundTrip || !hasDirections) return [];
    const filtered = roundTripPairs.filter(p => {
      if (airlineFilter && p.outbound.airlineCode !== airlineFilter) return false;
      if (selectedAirlines.length > 0 && !selectedAirlines.includes(p.outbound.airline)) return false;
      const payable = pairPayable(p);
      if (payable < priceRange[0] || payable > priceRange[1]) return false;
      if (stopsFilter !== "all") {
        const stops = p.outbound.stops ?? 0;
        if (stopsFilter === "0" && stops !== 0) return false;
        if (stopsFilter === "1" && stops !== 1) return false;
        if (stopsFilter === "2+" && stops < 2) return false;
      }
      if (departTimeRange[0] !== 0 || departTimeRange[1] !== 24) {
        const hour = getApiLocalHour(p.outbound.departureTime);
        if (hour !== null && (hour < departTimeRange[0] || hour >= departTimeRange[1])) return false;
      }
      if (arrivalTimeRange[0] !== 0 || arrivalTimeRange[1] !== 24) {
        const h = getApiLocalHour(p.outbound.arrivalTime);
        if (h !== null && (h < arrivalTimeRange[0] || h >= arrivalTimeRange[1])) return false;
      }
      if (refundableOnly && !p.outbound.refundable) return false;
      if (selectedAlliances.length > 0) {
        const alliance = AIRLINE_ALLIANCES[p.outbound.airlineCode || ''];
        if (!alliance || !selectedAlliances.includes(alliance)) return false;
      }
      if (durationRange[0] > 0 || durationRange[1] < 5000) {
        const dur = getFlightDurationMinutes(p.outbound);
        if (dur > 0 && (dur < durationRange[0] || dur > durationRange[1])) return false;
      }
      // Layover airports filter
      if (selectedLayoverAirports.length > 0) {
        const obCodes = (p.outbound.stopCodes || []).length > 0 ? p.outbound.stopCodes : (p.outbound.legs || []).slice(0, -1).map((l: any) => l.destination).filter(Boolean);
        const retCodes = (p.returnFlight.stopCodes || []).length > 0 ? p.returnFlight.stopCodes : (p.returnFlight.legs || []).slice(0, -1).map((l: any) => l.destination).filter(Boolean);
        const allCodes = [...obCodes, ...retCodes];
        if (!allCodes.some((c: string) => selectedLayoverAirports.includes(c))) return false;
      }
      // Layover duration filter
      if (layoverDurationRange[0] > 0 || layoverDurationRange[1] < 5000) {
        let valid = false;
        for (const flight of [p.outbound, p.returnFlight]) {
          const legs = flight.legs || [];
          for (let i = 0; i < legs.length - 1; i++) {
            if (legs[i].arrivalTime && legs[i + 1].departureTime) {
              const m = Math.round((new Date(legs[i + 1].departureTime).getTime() - new Date(legs[i].arrivalTime).getTime()) / 60000);
              if (m >= layoverDurationRange[0] && m <= layoverDurationRange[1]) { valid = true; break; }
            }
          }
          if (valid) break;
        }
        // Only filter if there are layovers
        const hasLayovers = (p.outbound.stops || 0) > 0 || (p.returnFlight.stops || 0) > 0;
        if (hasLayovers && !valid) return false;
      }
      // Baggage filter
      if (selectedBaggage.length > 0) {
        const bag = String(p.outbound.baggage || '').trim();
        if (!bag || !selectedBaggage.includes(bag)) return false;
      }
      return true;
    });
    return sortRoundTripPairs(filtered, sortBy);
  }, [roundTripPairs, isRoundTrip, hasDirections, airlineFilter, selectedAirlines, priceRange, stopsFilter, departTimeRange, arrivalTimeRange, refundableOnly, selectedAlliances, durationRange, sortBy, selectedLayoverAirports, layoverDurationRange, selectedBaggage]);

  // Quick sort summaries — always from current filtered pool (matches visible result set)
  const quickSortSummary = useMemo(() => {
    if (isRoundTrip && hasDirections) {
      const pool = filteredPairs;
      if (pool.length === 0) return { cheapest: null, fastest: null, best: null };

      const withMetrics = pool.map((p) => ({
        ...p,
        payableTotal: pairPayable(p),
        durationMins: getPairDurationMinutes(p),
        totalStops: (Number(p.outbound?.stops) || 0) + (Number(p.returnFlight?.stops) || 0),
      }));

      const cheapestPair = [...withMetrics].sort((a, b) => a.payableTotal - b.payableTotal)[0];
      const fastestPair = [...withMetrics].sort((a, b) => (a.durationMins || Number.MAX_SAFE_INTEGER) - (b.durationMins || Number.MAX_SAFE_INTEGER))[0];

      const payables = withMetrics.map((p) => p.payableTotal);
      const durations = withMetrics.map((p) => p.durationMins).filter((d) => d > 0);
      const minP = Math.min(...payables);
      const maxP = Math.max(...payables);
      const minD = durations.length > 0 ? Math.min(...durations) : 0;
      const maxD = durations.length > 0 ? Math.max(...durations) : 1;
      const priceSpread = maxP - minP || 1;
      const durSpread = maxD - minD || 1;

      const bestPair = [...withMetrics].sort((a, b) => {
        const durA = a.durationMins || maxD;
        const durB = b.durationMins || maxD;
        const scoreA = ((a.payableTotal - minP) / priceSpread) * 0.4 + ((durA - minD) / durSpread) * 0.45 + a.totalStops * 0.15;
        const scoreB = ((b.payableTotal - minP) / priceSpread) * 0.4 + ((durB - minD) / durSpread) * 0.45 + b.totalStops * 0.15;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return (a.outbound?.departureTime ? new Date(a.outbound.departureTime).getTime() : Number.MAX_SAFE_INTEGER)
          - (b.outbound?.departureTime ? new Date(b.outbound.departureTime).getTime() : Number.MAX_SAFE_INTEGER);
      })[0];

      return {
        cheapest: cheapestPair ? { price: cheapestPair.payableTotal, duration: cheapestPair.durationMins > 0 ? fmtDurationMins(cheapestPair.durationMins) : (cheapestPair.outbound?.duration || "") } : null,
        fastest: fastestPair ? { price: fastestPair.payableTotal, duration: fastestPair.durationMins > 0 ? fmtDurationMins(fastestPair.durationMins) : (fastestPair.outbound?.duration || "") } : null,
        best: bestPair ? { price: bestPair.payableTotal, duration: bestPair.durationMins > 0 ? fmtDurationMins(bestPair.durationMins) : (bestPair.outbound?.duration || "") } : null,
      };
    }

    const pool = isMultiCity ? sortFlights(applyFilters(allMultiCityFlights), sortBy) : filteredAll;
    if (pool.length === 0) return { cheapest: null, fastest: null, best: null };

    const withMetrics = pool.map((f: any) => ({ ...f, payable: flightPayable(f), durationMins: getFlightDurationMinutes(f), stops: Number(f?.stops) || 0 }));
    const cheapestFlight = [...withMetrics].sort((a, b) => a.payable - b.payable)[0];
    const fastestFlight = [...withMetrics].sort((a, b) => (a.durationMins || Number.MAX_SAFE_INTEGER) - (b.durationMins || Number.MAX_SAFE_INTEGER))[0];

    const payables = withMetrics.map((f) => f.payable);
    const durations = withMetrics.map((f) => f.durationMins).filter((d) => d > 0);
    const minP = Math.min(...payables);
    const maxP = Math.max(...payables);
    const minD = durations.length > 0 ? Math.min(...durations) : 0;
    const maxD = durations.length > 0 ? Math.max(...durations) : 1;
    const priceSpread = maxP - minP || 1;
    const durSpread = maxD - minD || 1;

    const bestFlight = [...withMetrics].sort((a, b) => {
      const durA = a.durationMins || maxD;
      const durB = b.durationMins || maxD;
      const scoreA = ((a.payable - minP) / priceSpread) * 0.4 + ((durA - minD) / durSpread) * 0.45 + a.stops * 0.15;
      const scoreB = ((b.payable - minP) / priceSpread) * 0.4 + ((durB - minD) / durSpread) * 0.45 + b.stops * 0.15;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return (a.departureTime ? new Date(a.departureTime).getTime() : Number.MAX_SAFE_INTEGER)
        - (b.departureTime ? new Date(b.departureTime).getTime() : Number.MAX_SAFE_INTEGER);
    })[0];

    return {
      cheapest: cheapestFlight ? { price: cheapestFlight.payable, duration: cheapestFlight.durationMins > 0 ? fmtDurationMins(cheapestFlight.durationMins) : (cheapestFlight.duration || "") } : null,
      fastest: fastestFlight ? { price: fastestFlight.payable, duration: fastestFlight.durationMins > 0 ? fmtDurationMins(fastestFlight.durationMins) : (fastestFlight.duration || "") } : null,
      best: bestFlight ? { price: bestFlight.payable, duration: bestFlight.durationMins > 0 ? fmtDurationMins(bestFlight.durationMins) : (bestFlight.duration || "") } : null,
    };
  }, [isRoundTrip, hasDirections, filteredPairs, isMultiCity, filteredAll, allMultiCityFlights, applyFilters, sortBy]);

  // Cabin class mismatch detection — searched for Business/First but API returned only Economy
  const searchedCabinNorm = (cabinClass || "").toLowerCase();
  const hasCabinMismatch = useMemo(() => {
    if (!searchedCabinNorm || searchedCabinNorm === "economy") return false;
    const relevantFlights = isMultiCity ? allMultiCityFlights : flights;
    if (relevantFlights.length === 0) return false;
    // Check if ANY result matches the searched cabin
    const searchedLabel = searchedCabinNorm.charAt(0).toUpperCase() + searchedCabinNorm.slice(1);
    return !relevantFlights.some((f: any) => (f.cabinClass || "").toLowerCase() === searchedCabinNorm || (f.cabinClass || "") === searchedLabel);
  }, [searchedCabinNorm, flights, allMultiCityFlights, isMultiCity]);

  const resetFilters = useCallback(() => {
    setSelectedAirlines([]); setPriceRange([0, maxPrice]); setStopsFilter("all");
    setDepartTimeRange([0, 24]); setArrivalTimeRange([0, 24]); setDurationRange([minDuration, maxDuration]);
    setSelectedAlliances([]); setRefundableOnly(false); setSelectedLayoverAirports([]);
    setLayoverDurationRange([0, maxLayoverDuration || 5000]); setAirlineFilter(null);
    setSelectedBaggage([]); setVisibleCount(20);
  }, [maxPrice, minDuration, maxDuration, maxLayoverDuration]);

  const sources = apiData.sources || {};

  const handleBookRoundTrip = () => {
    if (!selectedOutbound || !selectedReturn) return;
    navigate(`/flights/book?roundTrip=true&adults=${adults}&children=${children}&infants=${infants}&cabin=${cabinClass || "economy"}`, { state: { outboundFlight: selectedOutbound, returnFlight: selectedReturn } });
  };

  const roundTripTotal = (selectedOutbound?.price || 0) + (selectedReturn?.price || 0);

  // Multi-city booking handler
  const handleBookMultiCity = () => {
    const selectedFlights = Object.values(selectedMultiCityFlights);
    if (selectedFlights.length !== multiCitySegments.length) return;
    // Pass first segment as outbound, rest via state
    navigate(`/flights/book?adults=${adults}&children=${children}&infants=${infants}&cabin=${cabinClass || "economy"}`, {
      state: { outboundFlight: selectedFlights[0], multiCityFlights: selectedFlights },
    });
  };

  const multiCityTotal = useMemo(() => {
    return Object.values(selectedMultiCityFlights).reduce((sum, f) => sum + (f?.price || 0), 0);
  }, [selectedMultiCityFlights]);

  const totalMultiCityFlights = useMemo(() => {
    return Object.values(multiCityResults).reduce((sum, arr) => sum + arr.length, 0);
  }, [multiCityResults]);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* ─── Compact Pill Modification Bar with Full Features ─── */}
      <div className="bg-card border-b border-border pt-16 sm:pt-24 lg:pt-32 pb-0">
        <div className="container mx-auto px-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 py-2 sm:py-2.5">
            {/* Trip Type pill — clickable to switch */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="bg-muted border border-border hover:border-primary/50 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 shrink-0 transition-colors">
                  <Plane className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs sm:text-sm font-semibold text-foreground">
                    {isMultiCity ? "Multi-City" : isRoundTrip ? "Round Trip" : "One Way"}
                  </span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2 z-[60]" align="start">
                <div className="space-y-1">
                  {[
                    { label: "One Way", key: "oneway" },
                    { label: "Round Trip", key: "roundtrip" },
                    { label: "Multi-City", key: "multicity" },
                  ].map(t => {
                    const isActive =
                      (t.key === "oneway" && !isRoundTrip && !isMultiCity) ||
                      (t.key === "roundtrip" && isRoundTrip) ||
                      (t.key === "multicity" && isMultiCity);
                    return (
                      <button key={t.key} onClick={() => {
                        if (t.key === "multicity") {
                          // Navigate to flights page with multi-city mode pre-selected via URL params
                          const p = new URLSearchParams();
                          p.set("tripType", "multicity");
                          // Seed first segment from current route
                          if (fromCode && toCode && departDate) {
                            const segments = [
                              { from: fromCode, to: toCode, date: departDate },
                              { from: toCode, to: "", date: "" },
                            ];
                            p.set("segments", JSON.stringify(segments));
                          }
                          p.set("adults", adults);
                          if (parseInt(children) > 0) p.set("children", children);
                          if (parseInt(infants) > 0) p.set("infants", infants);
                          if (cabinClass) p.set("cabin", cabinClass);
                          navigate(`/flights?${p.toString()}`);
                          return;
                        }
                        const p = new URLSearchParams(searchParams);
                        if (t.key === "oneway") {
                          p.delete("return");
                          p.delete("tripType");
                        } else if (t.key === "roundtrip") {
                          if (!returnDate) {
                            const dep = new Date(departDate || Date.now());
                            dep.setDate(dep.getDate() + 7);
                            p.set("return", format(dep, "yyyy-MM-dd"));
                          }
                          p.delete("tripType");
                        }
                        navigate(`/flights?${p.toString()}`);
                      }}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"}`}>
                        {isActive && <Check className="w-3.5 h-3.5" />}
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {/* Route pill */}
            {!isMultiCity && (
              <Popover open={showRouteEdit} onOpenChange={setShowRouteEdit}>
                <PopoverTrigger asChild>
                  <button className="bg-muted border border-border hover:border-primary/50 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 shrink-0 transition-colors">
                    <span className="text-xs sm:text-sm font-bold text-foreground">{fromCode || "—"}</span>
                    <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs sm:text-sm font-bold text-foreground">{toCode || "—"}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3 z-[60]" align="start">
                  <p className="text-xs font-bold text-muted-foreground mb-2">Edit Route</p>
                  {/* Scope toggle */}
                   <div className="flex gap-1.5 mb-3">
                    {(["domestic", "international"] as const).map(s => (
                      <button key={s} onClick={() => {
                        setEditScope(s);
                        // Auto-reset airports that violate the new scope — same as homepage
                        if (s === "domestic") {
                          const fromAp = AIRPORTS.find(a => a.code === editFrom);
                          const toAp = AIRPORTS.find(a => a.code === editTo);
                          if (fromAp?.country !== "BD") setEditFrom(domesticAirports[0]?.code || "DAC");
                          if (toAp?.country !== "BD") setEditTo(domesticAirports[1]?.code || "CXB");
                        } else {
                          // International: if both are BD, reset destination
                          const fromAp = AIRPORTS.find(a => a.code === editFrom);
                          const toAp = AIRPORTS.find(a => a.code === editTo);
                          if (fromAp?.country === "BD" && toAp?.country === "BD") setEditTo("");
                        }
                      }}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${editScope === s ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border hover:border-primary/40"}`}>
                        {s === "domestic" ? "Domestic" : "International"}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">From</label>
                      <input className="w-full h-9 px-3 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                        value={editingField === "from" ? airportSearch : editFrom}
                        onFocus={() => { setEditingField("from"); setAirportSearch(editFrom); }}
                        onChange={(e) => setAirportSearch(e.target.value)} placeholder="Airport code or city" />
                      {editingField === "from" && (
                        <div className="max-h-32 overflow-y-auto border border-border rounded-md mt-1">
                          {filteredAirports.map(a => (
                            <button key={a.code} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex justify-between"
                              onClick={() => { setEditFrom(a.code); setEditingField(null); setAirportSearch(""); }}>
                              <span className="font-bold">{a.code}</span>
                              <span className="text-muted-foreground truncate ml-2">{a.city}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">To</label>
                      <input className="w-full h-9 px-3 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                        value={editingField === "to" ? airportSearch : editTo}
                        onFocus={() => { setEditingField("to"); setAirportSearch(editTo); }}
                        onChange={(e) => setAirportSearch(e.target.value)} placeholder="Airport code or city" />
                      {editingField === "to" && (
                        <div className="max-h-32 overflow-y-auto border border-border rounded-md mt-1">
                          {filteredAirports.map(a => (
                            <button key={a.code} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex justify-between"
                              onClick={() => { setEditTo(a.code); setEditingField(null); setAirportSearch(""); }}>
                              <span className="font-bold">{a.code}</span>
                              <span className="text-muted-foreground truncate ml-2">{a.city}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button size="sm" className="w-full bg-accent text-accent-foreground" onClick={applySearchEdit}>
                      <Search className="w-3.5 h-3.5 mr-1.5" /> Search
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {isMultiCity && (
              <Popover open={showMultiCityEdit} onOpenChange={(open) => {
                setShowMultiCityEdit(open);
                if (open && editMcSegments.length === 0 && multiCitySegments.length > 0) {
                  setEditMcSegments(JSON.parse(JSON.stringify(multiCitySegments)));
                }
              }}>
                <PopoverTrigger asChild>
                  <button className="bg-muted border border-border hover:border-primary/50 rounded-lg px-4 py-2 flex items-center gap-2 shrink-0 transition-colors">
                    <span className="text-sm font-bold text-foreground">
                      {multiCitySegments.map(s => s.from).join(" → ")} → {multiCitySegments[multiCitySegments.length - 1]?.to || "—"}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-4 z-[60]" align="start">
                  <p className="text-xs font-bold text-muted-foreground mb-3">Multi-City Segments</p>
                  <div className="space-y-2.5">
                    {editMcSegments.map((seg, i) => {
                      const fromAp = AIRPORTS.find(a => a.code === seg.from);
                      const toAp = AIRPORTS.find(a => a.code === seg.to);
                      return (
                        <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border border-border/50">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase shrink-0 w-10">Trip {i + 1}</span>
                          {/* From */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="flex-1 min-w-0 text-left bg-card border border-border rounded-md px-2 py-1.5 text-xs font-bold hover:border-primary/50 transition-colors truncate">
                                {fromAp ? `${fromAp.city} - ${seg.from}` : seg.from || "From"}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2 z-[70]" align="start">
                              <input className="w-full border border-border rounded px-2 py-1.5 text-xs mb-2 bg-background" placeholder="Search airport..." value={mcEditSearch} onChange={e => setMcEditSearch(e.target.value)} autoFocus />
                              <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {AIRPORTS.filter(a => !mcEditSearch || a.code.toLowerCase().includes(mcEditSearch.toLowerCase()) || a.city.toLowerCase().includes(mcEditSearch.toLowerCase()) || a.name.toLowerCase().includes(mcEditSearch.toLowerCase())).slice(0, 30).map(a => (
                                  <button key={a.code} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2" onClick={() => { updateMcSegment(i, "from", a.code); setMcEditSearch(""); }}>
                                    <span className="font-bold">{a.code}</span> <span className="text-muted-foreground truncate">{a.city}</span>
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {/* To */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="flex-1 min-w-0 text-left bg-card border border-border rounded-md px-2 py-1.5 text-xs font-bold hover:border-primary/50 transition-colors truncate">
                                {toAp ? `${toAp.city} - ${seg.to}` : seg.to || "To"}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2 z-[70]" align="start">
                              <input className="w-full border border-border rounded px-2 py-1.5 text-xs mb-2 bg-background" placeholder="Search airport..." value={mcEditSearch} onChange={e => setMcEditSearch(e.target.value)} autoFocus />
                              <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {AIRPORTS.filter(a => a.code !== seg.from && (!mcEditSearch || a.code.toLowerCase().includes(mcEditSearch.toLowerCase()) || a.city.toLowerCase().includes(mcEditSearch.toLowerCase()) || a.name.toLowerCase().includes(mcEditSearch.toLowerCase()))).slice(0, 30).map(a => (
                                  <button key={a.code} className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted flex items-center gap-2" onClick={() => { updateMcSegment(i, "to", a.code); setMcEditSearch(""); }}>
                                    <span className="font-bold">{a.code}</span> <span className="text-muted-foreground truncate">{a.city}</span>
                                  </button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                          {/* Date */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="shrink-0 bg-card border border-border rounded-md px-2 py-1.5 text-xs font-bold hover:border-primary/50 transition-colors whitespace-nowrap flight-date">
                                {seg.date ? (() => { try { return format(new Date(seg.date), "dd MMM, EEE"); } catch { return seg.date; } })() : "Date"}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2 z-[70]" align="end">
                              <Calendar mode="single" selected={seg.date ? new Date(seg.date) : undefined} onSelect={(d) => {
                                if (d) updateMcSegment(i, "date", format(d, "yyyy-MM-dd"));
                              }} disabled={(date) => {
                                if (date < new Date(new Date().toDateString())) return true;
                                if (i > 0 && editMcSegments[i - 1]?.date) {
                                  return date < new Date(editMcSegments[i - 1].date);
                                }
                                return false;
                              }} />
                            </PopoverContent>
                          </Popover>
                          {/* Remove */}
                          {editMcSegments.length > 2 && (
                            <button onClick={() => removeMcSegment(i)} className="text-destructive hover:text-destructive/80 shrink-0">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {editMcSegments.length < 5 && (
                    <button onClick={addMcSegment} className="flex items-center gap-1.5 text-accent font-bold text-xs mt-2 hover:underline">
                      <span className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm">+</span>
                      Add city
                    </button>
                  )}
                  <Button size="sm" className="w-full mt-3 bg-accent text-accent-foreground font-bold"
                    disabled={editMcSegments.filter(s => s.from && s.to && s.date).length < 2}
                    onClick={applyMcSearch}>
                    <Search className="w-3.5 h-3.5 mr-1.5" /> New Multi-City Search
                  </Button>
                </PopoverContent>
              </Popover>
            )}

            {/* Prev Day */}
            {!isMultiCity && (
              <button onClick={() => shiftDate(-1)} className="bg-muted border border-border hover:border-primary/50 rounded-lg p-1.5 sm:p-2 text-muted-foreground hover:text-primary transition-colors shrink-0" title="Previous Day">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Date pill */}
            <Popover open={showDateEdit} onOpenChange={setShowDateEdit}>
              <PopoverTrigger asChild>
                <button className="bg-muted border border-border hover:border-primary/50 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 shrink-0 transition-colors">
                  <CalendarDays className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs sm:text-sm font-medium text-foreground">
                    {isMultiCity
                      ? multiCitySegments.map(s => s.date).filter(Boolean).join(", ")
                      : departDate ? (() => { try { return format(new Date(departDate), "dd MMM, EEE"); } catch { return departDate; } })() : "—"}
                    {isRoundTrip && returnDate && (() => { try { return ` — ${format(new Date(returnDate), "dd MMM, EEE")}`; } catch { return ""; } })()}
                  </span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3 z-[60]" align="start">
                <p className="text-xs font-bold text-muted-foreground mb-2">{isRoundTrip ? "Departure Date" : "Select Date"}</p>
                <Calendar mode="single" selected={editDepart} onSelect={(d) => {
                  setEditDepart(d || undefined);
                  if (!isRoundTrip && d) {
                    setShowDateEdit(false);
                    setTimeout(() => {
                      const p = new URLSearchParams(searchParams);
                      p.set("depart", format(d, "yyyy-MM-dd"));
                      navigate(`/flights?${p.toString()}`);
                    }, 100);
                  }
                }} disabled={(date) => date < new Date(new Date().toDateString())} />
                {isRoundTrip && (
                  <>
                    <p className="text-xs font-bold text-muted-foreground mb-2 mt-3">Return Date</p>
                    <Calendar mode="single" selected={editReturn} onSelect={(d) => {
                      setEditReturn(d || undefined);
                      if (d && editDepart) {
                        setShowDateEdit(false);
                        setTimeout(() => {
                          const p = new URLSearchParams(searchParams);
                          p.set("depart", format(editDepart, "yyyy-MM-dd"));
                          p.set("return", format(d, "yyyy-MM-dd"));
                          navigate(`/flights?${p.toString()}`);
                        }, 100);
                      }
                    }} disabled={(date) => date < (editDepart || new Date())} />
                  </>
                )}
              </PopoverContent>
            </Popover>

            {/* Next Day */}
            {!isMultiCity && (
              <button onClick={() => shiftDate(1)} className="bg-muted border border-border hover:border-primary/50 rounded-lg p-1.5 sm:p-2 text-muted-foreground hover:text-primary transition-colors shrink-0" title="Next Day">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Pax & Cabin pill */}
            <Popover open={showPaxEdit} onOpenChange={setShowPaxEdit}>
              <PopoverTrigger asChild>
                <button className="bg-muted border border-border hover:border-primary/50 rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 shrink-0 transition-colors">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs sm:text-sm font-medium text-foreground">
                    {totalPax} Pax{cabinClass ? `, ${cabinClass.charAt(0).toUpperCase() + cabinClass.slice(1)}` : ""}
                  </span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 z-[60]" align="start">
                <p className="text-xs font-bold text-muted-foreground mb-3">Passengers, Cabin & Preferences</p>
                <div className="space-y-3">
                  {[
                    { label: "Adults (12+)", value: editAdults, set: setEditAdults, min: 1, max: 9 },
                    { label: "Children (2-11)", value: editChildren, set: setEditChildren, min: 0, max: 6 },
                    { label: "Infants (0-2)", value: editInfants, set: setEditInfants, min: 0, max: editAdults },
                  ].map(p => (
                    <div key={p.label} className="flex items-center justify-between">
                      <span className="text-xs font-medium">{p.label}</span>
                      <div className="flex items-center gap-2">
                        <button className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm hover:bg-muted"
                          onClick={() => p.set(Math.max(p.min, p.value - 1))}>−</button>
                        <span className="text-sm font-bold w-5 text-center">{p.value}</span>
                        <button className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm hover:bg-muted"
                          onClick={() => p.set(Math.min(p.max, p.value + 1))}>+</button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium">Cabin Class</label>
                    <select className="w-full h-9 px-2 text-sm border border-border rounded-md bg-background mt-1"
                      value={editCabin} onChange={(e) => setEditCabin(e.target.value)}>
                      <option value="economy">Economy</option>
                      <option value="premium-economy">Premium Economy</option>
                      <option value="business">Business</option>
                      <option value="first">First</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium">Preferred Airline</label>
                    <select className="w-full h-9 px-2 text-sm border border-border rounded-md bg-background mt-1"
                      value={editPreferredCarrier} onChange={(e) => setEditPreferredCarrier(e.target.value)}>
                      <option value="any">Any Airline</option>
                      <option value="BG">Biman Bangladesh</option>
                      <option value="2A">Air Astra</option>
                      <option value="BS">US-Bangla</option>
                      <option value="VQ">Novoair</option>
                      <option value="EK">Emirates</option>
                      <option value="QR">Qatar Airways</option>
                      <option value="SQ">Singapore Airlines</option>
                      <option value="TK">Turkish Airlines</option>
                      <option value="SV">Saudia</option>
                    </select>
                  </div>
                  <Separator />
                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium mb-1.5 block">Fare Type</label>
                    <div className="flex gap-2">
                      {["Regular", "Student", "Umrah"].map(f => (
                        <button key={f} onClick={() => setEditFareType(f.toLowerCase())}
                          className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${editFareType === f.toLowerCase() ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border hover:border-primary/40"}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" className="w-full bg-accent text-accent-foreground" onClick={applySearchEdit}>
                    <Search className="w-3.5 h-3.5 mr-1.5" /> Search
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Modify button */}
            <div className="ml-auto shrink-0">
              <Button size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground font-bold rounded-lg px-3 sm:px-5 h-7 sm:h-8 text-xs" onClick={applySearchEdit}>
                <Search className="w-3.5 h-3.5 mr-1" /> Modify
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Results info bar */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-2 sm:px-4 py-1.5 sm:py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm text-foreground font-semibold">
              {isMultiCity ? (
                <>Showing <strong>{totalMultiCityFlights}</strong> flights</>
              ) : isRoundTrip && hasDirections ? (
                <>Showing <strong>{filteredPairs.length} flights</strong> &amp; <strong>{airlineStats.length} Airlines</strong> <span className="text-muted-foreground font-normal text-[10px] sm:text-xs">(Fares include. AIT VAT)</span></>
              ) : (
                <>Showing <strong>{flights.length} flights</strong>
                  {sources.tti > 0 && <span className="text-muted-foreground font-normal text-[10px] ml-1">({sources.tti} Air Astra)</span>}
                  {sources.sabre > 0 && <span className="text-muted-foreground font-normal text-[10px] ml-1">({sources.sabre} Sabre)</span>}
                  {sources.flyhub > 0 && <span className="text-muted-foreground font-normal text-[10px] ml-1">({sources.flyhub} FlyHub)</span>}
                </>
              )}
            </p>
            {cheapest > 0 && (
              <span className="text-[10px] sm:text-xs text-muted-foreground">Sort by: <strong className="text-accent">{sortBy.charAt(0).toUpperCase() + sortBy.slice(1)}</strong></span>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-2 sm:px-4 py-3 sm:py-4">
        {!hasRequiredParams ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Plane className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
              <h2 className="text-lg font-bold mb-2">Search for Flights</h2>
              <p className="text-muted-foreground mb-4">Use the search widget to find flights with your travel dates.</p>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90" asChild><Link to="/">Search Flights</Link></Button>
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-3 sm:gap-5">
            {/* Sidebar filters */}
            <aside className="hidden lg:block w-72 shrink-0">
              <Card className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto shadow-[0_4px_20px_-4px_hsl(var(--foreground)/0.08),0_1px_3px_hsl(var(--foreground)/0.06)] border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Filters</h3>
                    <Button variant="ghost" size="sm" className="text-xs text-accent h-7" onClick={resetFilters}>Reset</Button>
                  </div>
                  <FilterPanel
                    flights={allFlightsForFilters}
                    priceRange={priceRange} setPriceRange={setPriceRange} maxPrice={maxPrice}
                    selectedAirlines={selectedAirlines} toggleAirline={toggleAirline}
                    stopsFilter={stopsFilter} setStopsFilter={setStopsFilter}
                    departTimeRange={departTimeRange} setDepartTimeRange={setDepartTimeRange}
                    arrivalTimeRange={arrivalTimeRange} setArrivalTimeRange={setArrivalTimeRange}
                    durationRange={durationRange} setDurationRange={setDurationRange}
                    selectedAlliances={selectedAlliances} toggleAlliance={toggleAlliance}
                    refundableOnly={refundableOnly} setRefundableOnly={setRefundableOnly}
                    selectedLayoverAirports={selectedLayoverAirports} toggleLayoverAirport={toggleLayoverAirport}
                    layoverDurationRange={layoverDurationRange} setLayoverDurationRange={setLayoverDurationRange}
                    isRoundTrip={isRoundTrip} originCode={fromCode} destCode={toCode}
                    selectedBaggage={selectedBaggage} toggleBaggage={toggleBaggage}
                    onReset={resetFilters}
                  />
                </CardContent>
              </Card>
            </aside>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Airline filter bar — real API data, 3D card with working scroll */}
              {airlineStats.length > 0 && (
                <Card className="shadow-[0_4px_20px_-4px_hsl(var(--foreground)/0.08),0_1px_3px_hsl(var(--foreground)/0.06)] border-border/60 overflow-hidden">
                  <div className="flex items-center">
                    <button
                      className="shrink-0 px-1 sm:px-2 text-accent font-semibold text-xs hover:bg-muted/50 transition-colors border-r border-border hidden sm:block"
                      onClick={resetFilters}
                    >
                      Reset
                    </button>
                    <button
                      className="shrink-0 px-1.5 sm:px-2 py-3 text-muted-foreground hover:text-foreground transition-colors border-r border-border"
                      onClick={() => airlineBarRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div ref={airlineBarRef} className="flex-1 overflow-x-auto scrollbar-none">
                      <div className="flex">
                        {airlineStats.map((a) => {
                          const isActive = airlineFilter === a.code;
                          return (
                            <button
                              key={a.code}
                              onClick={() => setAirlineFilter(isActive ? null : a.code)}
                              className={`flex items-center gap-2 px-3 py-2.5 whitespace-nowrap border-r border-border last:border-r-0 transition-colors shrink-0 ${
                                isActive ? "bg-accent/10" : "hover:bg-muted/50"
                              }`}
                            >
                              <img
                                src={getAirlineLogo(a.code) || ''}
                                alt={a.name}
                                className="w-5 h-5 rounded-full object-contain shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <div className="text-left">
                                <p className={`text-xs font-bold leading-tight ${isActive ? "text-accent" : "text-foreground"}`}>
                                  {a.code}
                                </p>
                                <p className={`text-[10px] leading-tight ${isActive ? "text-accent" : "text-muted-foreground"}`}>
                                  BDT {a.cheapest.toLocaleString()} ({a.count})
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      className="shrink-0 px-1.5 sm:px-2 py-3 text-muted-foreground hover:text-foreground transition-colors border-l border-border"
                      onClick={() => airlineBarRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </Card>
              )}

              {/* Quick sort chips — Cheapest / Fastest / Best */}
              <div className="flex items-center justify-between gap-1.5 sm:gap-2">
                <div className="flex gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0">
                  {[
                    { key: "cheapest", label: "Cheapest", icon: TrendingUp, data: quickSortSummary.cheapest },
                    { key: "fastest", label: "Fastest", icon: Zap, data: quickSortSummary.fastest },
                    { key: "best", label: "Best", icon: Star, data: quickSortSummary.best },
                  ].map((s) => {
                    const Icon = s.icon;
                    const isActive = sortBy === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => { setSortBy(s.key); setVisibleCount(20); }}
                        className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-xs whitespace-nowrap transition-all ${
                          isActive
                            ? "bg-card border border-accent shadow-[0_2px_10px_-3px_hsl(var(--accent)/0.3)]"
                            : "bg-card border border-border shadow-sm hover:shadow-md hover:border-foreground/20"
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isActive ? "text-accent" : ""}`} />
                          <span className={`font-bold ${isActive ? "text-foreground" : ""}`}>{s.label}</span>
                        </div>
                        {s.data && (
                          <span className={`text-[9px] sm:text-[10px] ${isActive ? "text-muted-foreground" : "text-muted-foreground/70"}`}>
                            BDT {s.data.price?.toLocaleString()}{s.data.duration ? ` | ${s.data.duration}` : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <Button variant="outline" size="sm" className="lg:hidden shrink-0 shadow-sm h-7 text-[11px] px-2" onClick={() => setShowFilters(true)}>
                  <Filter className="w-3.5 h-3.5 mr-1" /> Filters
                </Button>
              </div>

              {/* Results */}
              {isMultiCity ? (
                /* ── MULTI-CITY RESULTS — combined itinerary cards like BDFare ── */
                <DataLoader isLoading={isLoading} error={error} skeleton="cards" retry={refetch}>
                  {hasCabinMismatch && (
                    <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 mb-4">
                      <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {searchedCabinNorm.charAt(0).toUpperCase() + searchedCabinNorm.slice(1)} class is not available on this route
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Showing available Economy class fares instead. All prices shown are real-time from the airline.
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-2 bg-accent/10 text-accent rounded-lg px-3 py-1.5">
                        <Plane className="w-4 h-4" /><span className="text-sm font-bold">Multi-City</span>
                      </div>
                      <span className="text-sm font-medium">{multiCitySegments.map(s => s.from).join(" → ")} → {multiCitySegments[multiCitySegments.length - 1]?.to}</span>
                      <span className="text-xs text-muted-foreground">{multiCityFlights.length} itineraries</span>
                      <span className="text-xs text-muted-foreground italic">(Fares include. AIT VAT)</span>
                    </div>

                    {multiCityFlights.length === 0 ? (
                      <Card><CardContent className="py-8 text-center text-muted-foreground"><p>No multi-city itineraries found</p></CardContent></Card>
                    ) : sortFlights(applyFilters(multiCityFlights), sortBy).map((mcFlight: any) => (
                      <MultiCityFlightCard
                        key={mcFlight.id}
                        flight={mcFlight}
                        cheapest={multiCityFlights.length > 0 ? Math.min(...multiCityFlights.map((f: any) => f.price || Infinity)) : 0}
                        isExpanded={expandedFlight === mcFlight.id}
                        onToggleExpand={() => setExpandedFlight(expandedFlight === mcFlight.id ? null : mcFlight.id)}
                      />
                    ))}
                  </div>
                </DataLoader>
              ) : (
              <DataLoader isLoading={isLoading} error={error} skeleton="cards" retry={refetch}>
                {/* Cabin class mismatch alert for one-way / round-trip */}
                {hasCabinMismatch && (
                  <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 mb-4">
                    <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {searchedCabinNorm.charAt(0).toUpperCase() + searchedCabinNorm.slice(1)} class is not available on this route
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        The airlines operating this route do not offer {searchedCabinNorm.charAt(0).toUpperCase() + searchedCabinNorm.slice(1)} class. Showing available Economy class fares instead. All prices shown are real-time from the airline.
                      </p>
                    </div>
                  </div>
                )}
                {/* Cabin class guide info */}
                {!hasCabinMismatch && searchedCabinNorm && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border/60 bg-muted/30 mb-3">
                    <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        Showing {searchedCabinNorm.charAt(0).toUpperCase() + searchedCabinNorm.slice(1)} class results
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        Your searched cabin appears first in fare options. Airlines may also offer upgrade fares (e.g., Business on an Economy search). 
                        Each card shows the <strong>actual cabin</strong> from the airline — <span className="font-medium">Economy</span> (V, H, Q, L), <span className="font-medium">Business</span> (C, J, D), <span className="font-medium">First</span> (F, A), <span className="font-medium">Premium Economy</span> (W).
                      </p>
                    </div>
                  </div>
                )}
                {isRoundTrip && hasDirections ? (
                  <div className="space-y-2">
                    {/* Header: showing X round-trip combinations */}
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <div className="flex items-center gap-1.5 bg-accent/10 text-accent rounded-lg px-2.5 py-1">
                        <Plane className="w-3.5 h-3.5" /><span className="text-xs font-bold">Round Trip</span>
                      </div>
                      <span className="text-xs font-medium">{fromCode} ↔ {toCode}</span>
                      <span className="text-[10px] text-muted-foreground">{filteredPairs.length} combinations</span>
                      <span className="text-[10px] text-muted-foreground italic">(Fares include. AIT VAT)</span>
                    </div>

                    {filteredPairs.length === 0 ? (
                      <Card><CardContent className="py-8 text-center text-muted-foreground"><p>No round-trip flights found matching your filters</p></CardContent></Card>
                    ) : (
                      <>
                        {(() => {
                          const cheapest = Math.min(...filteredPairs.map((p) => pairPayable(p)));
                          const visible = filteredPairs.slice(0, visibleCount);
                          return visible.map((pair, idx) => (
                            <RoundTripFlightCard
                              key={`${pair.outbound.id}-${pair.returnFlight.id}-${idx}`}
                              outbound={pair.outbound}
                              returnFlight={pair.returnFlight}
                              cheapest={cheapest}
                              isExpanded={expandedFlight === `${pair.outbound.id}-${pair.returnFlight.id}`}
                              onToggleExpand={() => {
                                const pairId = `${pair.outbound.id}-${pair.returnFlight.id}`;
                                setExpandedFlight(expandedFlight === pairId ? null : pairId);
                              }}
                            />
                          ));
                        })()}
                        {visibleCount < filteredPairs.length && (
                          <div className="flex justify-center pt-4">
                            <Button
                              variant="outline"
                              className="font-bold px-8 py-3 rounded-full border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all"
                              onClick={() => setVisibleCount(prev => prev + LOAD_MORE_COUNT)}
                            >
                              Show More ({filteredPairs.length - visibleCount} remaining)
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  /* ONE-WAY with Similar Flights Grouping */
                  <>
                    {filteredAll.length === 0 ? (
                      <Card>
                        <CardContent className="py-12 text-center text-muted-foreground">
                          <Plane className="w-12 h-12 mx-auto mb-3 opacity-30" />
                          <p className="font-semibold">No flights found</p>
                          <p className="text-sm mt-1 max-w-md mx-auto">
                            {selectedAirlines.length > 0 || stopsFilter !== "all" ? "Try adjusting your filters" : "No flights available for this route."}
                          </p>
                          {selectedAirlines.length > 0 || stopsFilter !== "all" ? (
                            <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>Clear Filters</Button>
                          ) : (
                            <Button variant="outline" size="sm" className="mt-3" asChild><Link to="/">Try a Different Route</Link></Button>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      <>
                        {filteredAll.slice(0, visibleCount).map((flight: any, idx: number) => (
                          <FlightCard
                            key={`${flight.id}-${idx}`}
                            flight={flight}
                            cheapest={cheapest}
                            isExpanded={expandedFlight === flight.id}
                            onToggleExpand={() => setExpandedFlight(expandedFlight === flight.id ? null : flight.id)}
                          />
                        ))}
                        {visibleCount < filteredAll.length && (
                          <div className="flex justify-center pt-4">
                            <Button
                              variant="outline"
                              className="font-bold px-8 py-3 rounded-full border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all"
                              onClick={() => setVisibleCount(prev => prev + LOAD_MORE_COUNT)}
                            >
                              Show More ({filteredAll.length - visibleCount} remaining)
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </DataLoader>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile filter drawer */}
      <AnimatePresence>
        {showFilters && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setShowFilters(false)} />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-80 bg-card overflow-y-auto p-5 z-50 lg:hidden shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Filters</h3>
                <button onClick={() => setShowFilters(false)}><X className="w-5 h-5" /></button>
              </div>
              <FilterPanel
                flights={allFlightsForFilters}
                priceRange={priceRange} setPriceRange={setPriceRange} maxPrice={maxPrice}
                selectedAirlines={selectedAirlines} toggleAirline={toggleAirline}
                stopsFilter={stopsFilter} setStopsFilter={setStopsFilter}
                departTimeRange={departTimeRange} setDepartTimeRange={setDepartTimeRange}
                arrivalTimeRange={arrivalTimeRange} setArrivalTimeRange={setArrivalTimeRange}
                durationRange={durationRange} setDurationRange={setDurationRange}
                selectedAlliances={selectedAlliances} toggleAlliance={toggleAlliance}
                refundableOnly={refundableOnly} setRefundableOnly={setRefundableOnly}
                selectedLayoverAirports={selectedLayoverAirports} toggleLayoverAirport={toggleLayoverAirport}
                layoverDurationRange={layoverDurationRange} setLayoverDurationRange={setLayoverDurationRange}
                isRoundTrip={isRoundTrip} originCode={fromCode} destCode={toCode}
                selectedBaggage={selectedBaggage} toggleBaggage={toggleBaggage}
                onReset={resetFilters}
              />
              <Button className="w-full mt-6 bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowFilters(false)}>Apply Filters</Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Results Outdated Modal */}
      <AnimatePresence>
        {resultsExpired && (
          <ResultsOutdatedModal onNewSearch={() => navigate(`/flights?${searchParams.toString()}`)} />
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlightResults;
