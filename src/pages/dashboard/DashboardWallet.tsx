import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, ArrowUpRight, ArrowDownLeft, Plus, Send, CreditCard, Smartphone, Building2, Banknote, FileImage, X, Copy, Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState, useRef } from "react";
import { downloadCSV } from "@/lib/csv-export";
import { useToast } from "@/hooks/use-toast";
import { usePaymentGatewayStatus } from "@/hooks/usePaymentGateways";

const PAYMENT_METHODS = [
  { id: "ssl", label: "Card / Bank", icon: CreditCard, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-500/20", gateway: "ssl" },
  { id: "bkash", label: "bKash", icon: Smartphone, color: "text-pink-600", bg: "bg-pink-100 dark:bg-pink-500/20", gateway: "bkash" },
  { id: "nagad", label: "Nagad", icon: Smartphone, color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-500/20", gateway: "nagad" },
  { id: "bank", label: "Bank Transfer", icon: Building2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-500/20", gateway: null },
] as const;

const DashboardWallet = () => {
  const { toast } = useToast();
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [fundMethod, setFundMethod] = useState("ssl");
  const [fundLoading, setFundLoading] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  // Deposit slip state
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [depositNotes, setDepositNotes] = useState("");
  const [depositTxnId, setDepositTxnId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [copiedAcct, setCopiedAcct] = useState<string | null>(null);
  const [selectedBankIdx, setSelectedBankIdx] = useState<string>("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "wallet"],
    queryFn: () => api.get<any>("/dashboard/wallet"),
  });

  const { data: gwStatus } = usePaymentGatewayStatus();
  
  // Fetch bank accounts when bank method is selected
  const { data: bankData } = useQuery({
    queryKey: ["dashboard", "bank-list"],
    queryFn: () => api.get<any>("/dashboard/bank-accounts"),
    enabled: fundMethod === "bank" && addFundsOpen,
  });
  const bankAccounts = ((bankData as any)?.banks || (bankData as any)?.data || []) as any[];

  const wallet = (data as any) || {};
  const balance = wallet.balance ?? 0;
  const transactions = wallet.transactions || [];
  const totalCredited = wallet.totalCredited ?? 0;
  const totalDebited = wallet.totalDebited ?? 0;

  const availableMethods = PAYMENT_METHODS.filter((m) => {
    if (!m.gateway) return true;
    if (!gwStatus) return true;
    return (gwStatus as any)[m.gateway]?.enabled !== false;
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

  const resetAddFunds = () => {
    setAddFundsOpen(false);
    setFundAmount("");
    setFundMethod("ssl");
    removeSlip();
    setDepositNotes("");
    setDepositTxnId("");
  };

  const handleAddFunds = async () => {
    const amt = Number(fundAmount);
    if (!amt || amt < 10) {
      toast({ title: "Invalid amount", description: "Minimum amount is ৳10", variant: "destructive" });
      return;
    }
    if (amt > 500000) {
      toast({ title: "Amount too high", description: "Maximum single deposit is ৳500,000", variant: "destructive" });
      return;
    }

    setFundLoading(true);
    try {
      if (fundMethod === "bank") {
        if (!depositTxnId.trim()) {
          toast({ title: "Transaction ID required", description: "Please enter the bank/mobile transaction ID of your deposit.", variant: "destructive" });
          setFundLoading(false);
          return;
        }
        // Bank transfer: send as multipart with optional deposit slip
        const fd = new FormData();
        fd.append("amount", String(amt));
        fd.append("method", "bank");
        fd.append("transactionId", depositTxnId.trim());
        if (depositNotes) fd.append("notes", depositNotes);
        if (slipFile) fd.append("depositSlip", slipFile);
        await api.upload("/dashboard/wallet/deposit", fd);
        toast({ title: "Deposit request submitted", description: `৳${amt.toLocaleString()} deposit request sent. Admin will review and approve it.` });
        resetAddFunds();
        refetch();
      } else if (fundMethod === "ssl") {
        const result = await api.post<any>("/payments/ssl/init", {
          amount: amt, purpose: "wallet_topup", customerName: "Wallet Top-up", customerEmail: "",
        });
        if (result?.gatewayUrl) { window.location.href = result.gatewayUrl; }
        else { toast({ title: "Payment gateway error", description: "Could not initiate payment.", variant: "destructive" }); }
      } else if (fundMethod === "bkash") {
        const result = await api.post<any>("/payments/bkash/create", { amount: amt, purpose: "wallet_topup" });
        if (result?.bkashURL) { window.location.href = result.bkashURL; }
        else { toast({ title: "bKash error", description: "Could not initiate bKash payment.", variant: "destructive" }); }
      } else if (fundMethod === "nagad") {
        const result = await api.post<any>("/payments/nagad/init", { amount: amt, purpose: "wallet_topup" });
        if (result?.redirectUrl) { window.location.href = result.redirectUrl; }
        else { toast({ title: "Nagad error", description: "Could not initiate Nagad payment.", variant: "destructive" }); }
      }
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message || "Could not process deposit", variant: "destructive" });
    } finally {
      setFundLoading(false);
    }
  };

  const handleTransfer = async () => {
    const amt = Number(transferAmount);
    if (!transferTo.trim()) {
      toast({ title: "Recipient required", description: "Enter email or phone of recipient", variant: "destructive" });
      return;
    }
    if (!amt || amt < 1) {
      toast({ title: "Invalid amount", description: "Enter a valid transfer amount", variant: "destructive" });
      return;
    }
    if (amt > balance) {
      toast({ title: "Insufficient balance", description: `Your balance is ৳${Number(balance).toLocaleString()}`, variant: "destructive" });
      return;
    }

    setTransferLoading(true);
    try {
      await api.post("/dashboard/wallet/transfer", {
        recipientIdentifier: transferTo.trim(), amount: amt, note: transferNote.trim() || undefined,
      });
      toast({ title: "Transfer successful", description: `৳${amt.toLocaleString()} sent to ${transferTo}` });
      setTransferOpen(false);
      setTransferTo(""); setTransferAmount(""); setTransferNote("");
      refetch();
    } catch (err: any) {
      toast({ title: "Transfer failed", description: err?.message || "Could not complete transfer", variant: "destructive" });
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">My Wallet</h1>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        {/* Balance Card */}
        <Card className="bg-gradient-to-br from-primary/10 via-card to-accent/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Wallet className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Available Balance</p>
                  <p className="text-3xl font-bold text-foreground">৳{Number(balance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="gap-1.5" onClick={() => setAddFundsOpen(true)}>
                  <Plus className="w-4 h-4" /> Add Funds
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => setTransferOpen(true)}>
                  <Send className="w-4 h-4" /> Transfer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
                <ArrowDownLeft className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Total Credited</p>
                <p className="text-xs text-muted-foreground">৳{Number(totalCredited).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center">
                <ArrowUpRight className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Total Debited</p>
                <p className="text-xs text-muted-foreground">৳{Number(totalDebited).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transaction History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Wallet Transactions</CardTitle>
            <Button variant="outline" size="sm" onClick={() => {
              downloadCSV('wallet-transactions', ['Date', 'Type', 'Amount', 'Balance', 'Description'],
                transactions.map((t: any) => [t.date, t.type, t.amount, t.balance, t.description]));
              toast({ title: "Exported", description: "Wallet transactions CSV downloaded." });
            }}>Export</Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No wallet transactions yet</TableCell></TableRow>
                ) : transactions.map((txn: any, i: number) => (
                  <TableRow key={txn.id || i}>
                    <TableCell className="text-xs">{txn.date || txn.created_at}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={txn.type === 'credit' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'}>
                        {txn.type === 'credit' ? 'Credit' : 'Debit'}
                      </Badge>
                    </TableCell>
                    <TableCell className={`font-semibold ${txn.type === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {txn.type === 'credit' ? '+' : '-'}৳{Math.abs(txn.amount || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">৳{txn.balance?.toLocaleString() || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{txn.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      {/* ── Add Funds Dialog ── */}
      <Dialog open={addFundsOpen} onOpenChange={(v) => { if (!v) resetAddFunds(); else setAddFundsOpen(true); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-primary" /> Add Funds to Wallet
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Amount (৳)</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                min={10}
                className="text-lg font-bold"
              />
              <div className="flex gap-2 mt-2">
                {[500, 1000, 5000, 10000, 50000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setFundAmount(String(amt))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                      fundAmount === String(amt)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    ৳{amt >= 1000 ? `${amt / 1000}K` : amt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Payment Method</Label>
              <div className="grid grid-cols-2 gap-2">
                {availableMethods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setFundMethod(m.id)}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${
                      fundMethod === m.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg ${m.bg} flex items-center justify-center`}>
                      <m.icon className={`w-4 h-4 ${m.color}`} />
                    </div>
                    <span className="text-sm font-semibold">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Deposit slip upload - only for bank transfer */}
            {fundMethod === "bank" && (
              <div className="space-y-3 p-3 rounded-xl bg-muted/50 border border-border">
                {/* Company Bank Accounts */}
                {bankAccounts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground">Transfer to one of these accounts:</p>
                    <Select value={selectedBankIdx} onValueChange={setSelectedBankIdx}>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select a bank account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((bank: any, i: number) => (
                          <SelectItem key={bank.id || i} value={String(i)}>
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-primary shrink-0" />
                              <span className="font-medium">{bank.bankName || bank.name}</span>
                              <span className="text-muted-foreground">— {bank.accountNumber || bank.accNo}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Show selected bank details */}
                    {selectedBankIdx !== "" && bankAccounts[Number(selectedBankIdx)] && (() => {
                      const bank = bankAccounts[Number(selectedBankIdx)];
                      return (
                        <div className="p-2.5 rounded-lg bg-background border border-primary/20 text-xs space-y-1">
                          <p className="font-semibold text-sm">{bank.bankName || bank.name}</p>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">A/C Name</span>
                            <span className="font-medium">{bank.accountName || bank.accName}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">A/C Number</span>
                            <div className="flex items-center gap-1">
                              <span className="font-mono font-semibold">{bank.accountNumber || bank.accNo}</span>
                              <button onClick={() => { navigator.clipboard.writeText(bank.accountNumber || bank.accNo); setCopiedAcct(bank.accountNumber || bank.accNo); setTimeout(() => setCopiedAcct(null), 2000); }} className="p-0.5">
                                {copiedAcct === (bank.accountNumber || bank.accNo) ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                              </button>
                            </div>
                          </div>
                          {(bank.branch) && <div className="flex justify-between"><span className="text-muted-foreground">Branch</span><span>{bank.branch}</span></div>}
                          {(bank.routingNumber || bank.routing) && <div className="flex justify-between"><span className="text-muted-foreground">Routing</span><span className="font-mono">{bank.routingNumber || bank.routing}</span></div>}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {bankAccounts.length === 0 && (
                  <p className="text-xs font-semibold text-muted-foreground">
                    Transfer to our bank account (see Bank List in sidebar), then upload deposit slip below.
                  </p>
                )}
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Deposit Slip / Receipt</Label>
                  {slipPreview ? (
                    <div className="relative inline-block">
                      <img src={slipPreview} alt="Deposit slip" className="max-h-32 rounded-lg border border-border object-contain" />
                      <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={removeSlip}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                    >
                      <FileImage className="w-6 h-6 mx-auto text-muted-foreground mb-1" />
                      <p className="text-xs text-muted-foreground">Upload deposit slip (JPG, PNG, PDF — Max 5MB)</p>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Transaction ID <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. TRX8837261 / bank slip number"
                    value={depositTxnId}
                    onChange={(e) => setDepositTxnId(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Deposit request cannot be submitted without a transaction ID.</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1 block">Notes (optional)</Label>
                  <Input
                    placeholder="Any additional information"
                    value={depositNotes}
                    onChange={(e) => setDepositNotes(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetAddFunds}>Cancel</Button>
            <Button onClick={handleAddFunds} disabled={fundLoading || !fundAmount || (fundMethod === "bank" && !depositTxnId.trim())} className="gap-1.5">
              {fundLoading ? "Processing..." : fundMethod === "bank" ? `Submit Deposit ৳${Number(fundAmount || 0).toLocaleString()}` : `Pay ৳${Number(fundAmount || 0).toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Transfer Dialog ── */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Transfer Funds
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">Your Balance</p>
              <p className="text-lg font-bold">৳{Number(balance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Recipient (Email or Phone)</Label>
              <Input placeholder="recipient@email.com or 01XXXXXXXXX" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Amount (৳)</Label>
              <Input type="number" placeholder="Enter amount" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} min={1} className="text-lg font-bold" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Note (Optional)</Label>
              <Input placeholder="What's this for?" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={transferLoading || !transferTo || !transferAmount} className="gap-1.5">
              {transferLoading ? "Sending..." : `Send ৳${Number(transferAmount || 0).toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardWallet;