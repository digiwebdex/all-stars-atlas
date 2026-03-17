import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Plane, ArrowLeft, Copy, Download, CreditCard, Timer, Luggage, Shield,
  Users, Package, RotateCcw, XCircle, ArrowRight, AlertTriangle, Ban,
  FileText, Wallet, Clock, Eye, ChevronUp, ChevronDown, RefreshCw,
} from "lucide-react";
import { generateTicketPDF } from "@/lib/pdf-generator";
import { AIRPORTS } from "@/lib/airports";
import { useDashboardBookings } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";
import TravelDocVerificationModal from "@/components/TravelDocVerificationModal";
import BookingActions from "@/components/flights/BookingActions";
import FlightStatusBadge from "@/components/flights/FlightStatusBadge";
import FareRulesModal from "@/components/flights/FareRulesModal";
import { formatApiDate, formatApiTime } from "@/lib/flight-time";

const statusLabelMap: Record<string, string> = {
  on_hold: "Hold", confirmed: "Confirmed", pending: "Pending", in_progress: "In Progress",
  completed: "Completed", cancelled: "Cancelled", void: "Void", refund: "Refund",
  exchange: "Exchange", expired: "Expired", ticketed: "Ticketed",
};
function displayStatus(status: string) { return statusLabelMap[status] || status; }

const statusBadgeColors: Record<string, string> = {
  on_hold: "bg-amber-500 text-white",
  confirmed: "bg-emerald-500 text-white",
  ticketed: "bg-green-600 text-white",
  pending: "bg-blue-500 text-white",
  cancelled: "bg-red-500 text-white",
  void: "bg-red-500 text-white",
  expired: "bg-gray-500 text-white",
  completed: "bg-emerald-500 text-white",
};

const BD_AIRPORTS = ["DAC", "CXB", "CGP", "ZYL", "JSR", "RJH", "SPD", "BZL", "IRD", "TKR"];

function fmtTime(dt?: string) { return dt ? formatApiTime(dt, { withGMT: true }) : "—"; }
function fmtDate(dt?: string) { return dt ? formatApiDate(dt, { year: "numeric" }) : "—"; }
function fmtDateTime(dt?: string) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function getAirlineLogo(code?: string): string | null { return code ? `https://images.kiwi.com/airlines/64/${code}.png` : null; }

function parseAmount(value: any): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickAmount(...values: any[]): number | undefined {
  for (const value of values) {
    const parsed = parseAmount(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function mapBooking(b: any) {
  const details = b.details || {};
  const outbound = details.outbound || {};
  const passengers = b.passengerInfo || [];
  const origin = outbound.origin || details.origin || "";
  const destination = outbound.destination || details.destination || "";
  const airline = outbound.airline || details.airline || "";
  const airlineCode = outbound.airlineCode || details.airlineCode || "";
  const flightNumber = outbound.flightNumber || details.flightNumber || "";
  const cabinClass = outbound.cabinClass || details.cabinClass || "Economy";
  const aircraft = outbound.aircraft || outbound.legs?.[0]?.aircraft || "";
  const departureTime = outbound.departureTime || details.departureTime || "";
  const arrivalTime = outbound.arrivalTime || details.arrivalTime || "";
  const duration = outbound.duration || details.duration || "";
  const stops = outbound.stops ?? details.stops ?? 0;
  const baggage = outbound.baggage || details.baggage || null;
  const refundable = outbound.refundable ?? details.refundable ?? false;
  const legs = outbound.legs || [];
  const returnFlight = details.return || null;
  const isRoundTrip = !!details.isRoundTrip;
  const source = outbound.source || details.source || "db";
  const isDomestic = details.isDomestic ?? (BD_AIRPORTS.includes(origin.toUpperCase()) && BD_AIRPORTS.includes(destination.toUpperCase()));

  const rawAmount = pickAmount(b.totalAmount, details.totalAmount, details.total, outbound.totalAmount, outbound.price) || 0;

  const rawBaseFare = pickAmount(details.baseFare, details.base_fare, details.fare?.baseFare, details.fare?.base_fare, outbound.baseFare, outbound.base_fare, outbound.fare?.baseFare, b.baseFare, b.base_fare);
  const rawTaxes = pickAmount(details.taxes, details.tax, details.taxesAndFees, details.taxes_and_fees, details.fare?.taxes, outbound.taxes, outbound.tax, b.taxes, b.taxes_and_fees);
  const serviceCharge = pickAmount(details.serviceCharge, details.service_charge, details.serviceFee, details.service_fee, outbound.serviceCharge, outbound.service_charge, b.serviceCharge, b.service_charge) || 0;

  let baseFare = rawBaseFare || 0;
  const taxes = rawTaxes || 0;
  if (baseFare <= 0 && rawAmount > 0) {
    const knownExtra = taxes + serviceCharge;
    baseFare = knownExtra > 0 ? Math.max(0, rawAmount - knownExtra) : rawAmount;
  }

  const displayAirlinePnr = details.airlinePnr || null;
  const displayGdsBookingId = b.pnr || details.gdsPnr || null;

  return {
    id: b.bookingRef || b.id, rawId: b.id, type: b.bookingType || "flight", status: b.status || "pending",
    amount: `৳${rawAmount.toLocaleString()}`, rawAmount,
    date: b.bookedAt ? new Date(b.bookedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—",
    bookedAt: b.bookedAt || b.created_at || "",
    pnr: b.pnr || details.gdsPnr || "—",
    gdsPnr: details.gdsPnr || b.pnr || null,
    airlinePnr: displayAirlinePnr,
    gdsBookingId: displayGdsBookingId,
    pax: passengers.length || 1,
    paxNames: passengers.map((p: any) => `${p.firstName || ""} ${p.lastName || ""}`.trim()).filter(Boolean),
    ticketNo: b.ticketNo || "—",
    paymentMethod: b.paymentMethod || "—", paymentStatus: b.paymentStatus || "—",
    paymentDeadline: b.paymentDeadline || null,
    airline, airlineCode, flightNumber, cabinClass, aircraft, departureTime, arrivalTime, duration, stops, baggage, refundable,
    legs, returnFlight, isRoundTrip, source, origin, destination,
    details, passengers, contactInfo: b.contactInfo || {}, addOns: details.addOns || {},
    baseFare, taxes, serviceCharge, isDomestic,
  };
}

// Countdown hook
function useCountdown(deadline: string | null) {
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Expired"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${d} day(s), ${h} hour(s), ${m} minute(s), and ${s} second(s).`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);
  return timeLeft;
}

const DashboardBookingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("itinerary");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [docVerifyOpen, setDocVerifyOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [fareOpen, setFareOpen] = useState(true);

  const { data, isLoading, error, refetch } = useDashboardBookings({ search: id, limit: 1 });

  const resolved = (data as any) || {};
  const rawBookings = resolved?.data || resolved?.bookings || [];
  const booking = rawBookings.length > 0 ? mapBooking(rawBookings[0]) : null;

  const countdown = useCountdown(booking?.paymentDeadline || null);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
  };

  const handleCancel = async () => {
    if (!booking) return;
    setCancelLoading(true);
    try {
      await api.post(`/flights/cancel`, { bookingId: booking.rawId, reason: cancelReason });
      toast({ title: "Booking Cancelled", description: `${booking.id} has been cancelled.` });
      setCancelOpen(false);
      refetch();
    } catch (err: any) {
      const errMsg = err.gdsError || err.message || "Could not cancel booking.";
      toast({ title: "Cancel Failed", description: errMsg, variant: "destructive" });
    } finally {
      setCancelLoading(false);
    }
  };

  const handleVoidRequest = async () => {
    if (!booking) return;
    setVoidLoading(true);
    try {
      await api.post(`/flights/void`, { pnr: booking.pnr !== "—" ? booking.pnr : undefined, bookingId: booking.rawId });
      toast({ title: "Void Request Sent", description: "Your void request has been sent to admin for processing." });
      setVoidOpen(false);
      refetch();
    } catch (err: any) {
      toast({ title: "Void Failed", description: err.message || "Could not process void request.", variant: "destructive" });
    } finally {
      setVoidLoading(false);
    }
  };

  const handlePayNow = () => {
    if (!booking) return;
    if (!booking.isDomestic && booking.type === "flight") {
      setDocVerifyOpen(true);
    } else {
      navigate("/dashboard/payments");
    }
  };

  const handleDocVerified = () => {
    toast({ title: "Documents Verified ✓", description: "Redirecting to payment..." });
    setDocVerifyOpen(false);
    navigate("/dashboard/payments");
  };

  const handleDownloadTicket = async () => {
    if (!booking) return;
    try {
      const getCity = (code: string) => { const ap = AIRPORTS.find(a => a.code === code?.toUpperCase()); return ap ? `${ap.city}, ${ap.country}` : ""; };
      const buildSeg = (f: any) => ({
        airline: f?.airline || "Seven Trip", airlineCode: f?.airlineCode || "", flightNumber: f?.flightNumber || "",
        origin: f?.origin || "", originCity: f?.originCity || getCity(f?.origin),
        destination: f?.destination || "", destinationCity: f?.destinationCity || getCity(f?.destination),
        departureTime: f?.departureTime || "", arrivalTime: f?.arrivalTime || "", duration: f?.duration || "",
        cabinClass: f?.cabinClass || "Economy", aircraft: f?.aircraft || f?.legs?.[0]?.aircraft || "",
        terminal: f?.terminal || "", arrivalTerminal: f?.arrivalTerminal || "",
        baggage: f?.baggage || "20Kg", status: "Confirmed", meal: f?.meal || "Meals",
        distance: f?.distance || null, emission: f?.emission || null,
      });
      const outbound = booking.details?.outbound;
      const returnFlt = booking.returnFlight || booking.details?.return;
      await generateTicketPDF({
        id: booking.id, pnr: booking.pnr !== "—" ? booking.pnr : undefined,
        gdsPnr: booking.gdsBookingId || booking.pnr !== "—" ? booking.pnr : undefined,
        airlinePnr: booking.airlinePnr || undefined, bookingRef: booking.id, source: booking.source,
        airline: booking.airline || "Seven Trip", flightNo: booking.flightNumber || "",
        from: booking.origin || "", to: booking.destination || "",
        date: booking.departureTime || booking.date, time: booking.departureTime || "",
        passenger: booking.paxNames?.[0] || "Traveller", seat: "—", class: booking.cabinClass || "Economy",
        isRoundTrip: booking.isRoundTrip,
        outbound: outbound ? [buildSeg(outbound)] : [], returnSegments: returnFlt ? [buildSeg(returnFlt)] : [],
        passengers: booking.passengers?.map((p: any) => ({ title: p.title || "", firstName: p.firstName || "", lastName: p.lastName || "", passport: p.passport || "", seat: "" })) || [],
      });
      toast({ title: "Downloaded", description: "E-Ticket PDF saved" });
    } catch (err: any) {
      toast({ title: "Download Failed", description: "Could not generate PDF.", variant: "destructive" });
    }
  };

  const getAirportName = (code: string) => {
    const ap = AIRPORTS.find(a => a.code === code?.toUpperCase());
    return ap ? ap.name : code;
  };

  return (
    <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
      {!booking ? (
        <div className="text-center py-20">
          <Plane className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Booking not found</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard/bookings")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Bookings
          </Button>
        </div>
      ) : (
        <div className="space-y-5 max-w-5xl mx-auto">
          {/* Back + Title Bar */}
          <div className="flex items-center gap-3 bg-primary px-4 py-3 rounded-lg">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/bookings")} className="text-primary-foreground hover:bg-primary-foreground/10 p-1">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold text-primary-foreground">Booking Details</h1>
            <button onClick={() => refetch()} className="text-primary-foreground/70 hover:text-primary-foreground ml-1">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Top Action Buttons — matching ticketlagbe */}
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/dashboard/issue-with-balance`}>
              <Button className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-sm">
                <Wallet className="w-4 h-4 mr-1.5" /> Issue With Balance
              </Button>
            </Link>
            <div className="ml-auto flex flex-wrap gap-2">
              <Link to="/dashboard/timeline">
                <Button variant="outline" className="font-semibold border-2 border-foreground/80 text-foreground">
                  <Clock className="w-4 h-4 mr-1.5" /> Timeline
                </Button>
              </Link>
              <Link to="/dashboard/ssr-history">
                <Button variant="outline" className="font-semibold border-2 border-foreground/80 text-foreground">
                  <Eye className="w-4 h-4 mr-1.5" /> View SSR
                </Button>
              </Link>
              <Button variant="outline" className="font-semibold border-2 border-destructive text-destructive hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
                <Ban className="w-4 h-4 mr-1.5" /> Cancel Booking
              </Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-sm" onClick={handleDownloadTicket}>
                <Download className="w-4 h-4 mr-1.5" /> Voucher Download
              </Button>
            </div>
          </div>

          {/* Route + Status + Countdown */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-black tracking-tight">{booking.origin}-{booking.destination}</h2>
              <Badge className={`${statusBadgeColors[booking.status] || "bg-muted text-foreground"} text-sm px-3 py-1 font-bold`}>
                {displayStatus(booking.status)}
              </Badge>
              {booking.paymentDeadline && booking.status === "on_hold" && countdown && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-sm">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <span className="text-warning font-medium">The Booking will expire in {countdown}</span>
                </div>
              )}
            </div>

            {/* View SSR time limit link */}
            {booking.status === "on_hold" && (
              <Link to="/dashboard/ssr-history" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors">
                <AlertTriangle className="w-4 h-4" />
                View SSR to check the actual booking time limit
              </Link>
            )}
          </div>

          {/* Booking Info Bar — matching ticketlagbe layout */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Booking Id</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs font-bold font-mono bg-primary text-primary-foreground px-2 py-0.5 rounded">{booking.gdsBookingId || booking.id}</span>
                <button onClick={() => copyText(booking.gdsBookingId || booking.id, "Booking ID")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
              </div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Booking Created</p>
              <p className="text-xs font-bold mt-1">{fmtDateTime(booking.bookedAt)}</p>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Ticketing Time Limit</p>
              <p className="text-xs font-bold mt-1">{booking.paymentDeadline ? fmtDateTime(booking.paymentDeadline) : "—"}</p>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">PNR</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs font-bold font-mono">{booking.pnr}</span>
                {booking.pnr !== "—" && <button onClick={() => copyText(booking.pnr, "PNR")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Airline PNR</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs font-bold font-mono">{booking.airlinePnr || "—"}</span>
                {booking.airlinePnr && <button onClick={() => copyText(booking.airlinePnr!, "Airline PNR")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>}
              </div>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Refundable</p>
              <p className={`text-xs font-bold mt-1 ${booking.refundable ? "text-emerald-600" : "text-destructive"}`}>
                {booking.refundable ? "Yes" : "No"}
              </p>
            </div>
            <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Total Amount</p>
              <p className="text-sm font-black text-primary mt-1">{booking.rawAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border overflow-x-auto">
            {[
              { key: "itinerary", label: "Itinerary Information" },
              { key: "fare", label: "Fare Breakdown" },
              { key: "passengers", label: "Passengers" },
              { key: "manage", label: "Manage Booking" },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>{tab.label}</button>
            ))}
          </div>

          {/* ═══════ Itinerary Tab ═══════ */}
          {activeTab === "itinerary" && (
            <div className="space-y-6">
              {/* Outbound Flight */}
              {booking.isRoundTrip && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30 text-sm font-bold">
                  <Plane className="w-4 h-4" />
                  <span>Outbound: {booking.origin} → {booking.destination}</span>
                  <span className="text-xs ml-1">· {fmtDate(booking.departureTime)}</span>
                </div>
              )}

              <Card>
                <CardContent className="p-0">
                  <div className="bg-muted/40 px-5 py-3 border-b border-border">
                    <h3 className="text-sm font-bold">Flight Information</h3>
                  </div>

                  {/* Route summary bar */}
                  <div className="px-5 py-3 bg-muted/20 border-b border-border">
                    <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
                      <span>{booking.origin} - {booking.destination}</span>
                      <Separator orientation="vertical" className="h-4" />
                      <span>{fmtDate(booking.departureTime)}</span>
                      <Separator orientation="vertical" className="h-4" />
                      <span>{booking.stops === 0 ? "Non Stop" : `${booking.stops} Stop`}</span>
                    </div>
                  </div>

                  {/* Flight segments - visual timeline */}
                  <div className="divide-y divide-border">
                    {(booking.legs.length > 0 ? booking.legs : [{
                      airlineCode: booking.airlineCode,
                      airline: booking.airline,
                      flightNumber: booking.flightNumber,
                      aircraft: booking.aircraft,
                      origin: booking.origin,
                      destination: booking.destination,
                      departureTime: booking.departureTime,
                      arrivalTime: booking.arrivalTime,
                      duration: booking.duration,
                      originTerminal: null,
                      destinationTerminal: null,
                    }]).map((leg: any, i: number, arr: any[]) => (
                      <div key={i}>
                        {/* Airline header */}
                        <div className="px-5 py-3 flex items-center gap-3">
                          {getAirlineLogo(leg.airlineCode || booking.airlineCode) && (
                            <img src={getAirlineLogo(leg.airlineCode || booking.airlineCode)!} alt="" className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <span className="font-bold text-primary">{leg.airline || booking.airline}</span>
                          <Separator orientation="vertical" className="h-4" />
                          <span className="text-sm text-muted-foreground">{leg.airlineCode || booking.airlineCode} - {leg.flightNumber || booking.flightNumber}</span>
                          <Separator orientation="vertical" className="h-4" />
                          <span className="text-sm text-muted-foreground">{leg.aircraft || booking.aircraft || "—"}</span>
                        </div>

                        {/* Departure → Arrival visual */}
                        <div className="px-5 pb-5">
                          <div className="flex items-start justify-between">
                            {/* Departure */}
                            <div className="flex-1">
                              <p className="text-2xl font-black">{fmtTime(leg.departureTime)}</p>
                              <p className="text-xs text-muted-foreground mt-1">{fmtDate(leg.departureTime)}</p>
                              <p className="text-xs text-muted-foreground">{getAirportName(leg.origin)}</p>
                              {leg.originTerminal && <p className="text-xs text-muted-foreground">Terminal: {leg.originTerminal}</p>}
                              <p className="text-xs text-muted-foreground">{booking.cabinClass}</p>
                            </div>

                            {/* Visual connector */}
                            <div className="flex-1 flex flex-col items-center justify-center pt-2 px-4">
                              <p className="text-xs text-muted-foreground mb-2">⏱ {leg.duration || booking.duration}</p>
                              <div className="w-full flex items-center">
                                <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40" />
                                <div className="flex-1 border-t-2 border-dashed border-muted-foreground/30 relative">
                                  {leg.distance && (
                                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap">
                                      📍 {leg.distance}
                                    </span>
                                  )}
                                </div>
                                <Plane className="w-4 h-4 text-muted-foreground/60" />
                              </div>
                            </div>

                            {/* Arrival */}
                            <div className="flex-1 text-right">
                              <p className="text-2xl font-black">{fmtTime(leg.arrivalTime)}</p>
                              <p className="text-xs text-muted-foreground mt-1">{fmtDate(leg.arrivalTime)}</p>
                              <p className="text-xs text-muted-foreground">{getAirportName(leg.destination)}</p>
                              {leg.destinationTerminal && <p className="text-xs text-muted-foreground">Terminal: {leg.destinationTerminal}</p>}
                              <p className="text-xs text-muted-foreground">{booking.cabinClass}</p>
                            </div>
                          </div>
                        </div>

                        {/* Layover between segments */}
                        {i < arr.length - 1 && (
                          <div className="flex items-center justify-center py-3 bg-muted/20 border-t border-b border-dashed border-border">
                            <span className="text-xs text-muted-foreground bg-card px-4 py-1 rounded-full border border-border">
                              Change of plane · Layover in {AIRPORTS.find(a => a.code === leg.destination?.toUpperCase())?.city || leg.destination}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Baggage + meta */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Luggage className="w-3.5 h-3.5" /> {booking.baggage} checked</span>
                <span>Cabin: {booking.cabinClass}</span>
                {booking.refundable && <span className="flex items-center gap-1 text-emerald-600"><Shield className="w-3.5 h-3.5" /> Refundable</span>}
                <span>{booking.stops === 0 ? "Non-stop" : `${booking.stops} stop(s)`}</span>
                <Separator orientation="vertical" className="h-4" />
                <FlightStatusBadge airlineCode={booking.airlineCode} flightNumber={booking.flightNumber} date={(booking.departureTime || "").substring(0, 10)} compact />
                <FareRulesModal origin={booking.origin} destination={booking.destination} departureDate={(booking.departureTime || "").substring(0, 10)} airlineCode={booking.airlineCode} flightNumber={booking.flightNumber} />
              </div>

              {/* Return Flight */}
              {booking.isRoundTrip && booking.returnFlight && (
                <>
                  <Separator />
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30 text-sm font-bold">
                    <Plane className="w-4 h-4 rotate-180" />
                    <span>Return: {booking.returnFlight.origin} → {booking.returnFlight.destination}</span>
                    <span className="text-xs ml-1">· {fmtDate(booking.returnFlight.departureTime)}</span>
                  </div>

                  <Card>
                    <CardContent className="p-0">
                      <div className="bg-muted/40 px-5 py-3 border-b border-border">
                        <h3 className="text-sm font-bold">Return Flight Information</h3>
                      </div>
                      <div className="px-5 py-5">
                        <div className="flex items-center gap-3 mb-4">
                          {getAirlineLogo(booking.returnFlight.airlineCode) && (
                            <img src={getAirlineLogo(booking.returnFlight.airlineCode)!} alt="" className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <span className="font-bold text-primary">{booking.returnFlight.airline}</span>
                          <span className="text-sm text-muted-foreground">{booking.returnFlight.airlineCode} - {booking.returnFlight.flightNumber}</span>
                        </div>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-2xl font-black">{fmtTime(booking.returnFlight.departureTime)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.departureTime)}</p>
                            <p className="text-xs text-muted-foreground">{getAirportName(booking.returnFlight.origin)}</p>
                          </div>
                          <div className="flex-1 flex flex-col items-center justify-center pt-2 px-4">
                            <p className="text-xs text-muted-foreground mb-2">⏱ {booking.returnFlight.duration}</p>
                            <div className="w-full flex items-center">
                              <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40" />
                              <div className="flex-1 border-t-2 border-dashed border-muted-foreground/30" />
                              <Plane className="w-4 h-4 text-muted-foreground/60" />
                            </div>
                          </div>
                          <div className="flex-1 text-right">
                            <p className="text-2xl font-black">{fmtTime(booking.returnFlight.arrivalTime)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.arrivalTime)}</p>
                            <p className="text-xs text-muted-foreground">{getAirportName(booking.returnFlight.destination)}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* ═══════ Fare Tab ═══════ */}
          {activeTab === "fare" && (
            <div className="space-y-3">
              <Card>
                <button className="w-full px-5 py-4 flex items-center justify-between text-left border-b border-border" onClick={() => setFareOpen(!fareOpen)}>
                  <h3 className="text-sm font-bold">Customer Fare Summary</h3>
                  {fareOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {fareOpen && (
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Pax Type</th>
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Base Fare</th>
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Tax</th>
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Service Fee</th>
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Discount</th>
                          <th className="px-5 py-2 text-left text-xs font-bold text-muted-foreground">Pax Count</th>
                          <th className="px-5 py-2 text-right text-xs font-bold text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/50">
                          <td className="px-5 py-3 font-medium">Adult</td>
                          <td className="px-5 py-3">৳{(booking.baseFare || 0).toLocaleString()}</td>
                          <td className="px-5 py-3">৳{(booking.taxes || 0).toLocaleString()}</td>
                          <td className="px-5 py-3">৳{(booking.serviceCharge || 0).toLocaleString()}</td>
                          <td className="px-5 py-3">৳0</td>
                          <td className="px-5 py-3">{booking.pax}</td>
                          <td className="px-5 py-3 text-right font-bold">{booking.amount}</td>
                        </tr>
                      </tbody>
                    </table>
                  </CardContent>
                )}
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg border border-border"><p className="text-[10px] uppercase text-muted-foreground font-medium">Payment Method</p><p className="text-sm font-medium capitalize">{booking.paymentMethod}</p></div>
                <div className="p-3 bg-muted/30 rounded-lg border border-border"><p className="text-[10px] uppercase text-muted-foreground font-medium">Payment Status</p><p className="text-sm font-medium capitalize">{booking.paymentStatus}</p></div>
              </div>
            </div>
          )}

          {/* ═══════ Passengers Tab ═══════ */}
          {activeTab === "passengers" && (
            <div className="space-y-3">
              {booking.passengers?.length > 0 ? booking.passengers.map((p: any, i: number) => (
                <Card key={i}>
                  <div className="bg-primary/5 px-5 py-3 border-b border-border flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <span className="text-sm font-bold">{p.title} {p.firstName} {p.lastName}</span>
                    {i === 0 && <Badge className="bg-primary/10 text-primary border-0 text-[9px] ml-auto">Primary</Badge>}
                  </div>
                  <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {(p.dob || p.dateOfBirth) && <div><span className="text-muted-foreground">Date of Birth</span><p className="font-medium">{p.dob || p.dateOfBirth}</p></div>}
                    {p.nationality && <div><span className="text-muted-foreground">Nationality</span><p className="font-medium">{p.nationality}</p></div>}
                    {(p.passport || p.passportNumber) && <div><span className="text-muted-foreground">Document No.</span><p className="font-medium font-mono">{p.passport || p.passportNumber}</p></div>}
                    {p.passportExpiry && <div><span className="text-muted-foreground">Expiry Date</span><p className="font-medium">{p.passportExpiry}</p></div>}
                    {p.email && <div><span className="text-muted-foreground">Email</span><p className="font-medium">{p.email}</p></div>}
                    {p.phone && <div><span className="text-muted-foreground">Phone</span><p className="font-medium">{p.phone}</p></div>}
                  </CardContent>
                </Card>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-6">No passenger info available</p>
              )}
            </div>
          )}

          {/* ═══════ Manage Tab ═══════ */}
          {activeTab === "manage" && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Flight Status</p>
                  <FlightStatusBadge airlineCode={booking.airlineCode} flightNumber={booking.flightNumber} date={(booking.departureTime || "").substring(0, 10)} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Fare Rules & Conditions</p>
                  <FareRulesModal origin={booking.origin} destination={booking.destination} departureDate={(booking.departureTime || "").substring(0, 10)} airlineCode={booking.airlineCode} flightNumber={booking.flightNumber}
                    trigger={<Button variant="outline" size="sm" className="text-xs gap-1"><FileText className="w-3.5 h-3.5" /> View Fare Rules</Button>}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Booking Actions</p>
                  <div className="flex flex-wrap gap-3">
                    <BookingActions booking={booking} isAdmin={false} onActionComplete={() => refetch()} />
                    {/* Void Request */}
                    {["confirmed", "ticketed"].includes(booking.status) && (
                      <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5" onClick={() => setVoidOpen(true)}>
                        <XCircle className="w-4 h-4" /> Void Request
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Bottom Action Row */}
          <Separator />
          <div className="flex flex-wrap gap-3">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-sm" onClick={handleDownloadTicket}>
              <Download className="w-4 h-4 mr-1.5" /> Download E-Ticket
            </Button>
            {booking.pnr !== "—" && booking.type === "flight" && (
              <Button variant="outline" className="font-bold" onClick={() => navigate(`/dashboard/bookings/${booking.rawId}/extras`)}>
                <Package className="w-4 h-4 mr-1.5" /> Buy Extras
              </Button>
            )}
          </div>

          {/* ═══════ Dialogs ═══════ */}

          {/* Cancel Dialog */}
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-destructive" /> Cancel Booking</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Are you sure you want to cancel <strong>{booking.id}</strong>?</p>
                {(booking.pnr !== "—" || booking.gdsBookingId) && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
                    <p className="font-semibold text-destructive">⚠️ GDS Cancellation</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This will attempt to cancel {booking.airlinePnr ? `PNR ${booking.airlinePnr}` : `Booking ${booking.gdsBookingId || booking.pnr}`} in the airline system.
                    </p>
                  </div>
                )}
                <Textarea placeholder="Reason for cancellation (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep Booking</Button>
                <Button variant="destructive" onClick={handleCancel} disabled={cancelLoading}>
                  {cancelLoading ? "Cancelling..." : "Confirm Cancel"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Void Request Dialog */}
          <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><XCircle className="w-5 h-5 text-destructive" /> Void Request</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Submit a void request for booking <strong>{booking.id}</strong>? This will be sent to admin for processing.</p>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-warning">Void Policy</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Void requests must be submitted within 24 hours of booking. Admin will review and process the request.
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">PNR</span><span className="font-mono font-bold">{booking.pnr}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-muted-foreground">Amount</span><span className="font-bold">{booking.amount}</span></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleVoidRequest} disabled={voidLoading}>
                  {voidLoading ? "Submitting..." : "Submit Void Request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Travel Doc Verification */}
          {docVerifyOpen && booking && (
            <TravelDocVerificationModal
              open={docVerifyOpen}
              onOpenChange={(open) => { if (!open) setDocVerifyOpen(false); }}
              onVerified={handleDocVerified}
              passengers={booking.passengers || []}
              bookingRef={booking.id}
              bookingId={booking.rawId}
            />
          )}
        </div>
      )}
    </DataLoader>
  );
};

export default DashboardBookingDetail;
