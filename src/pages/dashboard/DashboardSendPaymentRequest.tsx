import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, CheckCircle, X, FileImage } from "lucide-react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

const DashboardSendPaymentRequest = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bookingRef, setBookingRef] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [sent, setSent] = useState(false);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      return api.upload("/dashboard/payment-requests", formData);
    },
    onSuccess: () => {
      setSent(true);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Request Sent", description: "Your payment request has been submitted to admin." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to send request", variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const removeSlip = () => {
    setSlipFile(null);
    setSlipPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = () => {
    if (!bookingRef || !amount) {
      toast({ title: "Missing fields", description: "Please fill booking ref and amount.", variant: "destructive" });
      return;
    }
    const fd = new FormData();
    fd.append("bookingRef", bookingRef);
    fd.append("amount", amount);
    if (method) fd.append("paymentMethod", method);
    if (notes) fd.append("notes", notes);
    if (slipFile) fd.append("depositSlip", slipFile);
    mutation.mutate(fd);
  };

  if (sent) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Send Payment Request</h1>
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Payment Request Sent!</h2>
            <p className="text-muted-foreground mb-4">Your payment request for booking <strong>{bookingRef}</strong> has been submitted. Admin will review and process it shortly.</p>
            <Button onClick={() => { setSent(false); setBookingRef(""); setAmount(""); setMethod(""); setNotes(""); removeSlip(); }}>Send Another</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Send Payment Request</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Request Payment Link</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Booking Reference *</Label>
              <Input placeholder="e.g. BK-XXXXXX" value={bookingRef} onChange={e => setBookingRef(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Amount (BDT) *</Label>
              <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Preferred Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">Bank Transfer</SelectItem>
                <SelectItem value="bkash">bKash</SelectItem>
                <SelectItem value="nagad">Nagad</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="balance">Wallet Balance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Deposit Slip Upload */}
          <div className="space-y-2">
            <Label>Deposit Slip / Payment Receipt</Label>
            {slipPreview ? (
              <div className="relative inline-block">
                <img src={slipPreview} alt="Deposit slip" className="max-h-40 rounded-lg border border-border object-contain" />
                <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={removeSlip}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              >
                <FileImage className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload deposit slip</p>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG or PDF — Max 5MB</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea placeholder="Any additional notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="gap-1.5">
            <Send className="w-4 h-4" /> {mutation.isPending ? 'Sending...' : 'Send Request'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardSendPaymentRequest;
