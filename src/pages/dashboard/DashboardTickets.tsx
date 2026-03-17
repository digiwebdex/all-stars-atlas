import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Ticket, Download, Plane, Search, Eye, Printer, Calendar, Users, Clock,
  Luggage, Ban, RefreshCw, ArrowLeftRight, Copy, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Info, Shield, FileText, AlertTriangle
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDashboardTickets, useDashboardBookings } from "@/hooks/useApiData";
import DataLoader from "@/components/DataLoader";
import { api } from "@/lib/api";
import { generateTicketPDF, printTicketPDF } from "@/lib/pdf-generator";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  active: "bg-success/10 text-success border-success/20",
  ticketed: "bg-success/10 text-success border-success/20",
  used: "bg-muted text-muted-foreground border-border",
  expired: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  voided: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  refunded: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 border-blue-200 dark:border-blue-500/20",
};

const statusLabel = (s: string) => {
  const map: Record<string, string> = {
    active: "Active", ticketed: "Ticketed", used: "Used", expired: "Expired",
    cancelled: "Cancelled", voided: "Voided", refunded: "Refunded",
  };
  return map[s] || s?.charAt(0).toUpperCase() + s?.slice(1);
};

const fmtDate = (d?: string) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
};
const fmtTime = (d?: string) => {
  if (!d) return "";
  try { return new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; }
};
const fmtDateTime = (d?: string) => {
  if (!d) return "—";
  return `${fmtDate(d)} ${fmtTime(d)}`.trim();
};

const copyText = (text: string, toast: any) => {
  navigator.clipboard.writeText(text);
  toast({ title: "Copied", description: text });
};

const CopyBadge = ({ value, toast }: { value: string; toast: any }) => (
  <button
    onClick={() => copyText(value, toast)}
    className="inline-flex items-center gap-1 font-mono text-sm font-bold hover:text-primary transition-colors"
  >
    {value} <Copy className="w-3 h-3 text-muted-foreground" />
  </button>
);

const DashboardTickets = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [voidDialog, setVoidDialog] = useState<any>(null);
  const [refundDialog, setRefundDialog] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data, isLoading, error, refetch } = useDashboardTickets({ search: search || undefined });
  const { data: bookingsData, isLoading: bookingsLoading } = useDashboardBookings();
  const resolved = (data as any) || {};
  const rawTickets = resolved?.data || resolved?.tickets || [];

  // Fallback: if tickets table is empty, derive ticket-like objects from bookings (including cancelled)
  const allTickets = useMemo(() => {
    if (rawTickets.length > 0) return rawTickets;
    // Build from bookings data
    const bookings = (bookingsData as any)?.data || [];
    if (!bookings.length) return [];
    return bookings
      .filter((b: any) => b.pnr && b.pnr !== '—' && b.pnr.trim().length > 0)
      .map((b: any) => {
        const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details); } catch { return {}; } })() : (b.details || {});
        const paxRaw = typeof b.passengerInfo === 'string' ? (() => { try { let p = JSON.parse(b.passengerInfo); if (typeof p === 'string') p = JSON.parse(p); return Array.isArray(p) ? p : [p]; } catch { return []; } })() : (Array.isArray(b.passengerInfo) ? b.passengerInfo : []);
        const ob = details.outbound || details;
        return {
          id: b.bookingRef || b.id,
          bookingRef: b.bookingRef,
          pnr: b.pnr || details.gdsPnr,
          airlinePnr: details.airlinePnr,
          ticketNo: details.ticketNumber || '',
          status: b.status === 'on_hold' ? 'active' : (b.status || 'active'),
          airline: ob.airline || ob.airlineName || details.airline || '',
          airlineCode: ob.airlineCode || details.airlineCode || '',
          flightNumber: ob.flightNumber || details.flightNumber || '',
          origin: ob.origin || details.origin || '',
          destination: ob.destination || details.destination || '',
          departureTime: ob.departureTime || details.departureTime,
          arrivalTime: ob.arrivalTime || details.arrivalTime,
          duration: ob.duration || details.duration,
          stops: ob.stops ?? details.stops ?? 0,
          cabinClass: ob.cabinClass || details.cabinClass || 'Economy',
          baggage: ob.baggage || details.baggage,
          refundable: details.refundable ?? false,
          issuedAt: b.bookedAt,
          source: details.source || details.provider,
          passengers: paxRaw.map((p: any) => ({
            name: [p.title, p.firstName || p.first_name, p.lastName || p.last_name].filter(Boolean).join(' ') || p.name || '',
            type: p.type || p.travelerType || 'ADT',
          })),
          legs: (details.legs || details.segments || []).map((l: any) => ({
            origin: l.origin || l.departureAirport,
            destination: l.destination || l.arrivalAirport,
            departureTime: l.departureTime || l.departureDateTime,
            arrivalTime: l.arrivalTime || l.arrivalDateTime,
            flightNumber: l.flightNumber || l.flight,
            airline: l.airline || l.airlineName,
            duration: l.duration,
          })),
          baseFare: details.baseFare || details.basePrice,
          taxes: details.taxes || details.taxAmount,
          totalAmount: b.totalAmount || b.rawAmount,
        };
      });
  }, [rawTickets, bookingsData]);

  const filtered = allTickets.filter((t: any) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (t.pnr || "").toLowerCase().includes(q) ||
      (t.ticketNo || "").toLowerCase().includes(q) ||
      (t.bookingRef || "").toLowerCase().includes(q) ||
      (t.airline || "").toLowerCase().includes(q) ||
      (t.passengers || []).some((p: any) => (p.name || "").toLowerCase().includes(q))
    );
  });

  const downloadPDF = async (ticket: any) => {
    try {
      await generateTicketPDF({
        ...ticket,
        gdsPnr: ticket.pnr,
        airlinePnr: ticket.airlinePnr,
        bookingRef: ticket.bookingRef || ticket.id,
        source: ticket.source,
      });
      toast({ title: "Downloaded", description: `E-Ticket PDF saved` });
    } catch (err: any) {
      console.error("PDF generation error:", err);
      toast({ title: "Download Failed", description: "Could not generate PDF. Please try again.", variant: "destructive" });
    }
  };

  const handleVoid = async (ticket: any) => {
    setActionLoading(true);
    try {
      await api.post("/flights/void", {
        pnr: ticket.pnr,
        tickets: ticket.ticketNo ? [ticket.ticketNo] : undefined,
      });
      toast({ title: "Void Successful", description: `Ticket ${ticket.ticketNo || ticket.pnr} has been voided.` });
      setVoidDialog(null);
      refetch();
    } catch (err: any) {
      toast({ title: "Void Failed", description: err?.message || "Could not void the ticket. Please contact support.", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRefundPrice = async (ticket: any) => {
    setActionLoading(true);
    try {
      const res = await api.post("/flights/refund/price", { pnr: ticket.pnr }) as any;
      toast({ title: "Refund Quoted", description: `Estimated refund: ${res?.currency || 'BDT'} ${res?.refundAmount || 'N/A'}. Contact support to finalize.` });
      setRefundDialog(null);
      refetch();
    } catch (err: any) {
      toast({ title: "Refund Request Failed", description: err?.message || "Could not process refund request.", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  // Can void within 24h of issuance and status is active/ticketed
  const canVoid = (t: any) => {
    if (!["active", "ticketed"].includes(t.status)) return false;
    if (!t.issuedAt) return true;
    const hoursSinceIssue = (Date.now() - new Date(t.issuedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceIssue <= 24;
  };

  const canRefund = (t: any) => {
    return ["active", "ticketed"].includes(t.status) && t.refundable !== false;
  };

  const canExchange = (t: any) => {
    return ["active", "ticketed"].includes(t.status);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            E-Tickets <FileText className="w-5 h-5 text-primary" />
          </h1>
          <p className="text-sm text-muted-foreground">View, download, and manage your electronic tickets</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search PNR, ticket, name, airline..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="ticketed">Ticketed</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataLoader isLoading={isLoading && bookingsLoading} error={error} skeleton="table" retry={refetch}>
        <div className="space-y-4">
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Ticket className="w-14 h-14 mx-auto mb-4 opacity-20" />
                <p className="font-semibold text-lg">No tickets found</p>
                <p className="text-sm mt-1">Tickets will appear here once bookings are issued</p>
              </CardContent>
            </Card>
          ) : (
            filtered.map((ticket: any) => {
              const isExpanded = expandedTicket === ticket.id;
              const paxNames = (ticket.passengers || []).map((p: any) => p.name).filter(Boolean);
              const mainPassenger = paxNames[0] || "—";

              return (
                <Card key={ticket.id} className="overflow-hidden hover:shadow-md transition-all border">
                  <CardContent className="p-0">
                    {/* Main ticket row */}
                    <div className="p-4 sm:p-5">
                      {/* Top: airline + status + actions */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Plane className="w-4 h-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-bold truncate block">{ticket.airline || "Airline"}</span>
                            <span className="text-[11px] text-muted-foreground">{ticket.flightNumber || ""}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={cn("text-[10px] font-bold border", statusColors[ticket.status] || "")}>
                            {statusLabel(ticket.status)}
                          </Badge>
                          {ticket.refundable && (
                            <Badge variant="outline" className="text-[10px] text-success border-success/30">Refundable</Badge>
                          )}
                          {!ticket.refundable && ticket.refundable === false && (
                            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Non-Refundable</Badge>
                          )}
                        </div>
                      </div>

                      {/* Route */}
                      <div className="flex items-center gap-3 sm:gap-6 mb-4">
                        <div className="text-center">
                          <p className="text-lg sm:text-xl font-black">{ticket.origin || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtTime(ticket.departureTime)}</p>
                        </div>
                        <div className="flex-1 relative flex flex-col items-center">
                          <div className="w-full h-px bg-border" />
                          <div className="absolute -top-2.5 bg-card px-2">
                            <Plane className="w-3.5 h-3.5 text-primary rotate-90 sm:rotate-0" />
                          </div>
                          {ticket.duration && (
                            <span className="text-[10px] text-muted-foreground mt-1">{ticket.duration}</span>
                          )}
                          {ticket.stops > 0 && (
                            <span className="text-[9px] text-warning font-medium">{ticket.stops} stop{ticket.stops > 1 ? "s" : ""}</span>
                          )}
                        </div>
                        <div className="text-center">
                          <p className="text-lg sm:text-xl font-black">{ticket.destination || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtTime(ticket.arrivalTime)}</p>
                        </div>
                      </div>

                      {/* Key info grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 text-xs border-t border-border pt-3">
                        <div>
                          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Ticket No</p>
                          <p className="font-bold font-mono">{ticket.ticketNo || "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Booking ID</p>
                          <CopyBadge value={ticket.pnr || "—"} toast={toast} />
                        </div>
                        {ticket.airlinePnr && (
                          <div>
                            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Airlines PNR</p>
                            <CopyBadge value={ticket.airlinePnr} toast={toast} />
                          </div>
                        )}
                        <div>
                          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Date</p>
                          <p className="font-semibold">{fmtDate(ticket.departureTime || ticket.issuedAt)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Passenger</p>
                          <p className="font-semibold truncate">{mainPassenger}</p>
                          {paxNames.length > 1 && <p className="text-[10px] text-muted-foreground">+{paxNames.length - 1} more</p>}
                        </div>
                        <div>
                          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Class</p>
                          <p className="font-semibold">{ticket.cabinClass || "Economy"}</p>
                        </div>
                      </div>

                      {/* Action buttons row */}
                      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-border">
                        <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8" onClick={() => setExpandedTicket(isExpanded ? null : ticket.id)}>
                          <Eye className="w-3.5 h-3.5" />
                          {isExpanded ? "Less" : "Details"}
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </Button>
                        <Button size="sm" className="text-xs gap-1.5 h-8 font-bold" onClick={() => downloadPDF(ticket)}>
                          <Download className="w-3.5 h-3.5" /> Download
                        </Button>
                        <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8" onClick={() => printTicketPDF(ticket)}>
                          <Printer className="w-3.5 h-3.5" /> Print
                        </Button>

                        {/* Void */}
                        {canVoid(ticket) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1.5 h-8 text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-500/30 dark:hover:bg-amber-500/10"
                            onClick={() => setVoidDialog(ticket)}
                          >
                            <Ban className="w-3.5 h-3.5" /> Void
                          </Button>
                        )}

                        {/* Refund */}
                        {canRefund(ticket) && !canVoid(ticket) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1.5 h-8 text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-500/30 dark:hover:bg-blue-500/10"
                            onClick={() => setRefundDialog(ticket)}
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Refund
                          </Button>
                        )}

                        {/* Exchange / Date Change */}
                        {canExchange(ticket) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs gap-1.5 h-8 text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-500/30 dark:hover:bg-violet-500/10"
                            onClick={() => toast({ title: "Exchange Request", description: "Please contact support at 09613001005 or support@seventrip.com to request a date change or exchange." })}
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" /> Exchange
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expanded details section */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="border-t border-border bg-muted/30 p-4 sm:p-5">
                            <Tabs defaultValue="itinerary" className="w-full">
                              <TabsList className="w-full justify-start h-9 bg-muted/50 mb-4 overflow-x-auto">
                                <TabsTrigger value="itinerary" className="text-xs">Itinerary</TabsTrigger>
                                <TabsTrigger value="passengers" className="text-xs">Passengers</TabsTrigger>
                                <TabsTrigger value="fare" className="text-xs">Fare</TabsTrigger>
                                <TabsTrigger value="policies" className="text-xs">Policies</TabsTrigger>
                              </TabsList>

                              {/* Itinerary Tab */}
                              <TabsContent value="itinerary" className="space-y-3">
                                {(ticket.legs || []).length > 0 ? ticket.legs.map((leg: any, i: number) => (
                                  <div key={i} className="rounded-lg border border-border bg-card p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                      <Badge variant="outline" className="text-[10px]">Segment {i + 1}</Badge>
                                      <span className="text-xs font-semibold">{leg.airline} {leg.flightNumber}</span>
                                      {leg.aircraft && <span className="text-[10px] text-muted-foreground">• {leg.aircraft}</span>}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="p-3 rounded-lg bg-success/5 border border-success/10">
                                        <p className="text-[10px] font-bold text-success uppercase mb-1">Departure</p>
                                        <p className="text-lg font-black">{leg.origin}</p>
                                        <p className="text-xs text-muted-foreground">{fmtDateTime(leg.departureTime)}</p>
                                        {leg.terminal && <p className="text-[10px] text-muted-foreground">Terminal {leg.terminal}</p>}
                                      </div>
                                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                                        <p className="text-[10px] font-bold text-primary uppercase mb-1">Arrival</p>
                                        <p className="text-lg font-black">{leg.destination}</p>
                                        <p className="text-xs text-muted-foreground">{fmtDateTime(leg.arrivalTime)}</p>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
                                      {leg.duration && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {leg.duration}</span>}
                                      {leg.baggage && <span className="flex items-center gap-1"><Luggage className="w-3 h-3" /> {typeof leg.baggage === "object" ? leg.baggage.weight || JSON.stringify(leg.baggage) : leg.baggage}</span>}
                                    </div>
                                  </div>
                                )) : (
                                  <div className="rounded-lg border border-border bg-card p-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="p-3 rounded-lg bg-success/5 border border-success/10">
                                        <p className="text-[10px] font-bold text-success uppercase mb-1">Departure</p>
                                        <p className="text-lg font-black">{ticket.origin || "—"}</p>
                                        <p className="text-xs text-muted-foreground">{fmtDateTime(ticket.departureTime)}</p>
                                      </div>
                                      <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                                        <p className="text-[10px] font-bold text-primary uppercase mb-1">Arrival</p>
                                        <p className="text-lg font-black">{ticket.destination || "—"}</p>
                                        <p className="text-xs text-muted-foreground">{fmtDateTime(ticket.arrivalTime)}</p>
                                      </div>
                                    </div>
                                    <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
                                      {ticket.duration && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {ticket.duration}</span>}
                                      {ticket.baggage && <span className="flex items-center gap-1"><Luggage className="w-3 h-3" /> {typeof ticket.baggage === "object" ? ticket.baggage.weight || JSON.stringify(ticket.baggage) : ticket.baggage}</span>}
                                      {ticket.aircraft && <span className="flex items-center gap-1"><Plane className="w-3 h-3" /> {ticket.aircraft}</span>}
                                    </div>
                                  </div>
                                )}
                              </TabsContent>

                              {/* Passengers Tab */}
                              <TabsContent value="passengers">
                                <div className="space-y-2">
                                  {(ticket.passengers || []).length > 0 ? ticket.passengers.map((pax: any, i: number) => (
                                    <div key={i} className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                        <Users className="w-3.5 h-3.5 text-primary" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold">{pax.name || "—"}</p>
                                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground mt-0.5">
                                          <span>{pax.type === "ADT" ? "Adult" : pax.type === "CHD" ? "Child" : pax.type === "INF" ? "Infant" : pax.type}</span>
                                          {pax.gender && <span>{pax.gender}</span>}
                                          {pax.dob && <span>DOB: {fmtDate(pax.dob)}</span>}
                                          {pax.passport && <span>Passport: {pax.passport}</span>}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-3 text-xs">
                                        {pax.ticketNo && (
                                          <div>
                                            <p className="text-[10px] text-muted-foreground">Ticket No</p>
                                            <p className="font-mono font-bold">{pax.ticketNo}</p>
                                          </div>
                                        )}
                                        {pax.seatNo && (
                                          <div>
                                            <p className="text-[10px] text-muted-foreground">Seat</p>
                                            <p className="font-bold">{pax.seatNo}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )) : (
                                    <p className="text-sm text-muted-foreground py-4 text-center">No passenger details available</p>
                                  )}
                                </div>
                              </TabsContent>

                              {/* Fare Tab */}
                              <TabsContent value="fare">
                                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                                  {ticket.baseFare != null && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Base Fare</span>
                                      <span className="font-semibold">{ticket.currency || "BDT"} {Number(ticket.baseFare).toLocaleString()}</span>
                                    </div>
                                  )}
                                  {ticket.taxes != null && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Taxes & Fees</span>
                                      <span className="font-semibold">{ticket.currency || "BDT"} {Number(ticket.taxes).toLocaleString()}</span>
                                    </div>
                                  )}
                                  {ticket.serviceCharge > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Service Charge</span>
                                      <span className="font-semibold">{ticket.currency || "BDT"} {Number(ticket.serviceCharge).toLocaleString()}</span>
                                    </div>
                                  )}
                                  {ticket.totalAmount != null && (
                                    <>
                                      <div className="border-t border-border my-2" />
                                      <div className="flex justify-between text-sm font-bold">
                                        <span>Total</span>
                                        <span className="text-primary">{ticket.currency || "BDT"} {Number(ticket.totalAmount).toLocaleString()}</span>
                                      </div>
                                    </>
                                  )}
                                  {ticket.baseFare == null && ticket.totalAmount == null && (
                                    <p className="text-sm text-muted-foreground text-center py-4">Fare details not available</p>
                                  )}
                                </div>
                              </TabsContent>

                              {/* Policies Tab */}
                              <TabsContent value="policies">
                                <div className="space-y-3">
                                  <div className="rounded-lg border border-border bg-card p-4">
                                    <h4 className="text-sm font-bold flex items-center gap-2 mb-3">
                                      <Shield className="w-4 h-4 text-primary" /> Cancellation & Refund
                                    </h4>
                                    {ticket.cancellationPolicy ? (
                                      <div className="space-y-2 text-xs">
                                        {ticket.cancellationPolicy.beforeDeparture != null && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Before Departure Fee</span>
                                            <span className="font-semibold">{ticket.currency || "BDT"} {ticket.cancellationPolicy.beforeDeparture}</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">After Departure</span>
                                          <span className="font-semibold">{ticket.cancellationPolicy.afterDeparture || "Non-refundable"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">No Show</span>
                                          <span className="font-semibold">{ticket.cancellationPolicy.noShow || "Non-refundable"}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        {ticket.refundable ? "This ticket is refundable. Contact support for refund terms." : "This ticket is non-refundable. Cancellation fees may apply as per airline policy."}
                                      </p>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-border bg-card p-4">
                                    <h4 className="text-sm font-bold flex items-center gap-2 mb-3">
                                      <ArrowLeftRight className="w-4 h-4 text-violet-500" /> Date Change / Exchange
                                    </h4>
                                    {ticket.dateChangePolicy ? (
                                      <div className="space-y-2 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Change Allowed</span>
                                          <span className="font-semibold">{ticket.dateChangePolicy.changeAllowed ? "Yes" : "No"}</span>
                                        </div>
                                        {ticket.dateChangePolicy.fee != null && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Change Fee</span>
                                            <span className="font-semibold">{ticket.currency || "BDT"} {ticket.dateChangePolicy.fee}</span>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">Date change availability depends on airline policy. Contact support for assistance.</p>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-border bg-card p-4">
                                    <h4 className="text-sm font-bold flex items-center gap-2 mb-3">
                                      <Ban className="w-4 h-4 text-amber-500" /> Void
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                      Tickets can be voided within 24 hours of issuance at no charge. After 24 hours, cancellation/refund fees may apply.
                                    </p>
                                  </div>
                                </div>
                              </TabsContent>
                            </Tabs>

                            {/* Additional info row */}
                            <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground">
                              {ticket.source && <span>Source: <strong className="text-foreground">{ticket.source}</strong></span>}
                              {ticket.bookingRef && <span>Booking Ref: <strong className="text-foreground">{ticket.bookingRef}</strong></span>}
                              {ticket.issuedAt && <span>Issued: <strong className="text-foreground">{fmtDateTime(ticket.issuedAt)}</strong></span>}
                              {ticket.baggage && <span className="flex items-center gap-1"><Luggage className="w-3 h-3" /> {typeof ticket.baggage === "object" ? ticket.baggage.weight || JSON.stringify(ticket.baggage) : ticket.baggage}</span>}
                              {ticket.handBaggage && <span>Hand: {typeof ticket.handBaggage === "object" ? ticket.handBaggage.weight || JSON.stringify(ticket.handBaggage) : ticket.handBaggage}</span>}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </DataLoader>

      {/* Void Confirmation Dialog */}
      <Dialog open={!!voidDialog} onOpenChange={(open) => !open && setVoidDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Void Ticket
            </DialogTitle>
            <DialogDescription>
              This will void the ticket and cancel the reservation. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {voidDialog && (
            <div className="space-y-3 py-3">
              <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                <p><strong>PNR:</strong> {voidDialog.pnr}</p>
                <p><strong>Ticket:</strong> {voidDialog.ticketNo || "N/A"}</p>
                <p><strong>Route:</strong> {voidDialog.origin} → {voidDialog.destination}</p>
                <p><strong>Passenger:</strong> {(voidDialog.passengers || []).map((p: any) => p.name).join(", ") || "—"}</p>
              </div>
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 p-3 rounded-lg">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>Void is available within 24 hours of ticket issuance at no charge. After this window, standard cancellation fees apply.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialog(null)} disabled={actionLoading}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => voidDialog && handleVoid(voidDialog)}
              disabled={actionLoading}
              className="gap-1.5"
            >
              {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Confirm Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={!!refundDialog} onOpenChange={(open) => !open && setRefundDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-500" /> Request Refund
            </DialogTitle>
            <DialogDescription>
              Submit a refund request for this ticket. We'll calculate the refund amount based on airline policy.
            </DialogDescription>
          </DialogHeader>
          {refundDialog && (
            <div className="space-y-3 py-3">
              <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                <p><strong>PNR:</strong> {refundDialog.pnr}</p>
                <p><strong>Ticket:</strong> {refundDialog.ticketNo || "N/A"}</p>
                <p><strong>Route:</strong> {refundDialog.origin} → {refundDialog.destination}</p>
                <p><strong>Amount Paid:</strong> {refundDialog.currency || "BDT"} {Number(refundDialog.totalAmount || 0).toLocaleString()}</p>
              </div>
              {refundDialog.cancellationPolicy?.beforeDeparture != null && (
                <div className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 p-3 rounded-lg">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>Estimated cancellation fee: {refundDialog.currency || "BDT"} {refundDialog.cancellationPolicy.beforeDeparture}. Final amount may vary.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialog(null)} disabled={actionLoading}>Cancel</Button>
            <Button
              onClick={() => refundDialog && handleRefundPrice(refundDialog)}
              disabled={actionLoading}
              className="gap-1.5"
            >
              {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Get Refund Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardTickets;