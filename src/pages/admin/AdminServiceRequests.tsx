import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XCircle, RefreshCw, Wallet, Ban, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const TYPE_META: Record<string, { label: string; icon: any; tone: string }> = {
  void: { label: "Void", icon: XCircle, tone: "bg-destructive/15 text-destructive" },
  reissue: { label: "Reissue", icon: RefreshCw, tone: "bg-amber-500/15 text-amber-600" },
  refund: { label: "Refund", icon: Wallet, tone: "bg-emerald-500/15 text-emerald-600" },
  cancel: { label: "Itinerary Cancel", icon: Ban, tone: "bg-destructive/15 text-destructive" },
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  quoted: "bg-sky-500/15 text-sky-600",
  accepted: "bg-indigo-500/15 text-indigo-600",
  processing: "bg-primary/15 text-primary",
  completed: "bg-emerald-500/15 text-emerald-600",
  rejected: "bg-destructive/15 text-destructive",
};


const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

const AdminServiceRequests = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<any>(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [airlineFee, setAirlineFee] = useState("");
  const [serviceCharge, setServiceCharge] = useState("");
  const [noShowCharge, setNoShowCharge] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const ticketAmount = Number(selected?.total_amount || 0);
  const isRefundable = ["void", "refund", "cancel"].includes(String(selected?.type));
  // Reissue also gets a quotation (fees only, no wallet credit)
  const isQuotable = isRefundable || String(selected?.type) === "reissue";
  const deductions = (Number(airlineFee) || 0) + (Number(serviceCharge) || 0) + (Number(noShowCharge) || 0);
  const computedRefund = refundAmount === ""
    ? Math.max(0, ticketAmount - deductions)
    : Math.max(0, Number(refundAmount) || 0);
  const customerAccepted = !!selected?.customer_accepted_at;

  const openRequest = (r: any) => {
    setSelected(r);
    setAdminNotes(r?.admin_notes || "");
    setAirlineFee(r?.airline_fee != null ? String(Number(r.airline_fee)) : "");
    setServiceCharge(r?.service_charge != null ? String(Number(r.service_charge)) : "");
    setNoShowCharge(r?.no_show_charge != null ? String(Number(r.no_show_charge)) : "");
    setRefundAmount(r?.refund_amount != null ? String(Number(r.refund_amount)) : "");
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "service-requests", status],
    queryFn: () => api.get<any>("/admin/service-requests", { status }),
    refetchInterval: 30000,
  });
  const rows: any[] = (data as any)?.data || [];

  const act = async (action: "quote" | "processing" | "completed" | "rejected") => {
    if (!selected) return;
    setBusy(action);
    try {
      const payload: any = { action, adminNotes };
      if (isQuotable && (action === "quote" || action === "completed")) {
        payload.airlineFee = Number(airlineFee) || 0;
        payload.serviceCharge = Number(serviceCharge) || 0;
        payload.noShowCharge = Number(noShowCharge) || 0;
        if (isRefundable) payload.refundAmount = computedRefund;
      }
      const res: any = await api.put(`/admin/service-requests/${selected.id}`, payload);
      toast({
        title: action === "quote" ? "Quotation sent" : "Request updated",
        description: res?.credited
          ? `Approved. ৳${Number(res.refundAmount || 0).toLocaleString()} credited to the customer balance.`
          : action === "quote"
            ? isRefundable
              ? `Customer will see the ৳${computedRefund.toLocaleString()} refund quotation for approval.`
              : `Customer will see the ৳${deductions.toLocaleString()} reissue charge quotation for approval.`
            : `Marked as ${action}.`,
      });
      setSelected(null); setAdminNotes(""); setAirlineFee(""); setServiceCharge(""); setNoShowCharge(""); setRefundAmount("");
      queryClient.invalidateQueries({ queryKey: ["admin", "service-requests"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message || "Error", variant: "destructive" });
    } finally { setBusy(null); }
  };



  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Void / Reissue / Refund Requests</h1>
        <p className="text-sm text-muted-foreground">Customer post-ticket service requests awaiting action.</p>
      </div>

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="quoted">Quoted</TabsTrigger>
          <TabsTrigger value="accepted">Accepted</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>


      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{rows.length} request{rows.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No requests in this status.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = TYPE_META[r.type] || { label: r.type, icon: XCircle, tone: "bg-muted text-muted-foreground" };
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge className={`border-0 ${meta.tone}`}><meta.icon className="w-3 h-3 mr-1" />{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.booking_ref || r.booking_id}</TableCell>
                      <TableCell className="font-mono text-xs">{r.pnr || r.booking_pnr || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <p className="font-semibold">{r.user_name || "—"}</p>
                        <p className="text-muted-foreground">{r.user_email || r.user_phone || ""}</p>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmt(r.created_at)}</TableCell>
                      <TableCell>
                        <Badge className={`border-0 uppercase text-[10px] ${STATUS_TONE[String(r.status)] || "bg-muted"}`}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openRequest(r)}>Review</Button>
                      </TableCell>

                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setAdminNotes(""); setAirlineFee(""); setServiceCharge(""); setRefundAmount(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{TYPE_META[selected?.type]?.label || "Request"} — {selected?.booking_ref}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-xs text-muted-foreground">PNR</span><p className="font-mono font-bold">{selected.pnr || selected.booking_pnr || "—"}</p></div>
                <div><span className="text-xs text-muted-foreground">Booking Status</span><p className="font-bold">{selected.booking_status}</p></div>
                <div><span className="text-xs text-muted-foreground">Ticket Amount</span><p className="font-bold">৳{ticketAmount.toLocaleString()}</p></div>
                <div><span className="text-xs text-muted-foreground">Requested</span><p>{fmt(selected.created_at)}</p></div>
              </div>
              {selected.notes && (
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Customer Note</p>
                  <p>{selected.notes}</p>
                </div>
              )}

              {isQuotable && (
                <div className="rounded-lg border-2 border-emerald-500/30 p-3 space-y-3 bg-emerald-500/5">
                  <p className="text-xs font-bold uppercase text-emerald-700">
                    {isRefundable ? "Refund Quotation" : "Reissue Charge Quotation"}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">{isRefundable ? "Airlines Refund Fee (৳)" : "Airlines Reissue Fee (৳)"}</Label>
                      <Input
                        type="number" min={0} value={airlineFee}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAirlineFee(v);
                          setRefundAmount(String(Math.max(0, ticketAmount - (Number(v) || 0) - (Number(serviceCharge) || 0) - (Number(noShowCharge) || 0))));
                        }}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Service Charge (৳)</Label>
                      <Input
                        type="number" min={0} value={serviceCharge}
                        onChange={(e) => {
                          const v = e.target.value;
                          setServiceCharge(v);
                          setRefundAmount(String(Math.max(0, ticketAmount - (Number(airlineFee) || 0) - (Number(v) || 0) - (Number(noShowCharge) || 0))));
                        }}
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">No-Show Charge (৳)</Label>
                      <Input
                        type="number" min={0} value={noShowCharge}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNoShowCharge(v);
                          setRefundAmount(String(Math.max(0, ticketAmount - (Number(airlineFee) || 0) - (Number(serviceCharge) || 0) - (Number(v) || 0))));
                        }}
                        placeholder="0"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Passenger did not fly and did not cancel before departure (no-show penalty).
                      </p>
                    </div>
                    {isRefundable && (
                      <div className="col-span-2">
                        <Label className="text-xs">Refundable Amount (৳)</Label>
                        <Input
                          type="number" min={0} value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          placeholder={String(ticketAmount)}
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isRefundable ? (
                      <>
                        Quotation: ৳{ticketAmount.toLocaleString()} − ৳{(Number(airlineFee) || 0).toLocaleString()} (airline) − ৳{(Number(serviceCharge) || 0).toLocaleString()} (service) − ৳{(Number(noShowCharge) || 0).toLocaleString()} (no-show) ={" "}
                        <strong>৳{computedRefund.toLocaleString()}</strong>
                      </>
                    ) : (
                      <>Total payable charges: <strong>৳{deductions.toLocaleString()}</strong></>
                    )}
                  </p>
                  <p className={`text-xs font-semibold ${customerAccepted ? "text-emerald-600" : "text-warning"}`}>
                    {customerAccepted
                      ? `Customer accepted on ${fmt(selected.customer_accepted_at)} — you can approve now.`
                      : "Send the quotation first; approval unlocks after the customer agrees."}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-1">Admin Note</p>
                <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} placeholder="Visible to the customer" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            {isQuotable && (
              <Button variant="secondary" onClick={() => act("quote")} disabled={!!busy}>
                {busy === "quote" ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending…</> : "Send Quotation"}
              </Button>
            )}
            <Button variant="outline" onClick={() => act("processing")} disabled={!!busy}>Mark Processing</Button>
            <Button variant="destructive" onClick={() => act("rejected")} disabled={!!busy}>Reject</Button>
            <Button onClick={() => act("completed")} disabled={!!busy || (isQuotable && !customerAccepted)}>
              {busy === "completed" ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</> : isRefundable ? "Approve & Refund" : "Mark Completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


    </div>
  );
};

export default AdminServiceRequests;
