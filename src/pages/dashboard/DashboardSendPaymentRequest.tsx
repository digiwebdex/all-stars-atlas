import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, CheckCircle } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const DashboardSendPaymentRequest = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bookingRef, setBookingRef] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: any) => api.post("/dashboard/payment-requests", data),
    onSuccess: () => {
      setSent(true);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Request Sent", description: "Your payment request has been submitted to admin." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to send request", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!bookingRef || !amount) {
      toast({ title: "Missing fields", description: "Please fill booking ref and amount.", variant: "destructive" });
      return;
    }
    mutation.mutate({ bookingRef, amount: Number(amount), paymentMethod: method, notes });
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
            <Button onClick={() => { setSent(false); setBookingRef(""); setAmount(""); setMethod(""); setNotes(""); }}>Send Another</Button>
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
