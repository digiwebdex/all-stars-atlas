import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Search, MoreHorizontal, Eye, Edit2, Download, CheckCircle2, Clock, XCircle, Ticket, Loader2,
  Plane, User, Phone, CreditCard, FileText, AlertTriangle, Save, Shield,
  Send, Ban, Archive, Trash2, RotateCcw, Upload, ExternalLink,
} from "lucide-react";
import AdminBookingTabs from "@/components/admin/AdminBookingTabs";
import { useToast } from "@/hooks/use-toast";
import { useAdminBookings } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { useQueryClient } from "@tanstack/react-query";
import DataLoader from "@/components/DataLoader";
import { downloadCSV } from "@/lib/csv-export";

const ALL_STATUSES = [
  { value: "on_hold", label: "Reserved", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "pending", label: "Pending", color: "bg-warning/10 text-warning" },
  { value: "confirmed", label: "Confirmed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "ticketed", label: "Ticketed", color: "bg-accent/10 text-accent" },
  { value: "processing", label: "Processing", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "completed", label: "Completed", color: "bg-primary/10 text-primary" },
  { value: "cancelled", label: "Cancelled", color: "bg-destructive/10 text-destructive" },
  { value: "refunded", label: "Refunded", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "partially_refunded", label: "Partially Refunded", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "failed", label: "Failed", color: "bg-destructive/10 text-destructive" },
  { value: "void", label: "Void", color: "bg-muted text-muted-foreground" },
  { value: "exchange", label: "Exchange", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
  { value: "no_show", label: "No Show", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
];

// Map DB status to display label
const statusLabel = (status: string) => ALL_STATUSES.find(s => s.value === status)?.label || status?.replace(/_/g, ' ');

const PAYMENT_STATUSES = ["unpaid", "paid", "partial", "refunded", "pending"];
const PAYMENT_METHODS = ["bkash", "nagad", "rocket", "card", "bank_transfer", "pay_later"];

function getStatusStyle(status: string) {
  return ALL_STATUSES.find(s => s.value === status)?.color || "bg-muted text-muted-foreground";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; }
}

const AdminBookings = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewBooking, setViewBooking] = useState<any>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [issueTicketOpen, setIssueTicketOpen] = useState(false);
  const [cancelFlightOpen, setCancelFlightOpen] = useState(false);
  const [sendPayLinkOpen, setSendPayLinkOpen] = useState(false);
  const [issueNotes, setIssueNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [payLinkEmail, setPayLinkEmail] = useState("");
  const [payLinkName, setPayLinkName] = useState("");
  const [payLinkPlatform, setPayLinkPlatform] = useState("email");
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelFilter, setBulkCancelFilter] = useState<"reserved" | "all_with_pnr">("reserved");
  const [bulkCancelLoading, setBulkCancelLoading] = useState(false);
  const [bulkCancelResult, setBulkCancelResult] = useState<any>(null);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useAdminBookings({
    ...(search ? { search } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  });

  // Parse passengerInfo safely — it may arrive as a double-stringified JSON string
  const safeParsePax = (pi: any): any[] => {
    let parsed = pi;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return []; } }
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { return []; } }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && parsed.passengers) return parsed.passengers;
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return [parsed];
    return [];
  };

  const apiBookings = (data as any)?.data?.map((b: any) => {
    const paxList = safeParsePax(b.passengerInfo);
    // Use first passenger name as customer if user name is missing / just email
    const userName = b.user?.name?.trim() || "";
    const paxName = paxList.length > 0 ? `${paxList[0].title || ''} ${paxList[0].firstName || paxList[0].first_name || ''} ${paxList[0].lastName || paxList[0].last_name || ''}`.trim() : "";
    const customer = (userName && userName !== "undefined undefined" && !userName.includes('@')) ? userName : (paxName || userName || "Unknown");

    // Extract route from nested details structure
    const ob = b.details?.outbound || b.details || {};
    const routeOrigin = ob.origin || b.details?.origin || '';
    const routeDest = ob.destination || b.details?.destination || '';
    const route = routeOrigin && routeDest ? `${routeOrigin} → ${routeDest}` : (b.details?.route || '—');

    const airlinePnr = b.details?.airlinePnr || null;
    const gdsPnr = b.pnr || ob.gdsPnr || b.details?.gdsPnr || null;

    return {
      id: b.bookingRef || b.id, rawId: b.id,
      customer, email: b.user?.email || "",
      type: b.bookingType || "flight",
      route,
      pnr: gdsPnr || "—",
      airlinePnr,
      date: b.bookedAt ? new Date(b.bookedAt).toLocaleDateString('en-GB') : "—",
      status: b.status, amount: `৳${(b.totalAmount || 0).toLocaleString()}`,
      rawAmount: b.totalAmount || 0, paymentMethod: b.paymentMethod || "—",
      paymentStatus: b.paymentStatus || "—",
      paymentDeadline: b.paymentDeadline,
      details: b.details || {},
      passengerInfo: paxList,
      contactInfo: b.contactInfo || {},
      notes: b.notes || "",
      bookedAt: b.bookedAt,
      updatedAt: b.updatedAt,
    };
  }) || [];

  const bookings = apiBookings;
  // Only bookings WITH PNR are valid — others go to "Failed" section
  const hasPnr = (b: any) => b.pnr && b.pnr !== "—" && b.pnr.trim().length > 0;
  const successBookings = bookings.filter((b: any) => hasPnr(b));
  const failedBookings = bookings.filter((b: any) => !hasPnr(b));

  const stats = {
    total: bookings.length,
    confirmed: successBookings.length,
    pending: successBookings.filter((b: any) => ["pending", "on_hold", "processing"].includes(b.status)).length,
    cancelled: successBookings.filter((b: any) => ["cancelled", "failed", "void", "no_show"].includes(b.status)).length,
    failed: failedBookings.length,
  };

  const applyFilters = (list: any[]) => list.filter((b: any) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.id?.toLowerCase().includes(q) || b.customer?.toLowerCase().includes(q) || b.email?.toLowerCase().includes(q) || b.route?.toLowerCase().includes(q) || b.pnr?.toLowerCase().includes(q);
    }
    return true;
  });

  const filtered = applyFilters(successBookings);
  const filteredFailed = applyFilters(failedBookings);
  const allVisibleBookings = [...filtered, ...filteredFailed];
  const allVisibleIds = allVisibleBookings.map((b: any) => String(b.rawId || b.id));
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id: string) => selectedBookingIds.includes(id));

  const updateBooking = async (b: any, updates: Record<string, any>) => {
    setActionLoading(b.rawId || b.id);
    try {
      const result: any = await api.put(`/admin/bookings/${b.rawId || b.id}`, updates);

      if (result?.gdsAction?.skipped) {
        // GDS was intentionally skipped (e.g., TTI has no ticketing API)
        toast({
          title: "✅ Status Updated (Manual)",
          description: `${result.message || 'Booking updated'}. Note: GDS action skipped — ${result.gdsAction.methodUsed || 'no API available'}. Update the airline system manually if needed.`,
        });
      } else if (result?.gdsAction?.success) {
        const tickets = result.gdsAction.ticketNumbers || [];
        toast({
          title: "✅ GDS Action Successful",
          description: tickets.length > 0
            ? `Booking ${b.id} updated. Ticket(s): ${tickets.join(", ")}`
            : `Booking ${b.id} updated via GDS successfully.`,
        });
      } else {
        toast({ title: "Updated", description: `Booking ${b.id} updated successfully` });
      }

      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      refetch();
    } catch (err: any) {
      // Handle 422 GDS failure — status was NOT changed
      const gdsError = err?.gdsError || err?.gdsAction?.error || err?.hint;
      if (err?.status === 422) {
        toast({
          title: "❌ GDS Action Failed — Status NOT Changed",
          description: gdsError 
            ? `${gdsError}. The booking remains in its previous state.`
            : (err?.message || "GDS action failed. Status was not changed."),
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: err?.message || "Could not update booking", variant: "destructive" });
      }
    } finally {
      setActionLoading(null);
    }
  };

  const openDetail = (b: any) => {
    setViewBooking(b);
    setEditMode(false);
    setEditData({
      status: b.status,
      paymentStatus: b.paymentStatus,
      paymentMethod: b.paymentMethod,
      notes: b.notes,
      totalAmount: b.rawAmount,
      passengerInfo: b.passengerInfo,
      contactInfo: b.contactInfo,
    });
  };

  const saveEdits = async () => {
    if (!viewBooking) return;
    await updateBooking(viewBooking, editData);
    setEditMode(false);
    setViewBooking(null);
  };

  const handleExport = () => {
    downloadCSV('bookings', ['ID', 'Customer', 'Email', 'Type', 'Route', 'PNR', 'Date', 'Status', 'Payment', 'Amount'],
      bookings.map((b: any) => [b.id, b.customer, b.email, b.type, b.route, b.pnr, b.date, b.status, b.paymentStatus, b.amount]));
    toast({ title: "Exported", description: "Bookings CSV downloaded" });
  };

  const archiveBooking = async (b: any) => {
    setActionLoading(b.rawId || b.id);
    try {
      await api.patch(`/admin/bookings/${b.rawId || b.id}/archive`, { archived: true });
      toast({ title: "Archived", description: `Booking ${b.id} hidden from dashboards` });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to archive", variant: "destructive" });
    }
    setActionLoading(null);
  };

  const deleteBooking = async (b: any) => {
    setActionLoading(b.rawId || b.id);
    try {
      await api.delete(`/admin/bookings/${b.rawId || b.id}`);
      toast({ title: "Deleted", description: `Booking ${b.id} permanently removed` });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      setDeleteConfirm(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to delete", variant: "destructive" });
    }
    setActionLoading(null);
  };

  const [bulkCancelSkipGds, setBulkCancelSkipGds] = useState(false);
  const [bulkCancelProgress, setBulkCancelProgress] = useState<string>("");

  const handleBulkCancel = async () => {
    setBulkCancelLoading(true);
    setBulkCancelResult(null);
    setBulkCancelProgress("");

    const allResults: any[] = [];
    let offset = 0;

    try {
      while (true) {
        const resp: any = await api.post('/admin/bookings/bulk-cancel', {
          filter: bulkCancelFilter,
          offset,
          skipGds: bulkCancelSkipGds,
        });

        // Server says all done
        if (resp.done) {
          setBulkCancelProgress(`Done — all ${resp.totalBookings} bookings processed`);
          break;
        }

        const r = resp.result;
        allResults.push(r);

        const statusIcon = r.status === 'cancelled' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
        setBulkCancelProgress(
          `${statusIcon} ${r.bookingRef} (PNR: ${r.pnr || '—'}) → ${r.status}  |  ${resp.progress.current}/${resp.progress.total}`
        );

        // Update live results
        setBulkCancelResult({
          summary: {
            total: allResults.length,
            cancelled: allResults.filter((x: any) => x.status === 'cancelled').length,
            failed: allResults.filter((x: any) => x.status === 'gds_failed' || x.status === 'error').length,
            skipped: allResults.filter((x: any) => x.status === 'skipped').length,
          },
          results: allResults,
        });

        if (!resp.progress.hasMore) break;

        // Move to next — if this one was cancelled/skipped, the list shifts so offset stays 0
        // If it failed and status didn't change, it's still in the list so we advance offset
        if (r.status === 'cancelled' || r.status === 'skipped') {
          // Booking was removed from query results (status changed), don't increment offset
          offset = 0;
        } else {
          // Booking still matches the query (GDS failed, status unchanged), skip it
          offset++;
        }
      }

      const final = {
        summary: {
          total: allResults.length,
          cancelled: allResults.filter((x: any) => x.status === 'cancelled').length,
          failed: allResults.filter((x: any) => x.status === 'gds_failed' || x.status === 'error').length,
          skipped: allResults.filter((x: any) => x.status === 'skipped').length,
        },
        results: allResults,
      };
      setBulkCancelResult(final);

      toast({
        title: `Bulk Cancel Complete`,
        description: `${final.summary.cancelled} cancelled, ${final.summary.failed} failed, ${final.summary.skipped} skipped`,
      });
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Bulk cancel failed", variant: "destructive" });
    } finally {
      setBulkCancelLoading(false);
    }
  };

  const toggleSelectOne = (bookingId: string, checked: boolean) => {
    setSelectedBookingIds((prev) => checked ? [...new Set([...prev, bookingId])] : prev.filter((id) => id !== bookingId));
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedBookingIds((prev) => {
      if (checked) return [...new Set([...prev, ...allVisibleIds])];
      const visibleSet = new Set(allVisibleIds);
      return prev.filter((id) => !visibleSet.has(id));
    });
  };

  const handleBulkDelete = async () => {
    if (selectedBookingIds.length === 0) return;
    setBulkDeleteLoading(true);
    try {
      const result: any = await api.post('/admin/bookings/bulk-delete', { bookingIds: selectedBookingIds });
      toast({
        title: 'Bulk Delete Complete',
        description: `${result.summary?.deleted || 0} deleted, ${result.summary?.notFound || 0} not found`,
      });
      setSelectedBookingIds([]);
      setBulkDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Bulk delete failed', variant: 'destructive' });
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const statCards = [
    { label: "Total Bookings", value: stats.total, icon: Ticket, color: "text-primary", bg: "bg-primary/10" },
    { label: "With PNR", value: stats.confirmed, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
    { label: "Pending", value: stats.pending, icon: Clock, color: "text-warning", bg: "bg-warning/10" },
    { label: "Failed (No PNR)", value: stats.failed, icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
  ];

  // Passenger info can be array or object
  const getPassengers = (b: any): any[] => {
    if (!b) return [];
    const pi = b.passengerInfo;
    if (Array.isArray(pi)) return pi;
    if (pi && typeof pi === 'object' && pi.passengers) return pi.passengers;
    if (pi && typeof pi === 'object' && Object.keys(pi).length > 0) return [pi];
    return [];
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">All Bookings</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" onClick={() => { setBulkCancelOpen(true); setBulkCancelResult(null); }}>
            <Ban className="w-4 h-4 mr-1.5" /> Cancel All Reserved
          </Button>
          <Button variant="destructive" size="sm" disabled={selectedBookingIds.length === 0} onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-4 h-4 mr-1.5" /> Delete Selected ({selectedBookingIds.length})
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4 mr-1.5" /> Export CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <Card key={i}><CardContent className="flex items-center gap-3 p-4">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold mt-1">{s.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search bookings..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {ALL_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) => toggleSelectAllVisible(Boolean(checked))}
                  aria-label="Select all visible bookings"
                />
              </TableHead>
              <TableHead>ID</TableHead><TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Route</TableHead>
              <TableHead className="hidden md:table-cell">PNR</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Payment</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-12">No bookings found</TableCell></TableRow>
              ) : filtered.map((b: any) => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(b)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedBookingIds.includes(String(b.rawId || b.id))}
                      onCheckedChange={(checked) => toggleSelectOne(String(b.rawId || b.id), Boolean(checked))}
                      aria-label={`Select booking ${b.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.id}</TableCell>
                  <TableCell><div><p className="text-sm font-medium">{b.customer}</p><p className="text-xs text-muted-foreground">{b.email}</p></div></TableCell>
                  <TableCell className="hidden md:table-cell"><Badge variant="outline" className="text-[10px]">{b.type}</Badge></TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{b.route}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="space-y-0.5">
                      {b.airlinePnr ? (
                        <code className="font-mono text-xs font-bold text-accent">{b.airlinePnr}</code>
                      ) : (
                        <span className="text-[9px] text-muted-foreground italic">PNR Pending</span>
                      )}
                      {b.pnr && b.pnr !== "—" && (
                        <span className="text-[9px] text-muted-foreground font-mono block">ID: {b.pnr}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{b.date}</TableCell>
                  <TableCell><Badge variant="outline" className={`text-[11px] capitalize ${getStatusStyle(b.status)}`}>{statusLabel(b.status)}</Badge></TableCell>
                  <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-[10px] capitalize">{b.paymentStatus}</Badge></TableCell>
                  <TableCell className="text-right font-semibold text-sm">{b.amount}</TableCell>
                  <TableCell>
                    <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(b); }}><Eye className="w-4 h-4 mr-2" /> View Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(b); setEditMode(true); }}><Edit2 className="w-4 h-4 mr-2" /> Edit Booking</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {b.status === "on_hold" && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateBooking(b, { status: "confirmed" }); }}><CheckCircle2 className="w-4 h-4 mr-2" /> Confirm</DropdownMenuItem>}
                        {b.status === "pending" && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateBooking(b, { status: "confirmed" }); }}><CheckCircle2 className="w-4 h-4 mr-2" /> Approve & Confirm</DropdownMenuItem>}
                        {b.status === "confirmed" && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateBooking(b, { status: "completed" }); }}><CheckCircle2 className="w-4 h-4 mr-2" /> Mark Completed</DropdownMenuItem>}
                        {b.status === "cancelled" && (
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); updateBooking(b, { status: "on_hold" }); }}><RotateCcw className="w-4 h-4 mr-2" /> Revert to Reserved</DropdownMenuItem>
                        )}
                        {!["cancelled", "completed", "refunded", "void", "failed"].includes(b.status) && (
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); updateBooking(b, { status: "cancelled" }); }}><XCircle className="w-4 h-4 mr-2" /> Cancel</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); archiveBooking(b); }}><Archive className="w-4 h-4 mr-2" /> Archive</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(b); }}><Trash2 className="w-4 h-4 mr-2" /> Delete Permanently</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </DataLoader>

      {/* ── Failed Bookings (No PNR) ── */}
      {filteredFailed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" /> Failed Bookings (No PNR) — {filteredFailed.length}
          </h2>
          <Card className="border-destructive/30"><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-destructive/5">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => toggleSelectAllVisible(Boolean(checked))}
                    aria-label="Select all visible bookings"
                  />
                </TableHead>
                <TableHead>ID</TableHead><TableHead>Customer</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="hidden lg:table-cell">Route</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredFailed.map((b: any) => (
                  <TableRow key={b.id} className="cursor-pointer hover:bg-destructive/5" onClick={() => openDetail(b)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedBookingIds.includes(String(b.rawId || b.id))}
                        onCheckedChange={(checked) => toggleSelectOne(String(b.rawId || b.id), Boolean(checked))}
                        aria-label={`Select booking ${b.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{b.id}</TableCell>
                    <TableCell><div><p className="text-sm font-medium">{b.customer}</p><p className="text-xs text-muted-foreground">{b.email}</p></div></TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="outline" className="text-[10px]">{b.type}</Badge></TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">{b.route}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{b.date}</TableCell>
                    <TableCell><Badge variant="destructive" className="text-[11px]">Failed</Badge></TableCell>
                    <TableCell className="text-right font-semibold text-sm">{b.amount}</TableCell>
                    <TableCell>
                      <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDetail(b); }}><Eye className="w-4 h-4 mr-2" /> View Details</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); archiveBooking(b); }}><Archive className="w-4 h-4 mr-2" /> Archive</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(b); }}><Trash2 className="w-4 h-4 mr-2" /> Delete Permanently</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </div>
      )}

      {/* ── Comprehensive Booking Detail Dialog ── */}
      <Dialog open={!!viewBooking} onOpenChange={() => { setViewBooking(null); setEditMode(false); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <Ticket className="w-5 h-5" /> Booking {viewBooking?.id}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`capitalize ${getStatusStyle(viewBooking?.status || '')}`}>
                  {statusLabel(viewBooking?.status || '')}
                </Badge>
                {!editMode && (
                  <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
                    <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          {viewBooking && (
            <AdminBookingTabs
              viewBooking={viewBooking}
              editMode={editMode}
              editData={editData}
              setEditData={setEditData}
              actionLoading={actionLoading}
              saveEdits={saveEdits}
              updateBooking={updateBooking}
              setViewBooking={setViewBooking}
              setEditMode={setEditMode}
              setIssueTicketOpen={setIssueTicketOpen}
              setCancelFlightOpen={setCancelFlightOpen}
              setSendPayLinkOpen={setSendPayLinkOpen}
              setPayLinkEmail={setPayLinkEmail}
              safeParsePax={safeParsePax}
              getPassengers={getPassengers}
              refetch={refetch}
              fmtDate={fmtDate}
            />
          )}

          {editMode && (
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setEditMode(false)}>Cancel Edit</Button>
              <Button onClick={saveEdits} disabled={!!actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save All Changes
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Issue Ticket Modal */}
      <Dialog open={issueTicketOpen} onOpenChange={setIssueTicketOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ticket className="w-5 h-5" /> Issue Ticket — {viewBooking?.id}</DialogTitle></DialogHeader>
          {viewBooking?.details?.outbound?.source === 'tti' || viewBooking?.details?.outbound?.airlineCode === '2A' || viewBooking?.details?.outbound?.airlineCode === 'S2' ? (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm space-y-1">
              <p className="font-semibold text-warning">ℹ️ TTI/Air Astra — Manual Ticketing</p>
              <p className="text-muted-foreground">TTI API does not support remote ticketing. This will update the status locally only.</p>
              <p className="text-muted-foreground text-xs">Please ensure the ticket has been issued via Air Astra's back-office/GDS terminal before marking as ticketed.</p>
              {viewBooking?.details?.gdsPnr && <p className="font-mono text-xs">PNR: <span className="font-bold">{viewBooking.details.gdsPnr}</span></p>}
            </div>
          ) : viewBooking?.details?.outbound?.source && viewBooking?.details?.gdsPnr ? (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm">
              <p className="font-semibold text-warning">⚠️ Real GDS API Call</p>
              <p className="text-muted-foreground">This will call the <span className="font-bold uppercase">{viewBooking.details.outbound.source}</span> API to issue a real airline ticket for PNR: <span className="font-mono font-bold">{viewBooking.details.gdsPnr}</span></p>
              <p className="text-destructive text-xs mt-1">This action cannot be undone. Payment will be deducted from your GDS balance.</p>
            </div>
          ) : null}
          <Textarea value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="Type notes..." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueTicketOpen(false)}>Close</Button>
            <Button className="bg-accent text-accent-foreground" disabled={!!actionLoading} onClick={() => {
              if (viewBooking) updateBooking(viewBooking, { status: "ticketed", paymentStatus: "paid", notes: issueNotes ? `${viewBooking.notes ? viewBooking.notes + '\n' : ''}[Ticket Issued] ${issueNotes}` : viewBooking.notes });
              setIssueTicketOpen(false); setViewBooking(null);
            }}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ticket className="w-4 h-4 mr-1" />}
              {(viewBooking?.details?.outbound?.source === 'tti' || viewBooking?.details?.outbound?.airlineCode === '2A') ? 'Mark as Ticketed' : 'Issue Ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Flight Modal */}
      <Dialog open={cancelFlightOpen} onOpenChange={setCancelFlightOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><Ban className="w-5 h-5" /> Cancel Flight — {viewBooking?.id}</DialogTitle></DialogHeader>
          {viewBooking?.details?.outbound?.source && viewBooking?.details?.gdsPnr && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
              <p className="font-semibold text-destructive">⚠️ Real GDS Cancellation</p>
              <p className="text-muted-foreground">This will call the <span className="font-bold uppercase">{viewBooking.details.outbound.source}</span> API to cancel PNR: <span className="font-mono font-bold">{viewBooking.details.gdsPnr}</span></p>
              <p className="text-destructive text-xs mt-1">This will cancel the actual airline reservation. This cannot be undone.</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">Type reason to cancel the flight ticket:</p>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Type reason to cancel the booking..." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelFlightOpen(false)}>Close</Button>
            <Button variant="destructive" disabled={!!actionLoading} onClick={() => {
              if (viewBooking) updateBooking(viewBooking, { status: "cancelled", notes: cancelReason ? `${viewBooking.notes ? viewBooking.notes + '\n' : ''}[Cancelled] ${cancelReason}` : viewBooking.notes });
              setCancelFlightOpen(false); setViewBooking(null);
            }}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ban className="w-4 h-4 mr-1" />}
              Cancel Flight
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Pay Link Modal */}
      <Dialog open={sendPayLinkOpen} onOpenChange={setSendPayLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="w-5 h-5 text-accent" /> Send Pay Link — {viewBooking?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Enter your name</label>
              <Input value={payLinkName} onChange={(e) => setPayLinkName(e.target.value)} placeholder="Your Name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Select Platform Type</label>
              <Select value={payLinkPlatform} onValueChange={setPayLinkPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Enter Receiver {payLinkPlatform === "email" ? "Email" : "Phone"}</label>
              <Input value={payLinkEmail} onChange={(e) => setPayLinkEmail(e.target.value)} placeholder={payLinkPlatform === "email" ? "email@example.com" : "+880 1XXX"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendPayLinkOpen(false)}>Close</Button>
            <Button className="bg-accent text-accent-foreground" onClick={() => {
              toast({ title: "Pay Link Sent", description: `Payment link sent to ${payLinkEmail}` });
              setSendPayLinkOpen(false);
            }}>Send {payLinkPlatform === "email" ? "Email" : "SMS"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-5 h-5" /> Permanently Delete Booking</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">This will <strong className="text-destructive">permanently delete</strong> booking <strong>{deleteConfirm?.id}</strong> and all related tickets and transactions. This action cannot be undone.</p>
            <div className="p-3 bg-destructive/5 rounded-lg border border-destructive/20 text-sm">
              <p><strong>Route:</strong> {deleteConfirm?.route}</p>
              <p><strong>Customer:</strong> {deleteConfirm?.customer}</p>
              <p><strong>Status:</strong> {deleteConfirm?.status}</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!!actionLoading} onClick={() => deleteBooking(deleteConfirm)}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />} Delete Forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Cancel Dialog */}
      <Dialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="w-5 h-5" /> Bulk Cancel Bookings via GDS
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              This will call the GDS cancel API for each booking and update the local status. Only bookings with confirmed PNRs will be processed.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cancel scope:</label>
              <Select value={bulkCancelFilter} onValueChange={(v) => setBulkCancelFilter(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reserved">Reserved (on_hold) only — {stats.pending} bookings</SelectItem>
                  <SelectItem value="all_with_pnr">All active with PNR — {stats.confirmed} bookings</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/30 bg-warning/5">
              <Checkbox
                id="skipGds"
                checked={bulkCancelSkipGds}
                onCheckedChange={(v) => setBulkCancelSkipGds(Boolean(v))}
              />
              <label htmlFor="skipGds" className="text-sm cursor-pointer">
                <span className="font-medium">Force cancel locally</span>
                <span className="text-muted-foreground"> — skip GDS API calls, just mark as cancelled in database (use when GDS keeps failing)</span>
              </label>
            </div>

                {bulkCancelLoading && bulkCancelProgress && (
                  <div className="p-3 rounded-lg border bg-muted/50 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {bulkCancelProgress}
                  </div>
                )}

                {bulkCancelResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{bulkCancelResult.summary?.cancelled || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Cancelled</p>
                  </div>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <p className="text-lg font-bold text-destructive">{bulkCancelResult.summary?.failed || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Failed</p>
                  </div>
                  <div className="p-2 rounded-lg bg-muted">
                    <p className="text-lg font-bold text-muted-foreground">{bulkCancelResult.summary?.skipped || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Skipped</p>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono bg-muted/50 p-3 rounded-lg border">
                  {bulkCancelResult.results?.map((r: any, i: number) => (
                    <div key={i} className={`flex justify-between ${r.status === 'cancelled' ? 'text-emerald-600' : r.status === 'gds_failed' || r.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      <span>{r.bookingRef} ({r.pnr || '—'})</span>
                      <span>{r.status === 'cancelled' ? '✓ Cancelled' : r.status === 'gds_failed' ? `✗ ${r.reason?.slice(0, 40)}` : r.status === 'error' ? `✗ ${r.reason?.slice(0, 40)}` : `⊘ ${r.reason}`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkCancelOpen(false)}>Close</Button>
            {!bulkCancelResult && (
              <Button variant="destructive" disabled={bulkCancelLoading} onClick={handleBulkCancel}>
                {bulkCancelLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ban className="w-4 h-4 mr-1" />}
                {bulkCancelLoading ? 'Cancelling via GDS...' : 'Cancel All via GDS'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Delete Selected Bookings
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <strong>{selectedBookingIds.length}</strong> selected booking(s) and related tickets/transactions. This cannot be undone.
            </p>
            <div className="p-3 rounded-lg border bg-destructive/5 border-destructive/20 text-xs text-muted-foreground">
              Tip: use the table checkbox in header to select all visible bookings.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={bulkDeleteLoading || selectedBookingIds.length === 0} onClick={handleBulkDelete}>
              {bulkDeleteLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />} Delete All Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminBookings;
