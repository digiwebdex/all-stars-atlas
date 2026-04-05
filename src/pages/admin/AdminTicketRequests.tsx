import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket, CheckCircle2, XCircle, Clock, Loader2, Eye, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";


const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  processing: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  issued: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return d; }
}

const AdminTicketRequests = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [viewRequest, setViewRequest] = useState<any>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "ticket-issue-requests", statusFilter],
    queryFn: () => api.get<any>("/admin/ticket-issue-requests", { status: statusFilter }),
  });

  const requests = (data as any)?.data || [];

  const handleAction = async (requestId: string, action: "issue" | "reject") => {
    setActionLoading(requestId);
    try {
      const result: any = await api.put(`/admin/ticket-issue-requests/${requestId}`, { action, adminNotes: adminNotes || undefined });
      if (result.success) {
        toast({
          title: action === "issue" ? "✅ Ticket Issued" : "Request Rejected",
          description: action === "issue"
            ? `Ticket issued successfully${result.ticketNumbers?.length ? `. Tickets: ${result.ticketNumbers.join(", ")}` : ""}`
            : "Ticket request has been rejected",
        });
        setViewRequest(null);
        setAdminNotes("");
        qc.invalidateQueries({ queryKey: ["admin", "ticket-issue-requests"] });
        qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
        refetch();
      }
    } catch (err: any) {
      toast({
        title: "Failed",
        description: err.gdsError || err.message || "Action failed",
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const stats = {
    pending: requests.filter((r: any) => r.status === "pending").length,
    processing: requests.filter((r: any) => r.status === "processing").length,
    issued: requests.filter((r: any) => r.status === "issued").length,
    rejected: requests.filter((r: any) => r.status === "rejected").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Ticket className="w-6 h-6 text-primary" /> Ticket Issue Requests
        </h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pending", value: stats.pending, icon: Clock, color: "text-amber-600" },
          { label: "Processing", value: stats.processing, icon: Loader2, color: "text-blue-600" },
          { label: "Issued", value: stats.issued, icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Rejected", value: stats.rejected, icon: XCircle, color: "text-rose-600" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-12">No ticket issue requests found</TableCell></TableRow>
                ) : requests.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setViewRequest(r); setAdminNotes(r.admin_notes || ""); }}>
                    <TableCell className="font-mono text-xs font-bold">{r.booking_ref || "—"}</TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{r.user_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.user_email}</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.pnr || "—"}</TableCell>
                    <TableCell className="font-bold text-sm">৳{(r.total_amount || 0).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize text-[10px]">{r.payment_status || "—"}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={`capitalize ${statusColors[r.status] || ""}`}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setViewRequest(r); setAdminNotes(r.admin_notes || ""); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      {/* Detail / Action Dialog */}
      <Dialog open={!!viewRequest} onOpenChange={() => setViewRequest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ticket className="w-5 h-5" /> Ticket Issue Request — {viewRequest?.booking_ref}
            </DialogTitle>
          </DialogHeader>
          {viewRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Booking Ref</p><p className="font-bold font-mono">{viewRequest.booking_ref}</p></div>
                <div><p className="text-xs text-muted-foreground">PNR</p><p className="font-bold font-mono text-primary">{viewRequest.pnr || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Customer</p><p className="font-medium">{viewRequest.user_name}</p><p className="text-xs text-muted-foreground">{viewRequest.user_email}</p></div>
                <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{viewRequest.user_phone || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-bold text-primary">৳{(viewRequest.total_amount || 0).toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Payment Status</p><Badge variant="outline" className="capitalize">{viewRequest.payment_status}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Booking Status</p><Badge variant="outline" className="capitalize">{viewRequest.booking_status}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Request Status</p><Badge variant="outline" className={`capitalize ${statusColors[viewRequest.status] || ""}`}>{viewRequest.status}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Requested</p><p className="font-medium">{fmtDate(viewRequest.created_at)}</p></div>
                {viewRequest.processed_at && <div><p className="text-xs text-muted-foreground">Processed</p><p className="font-medium">{fmtDate(viewRequest.processed_at)}</p></div>}
              </div>

              {viewRequest.notes && (
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Customer Notes</p>
                  <p className="text-sm">{viewRequest.notes}</p>
                </div>
              )}

              {/* GDS Source */}
              {(() => {
                const details = typeof viewRequest.details === 'string' ? JSON.parse(viewRequest.details || '{}') : (viewRequest.details || {});
                const outbound = details.outbound || details;
                const source = outbound.source || details.source || '';
                const route = `${outbound.origin || ''} → ${outbound.destination || ''}`;
                return source ? (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
                    <p className="font-semibold">GDS Source: <span className="uppercase text-primary">{source}</span></p>
                    <p className="text-muted-foreground text-xs">Route: {route}</p>
                    <p className="text-xs text-muted-foreground mt-1">⚠️ Issuing will call the {source.toUpperCase()} GDS API to issue a real airline ticket.</p>
                  </div>
                ) : null;
              })()}

              {viewRequest.status === "pending" || viewRequest.status === "processing" ? (
                <>
                  <Textarea
                    placeholder="Admin notes (optional)"
                    value={adminNotes}
                    onChange={e => setAdminNotes(e.target.value)}
                    rows={2}
                  />
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setViewRequest(null)}>Close</Button>
                    <Button
                      variant="destructive"
                      disabled={!!actionLoading}
                      onClick={() => handleAction(viewRequest.id, "reject")}
                    >
                      {actionLoading === viewRequest.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
                      Reject
                    </Button>
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={!!actionLoading}
                      onClick={() => handleAction(viewRequest.id, "issue")}
                    >
                      {actionLoading === viewRequest.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ticket className="w-4 h-4 mr-1" />}
                      Issue Ticket via GDS
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <div className="space-y-2">
                  {viewRequest.admin_notes && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Admin Notes</p>
                      <p className="text-sm">{viewRequest.admin_notes}</p>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setViewRequest(null)}>Close</Button>
                  </DialogFooter>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminTicketRequests;
