import { useState } from "react";
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
  FileText,
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
  on_hold: "Reserved", confirmed: "Confirmed", pending: "Pending", in_progress: "In Progress",
  completed: "Completed", cancelled: "Cancelled", void: "Void", refund: "Refund",
  exchange: "Exchange", expired: "Expired", ticketed: "Ticketed",
};
function displayStatus(status: string) { return statusLabelMap[status] || status; }

const statusColors: Record<string, string> = {
  on_hold: "bg-warning/10 text-warning border-warning/20",
  confirmed: "bg-accent/10 text-accent border-accent/20",
  ticketed: "bg-accent/10 text-accent border-accent/20",
  pending: "bg-warning/10 text-warning border-warning/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  void: "bg-destructive/10 text-destructive border-destructive/20",
  expired: "bg-muted text-muted-foreground border-border",
  completed: "bg-muted text-muted-foreground border-border",
};

const BD_AIRPORTS = ["DAC", "CXB", "CGP", "ZYL", "JSR", "RJH", "SPD", "BZL", "IRD", "TKR"];

function fmtTime(dt?: string) { return dt ? formatApiTime(dt, { withGMT: true }) : "—"; }
function fmtDate(dt?: string) { return dt ? formatApiDate(dt, { year: "numeric" }) : "—"; }
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

  const rawAmount = pickAmount(
    b.totalAmount,
    details.totalAmount,
    details.total,
    outbound.totalAmount,
    outbound.price,
  ) || 0;

  const rawBaseFare = pickAmount(
    details.baseFare,
    details.base_fare,
    details.fare?.baseFare,
    details.fare?.base_fare,
    outbound.baseFare,
    outbound.base_fare,
    outbound.fare?.baseFare,
    b.baseFare,
    b.base_fare,
  );

  const rawTaxes = pickAmount(
    details.taxes,
    details.tax,
    details.taxesAndFees,
    details.taxes_and_fees,
    details.fare?.taxes,
    outbound.taxes,
    outbound.tax,
    b.taxes,
    b.taxes_and_fees,
  );

  const serviceCharge = pickAmount(
    details.serviceCharge,
    details.service_charge,
    details.serviceFee,
    details.service_fee,
    outbound.serviceCharge,
    outbound.service_charge,
    b.serviceCharge,
    b.service_charge,
  ) || 0;

  let baseFare = rawBaseFare || 0;
  const taxes = rawTaxes || 0;

  if (baseFare <= 0 && rawAmount > 0) {
    const knownExtra = taxes + serviceCharge;
    baseFare = knownExtra > 0 ? Math.max(0, rawAmount - knownExtra) : rawAmount;
  }

  // Dual PNR: Airlines PNR (actual airline confirmation) vs GDS Booking ID (GDS record locator)
  const displayAirlinePnr = details.airlinePnr || null;
  const displayGdsBookingId = b.pnr || details.gdsPnr || null;

  return {
    id: b.bookingRef || b.id, rawId: b.id, type: b.bookingType || "flight", status: b.status || "pending",
    amount: `৳${rawAmount.toLocaleString()}`, rawAmount,
    date: b.bookedAt ? new Date(b.bookedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—",
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
    baseFare, taxes, serviceCharge,
    isDomestic,
  };
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

  const { data, isLoading, error, refetch } = useDashboardBookings({ search: id, limit: 1 });

  const resolved = (data as any) || {};
  const rawBookings = resolved?.data || resolved?.bookings || [];
  const booking = rawBookings.length > 0 ? mapBooking(rawBookings[0]) : null;

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
      const hint = err.hint || "";
      toast({ title: "Cancel Failed", description: `${errMsg}${hint ? ` — ${hint}` : ""}`, variant: "destructive" });
    } finally {
      setCancelLoading(false);
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
        airlinePnr: booking.airlinePnr || undefined,
        bookingRef: booking.id,
        source: booking.source,
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
      console.error("PDF generation error:", err);
      toast({ title: "Download Failed", description: "Could not generate PDF. Please try again.", variant: "destructive" });
    }
  };

  const logo = booking ? getAirlineLogo(booking.airlineCode) : null;

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
        <div className="space-y-6 max-w-4xl mx-auto">
          {/* Back button */}
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/bookings")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Bookings
          </Button>

          {/* Header */}
          <div className="bg-accent text-accent-foreground rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Plane className="w-6 h-6 shrink-0" />
              <div>
                <h1 className="text-lg font-bold">Booking: {booking.id}</h1>
                <p className="text-xs text-accent-foreground/70">{booking.airline} · {booking.flightNumber} · {booking.origin} → {booking.destination}</p>
              </div>
            </div>
            <Badge className="bg-accent-foreground/20 text-accent-foreground border-0 text-xs w-fit">
              {displayStatus(booking.status)}
            </Badge>
          </div>

          {/* Payment deadline banner (inline under booking) */}
          {booking.paymentDeadline && (booking.status === "on_hold") && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border bg-warning/5 border-warning/30">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4.5 h-4.5 text-warning" />
                </div>
                <div>
                  <p className="text-sm font-bold">Payment Due</p>
                  <p className="text-xs text-muted-foreground">
                    Deadline: {new Date(booking.paymentDeadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              <Button size="sm" className="h-8 text-xs font-bold" onClick={handlePayNow}>
                <CreditCard className="w-3.5 h-3.5 mr-1" /> {!booking.isDomestic ? "Upload Docs & Pay" : "Pay Now"}
              </Button>
            </div>
          )}

          {/* Booking meta — 5 columns: Booking ID (GDS PNR), Airlines PNR, GDS Booking ID, Class, Journey */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Booking ID</p>
              <p className="text-sm font-bold font-mono flex items-center gap-1 truncate">{booking.gdsBookingId || booking.id}
                <button onClick={() => copyText(booking.gdsBookingId || booking.id, "Booking ID")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
              </p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Airlines PNR</p>
              {booking.airlinePnr ? (
                <p className="text-sm font-bold font-mono text-accent flex items-center gap-1">{booking.airlinePnr}
                  <button onClick={() => copyText(booking.airlinePnr!, "Airlines PNR")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
                </p>
              ) : (
                <p className="text-sm font-medium text-muted-foreground italic">Pending</p>
              )}
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Booking Ref</p>
              <p className="text-sm font-bold font-mono flex items-center gap-1 truncate">{booking.id}
                <button onClick={() => copyText(booking.id, "Booking Ref")} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>
              </p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Booking Class</p>
              <p className="text-sm font-bold">{booking.cabinClass}</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-[10px] uppercase text-muted-foreground font-medium">Journey Type</p>
              <p className="text-sm font-bold">{booking.isRoundTrip ? "Round Trip" : "One Way"}</p>
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
                  activeTab === tab.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>{tab.label}</button>
            ))}
          </div>

          {/* Itinerary Tab */}
          {activeTab === "itinerary" && (
            <div className="space-y-4">
              {booking.isRoundTrip && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/15 text-accent border border-accent/30 text-sm font-bold shadow-sm">
                  <Plane className="w-4 h-4" />
                  <span>Outbound: {booking.origin} → {booking.destination}</span>
                  <span className="flight-date text-xs ml-1">· {fmtDate(booking.departureTime)}</span>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-accent px-4 py-2"><p className="text-xs font-bold text-accent-foreground uppercase">Departure</p></div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between"><span className="text-3xl font-black">{booking.origin}</span><span className="text-2xl font-black">{fmtTime(booking.departureTime)}</span></div>
                    <p className="text-xs text-muted-foreground">{fmtDate(booking.departureTime)}</p>
                    {booking.legs[0]?.originTerminal && <p className="text-xs text-muted-foreground">Terminal {booking.legs[0].originTerminal}</p>}
                  </div>
                </div>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-accent px-4 py-2"><p className="text-xs font-bold text-accent-foreground uppercase">Arrival</p></div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between"><span className="text-3xl font-black">{booking.destination}</span><span className="text-2xl font-black">{fmtTime(booking.arrivalTime)}</span></div>
                    <p className="text-xs text-muted-foreground">{fmtDate(booking.arrivalTime)}</p>
                    {booking.legs[booking.legs.length - 1]?.destinationTerminal && <p className="text-xs text-muted-foreground">Terminal {booking.legs[booking.legs.length - 1].destinationTerminal}</p>}
                  </div>
                </div>
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <div className="bg-muted/30 px-4 py-2 border-b border-border"><p className="text-xs font-bold uppercase text-muted-foreground">Flight Details</p></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border bg-muted/10">
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Flight Number</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Departure</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Arrival</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Duration</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Baggage</th>
                    </tr></thead>
                    <tbody>
                      {booking.legs.length > 0 ? booking.legs.map((leg: any, i: number) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {getAirlineLogo(leg.airlineCode) && <img src={getAirlineLogo(leg.airlineCode)!} alt="" className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                              <div><p className="font-bold">{leg.flightNumber}</p><p className="text-[10px] text-muted-foreground">{leg.aircraft || ""}</p></div>
                            </div>
                          </td>
                          <td className="px-4 py-3"><p className="font-bold">{leg.origin} {fmtTime(leg.departureTime)}</p><p className="text-[10px] text-muted-foreground">{fmtDate(leg.departureTime)}</p>{leg.originTerminal && <p className="text-[10px] text-muted-foreground">Terminal {leg.originTerminal}</p>}</td>
                          <td className="px-4 py-3"><p className="font-bold">{leg.destination} {fmtTime(leg.arrivalTime)}</p><p className="text-[10px] text-muted-foreground">{fmtDate(leg.arrivalTime)}</p>{leg.destinationTerminal && <p className="text-[10px] text-muted-foreground">Terminal {leg.destinationTerminal}</p>}</td>
                          <td className="px-4 py-3 font-medium">{leg.duration || `${leg.durationMinutes}m`}</td>
                          <td className="px-4 py-3 font-medium">{booking.baggage}</td>
                        </tr>
                      )) : (
                        <tr className="border-b border-border/50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {logo && <img src={logo} alt="" className="w-5 h-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                              <div><p className="font-bold">{booking.flightNumber}</p><p className="text-[10px] text-muted-foreground">{booking.aircraft}</p></div>
                            </div>
                          </td>
                          <td className="px-4 py-3"><p className="font-bold">{booking.origin} {fmtTime(booking.departureTime)}</p><p className="text-[10px] text-muted-foreground">{fmtDate(booking.departureTime)}</p></td>
                          <td className="px-4 py-3"><p className="font-bold">{booking.destination} {fmtTime(booking.arrivalTime)}</p><p className="text-[10px] text-muted-foreground">{fmtDate(booking.arrivalTime)}</p></td>
                          <td className="px-4 py-3 font-medium">{booking.duration}</td>
                          <td className="px-4 py-3 font-medium">{booking.baggage}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Luggage className="w-3.5 h-3.5" /> {booking.baggage} checked</span>
                <span>Cabin: {booking.cabinClass}</span>
                {booking.refundable && <span className="flex items-center gap-1 text-accent"><Shield className="w-3.5 h-3.5" /> Refundable</span>}
                <span>{booking.stops === 0 ? "Non-stop" : `${booking.stops} stop(s)`}</span>
                <Separator orientation="vertical" className="h-4" />
                <FlightStatusBadge
                  airlineCode={booking.airlineCode}
                  flightNumber={booking.flightNumber}
                  date={(booking.departureTime || "").substring(0, 10)}
                  compact
                />
                <FareRulesModal
                  origin={booking.origin}
                  destination={booking.destination}
                  departureDate={(booking.departureTime || "").substring(0, 10)}
                  airlineCode={booking.airlineCode}
                  flightNumber={booking.flightNumber}
                />
              </div>

              {booking.isRoundTrip && booking.returnFlight && (
                <>
                  <Separator />
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30 text-sm font-bold shadow-sm">
                    <Plane className="w-4 h-4 rotate-180" />
                    <span>Return: {booking.returnFlight.origin} → {booking.returnFlight.destination}</span>
                    <span className="flight-date text-xs ml-1">· {fmtDate(booking.returnFlight.departureTime)}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className="bg-warning/80 px-4 py-2"><p className="text-xs font-bold text-warning-foreground uppercase">Departure</p></div>
                      <div className="p-4"><div className="flex items-center justify-between"><span className="text-3xl font-black">{booking.returnFlight.origin}</span><span className="text-2xl font-black">{fmtTime(booking.returnFlight.departureTime)}</span></div><p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.departureTime)}</p></div>
                    </div>
                    <div className="border border-border rounded-xl overflow-hidden">
                      <div className="bg-warning/80 px-4 py-2"><p className="text-xs font-bold text-warning-foreground uppercase">Arrival</p></div>
                      <div className="p-4"><div className="flex items-center justify-between"><span className="text-3xl font-black">{booking.returnFlight.destination}</span><span className="text-2xl font-black">{fmtTime(booking.returnFlight.arrivalTime)}</span></div><p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.arrivalTime)}</p></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Fare Breakdown Tab */}
          {activeTab === "fare" && (
            <div className="space-y-3">
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="bg-muted/30 px-4 py-2 border-b border-border"><p className="text-xs font-bold uppercase text-muted-foreground">Customer Fare Breakdown</p></div>
                <div className="p-4 space-y-2 text-sm">
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Base Fare</span><span className="font-semibold">৳{(booking.baseFare || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Taxes & Fees</span><span className="font-semibold">৳{(booking.taxes || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">Service Charge</span><span className="font-semibold">৳{(booking.serviceCharge || 0).toLocaleString()}</span></div>
                  {booking.addOns?.total > 0 && <div className="flex justify-between py-1"><span className="text-muted-foreground">Add-ons</span><span className="font-semibold">৳{booking.addOns.total.toLocaleString()}</span></div>}
                  <Separator />
                  <div className="flex justify-between text-base font-bold pt-1"><span>Total Payable</span><span className="text-accent">{booking.amount}</span></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/30 rounded-lg"><p className="text-[10px] uppercase text-muted-foreground font-medium">Payment Method</p><p className="text-sm font-medium capitalize">{booking.paymentMethod}</p></div>
                <div className="p-3 bg-muted/30 rounded-lg"><p className="text-[10px] uppercase text-muted-foreground font-medium">Payment Status</p><p className="text-sm font-medium capitalize">{booking.paymentStatus}</p></div>
              </div>
            </div>
          )}

          {/* Passengers Tab */}
          {activeTab === "passengers" && (
            <div className="space-y-3">
              {booking.passengers?.length > 0 ? booking.passengers.map((p: any, i: number) => (
                <div key={i} className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-accent/5 px-4 py-2 border-b border-border/50 flex items-center gap-2">
                    <Users className="w-4 h-4 text-accent" />
                    <span className="text-sm font-bold">{p.title} {p.firstName} {p.lastName}</span>
                    {i === 0 && <Badge className="bg-accent/10 text-accent border-0 text-[9px] ml-auto">Primary</Badge>}
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {(p.dob || p.dateOfBirth) && <div><span className="text-muted-foreground">Date of Birth</span><p className="font-medium">{p.dob || p.dateOfBirth}</p></div>}
                    {p.nationality && <div><span className="text-muted-foreground">Nationality</span><p className="font-medium">{p.nationality}</p></div>}
                    {(p.passport || p.passportNumber) && <div><span className="text-muted-foreground">Document No.</span><p className="font-medium font-mono">{p.passport || p.passportNumber}</p></div>}
                    {p.passportExpiry && <div><span className="text-muted-foreground">Expiry Date</span><p className="font-medium">{p.passportExpiry}</p></div>}
                    {p.email && <div><span className="text-muted-foreground">Email</span><p className="font-medium">{p.email}</p></div>}
                    {p.phone && <div><span className="text-muted-foreground">Phone</span><p className="font-medium">{p.phone}</p></div>}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-6">No passenger info available</p>
              )}
            </div>
          )}

          {/* Manage Booking Tab */}
          {activeTab === "manage" && (
            <div className="space-y-4">
              <div className="border border-border rounded-xl p-4">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Flight Status</p>
                <FlightStatusBadge
                  airlineCode={booking.airlineCode}
                  flightNumber={booking.flightNumber}
                  date={(booking.departureTime || "").substring(0, 10)}
                />
              </div>
              <div className="border border-border rounded-xl p-4">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Fare Rules & Conditions</p>
                <FareRulesModal
                  origin={booking.origin}
                  destination={booking.destination}
                  departureDate={(booking.departureTime || "").substring(0, 10)}
                  airlineCode={booking.airlineCode}
                  flightNumber={booking.flightNumber}
                  trigger={
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      <FileText className="w-3.5 h-3.5" /> View Fare Rules
                    </Button>
                  }
                />
              </div>
              <Separator />
              <div className="border border-border rounded-xl p-4">
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Booking Actions</p>
                <BookingActions
                  booking={booking}
                  isAdmin={false}
                  onActionComplete={() => refetch()}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <Separator />
          <div className="flex flex-wrap gap-3">
            {(booking.status === "on_hold") && (
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-bold" onClick={handlePayNow}>
                <CreditCard className="w-4 h-4 mr-1.5" /> {!booking.isDomestic ? "Upload Docs & Pay" : "Pay Now"}
              </Button>
            )}
            <Button variant="outline" onClick={handleDownloadTicket}>
              <Download className="w-4 h-4 mr-1.5" /> Download E-Ticket
            </Button>
            {booking.pnr !== "—" && booking.type === "flight" && (
              <Button variant="outline" onClick={() => navigate(`/dashboard/bookings/${booking.rawId}/extras`)}>
                <Package className="w-4 h-4 mr-1.5" /> Buy Extras
              </Button>
            )}
            {/* Cancel Booking — available for on_hold, confirmed, ticketed */}
            {["on_hold", "confirmed", "ticketed", "pending"].includes(booking.status) && (
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setCancelOpen(true)}>
                <Ban className="w-4 h-4 mr-1.5" /> Cancel Booking
              </Button>
            )}
          </div>

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
                      This will attempt to cancel {booking.airlinePnr ? `PNR ${booking.airlinePnr}` : `Booking ${booking.gdsBookingId || booking.pnr}`} in the airline system. Cancellation fees may apply.
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
