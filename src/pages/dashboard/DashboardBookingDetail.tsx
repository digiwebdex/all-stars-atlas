import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plane, ArrowLeft, Copy, Download, CreditCard, Luggage, Shield,
  Users, Package, XCircle, AlertTriangle, Ban,
  FileText, Wallet, Clock, Eye, ChevronUp, ChevronDown, RefreshCw,
  CheckCircle, Utensils, Armchair, Accessibility, Baby, Ticket,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";

/* ── helpers ─────────────────────────────────────────── */
const BD_AIRPORTS = ["DAC", "CXB", "CGP", "ZYL", "JSR", "RJH", "SPD", "BZL", "IRD", "TKR"];
function fmtTime(dt?: string) { return dt ? formatApiTime(dt, { withGMT: true }) : "—"; }
function fmtDate(dt?: string) { return dt ? formatApiDate(dt, { year: "numeric" }) : "—"; }
function fmtDateTime(dt?: string) {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function airlineLogo(code?: string) { return code ? `https://images.kiwi.com/airlines/64/${code}.png` : null; }
function parseAmt(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : undefined; }
  return undefined;
}
function pickAmt(...vs: any[]) { for (const v of vs) { const p = parseAmt(v); if (p !== undefined) return p; } return undefined; }
function airportName(code: string) { const a = AIRPORTS.find(x => x.code === code?.toUpperCase()); return a ? a.name : code; }

function mapBooking(b: any) {
  const d = b.details || {}, o = d.outbound || {}, pax = b.passengerInfo || [];
  const origin = o.origin || d.origin || "", dest = o.destination || d.destination || "";
  const airline = o.airline || d.airline || "", ac = o.airlineCode || d.airlineCode || "";
  const fn = o.flightNumber || d.flightNumber || "", cabin = o.cabinClass || d.cabinClass || "Economy";
  const aircraft = o.aircraft || o.legs?.[0]?.aircraft || "";
  const depTime = o.departureTime || d.departureTime || "", arrTime = o.arrivalTime || d.arrivalTime || "";
  const dur = o.duration || d.duration || "", stops = o.stops ?? d.stops ?? 0;
  const bag = o.baggage || d.baggage || null, refundable = o.refundable ?? d.refundable ?? false;
  const legs = o.legs || [], ret = d.return || null, rt = !!d.isRoundTrip;
  const src = o.source || d.source || "db";
  const dom = d.isDomestic ?? (BD_AIRPORTS.includes(origin.toUpperCase()) && BD_AIRPORTS.includes(dest.toUpperCase()));
  const rawAmt = pickAmt(b.totalAmount, d.totalAmount, d.total, o.totalAmount, o.price) || 0;
  const fareObj = d.fare || d.fareBreakdown || d.pricing || o.fare || {};
  const paxFares = d.paxFares || d.passengerFares || fareObj.passengerFares || [];
  const firstPaxFare = Array.isArray(paxFares) && paxFares.length > 0 ? paxFares[0] : {};
  const rawBase = pickAmt(d.baseFare, d.base_fare, fareObj.baseFare, firstPaxFare.baseFare, o.baseFare, b.baseFare, d.fareDetails?.baseFare);
  const rawTax = pickAmt(d.taxes, d.tax, d.taxesAndFees, fareObj.taxes, firstPaxFare.tax, firstPaxFare.taxes, o.taxes, b.taxes, d.fareDetails?.taxes);
  const svc = pickAmt(d.serviceCharge, d.service_charge, d.serviceFee, o.serviceCharge, b.serviceCharge, fareObj.serviceFee) || 0;
  let base = rawBase || 0; const tax = rawTax || 0;
  if (base <= 0 && rawAmt > 0) { const k = tax + svc; base = k > 0 ? Math.max(0, rawAmt - k) : rawAmt; }
  const discount = pickAmt(d.discount, o.discount, fareObj.discount) || 0;
  const ait = pickAmt(d.ait, d.aitVat, fareObj.aitVat) || 0;
  const passengerTicketNo = Array.isArray(pax) ? (pax.find((p: any) => p?.ticketNumber || p?.ticketNo)?.ticketNumber || pax.find((p: any) => p?.ticketNumber || p?.ticketNo)?.ticketNo) : null;
  const resolvedTicketNo = b.ticketNo || b.ticket_number || d.ticketNumber || d.ticket_number || d.ticketNo || d.gdsBookingResult?.ticketNumbers?.[0] || d.gdsResult?.ticketNumbers?.[0] || o.ticketNumber || o.ticket_number || ret?.ticketNumber || ret?.ticket_number || passengerTicketNo || "—";
  return {
    id: b.bookingRef || b.id, rawId: b.id, type: b.bookingType || "flight", status: b.status || "pending",
    amount: `৳${rawAmt.toLocaleString()}`, rawAmount: rawAmt,
    date: b.bookedAt ? new Date(b.bookedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—",
    bookedAt: b.bookedAt || b.created_at || "",
    pnr: b.pnr || d.gdsPnr || "—", gdsPnr: d.gdsPnr || b.pnr || null,
    airlinePnr: d.airlinePnr || null, gdsBookingId: b.pnr || d.gdsPnr || null,
    pax: pax.length || 1, paxNames: pax.map((p: any) => `${p.firstName||""} ${p.lastName||""}`.trim()).filter(Boolean),
    ticketNo: resolvedTicketNo, paymentMethod: b.paymentMethod || "—", paymentStatus: b.paymentStatus || "—",
    paymentDeadline: b.paymentDeadline || null,
    airline, airlineCode: ac, flightNumber: fn, cabinClass: cabin, aircraft, departureTime: depTime, arrivalTime: arrTime,
    duration: dur, stops, baggage: bag, refundable, legs, returnFlight: ret, isRoundTrip: rt, source: src,
    origin, destination: dest, details: d, passengers: pax, contactInfo: b.contactInfo || {}, addOns: d.addOns || {},
    baseFare: base, taxes: tax, serviceCharge: svc, discount, ait, isDomestic: dom,
  };
}

function useCountdown(deadline: string | null) {
  const [tl, setTl] = useState("");
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setTl("Expired"); return; }
      const dd = Math.floor(diff / 86400000), hh = Math.floor((diff % 86400000) / 3600000);
      const mm = Math.floor((diff % 3600000) / 60000), ss = Math.floor((diff % 60000) / 1000);
      setTl(`${dd} day(s), ${hh} hour(s), ${mm} minute(s), and ${ss} second(s).`);
    };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [deadline]);
  return tl;
}

/* ── Collapsible Section ─────────────────────────────── */
const Section = ({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button className="w-full px-5 py-3.5 flex items-center justify-between bg-card hover:bg-muted/30 transition-colors" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-bold">{title}</h3>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
};

/* ── Main Component ──────────────────────────────────── */
const DashboardBookingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [docVerifyOpen, setDocVerifyOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidLoading, setVoidLoading] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [ssrOpen, setSsrOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [hasIssuedWithBalance, setHasIssuedWithBalance] = useState(false);

  const { data, isLoading, error, refetch } = useDashboardBookings({ search: id, limit: 1 });
  const resolved = (data as any) || {};
  const rawBookings = resolved?.data || resolved?.bookings || [];
  const booking = rawBookings.length > 0 ? mapBooking(rawBookings[0]) : null;
  const countdown = useCountdown(booking?.paymentDeadline || null);

  // Fetch ticket issue request for this booking to get admin-entered ticket number
  const { data: issueRequestData } = useQuery({
    queryKey: ["dashboard", "ticket-issue-request", booking?.rawId],
    queryFn: () => api.get<any>("/dashboard/ticket-issue-requests"),
    enabled: !!booking,
  });
  const bookingRequests = ((issueRequestData as any)?.data || []).filter(
    (r: any) => r.booking_id === booking?.rawId || r.bookingId === booking?.rawId
  );
  const sortedBookingRequests = [...bookingRequests].sort((a: any, b: any) => {
    const aTime = new Date(a?.updated_at || a?.processed_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.updated_at || b?.processed_at || b?.created_at || 0).getTime();
    return bTime - aTime;
  });
  const latestIssuedRequest = sortedBookingRequests.find((r: any) => {
    const status = String(r?.status || '').toLowerCase();
    return status === 'issued' || !!(r?.ticket_number || r?.ticketNumber);
  });
  const latestActiveIssueRequest = sortedBookingRequests.find((r: any) => ['pending', 'processing'].includes(String(r?.status || '').toLowerCase()));
  const issuedTicketNo = latestIssuedRequest?.ticket_number || latestIssuedRequest?.ticketNumber || null;
  const effectiveTicketNo = [booking?.ticketNo, issuedTicketNo].find((value) => value && value !== '—') || null;
  const hasFinalTicket = !!effectiveTicketNo;
  const isTicketed = booking?.status === 'ticketed' || String(latestIssuedRequest?.status || '').toLowerCase() === 'issued';
  const hasActiveIssueRequest = !hasFinalTicket && (
    booking?.status === 'processing' ||
    ['pending', 'processing'].includes(String(latestActiveIssueRequest?.status || '').toLowerCase())
  );

  useEffect(() => {
    setHasIssuedWithBalance(hasActiveIssueRequest);
  }, [hasActiveIssueRequest]);

  const { data: walletData } = useQuery({
    queryKey: ["dashboard", "wallet", "detail"],
    queryFn: () => api.get<any>("/dashboard/wallet"),
    enabled: payDialogOpen || hasIssuedWithBalance,
  });
  const walletBalance = Number((walletData as any)?.balance ?? 0);

  // SSR history for this booking
  const { data: ssrData, isLoading: ssrLoading } = useQuery({
    queryKey: ["dashboard", "ssr-history", booking?.id],
    queryFn: () => api.get<any>("/dashboard/ssr-history", { search: booking?.id || booking?.pnr }),
    enabled: ssrOpen && !!booking,
  });

  // Build SSR list: merge API + extracted from booking details JSON
  const apiSSRList = (ssrData as any)?.data || (ssrData as any)?.ssrHistory || [];
  const extractedSSRs = (() => {
    if (!booking) return [];
    const items: any[] = [];
    const d = booking.details || {};
    const pax = booking.passengers || [];
    const rawObj = rawBookings[0] || {};
    const rd = rawObj.details || {};

    // 1. specialServices / ssrs / addOns arrays
    [d.specialServices, d.ssrs, d.addOns?.services, d.addOns?.ssrs, rd.specialServices, rd.ssrs]
      .filter(Array.isArray).forEach((arr: any[]) => {
        arr.forEach((s: any) => {
          items.push({
            ssrType: s.type || s.ssrType || s.code || s.ssrCode || "service",
            passengerName: s.passengerName || s.passenger || s.paxName || (pax[0] ? `${pax[0]?.firstName || ""} ${pax[0]?.lastName || ""}`.trim() : "All"),
            details: s.details || s.description || s.text || s.freeText || s.code || "—",
            status: s.status || "confirmed",
          });
        });
      });

    // 2. Per-passenger SSRs
    pax.forEach((p: any) => {
      const name = `${p.title || ""} ${p.firstName || ""} ${p.lastName || ""}`.trim();
      if (p.meal || p.mealPreference) items.push({ ssrType: "meal", passengerName: name, details: p.meal || p.mealPreference, status: "confirmed" });
      if (p.seatPreference || p.seat) items.push({ ssrType: "seat", passengerName: name, details: p.seatPreference || p.seat, status: "confirmed" });
      if (p.wheelchair || p.wheelchairRequired) items.push({ ssrType: "wheelchair", passengerName: name, details: typeof p.wheelchair === "string" ? p.wheelchair : "Wheelchair requested", status: "confirmed" });
      if (p.frequentFlyer || p.ffNumber) items.push({ ssrType: "frequent_flyer", passengerName: name, details: `${p.ffAirline || ""} ${p.frequentFlyer || p.ffNumber || ""}`.trim(), status: "confirmed" });
      if (p.passport || p.passportNumber) items.push({ ssrType: "docs", passengerName: name, details: `Passport: ${p.passport || p.passportNumber}${p.passportExpiry ? ` Exp: ${p.passportExpiry}` : ""}${p.nationality ? ` (${p.nationality})` : ""}`, status: "confirmed" });
    });

    // 3. Contact SSRs
    const ct = booking.contactInfo || d.contactInfo || {};
    const primaryName = pax[0] ? `${pax[0]?.firstName || ""} ${pax[0]?.lastName || ""}`.trim() : "Primary";
    if (ct.phone || ct.mobile) items.push({ ssrType: "contact", passengerName: primaryName, details: `Phone: ${ct.phone || ct.mobile}`, status: "confirmed" });
    if (ct.email) items.push({ ssrType: "contact", passengerName: primaryName, details: `Email: ${ct.email}`, status: "confirmed" });

    // 4. Baggage
    if (booking.baggage) items.push({ ssrType: "baggage", passengerName: "All Passengers", details: typeof booking.baggage === "string" ? booking.baggage : `${booking.baggage}KG`, status: "confirmed" });
    if (d.addOns?.extraBaggage) items.push({ ssrType: "baggage", passengerName: "All Passengers", details: `Extra: ${d.addOns.extraBaggage}`, status: "confirmed" });

    // 5. Cabin class
    if (booking.cabinClass) items.push({ ssrType: "cabin", passengerName: "All Passengers", details: booking.cabinClass, status: "confirmed" });

    // 6. Time limit
    if (booking.paymentDeadline) items.push({ ssrType: "time_limit", passengerName: "Booking", details: `Last ticketing: ${fmtDateTime(booking.paymentDeadline)}`, status: booking.status === "on_hold" ? "pending" : "confirmed" });

    return items;
  })();
  const ssrList = [...apiSSRList, ...extractedSSRs];

  // Timeline from bookings for this booking
  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ["dashboard", "bookings", "timeline-detail", booking?.rawId],
    queryFn: () => api.get<any>("/dashboard/bookings", { search: booking?.id, limit: 1 }),
    enabled: timelineOpen && !!booking,
  });

  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast({ title: "Copied", description: `${label} copied` }); };

  const handleCancel = async () => {
    if (!booking) return; setCancelLoading(true);
    try {
      await api.post(`/flights/cancel`, { bookingId: booking.rawId, reason: cancelReason });
      toast({ title: "Cancelled", description: `${booking.id} cancelled.` }); setCancelOpen(false); refetch();
    } catch (e: any) { toast({ title: "Failed", description: e.gdsError || e.message || "Error", variant: "destructive" }); }
    finally { setCancelLoading(false); }
  };

  const handleVoid = async () => {
    if (!booking) return; setVoidLoading(true);
    try {
      await api.post(`/flights/void`, { pnr: booking.pnr !== "—" ? booking.pnr : undefined, bookingId: booking.rawId });
      toast({ title: "Void Requested", description: "Sent to admin." }); setVoidOpen(false); refetch();
    } catch (e: any) { toast({ title: "Failed", description: e.message || "Error", variant: "destructive" }); }
    finally { setVoidLoading(false); }
  };

  const handlePayWithBalance = async () => {
    if (!booking || hasIssuedWithBalance) return;
    const amount = booking.rawAmount;
    if (walletBalance < amount) {
      toast({ title: "Insufficient Balance", description: `You need ৳${amount.toLocaleString()} but only have ৳${walletBalance.toLocaleString()}`, variant: "destructive" });
      return;
    }
    setPayLoading(true);
    try {
      await api.post("/dashboard/wallet/pay", { bookingId: booking.rawId, amount });
      setHasIssuedWithBalance(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "wallet", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      await refetch();
      toast({ title: "Payment Successful ✓", description: "Wallet debited. Ticket issue request sent to admin." });
      setPayDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Payment Failed", description: e.message || "Could not process payment", variant: "destructive" });
    } finally {
      setPayLoading(false);
    }
  };


  const handleDownload = async () => {
    if (!booking) return;
    try {
      const getCity = (c: string) => { const a = AIRPORTS.find(x => x.code === c?.toUpperCase()); return a ? `${a.city}, ${a.country}` : ""; };
      const seg = (f: any) => ({
        airline: f?.airline || "Seven Trip", airlineCode: f?.airlineCode || "", flightNumber: f?.flightNumber || "",
        origin: f?.origin || "", originCity: f?.originCity || getCity(f?.origin),
        destination: f?.destination || "", destinationCity: f?.destinationCity || getCity(f?.destination),
        departureTime: f?.departureTime || "", arrivalTime: f?.arrivalTime || "", duration: f?.duration || "",
        cabinClass: f?.cabinClass || "Economy", aircraft: f?.aircraft || "",
        terminal: f?.terminal || "", arrivalTerminal: f?.arrivalTerminal || "",
        baggage: f?.baggage || "20Kg", status: "Confirmed", meal: f?.meal || "Meals",
        distance: f?.distance || null, emission: f?.emission || null,
      });
      const ob = booking.details?.outbound, rt = booking.returnFlight || booking.details?.return;
      await generateTicketPDF({
        id: booking.id, pnr: booking.pnr !== "—" ? booking.pnr : undefined,
        gdsPnr: booking.gdsBookingId || undefined, airlinePnr: booking.airlinePnr || undefined,
        bookingRef: booking.id, source: booking.source,
        ticketNo: effectiveTicketNo || undefined,
        airline: booking.airline || "Seven Trip", flightNo: booking.flightNumber || "",
        from: booking.origin, to: booking.destination,
        date: booking.departureTime || booking.date, time: booking.departureTime || "",
        passenger: booking.paxNames?.[0] || "Traveller", seat: "—", class: booking.cabinClass,
        isRoundTrip: booking.isRoundTrip,
        outbound: ob ? [seg(ob)] : [], returnSegments: rt ? [seg(rt)] : [],
        passengers: booking.passengers?.map((p: any) => ({ title: p.title || "", firstName: p.firstName || "", lastName: p.lastName || "", passport: p.passport || "", seat: "", ticketNumber: effectiveTicketNo || "" })) || [],
      });
      toast({ title: "Downloaded", description: "E-Ticket PDF saved" });
    } catch { toast({ title: "Failed", description: "Could not generate PDF.", variant: "destructive" }); }
  };

  /* ── Render ── */
  return (
    <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
      {!booking ? (
        <div className="text-center py-20">
          <Plane className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Booking not found</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard/bookings")}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Bookings</Button>
        </div>
      ) : (
        <div className="space-y-5 max-w-5xl mx-auto">

          {/* ━━ Header Bar ━━ */}
          <div className="flex items-center gap-3 bg-primary px-4 py-3 rounded-lg">
            <button onClick={() => navigate("/dashboard/bookings")} className="text-primary-foreground hover:opacity-80"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-lg font-bold text-primary-foreground">Booking Details</h1>
            <button onClick={() => refetch()} className="text-primary-foreground/70 hover:text-primary-foreground"><RefreshCw className="w-4 h-4" /></button>
          </div>

          {/* ━━ Action Buttons ━━ */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Issue With Balance — hide when ticketed or already paid */}
            {!isTicketed && ['on_hold', 'pending'].includes(booking.status) && !hasIssuedWithBalance && String(booking.paymentStatus || '').toLowerCase() !== 'paid' && (
              <Button
                onClick={() => setPayDialogOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-sm"
              >
                <Wallet className="w-4 h-4 mr-1.5" /> Issue With Balance
              </Button>
            )}
            {hasIssuedWithBalance && !isTicketed && !hasFinalTicket && (
              <Badge className="bg-blue-500 text-white text-sm px-4 py-2 font-bold gap-1.5">
                <Clock className="w-4 h-4" /> Issue Request Sent — Awaiting Admin
              </Badge>
            )}
            {(isTicketed || hasFinalTicket) && (
              <Badge className="bg-green-600 text-white text-sm px-4 py-2 font-bold gap-1.5">
                <Ticket className="w-4 h-4" /> {effectiveTicketNo ? `Ticket: ${effectiveTicketNo}` : 'Ticketed'}
              </Badge>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {/* Timeline, View SSR, Cancel — hide when ticketed or issue request sent */}
              {!isTicketed && !hasIssuedWithBalance && (
                <>
                  <Button variant="outline" className="font-semibold border-2 border-foreground/80" onClick={() => setTimelineOpen(true)}><Clock className="w-4 h-4 mr-1.5" /> Timeline</Button>
                  <Button variant="outline" className="font-semibold border-2 border-foreground/80" onClick={() => setSsrOpen(true)}><Eye className="w-4 h-4 mr-1.5" /> View SSR</Button>
                  <Button variant="outline" className="font-semibold border-2 border-destructive text-destructive hover:bg-destructive/10" onClick={() => setCancelOpen(true)}><Ban className="w-4 h-4 mr-1.5" /> Cancel Booking</Button>
                </>
              )}
              <Button className="bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-sm" onClick={handleDownload}><Download className="w-4 h-4 mr-1.5" /> Voucher Download</Button>
            </div>
          </div>

          {/* ━━ Route + Status + Countdown ━━ */}
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight">{booking.origin}-{booking.destination}</h2>
            {(() => {
              const normalizedStatus = String(booking.status || '').toLowerCase();
              const displayStatus = hasFinalTicket
                ? (normalizedStatus === 'ticketed' ? 'ticketed' : normalizedStatus === 'completed' ? 'completed' : normalizedStatus === 'cancelled' ? 'cancelled' : 'confirmed')
                : (hasIssuedWithBalance && ['confirmed', 'on_hold', 'pending', 'processing'].includes(normalizedStatus)) ? 'processing'
                : normalizedStatus;
              const statusLabel = displayStatus === 'on_hold' ? 'Reserved'
                : displayStatus === 'processing' ? 'In Progress'
                : displayStatus === 'ticketed' ? 'Ticketed'
                : displayStatus?.charAt(0).toUpperCase() + displayStatus?.slice(1);
              const statusColor = displayStatus === 'on_hold' ? 'bg-amber-500'
                : displayStatus === 'ticketed' ? 'bg-green-600'
                : displayStatus === 'processing' ? 'bg-blue-500'
                : displayStatus === 'confirmed' ? 'bg-emerald-500'
                : displayStatus === 'cancelled' ? 'bg-red-500' : 'bg-muted';
              return <Badge className={`${statusColor} text-white text-sm px-3 py-1 font-bold`}>{statusLabel}</Badge>;
            })()}
            {booking.paymentDeadline && booking.status === "on_hold" && countdown && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-sm">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
                <span className="text-warning font-medium">The Booking will expire in {countdown}</span>
              </div>
            )}
          </div>

          {booking.status === "on_hold" && (
            <Button variant="ghost" className="inline-flex items-center gap-2 px-3 py-1.5 text-destructive text-sm font-medium hover:bg-destructive/5" onClick={() => setSsrOpen(true)}>
              <AlertTriangle className="w-4 h-4" /> View SSR to check the actual booking time limit
            </Button>
          )}

          {/* ━━ Booking Info Bar ━━ */}
          <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-${effectiveTicketNo ? '8' : '7'} gap-2`}>
            {[
              { label: "Booking Id", value: booking.gdsBookingId || booking.id, copy: true, highlight: true },
              { label: "Booking Created", value: fmtDateTime(booking.bookedAt) },
              { label: "Ticketing Time Limit", value: booking.paymentDeadline ? fmtDateTime(booking.paymentDeadline) : "—" },
              { label: "PNR", value: booking.pnr, copy: booking.pnr !== "—" },
              { label: "Airline PNR", value: booking.airlinePnr || "—", copy: !!booking.airlinePnr },
              { label: "Refundable", value: booking.refundable ? "Yes" : "No", color: booking.refundable ? "text-emerald-600" : "text-destructive" },
              { label: "Total Amount", value: `${booking.rawAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT`, accent: true },
              ...(effectiveTicketNo ? [{ label: "Ticket Number", value: effectiveTicketNo, copy: true, color: "text-green-600 font-bold" }] : []),
            ].map((item, i) => (
              <div key={i} className={`p-3 rounded-lg border ${item.accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
                <p className="text-[10px] uppercase text-muted-foreground font-medium">{item.label}</p>
                <div className="flex items-center gap-1 mt-1">
                  {item.highlight ? (
                    <span className="text-xs font-bold font-mono bg-primary text-primary-foreground px-2 py-0.5 rounded">{item.value}</span>
                  ) : (
                    <span className={`text-xs font-bold font-mono ${item.color || ""} ${item.accent ? "text-primary text-sm" : ""}`}>{item.value}</span>
                  )}
                  {item.copy && <button onClick={() => copy(String(item.value), item.label)} className="shrink-0"><Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" /></button>}
                </div>
              </div>
            ))}
          </div>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
               FLIGHT INFORMATION (no tabs — all inline)
             ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          <Section title="Flight Information">
            {/* Route bar */}
            <div className="px-5 py-3 bg-muted/20 border-b border-border flex flex-wrap items-center gap-3 text-sm font-semibold text-muted-foreground">
              <span>{booking.origin} - {booking.destination}</span>
              <Separator orientation="vertical" className="h-4" />
              <span>{fmtDate(booking.departureTime)}</span>
              <Separator orientation="vertical" className="h-4" />
              <span>{booking.stops === 0 ? "Non Stop" : `${booking.stops} Stop`}</span>
            </div>

            {/* Segments */}
            <div className="divide-y divide-border">
              {(booking.legs.length > 0 ? booking.legs : [{
                airlineCode: booking.airlineCode, airline: booking.airline,
                flightNumber: booking.flightNumber, aircraft: booking.aircraft,
                origin: booking.origin, destination: booking.destination,
                departureTime: booking.departureTime, arrivalTime: booking.arrivalTime,
                duration: booking.duration, originTerminal: null, destinationTerminal: null,
              }]).map((leg: any, i: number, arr: any[]) => (
                <div key={i}>
                  {/* Airline row */}
                  <div className="px-5 py-3 flex flex-wrap items-center gap-3 bg-card">
                    {airlineLogo(leg.airlineCode || booking.airlineCode) && (
                      <img src={airlineLogo(leg.airlineCode || booking.airlineCode)!} alt="" className="w-6 h-6 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                    <span className="font-bold text-primary">{leg.airline || booking.airline}</span>
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-sm text-muted-foreground">{leg.airlineCode || booking.airlineCode} - {leg.flightNumber || booking.flightNumber}</span>
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-sm text-muted-foreground">{leg.aircraft || booking.aircraft || "—"}</span>
                  </div>

                  {/* Departure ←→ Arrival visual */}
                  <div className="px-5 pb-5 pt-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-2xl font-black">{fmtTime(leg.departureTime)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{fmtDate(leg.departureTime)}</p>
                        <p className="text-xs text-muted-foreground">{airportName(leg.origin)}</p>
                        {leg.originTerminal && <p className="text-xs text-muted-foreground">Terminal: {leg.originTerminal}</p>}
                        <p className="text-xs text-muted-foreground">{booking.cabinClass}</p>
                      </div>
                      <div className="flex-1 flex flex-col items-center justify-center pt-3 px-2">
                        <p className="text-[11px] text-muted-foreground mb-2">⏱ {leg.duration || booking.duration}</p>
                        <div className="w-full flex items-center">
                          <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />
                          <div className="flex-1 border-t-2 border-dashed border-muted-foreground/30 relative mx-1">
                            {leg.distance && <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap">📍 {leg.distance}</span>}
                          </div>
                          <Plane className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="text-2xl font-black">{fmtTime(leg.arrivalTime)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{fmtDate(leg.arrivalTime)}</p>
                        <p className="text-xs text-muted-foreground">{airportName(leg.destination)}</p>
                        {leg.destinationTerminal && <p className="text-xs text-muted-foreground">Terminal: {leg.destinationTerminal}</p>}
                        <p className="text-xs text-muted-foreground">{booking.cabinClass}</p>
                      </div>
                    </div>
                  </div>

                  {/* Layover with duration */}
                  {i < arr.length - 1 && (() => {
                    const nextLeg = arr[i + 1];
                    let layoverStr = "";
                    if (leg.arrivalTime && nextLeg.departureTime) {
                      const arrMs = new Date(leg.arrivalTime).getTime();
                      const depMs = new Date(nextLeg.departureTime).getTime();
                      const diffMin = Math.round((depMs - arrMs) / 60000);
                      if (diffMin > 0 && diffMin < 2880) {
                        const h = Math.floor(diffMin / 60);
                        const m = diffMin % 60;
                        layoverStr = h > 0 ? `${h}h ${m > 0 ? `${m}m` : ""}` : `${m}m`;
                      }
                    }
                    const city = AIRPORTS.find(a => a.code === leg.destination?.toUpperCase())?.city || leg.destination;
                    return (
                      <div className="flex items-center justify-center py-3 bg-muted/20 border-t border-dashed border-border">
                        <span className="text-xs text-muted-foreground bg-card px-4 py-1 rounded-full border border-border">
                          Change of plane · Layover in {city}{layoverStr ? ` · ${layoverStr}` : ""}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            {/* Return flight info */}
            {booking.isRoundTrip && booking.returnFlight && (
              <div className="border-t border-border">
                <div className="px-5 py-3 bg-muted/20 border-b border-border flex flex-wrap items-center gap-3 text-sm font-semibold text-muted-foreground">
                  <span>Return: {booking.returnFlight.origin} - {booking.returnFlight.destination}</span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{fmtDate(booking.returnFlight.departureTime)}</span>
                </div>
                <div className="px-5 py-3 flex flex-wrap items-center gap-3 bg-card">
                  {airlineLogo(booking.returnFlight.airlineCode) && <img src={airlineLogo(booking.returnFlight.airlineCode)!} alt="" className="w-6 h-6 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <span className="font-bold text-primary">{booking.returnFlight.airline}</span>
                  <span className="text-sm text-muted-foreground">{booking.returnFlight.airlineCode} - {booking.returnFlight.flightNumber}</span>
                </div>
                <div className="px-5 pb-5 pt-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-2xl font-black">{fmtTime(booking.returnFlight.departureTime)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.departureTime)}</p>
                      <p className="text-xs text-muted-foreground">{airportName(booking.returnFlight.origin)}</p>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center pt-3 px-2">
                      <p className="text-[11px] text-muted-foreground mb-2">⏱ {booking.returnFlight.duration}</p>
                      <div className="w-full flex items-center">
                        <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />
                        <div className="flex-1 border-t-2 border-dashed border-muted-foreground/30 mx-1" />
                        <Plane className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-2xl font-black">{fmtTime(booking.returnFlight.arrivalTime)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{fmtDate(booking.returnFlight.arrivalTime)}</p>
                      <p className="text-xs text-muted-foreground">{airportName(booking.returnFlight.destination)}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ━━ Customer Price Summary ━━ */}
          <Section title="Customer Price Summary">
            <div className="px-5 pt-4 pb-2">
              {/* Reward Points */}
              {booking.details?.rewardPoints > 0 && (
                <div className="flex justify-between items-center text-sm mb-4 text-emerald-600 dark:text-emerald-400">
                  <span className="font-medium">Total Earned Reward Points</span>
                  <span className="font-bold">+ {Math.round(booking.details.rewardPoints).toLocaleString()}</span>
                </div>
              )}

              {/* Pax icons header */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-base font-bold">Customer Price Summary</h4>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1"><Users className="w-4 h-4 text-primary" /> {booking.pax}</span>
                  <span className="flex items-center gap-1"><Baby className="w-4 h-4 text-primary" /> {booking.details?.childCount || 0}</span>
                  <span className="flex items-center gap-1"><Accessibility className="w-4 h-4 text-primary" /> {booking.details?.infantCount || 0}</span>
                </div>
              </div>

              {/* Per-traveller expandable */}
              <div className="border border-border rounded-lg overflow-hidden mb-4">
                <div className="px-4 py-3 bg-muted/30 flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-semibold">Traveller {booking.pax > 0 ? 1 : 0} (Adult)</span>
                </div>
                <div className="px-4 py-2 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Base Price</span>
                    <span className="font-medium">{booking.baseFare.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax fee</span>
                    <span className="font-medium">{booking.taxes.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</span>
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium">{booking.discount > 0 ? `-${booking.discount.toLocaleString('en-BD', { minimumFractionDigits: 2 })}` : "0.00"} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Special Commission</span>
                  <span className="font-medium">{(booking.details?.specialCommission || 0).toLocaleString('en-BD', { minimumFractionDigits: 0 })} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service fee</span>
                  <span className="font-medium">{booking.serviceCharge.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">AIT & VAT</span>
                  <span className="font-medium">{booking.ait.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Extra Baggage Cost</span>
                  <span className="font-medium">{(booking.addOns?.baggage || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Seat Cost</span>
                  <span className="font-medium">{(booking.addOns?.seat || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Meal Cost</span>
                  <span className="font-medium">{(booking.addOns?.meal || 0).toLocaleString()} BDT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Addons</span>
                  <span className="font-medium">{(booking.addOns?.total || 0).toLocaleString()} BDT</span>
                </div>
              </div>

              <Separator className="my-4" />
              <div className="flex justify-between items-center text-base font-bold pb-2">
                <span className="text-primary">Total Payable (incl. All charges)</span>
                <span className="text-primary">{booking.rawAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })} BDT</span>
              </div>
            </div>
          </Section>

          {/* ━━ Passenger Information ━━ */}
          <Section title="Passenger Information">
            <div className="divide-y divide-border">
              {booking.passengers?.length > 0 ? booking.passengers.map((p: any, i: number) => (
                <PassengerCard key={i} p={p} i={i} booking={booking} effectiveTicketNo={effectiveTicketNo} />
              )) : (
                <p className="text-sm text-muted-foreground text-center py-8">No passenger information available</p>
              )}
            </div>
          </Section>

          {/* ━━ Manage Booking ━━ */}
          <Section title="Manage Booking" defaultOpen={false}>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Flight Status</p>
                <FlightStatusBadge airlineCode={booking.airlineCode} flightNumber={booking.flightNumber} date={(booking.departureTime || "").substring(0, 10)} />
              </div>
              <Separator />
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Fare Rules & Conditions</p>
                <FareRulesModal origin={booking.origin} destination={booking.destination} departureDate={(booking.departureTime || "").substring(0, 10)} airlineCode={booking.airlineCode} flightNumber={booking.flightNumber}
                  trigger={<Button variant="outline" size="sm" className="text-xs gap-1"><FileText className="w-3.5 h-3.5" /> View Fare Rules</Button>} />
              </div>
              <Separator />
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-3">Actions</p>
                <div className="flex flex-wrap gap-3">
                  <BookingActions booking={booking} isAdmin={false} onActionComplete={() => refetch()} />
                  {["confirmed", "ticketed"].includes(booking.status) && (
                    <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5" onClick={() => setVoidOpen(true)}>
                      <XCircle className="w-4 h-4" /> Void Request
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* ━━ Bottom Actions ━━ */}
          <div className="flex flex-wrap gap-3 pb-4">
            <Button className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-1.5" /> Download E-Ticket
            </Button>
            {booking.pnr !== "—" && booking.type === "flight" && (
              <Button variant="outline" className="font-bold" onClick={() => navigate(`/dashboard/bookings/${booking.rawId}/extras`)}>
                <Package className="w-4 h-4 mr-1.5" /> Buy Extras
              </Button>
            )}
          </div>

          {/* ━━ Dialogs ━━ */}
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-destructive" /> Cancel Booking</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Cancel <strong>{booking.id}</strong>?</p>
                {(booking.pnr !== "—") && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
                    <p className="font-semibold text-destructive">⚠️ GDS Cancellation</p>
                    <p className="text-xs text-muted-foreground mt-1">This will cancel PNR {booking.airlinePnr || booking.pnr} in the airline system.</p>
                  </div>
                )}
                <Textarea placeholder="Reason (optional)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep</Button>
                <Button variant="destructive" onClick={handleCancel} disabled={cancelLoading}>{cancelLoading ? "Cancelling..." : "Confirm Cancel"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><XCircle className="w-5 h-5 text-destructive" /> Void Request</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Submit void request for <strong>{booking.id}</strong>?</p>
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-warning">Void Policy</p>
                  <p className="text-xs text-muted-foreground mt-1">Must be within 24h of booking. Admin will review.</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">PNR</span><span className="font-mono font-bold">{booking.pnr}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold">{booking.amount}</span></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleVoid} disabled={voidLoading}>{voidLoading ? "Submitting..." : "Submit Void Request"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


          {/* ━━ Timeline Dialog ━━ */}
          <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
            <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Booking Timeline</DialogTitle></DialogHeader>
              {timelineLoading ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Loading timeline...</div>
              ) : (() => {
                const tb = timelineData ? ((timelineData as any)?.data || (timelineData as any)?.bookings || [])[0] : null;
                const events: { date: string; type: string; title: string; desc: string }[] = [];
                if (tb || booking) {
                  const b = tb || rawBookings[0];
                  const ref = b?.booking_ref || b?.bookingRef || booking?.id;
                  events.push({ date: b?.created_at || b?.bookedAt || booking?.bookedAt || "", type: "created", title: "Booking Created", desc: `${ref} created` });
                  if (["confirmed", "ticketed"].includes(b?.status || booking?.status)) {
                    events.push({ date: b?.updated_at || b?.bookedAt || "", type: "confirmed", title: "Booking Confirmed", desc: `${ref} · Payment received` });
                  }
                  if ((b?.status || booking?.status) === "ticketed") {
                    events.push({ date: b?.updated_at || "", type: "ticketed", title: "Ticket Issued", desc: `${ref} · PNR: ${b?.pnr || booking?.pnr || "—"}` });
                  }
                  if ((b?.status || booking?.status) === "cancelled") {
                    events.push({ date: b?.updated_at || "", type: "cancelled", title: "Booking Cancelled", desc: ref });
                  }
                  if ((b?.status || booking?.status) === "on_hold") {
                    events.push({ date: b?.created_at || b?.bookedAt || "", type: "on_hold", title: "On Hold", desc: `${ref} · Awaiting payment` });
                  }
                }
                events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                const eventIconMap: Record<string, any> = { created: Clock, confirmed: CheckCircle, ticketed: FileText, cancelled: XCircle, on_hold: AlertTriangle };
                const eventColorMap: Record<string, string> = {
                  created: "bg-blue-100 text-blue-600 dark:bg-blue-500/20",
                  confirmed: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20",
                  ticketed: "bg-green-100 text-green-600 dark:bg-green-500/20",
                  cancelled: "bg-red-100 text-red-600 dark:bg-red-500/20",
                  on_hold: "bg-amber-100 text-amber-600 dark:bg-amber-500/20",
                };

                return events.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No timeline events</p>
                ) : (
                  <div className="relative">
                    <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                    <div className="space-y-5">
                      {events.map((ev, i) => {
                        const Ic = eventIconMap[ev.type] || Clock;
                        return (
                          <div key={i} className="relative flex items-start gap-4 pl-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${eventColorMap[ev.type] || eventColorMap.created}`}>
                              <Ic className="w-4 h-4" />
                            </div>
                            <div className="flex-1 pt-0.5">
                              <p className="text-sm font-semibold">{ev.title}</p>
                              <p className="text-xs text-muted-foreground">{ev.desc}</p>
                              <p className="text-[11px] text-muted-foreground/70 mt-1">{ev.date ? fmtDateTime(ev.date) : "—"}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>

          {/* ━━ SSR Dialog ━━ */}
          <Dialog open={ssrOpen} onOpenChange={setSsrOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5 text-primary" /> SSR History</DialogTitle></DialogHeader>
              
              {/* Ticketing Time Limit */}
              {booking?.paymentDeadline && (
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${booking.status === "on_hold" ? "border-warning/40 bg-warning/5" : "border-border bg-muted/20"}`}>
                  <Clock className={`w-5 h-5 flex-shrink-0 mt-0.5 ${booking.status === "on_hold" ? "text-warning" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-semibold">Ticketing Time Limit</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Deadline: <span className="font-mono font-bold">{fmtDateTime(booking.paymentDeadline)}</span>
                    </p>
                    {countdown && booking.status === "on_hold" && (
                      <p className="text-xs text-warning font-medium mt-1">Expires in {countdown}</p>
                    )}
                  </div>
                </div>
              )}

              {ssrLoading ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Loading SSR data...</div>
              ) : ssrList.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">No SSR requests found for this booking</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Passenger</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ssrList.map((ssr: any, i: number) => {
                      const ssrIcons: Record<string, any> = { meal: Utensils, seat: Armchair, baggage: Luggage, wheelchair: Accessibility, infant: Baby, docs: FileText, contact: Users, cabin: Plane, time_limit: Clock, frequent_flyer: CreditCard, service: Package };
                      const Ic = ssrIcons[ssr.ssrType?.toLowerCase()] || FileText;
                      const statusCol: Record<string, string> = {
                        confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10",
                        pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10",
                        rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/10",
                      };
                      return (
                        <TableRow key={ssr.id || i}>
                          <TableCell><div className="flex items-center gap-2"><Ic className="w-4 h-4 text-muted-foreground" /><span className="capitalize text-sm">{ssr.ssrType || "N/A"}</span></div></TableCell>
                          <TableCell className="text-sm">{ssr.passengerName || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{ssr.details || ssr.description || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className={statusCol[ssr.status] || ""}>{ssr.status || "unknown"}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </DialogContent>
          </Dialog>

          {/* ━━ Pay With Balance Dialog ━━ */}
          <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-emerald-600" /> Issue With Balance
                </DialogTitle>
              </DialogHeader>
              {booking && (
                <div className="space-y-4">
                  {/* Balance Card */}
                  <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                    <p className="text-xs text-muted-foreground font-medium">Available Wallet Balance</p>
                    <p className="text-2xl font-bold text-foreground">৳{walletBalance.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</p>
                  </div>

                  {/* Booking Info */}
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Booking</span>
                      <span className="font-mono font-bold">{booking.gdsBookingId || booking.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PNR</span>
                      <span className="font-mono font-bold">{booking.pnr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Route</span>
                      <span className="font-semibold">{booking.origin} → {booking.destination}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Booking Amount</span>
                      <span className="font-bold text-base">৳{booking.rawAmount.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">After Payment</span>
                      <span className={`font-bold ${walletBalance >= booking.rawAmount ? 'text-emerald-600' : 'text-destructive'}`}>
                        ৳{(walletBalance - booking.rawAmount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {walletBalance < booking.rawAmount && (
                    <div className="flex items-center gap-2 text-destructive text-sm p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>Insufficient balance. Please <button className="underline font-semibold" onClick={() => { setPayDialogOpen(false); navigate('/dashboard/wallet'); }}>add funds</button> first.</span>
                    </div>
                  )}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPayDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={handlePayWithBalance}
                  disabled={payLoading || hasIssuedWithBalance || walletBalance < (booking?.rawAmount || 0)}
                  className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted"
                >
                  <CheckCircle className="w-4 h-4" />
                  {payLoading ? 'Processing...' : hasIssuedWithBalance ? 'Already Requested' : 'Confirm Payment'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {docVerifyOpen && booking && (
            <TravelDocVerificationModal open={docVerifyOpen} onOpenChange={o => { if (!o) setDocVerifyOpen(false); }}
              onVerified={() => { toast({ title: "Verified ✓" }); setDocVerifyOpen(false); navigate("/dashboard/payments"); }}
              passengers={booking.passengers || []} bookingRef={booking.id} bookingId={booking.rawId} />
          )}
        </div>
      )}
    </DataLoader>
  );
};

/* ── Passenger Card (collapsible) ─────────────────────── */
const PassengerCard = ({ p, i, booking, effectiveTicketNo }: { p: any; i: number; booking: any; effectiveTicketNo?: string | null }) => {
  const [open, setOpen] = useState(true);
  const name = `${p.title || ""} ${p.firstName || ""} ${p.lastName || ""}`.trim().toUpperCase();
  const ticketNo = effectiveTicketNo || (booking.ticketNo !== '—' ? booking.ticketNo : null);
  return (
    <div>
      <button className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold">{name || `Passenger ${i + 1}`}</span>
          {i === 0 && <Badge className="bg-primary/10 text-primary border-0 text-[9px]">Primary</Badge>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Left: Details */}
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <span className="text-muted-foreground">Name</span><span className="font-medium">{name}</span>
                <span className="text-muted-foreground">Pax Type</span><span className="font-medium">{p.type || "Adult"}</span>
                {(p.dob || p.dateOfBirth) && <><span className="text-muted-foreground">Date of Birth</span><span className="font-medium">{p.dob || p.dateOfBirth}</span></>}
                {(p.passport || p.passportNumber) && <><span className="text-muted-foreground">Passport Number</span><span className="font-medium font-mono">{p.passport || p.passportNumber}</span></>}
                {p.passportExpiry && <><span className="text-muted-foreground">Passport Expiry Date</span><span className="font-medium">{p.passportExpiry}</span></>}
                {p.nationality && <><span className="text-muted-foreground">Nationality</span><span className="font-medium">{p.nationality}</span></>}
                {p.email && <><span className="text-muted-foreground">Email</span><span className="font-medium text-xs break-all">{p.email}</span></>}
                {p.phone && <><span className="text-muted-foreground">Phone Number</span><span className="font-medium">{p.phone}</span></>}
                {ticketNo && (
                  <><span className="text-muted-foreground font-semibold">Ticket Number</span><span className="font-bold font-mono text-green-600">{ticketNo}</span></>
                )}
              </div>
            </div>

            {/* Right: Route + Baggage */}
            <div className="border border-border rounded-lg p-3 text-sm">
              <p className="text-xs font-bold text-muted-foreground mb-2">Route: {booking.origin} - {booking.destination}</p>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Cabin Baggage</span><span className="font-medium">7 Kg</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Baggage</span><span className="font-medium">{booking.baggage || "25 kg"}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardBookingDetail;
