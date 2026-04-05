import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plane, User, Phone, CreditCard, FileText, AlertTriangle, Save, Shield,
  Send, Ban, Ticket, Loader2, Upload, ExternalLink, XCircle, CheckCircle2,
  RotateCcw, Terminal, Activity, Bug, Building2, Receipt,
} from "lucide-react";
import BookingActions from "@/components/flights/BookingActions";
import FlightStatusBadge from "@/components/flights/FlightStatusBadge";
import FareRulesModal from "@/components/flights/FareRulesModal";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";

const PAYMENT_STATUSES = ["unpaid", "paid", "partial", "refunded", "pending"];
const PAYMENT_METHODS = ["bkash", "nagad", "rocket", "card", "bank_transfer", "pay_later"];

const ALL_STATUSES = [
  { value: "on_hold", label: "Reserved" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "ticketed", label: "Ticketed" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "partially_refunded", label: "Partially Refunded" },
  { value: "failed", label: "Failed" },
  { value: "void", label: "Void" },
  { value: "exchange", label: "Exchange" },
  { value: "no_show", label: "No Show" },
];

interface AdminBookingTabsProps {
  viewBooking: any;
  editMode: boolean;
  editData: any;
  setEditData: (d: any) => void;
  actionLoading: string | null;
  saveEdits: () => void;
  updateBooking: (b: any, updates: Record<string, any>) => void;
  setViewBooking: (b: any) => void;
  setEditMode: (v: boolean) => void;
  setIssueTicketOpen: (v: boolean) => void;
  setCancelFlightOpen: (v: boolean) => void;
  setSendPayLinkOpen: (v: boolean) => void;
  setPayLinkEmail: (v: string) => void;
  safeParsePax: (pi: any) => any[];
  getPassengers: (b: any) => any[];
  refetch: () => void;
  fmtDate: (d: string | null | undefined) => string;
}

const AdminBookingTabs = ({
  viewBooking, editMode, editData, setEditData, actionLoading, saveEdits,
  updateBooking, setViewBooking, setEditMode, setIssueTicketOpen, setCancelFlightOpen,
  setSendPayLinkOpen, setPayLinkEmail, safeParsePax, getPassengers, refetch, fmtDate,
}: AdminBookingTabsProps) => {
  const { toast } = useToast();

  // Terminal state
  const [terminalCmd, setTerminalCmd] = useState("");
  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false);
  const [confirmPnr, setConfirmPnr] = useState("");
  const [confirmTicketNo, setConfirmTicketNo] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<{ command: string; response: string; timestamp: string; success: boolean }[]>([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalHistory]);

  // Auto-load PNR when terminal tab opens
  useEffect(() => {
    if (viewBooking?.pnr && viewBooking.pnr !== "—" && !terminalSessionId) {
      setTerminalSessionId(`${viewBooking.pnr}-${Date.now()}`);
    }
  }, [viewBooking?.pnr, terminalSessionId]);

  const executeCommand = async () => {
    if (!terminalCmd.trim()) return;
    setTerminalLoading(true);
    try {
      const result: any = await api.post("/admin/terminal/execute", { command: terminalCmd.trim() });
      setTerminalHistory(prev => [...prev, {
        command: terminalCmd.trim(),
        response: result.response || "No output",
        timestamp: new Date().toLocaleString(),
        success: result.success !== false,
      }]);
      setTerminalCmd("");
    } catch (err: any) {
      setTerminalHistory(prev => [...prev, {
        command: terminalCmd.trim(),
        response: `Error: ${err.message || "Failed to execute"}`,
        timestamp: new Date().toLocaleString(),
        success: false,
      }]);
    } finally {
      setTerminalLoading(false);
    }
  };

  const closeTerminalSession = async () => {
    try {
      await api.post("/admin/terminal/close", {});
      toast({ title: "Session Closed", description: "GDS terminal session has been closed." });
      setTerminalSessionId(null);
    } catch {
      toast({ title: "Error", description: "Failed to close session", variant: "destructive" });
    }
  };

  // Extract fare breakdown from booking details
  const fareData = viewBooking?.details?.outbound || viewBooking?.details || {};
  const passengers = getPassengers(viewBooking);

  return (
    <Tabs defaultValue="itinerary" className="mt-2">
      <ScrollArea className="w-full">
        <TabsList className="inline-flex w-auto min-w-full">
          <TabsTrigger value="itinerary" className="text-xs">Itinerary</TabsTrigger>
          <TabsTrigger value="passengers" className="text-xs">Passengers</TabsTrigger>
          <TabsTrigger value="fare" className="text-xs">Fare Breakdown</TabsTrigger>
          <TabsTrigger value="invoice" className="text-xs">Invoice</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
          <TabsTrigger value="debug" className="text-xs">Debug</TabsTrigger>
          <TabsTrigger value="supplier" className="text-xs">Supplier</TabsTrigger>
          <TabsTrigger value="terminal" className="text-xs">Terminal</TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">Actions</TabsTrigger>
        </TabsList>
      </ScrollArea>

      {/* ── Itinerary Tab ── */}
      <TabsContent value="itinerary" className="space-y-4 mt-4">
        {/* Departure / Arrival Cards */}
        {fareData.origin && fareData.destination && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-center">
              <p className="text-xs text-muted-foreground font-medium">Departure</p>
              <p className="text-2xl font-black text-primary mt-1">{fareData.origin}</p>
              <p className="text-sm text-muted-foreground mt-1">{fmtDate(fareData.departureTime)}</p>
            </div>
            <div className="rounded-lg bg-accent/10 border border-accent/20 p-4 text-center">
              <p className="text-xs text-muted-foreground font-medium">Arrival</p>
              <p className="text-2xl font-black text-accent mt-1">{fareData.destination}</p>
              <p className="text-sm text-muted-foreground mt-1">{fmtDate(fareData.arrivalTime)}</p>
            </div>
          </div>
        )}

        {/* Booking meta bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Booking ID</p>
            <p className="font-bold font-mono text-xs mt-1">{viewBooking.id}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Airlines PNR</p>
            <p className="font-bold font-mono text-xs mt-1 text-accent">{viewBooking.details?.airlinePnr || "—"}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">GDS PNR</p>
            <p className="font-bold font-mono text-xs mt-1 text-primary">{viewBooking.pnr || "—"}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Booking Class</p>
            <p className="font-bold text-xs mt-1">{fareData.bookingClass || fareData.cabinClass || "—"}</p>
          </div>
        </div>

        {/* Flight Segments */}
        {viewBooking.details?.legs && Array.isArray(viewBooking.details.legs) && viewBooking.details.legs.length > 0 && (
          <>
            <h4 className="text-sm font-bold flex items-center gap-1.5"><Plane className="w-4 h-4" /> Flight Details</h4>
            {viewBooking.details.legs.map((leg: any, i: number) => (
              <div key={i} className="bg-muted/30 rounded-lg p-3 text-sm border">
                <div className="flex items-center gap-2 mb-2">
                  <Plane className="w-4 h-4 text-primary" />
                  <span className="font-bold">{leg.airline || leg.marketingCarrier || ''}</span>
                  <span className="font-mono text-xs text-muted-foreground">{leg.flightNumber}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Departure</p>
                    <p className="font-bold">{leg.origin}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(leg.departureTime)}</p>
                    {leg.originTerminal && <p className="text-xs text-muted-foreground">Terminal {leg.originTerminal}</p>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Arrival</p>
                    <p className="font-bold">{leg.destination}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(leg.arrivalTime)}</p>
                    {leg.destinationTerminal && <p className="text-xs text-muted-foreground">Terminal {leg.destinationTerminal}</p>}
                  </div>
                </div>
                {(leg.duration || leg.aircraft) && (
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    {leg.duration && <span>Duration: {leg.duration}</span>}
                    {leg.aircraft && <span>Aircraft: {leg.aircraft}</span>}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* Booking info */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Service Type</p><Badge variant="outline" className="capitalize">{viewBooking.type}</Badge></div>
          <div><p className="text-xs text-muted-foreground">Booked At</p><p className="font-medium">{fmtDate(viewBooking.bookedAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">Last Updated</p><p className="font-medium">{fmtDate(viewBooking.updatedAt)}</p></div>
          {fareData.baggage && <div><p className="text-xs text-muted-foreground">Baggage</p><p className="font-medium">{fareData.baggage}</p></div>}
        </div>
      </TabsContent>

      {/* ── Passengers Tab (Fare Partner Customer) ── */}
      <TabsContent value="passengers" className="space-y-4 mt-4">
        {passengers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No passenger information available</p>
          </div>
        ) : (
          passengers.map((p: any, i: number) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Passenger {i + 1} {p.type ? `(${p.type})` : ''}</p>
                    <p className="text-xs text-muted-foreground">{p.title || ''} {p.firstName || p.first_name || ''} {p.lastName || p.last_name || ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {(p.firstName || p.first_name) && <div><p className="text-xs text-muted-foreground">First Name</p><p className="font-medium">{p.firstName || p.first_name}</p></div>}
                  {(p.lastName || p.last_name) && <div><p className="text-xs text-muted-foreground">Last Name</p><p className="font-medium">{p.lastName || p.last_name}</p></div>}
                  {p.title && <div><p className="text-xs text-muted-foreground">Title</p><p className="font-medium">{p.title}</p></div>}
                  {p.dob && <div><p className="text-xs text-muted-foreground">Date of Birth</p><p className="font-medium">{p.dob}</p></div>}
                  {p.gender && <div><p className="text-xs text-muted-foreground">Gender</p><p className="font-medium capitalize">{p.gender}</p></div>}
                  {p.nationality && <div><p className="text-xs text-muted-foreground">Nationality</p><p className="font-medium">{p.nationality}</p></div>}
                  {p.passport && <div><p className="text-xs text-muted-foreground">Passport No.</p><p className="font-medium font-mono">{p.passport}</p></div>}
                  {p.passportExpiry && <div><p className="text-xs text-muted-foreground">Passport Expiry</p><p className="font-medium">{p.passportExpiry}</p></div>}
                  {p.documentCountry && <div><p className="text-xs text-muted-foreground">Document Country</p><p className="font-medium">{p.documentCountry}</p></div>}
                  {p.email && <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{p.email}</p></div>}
                  {p.phone && <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{p.phone}</p></div>}
                  {p.frequentFlyer && <div><p className="text-xs text-muted-foreground">Frequent Flyer</p><p className="font-medium font-mono">{p.frequentFlyer}</p></div>}
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* Contact Info */}
        {viewBooking.contactInfo && Object.keys(viewBooking.contactInfo).length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Phone className="w-4 h-4" /> Contact Information</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {viewBooking.contactInfo.email && <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{viewBooking.contactInfo.email}</p></div>}
                {viewBooking.contactInfo.phone && <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{viewBooking.contactInfo.phone}</p></div>}
                {viewBooking.contactInfo.emergencyContact && <div><p className="text-xs text-muted-foreground">Emergency</p><p className="font-medium">{viewBooking.contactInfo.emergencyContact}</p></div>}
                {viewBooking.contactInfo.emergencyPhone && <div><p className="text-xs text-muted-foreground">Emergency Phone</p><p className="font-medium">{viewBooking.contactInfo.emergencyPhone}</p></div>}
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ── Fare Breakdown Tab ── */}
      <TabsContent value="fare" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Total Amount</p>
            <p className="text-xl font-black text-primary mt-1">{viewBooking.amount}</p>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Payment Method</p>
            <p className="font-bold capitalize mt-1">{viewBooking.paymentMethod?.replace(/_/g, ' ') || '—'}</p>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Payment Status</p>
            <Badge variant="outline" className="capitalize mt-1">{viewBooking.paymentStatus}</Badge>
          </div>
        </div>

        {/* Per-passenger fare if available */}
        {fareData.fareBreakdown && Array.isArray(fareData.fareBreakdown) ? (
          <div className="space-y-2">
            <h4 className="text-sm font-bold">Per-Passenger Fare</h4>
            {fareData.fareBreakdown.map((fb: any, i: number) => (
              <div key={i} className="flex justify-between items-center p-3 bg-muted/30 rounded-lg text-sm">
                <div>
                  <p className="font-medium">{fb.passengerType || fb.type || `Passenger ${i + 1}`}</p>
                  <p className="text-xs text-muted-foreground">{fb.count || 1}x</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">৳{(fb.baseFare || fb.amount || 0).toLocaleString()}</p>
                  {fb.tax && <p className="text-xs text-muted-foreground">Tax: ৳{fb.tax.toLocaleString()}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <h4 className="text-sm font-bold">Fare Details</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {fareData.baseFare && <div className="p-3 bg-muted/30 rounded-lg"><p className="text-xs text-muted-foreground">Base Fare</p><p className="font-bold">৳{Number(fareData.baseFare).toLocaleString()}</p></div>}
              {fareData.tax && <div className="p-3 bg-muted/30 rounded-lg"><p className="text-xs text-muted-foreground">Taxes & Fees</p><p className="font-bold">৳{Number(fareData.tax).toLocaleString()}</p></div>}
              {fareData.markup && <div className="p-3 bg-muted/30 rounded-lg"><p className="text-xs text-muted-foreground">Markup</p><p className="font-bold">৳{Number(fareData.markup).toLocaleString()}</p></div>}
              {fareData.discount && <div className="p-3 bg-muted/30 rounded-lg"><p className="text-xs text-muted-foreground">Discount</p><p className="font-bold text-emerald-600">-৳{Number(fareData.discount).toLocaleString()}</p></div>}
            </div>
          </div>
        )}

        {viewBooking.paymentDeadline && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="text-sm"><span className="font-medium">Payment Deadline:</span> {fmtDate(viewBooking.paymentDeadline)}</p>
          </div>
        )}
      </TabsContent>

      {/* ── Invoice Tab ── */}
      <TabsContent value="invoice" className="space-y-4 mt-4">
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-lg font-bold">Invoice</h4>
              <p className="text-xs text-muted-foreground">Booking: {viewBooking.id}</p>
            </div>
            <Badge variant="outline" className="capitalize">{viewBooking.paymentStatus}</Badge>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="font-medium">{viewBooking.customer}</p>
              <p className="text-xs text-muted-foreground">{viewBooking.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">{fmtDate(viewBooking.bookedAt)}</p>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Flight: {viewBooking.route}</span>
              <span className="font-bold">{viewBooking.amount}</span>
            </div>
            {fareData.baseFare && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Base Fare</span>
                <span>৳{Number(fareData.baseFare).toLocaleString()}</span>
              </div>
            )}
            {fareData.tax && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Taxes & Fees</span>
                <span>৳{Number(fareData.tax).toLocaleString()}</span>
              </div>
            )}
          </div>
          <Separator />
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span className="text-primary">{viewBooking.amount}</span>
          </div>
        </div>
      </TabsContent>

      {/* ── Activity Tab ── */}
      <TabsContent value="activity" className="space-y-4 mt-4">
        <h4 className="text-sm font-bold flex items-center gap-1.5"><Activity className="w-4 h-4" /> Activity Timeline</h4>
        <div className="space-y-3">
          {/* Booking created */}
          <div className="flex gap-3">
            <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
            <div>
              <p className="text-sm font-medium">Booking Created</p>
              <p className="text-xs text-muted-foreground">{fmtDate(viewBooking.bookedAt)}</p>
            </div>
          </div>

          {/* PNR assigned */}
          {viewBooking.pnr && viewBooking.pnr !== "—" && (
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />
              <div>
                <p className="text-sm font-medium">PNR Assigned: <span className="font-mono">{viewBooking.pnr}</span></p>
                <p className="text-xs text-muted-foreground">GDS reservation confirmed</p>
              </div>
            </div>
          )}

          {/* Last GDS Action */}
          {viewBooking.details?.lastGdsAction && (
            <div className="flex gap-3">
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${viewBooking.details.lastGdsAction.result?.success ? 'bg-emerald-500' : 'bg-destructive'}`} />
              <div>
                <p className="text-sm font-medium capitalize">GDS: {viewBooking.details.lastGdsAction.action}</p>
                {viewBooking.details.lastGdsAction.result?.ticketNumbers?.length > 0 && (
                  <p className="text-xs font-mono text-emerald-600">Tickets: {viewBooking.details.lastGdsAction.result.ticketNumbers.join(", ")}</p>
                )}
                {viewBooking.details.lastGdsAction.error && (
                  <p className="text-xs text-destructive">{viewBooking.details.lastGdsAction.error}</p>
                )}
                <p className="text-xs text-muted-foreground">{fmtDate(viewBooking.details.lastGdsAction.timestamp)} by {viewBooking.details.lastGdsAction.performedBy}</p>
              </div>
            </div>
          )}

          {/* Last updated */}
          {viewBooking.updatedAt && viewBooking.updatedAt !== viewBooking.bookedAt && (
            <div className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-muted-foreground mt-2 shrink-0" />
              <div>
                <p className="text-sm font-medium">Last Updated</p>
                <p className="text-xs text-muted-foreground">{fmtDate(viewBooking.updatedAt)}</p>
              </div>
            </div>
          )}

          {/* Notes as activity */}
          {viewBooking.notes && viewBooking.notes.split('\n').filter((n: string) => n.trim()).map((note: string, i: number) => (
            <div key={i} className="flex gap-3">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/50 mt-2 shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">{note}</p>
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      {/* ── Debug Tab ── */}
      <TabsContent value="debug" className="space-y-4 mt-4">
        <h4 className="text-sm font-bold flex items-center gap-1.5"><Bug className="w-4 h-4" /> Debug Information</h4>

        <div className="space-y-3">
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Internal Booking ID</p>
            <p className="font-mono text-xs">{viewBooking.rawId || viewBooking.id}</p>
          </div>

          {viewBooking.details?.gdsPnr && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">GDS PNR</p>
              <p className="font-mono text-sm font-bold">{viewBooking.details.gdsPnr}</p>
            </div>
          )}

          {viewBooking.details?.ttiBookingId && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">TTI Booking ID</p>
              <p className="font-mono text-xs">{viewBooking.details.ttiBookingId}</p>
            </div>
          )}

          <details className="text-xs" open>
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium p-2">Raw Booking JSON</summary>
            <pre className="mt-2 bg-muted/50 rounded-lg p-3 overflow-x-auto text-[10px] max-h-80 border">{JSON.stringify(viewBooking.details, null, 2)}</pre>
          </details>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium p-2">Passenger Info (Raw)</summary>
            <pre className="mt-2 bg-muted/50 rounded-lg p-3 overflow-x-auto text-[10px] max-h-60 border">{JSON.stringify(viewBooking.passengerInfo, null, 2)}</pre>
          </details>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium p-2">Contact Info (Raw)</summary>
            <pre className="mt-2 bg-muted/50 rounded-lg p-3 overflow-x-auto text-[10px] max-h-40 border">{JSON.stringify(viewBooking.contactInfo, null, 2)}</pre>
          </details>
        </div>
      </TabsContent>

      {/* ── Supplier Tab ── */}
      <TabsContent value="supplier" className="space-y-4 mt-4">
        <h4 className="text-sm font-bold flex items-center gap-1.5"><Building2 className="w-4 h-4" /> Supplier / GDS Information</h4>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">GDS Source</p>
            <p className="font-bold uppercase text-primary mt-1">{fareData.source || viewBooking.details?.outbound?.source || "—"}</p>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Airline</p>
            <p className="font-bold mt-1">{fareData.airline || fareData.airlineCode || "—"}</p>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">GDS PNR</p>
            <p className="font-mono font-bold mt-1">{viewBooking.pnr || "—"}</p>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Airline PNR</p>
            <p className="font-mono font-bold mt-1 text-accent">{viewBooking.details?.airlinePnr || "—"}</p>
          </div>
        </div>

        {/* GDS Action History */}
        {viewBooking.details?.lastGdsAction && (
          <div className={`border rounded-lg p-3 ${viewBooking.details.lastGdsAction.result?.success ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200' : 'bg-destructive/10 border-destructive/20'}`}>
            <p className="text-sm font-bold mb-1">Last GDS Action</p>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Action:</span> <span className="capitalize font-medium">{viewBooking.details.lastGdsAction.action}</span></p>
              {viewBooking.details.lastGdsAction.result?.ticketNumbers?.length > 0 && (
                <p className="font-mono text-xs">Tickets: {viewBooking.details.lastGdsAction.result.ticketNumbers.join(", ")}</p>
              )}
              {viewBooking.details.lastGdsAction.error && <p className="text-destructive text-xs">{viewBooking.details.lastGdsAction.error}</p>}
              <p className="text-xs text-muted-foreground">By {viewBooking.details.lastGdsAction.performedBy} at {fmtDate(viewBooking.details.lastGdsAction.timestamp)}</p>
            </div>
          </div>
        )}

        {/* Sabre v4 actions */}
        {viewBooking.pnr && viewBooking.pnr !== "—" && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase text-muted-foreground">Live GDS Queries</p>
            <div className="flex flex-wrap gap-2">
              <FlightStatusBadge
                airlineCode={fareData.airlineCode || viewBooking.details?.outbound?.airlineCode || ""}
                flightNumber={fareData.flightNumber || viewBooking.details?.outbound?.flightNumber || ""}
                date={(fareData.departureTime || viewBooking.details?.outbound?.departureTime || "").substring(0, 10)}
                compact
              />
              <FareRulesModal
                origin={fareData.origin || viewBooking.details?.outbound?.origin || ""}
                destination={fareData.destination || viewBooking.details?.outbound?.destination || ""}
                departureDate={(fareData.departureTime || viewBooking.details?.outbound?.departureTime || "").substring(0, 10)}
                airlineCode={fareData.airlineCode || viewBooking.details?.outbound?.airlineCode || ""}
                flightNumber={fareData.flightNumber || viewBooking.details?.outbound?.flightNumber || ""}
              />
            </div>
          </div>
        )}
      </TabsContent>

      {/* ── Terminal Tab ── */}
      <TabsContent value="terminal" className="space-y-4 mt-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold flex items-center gap-1.5"><Terminal className="w-4 h-4" /> Terminal Window</h4>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={closeTerminalSession}>
                Closed
              </Button>
            </div>
          </div>

          {/* Session info */}
          <div className="bg-muted/50 rounded-lg p-2 text-xs font-mono text-muted-foreground border">
            Session ID: {terminalSessionId || "—"} — Booking {viewBooking.id}
          </div>

          {/* Command input */}
          <div className="flex gap-2">
            <Input
              placeholder="Type Terminal Command"
              className="font-mono text-sm"
              value={terminalCmd}
              onChange={(e) => setTerminalCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !terminalLoading) executeCommand(); }}
              disabled={terminalLoading}
            />
            <Button size="sm" onClick={executeCommand} disabled={terminalLoading || !terminalCmd.trim()} className="shrink-0">
              {terminalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Execute"}
            </Button>
          </div>

          {/* Quick commands */}
          {viewBooking.pnr && viewBooking.pnr !== "—" && (
            <div className="flex flex-wrap gap-1.5">
              <p className="text-xs text-muted-foreground w-full">Quick Commands:</p>
              {[
                { label: "Retrieve PNR", cmd: `*${viewBooking.pnr}` },
                { label: "Display Itinerary", cmd: `*I` },
                { label: "Fare Display", cmd: `*FF` },
                { label: "Vendor Locator", cmd: `*VL` },
                { label: "SSR Info", cmd: `*SI` },
                { label: "Ticket Info", cmd: `*T` },
                { label: "History", cmd: `*H` },
              ].map((q) => (
                <Button
                  key={q.cmd}
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-6 px-2"
                  onClick={() => { setTerminalCmd(q.cmd); }}
                >
                  {q.label}
                </Button>
              ))}
            </div>
          )}

          {/* Terminal output */}
          <div className="bg-slate-950 rounded-lg p-3 min-h-[200px] max-h-[400px] overflow-y-auto font-mono text-xs">
            {terminalHistory.length === 0 ? (
              <p className="text-slate-500">Terminal ready. Type a Sabre command and press Execute or Enter.</p>
            ) : (
              terminalHistory.map((entry, i) => (
                <div key={i} className="mb-4">
                  <div className="text-emerald-400 mb-1">
                    <span className="text-slate-500 text-[10px]">{entry.timestamp}</span>
                  </div>
                  <div className="text-amber-300 mb-1">{'>'} {entry.command}</div>
                  <pre className={`whitespace-pre-wrap ${entry.success ? 'text-slate-300' : 'text-red-400'}`}>
                    {entry.response}
                  </pre>
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>
      </TabsContent>

      {/* ── Actions Tab ── */}
      <TabsContent value="actions" className="space-y-4 mt-4">
        <div>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5"><Shield className="w-4 h-4" /> Change Booking Status</h4>
          <Select value={editData.status} onValueChange={(v) => setEditData({ ...editData, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map(s => (
                <SelectItem key={s.value} value={s.value}>
                  <span className="capitalize">{s.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5"><CreditCard className="w-4 h-4" /> Payment Status</h4>
          <Select value={editData.paymentStatus} onValueChange={(v) => setEditData({ ...editData, paymentStatus: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Admin Notes</h4>
          <Textarea value={editData.notes} onChange={(e) => setEditData({ ...editData, notes: e.target.value })} placeholder="Add notes..." rows={3} />
        </div>

        <Separator />

        <h4 className="text-sm font-bold mb-3">Manage Flight Booking</h4>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" className="border-accent text-accent" onClick={() => setIssueTicketOpen(true)}>
            <Ticket className="w-4 h-4 mr-1" /> Issue Ticket
          </Button>
          <Button variant="outline" size="sm" className="border-destructive text-destructive" onClick={() => setCancelFlightOpen(true)}>
            <Ban className="w-4 h-4 mr-1" /> Cancel Flight
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setPayLinkEmail(viewBooking?.email || ""); setSendPayLinkOpen(true); }}>
            <Send className="w-4 h-4 mr-1" /> Send Pay Link
          </Button>
        </div>

        {/* GDS Actions (Sabre v4) */}
        {viewBooking.pnr && viewBooking.pnr !== "—" && (
          <div className="mt-3 border border-border rounded-lg p-3 space-y-3">
            <p className="text-xs font-bold uppercase text-muted-foreground">GDS Actions (Sabre v4.0.0)</p>
            <BookingActions
              booking={{
                rawId: viewBooking.rawId,
                id: viewBooking.id,
                pnr: viewBooking.pnr,
                status: viewBooking.status,
                airlineCode: fareData.airlineCode || viewBooking.details?.outbound?.airlineCode || "",
                flightNumber: fareData.flightNumber || viewBooking.details?.outbound?.flightNumber || "",
                origin: fareData.origin || viewBooking.details?.outbound?.origin || "",
                destination: fareData.destination || viewBooking.details?.outbound?.destination || "",
                departureTime: fareData.departureTime || viewBooking.details?.outbound?.departureTime || "",
                ticketNo: viewBooking.ticketNo,
                refundable: fareData.refundable ?? viewBooking.details?.outbound?.refundable,
                passengers: safeParsePax(viewBooking.passengerInfo || viewBooking.passengers || []),
              }}
              isAdmin={true}
              onActionComplete={() => { refetch(); setViewBooking(null); }}
            />
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button onClick={saveEdits} disabled={!!actionLoading} className="bg-primary">
            {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save Changes
          </Button>
          {(viewBooking.status === "on_hold" || viewBooking.status === "pending" || viewBooking.status === "confirmed") && (
            <Button variant="outline" className="border-emerald-500 text-emerald-600" onClick={() => {
              setConfirmPnr(viewBooking.pnr || viewBooking.details?.gdsPnr || "");
              setConfirmTicketNo(viewBooking.ticketNo || "");
              setConfirmIssueOpen(true);
            }}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Approve & Issue Ticket
            </Button>
          )}
          {viewBooking.status === "confirmed" && (
            <Button variant="outline" className="border-purple-500 text-purple-600" onClick={() => { updateBooking(viewBooking, { status: "ticketed" }); setViewBooking(null); }}>
              <Ticket className="w-4 h-4 mr-1" /> Mark Ticketed
            </Button>
          )}
          {!["cancelled", "completed", "refunded", "void", "failed"].includes(viewBooking.status) && (
            <Button variant="destructive" size="sm" onClick={() => setCancelFlightOpen(true)}>
              <XCircle className="w-4 h-4 mr-1" /> Cancel Booking
            </Button>
          )}
        </div>

        {viewBooking.status === "on_hold" && (
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-warning">Booking Reserved</p>
              <p className="text-muted-foreground">Awaiting payment or admin approval.</p>
              {viewBooking.paymentDeadline && <p className="text-warning font-medium mt-1">Deadline: {fmtDate(viewBooking.paymentDeadline)}</p>}
            </div>
          </div>
        )}

        {viewBooking.status === "cancelled" && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">Booking Cancelled</p>
              {viewBooking.details?.lastGdsAction?.statusBlocked && (
                <p className="text-muted-foreground">⚠️ GDS cancellation failed previously. This booking may still be active in the airline system.</p>
              )}
              <Button variant="outline" size="sm" className="mt-2" onClick={() => { updateBooking(viewBooking, { status: "on_hold" }); setViewBooking(null); }}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Revert to Reserved
              </Button>
            </div>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default AdminBookingTabs;
