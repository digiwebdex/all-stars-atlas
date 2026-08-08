import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, ImageIcon, Pencil, X, FileImage, Download } from "lucide-react";
import { api } from "@/lib/api";
import { fileUrl } from "@/lib/config";
import { useToast } from "@/hooks/use-toast";
import DataLoader from "@/components/DataLoader";

const statusColors: Record<string, string> = {
  Pending: "bg-warning/10 text-warning border-warning/20",
  Approved: "bg-success/10 text-success border-success/20",
  Rejected: "bg-destructive/10 text-destructive border-destructive/20",
};

const MyPaymentRequests = () => {
  const { toast } = useToast();
  const [viewItem, setViewItem] = useState<any>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [txnId, setTxnId] = useState("");
  const [notes, setNotes] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "payment-requests"],
    queryFn: () => api.get("/dashboard/payment-requests"),
  });

  const items = ((data as any)?.data || []) as any[];

  const openEdit = (item: any) => {
    setEditItem(item);
    setAmount(String(item.amount || ""));
    setTxnId(item.transactionId || "");
    setNotes(item.notes || "");
    setSlipFile(null);
    setSlipPreview(null);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB allowed", variant: "destructive" });
      return;
    }
    setSlipFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setSlipPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (amount) fd.append("amount", amount);
      fd.append("transactionId", txnId);
      fd.append("notes", notes);
      if (slipFile) fd.append("depositSlip", slipFile);
      await api.upload(`/dashboard/payment-requests/${editItem.id}/update`, fd);
      toast({ title: "Updated", description: "Your request has been corrected." });
      setEditItem(null);
      refetch();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message || "Could not update request", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const SlipPreview = ({ url }: { url: string }) => (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">Payment Slip</p>
      <div className="border rounded-lg overflow-hidden bg-muted/30">
        {/\.pdf$/i.test(url) ? (
          <iframe src={fileUrl(url)} title="Payment slip" className="w-full h-64 bg-background" />
        ) : (
          <img src={fileUrl(url)} alt="Payment slip" className="w-full max-h-64 object-contain cursor-pointer" onClick={() => window.open(fileUrl(url), "_blank")} />
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs" onClick={() => window.open(fileUrl(url), "_blank")}>
          <Eye className="w-3 h-3 mr-1" /> View Full
        </Button>
        <a href={fileUrl(url)} download target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" className="text-xs"><Download className="w-3 h-3 mr-1" /> Download</Button>
        </a>
      </div>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">My Payment & Deposit Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0 table-responsive">
          <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead className="hidden md:table-cell">Transaction ID</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Slip</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">No payment requests yet</TableCell></TableRow>
                ) : items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell><p className="font-mono text-xs">{item.reference}</p><p className="text-[10px] text-muted-foreground">{item.bookingRef || item.type}</p></TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs">{item.transactionId || "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">৳{Number(item.amount || 0).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${statusColors[item.status] || ""}`}>{item.status}</Badge></TableCell>
                    <TableCell>
                      {item.receiptUrl ? (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-primary" title="View payment slip" onClick={() => setViewItem(item)}>
                          <ImageIcon className="w-3.5 h-3.5" />
                        </Button>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View details" onClick={() => setViewItem(item)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {item.editable && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit request" onClick={() => openEdit(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataLoader>
        </CardContent>
      </Card>

      {/* View dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Request Detail</DialogTitle></DialogHeader>
          {viewItem && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Reference</p><p className="font-bold font-mono">{viewItem.reference}</p></div>
                <div><p className="text-xs text-muted-foreground">Amount</p><p className="font-bold text-primary text-lg">৳{Number(viewItem.amount || 0).toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Transaction ID</p><p className="font-bold font-mono break-all">{viewItem.transactionId || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="outline" className={statusColors[viewItem.status] || ""}>{viewItem.status}</Badge></div>
              </div>
              {viewItem.notes && <div><p className="text-xs text-muted-foreground">Notes</p><p className="text-sm bg-muted/50 p-2 rounded">{viewItem.notes}</p></div>}
              {viewItem.receiptUrl ? <SlipPreview url={viewItem.receiptUrl} /> : <p className="text-xs text-muted-foreground">No payment slip uploaded.</p>}
              {viewItem.editable && (
                <Button size="sm" variant="outline" onClick={() => { openEdit(viewItem); setViewItem(null); }}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Edit Request
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={() => setEditItem(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Payment Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (৳)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Transaction ID</Label>
              <Input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="e.g. TRX8837261 / bank slip number" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Replace Payment Slip</Label>
              {slipPreview ? (
                <div className="relative inline-block">
                  <img src={slipPreview} alt="New slip" className="max-h-32 rounded-lg border border-border object-contain" />
                  <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={() => { setSlipFile(null); setSlipPreview(null); if (fileRef.current) fileRef.current.value = ""; }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors">
                  <FileImage className="w-7 h-7 mx-auto text-muted-foreground mb-1.5" />
                  <p className="text-xs text-muted-foreground">Upload corrected slip (JPG, PNG, PDF — Max 5MB)</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
              {!slipPreview && editItem?.receiptUrl && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => window.open(fileUrl(editItem.receiptUrl), "_blank")}>
                  <Eye className="w-3 h-3 mr-1" /> View current slip
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MyPaymentRequests;
