import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, CheckCircle, Search, Plane, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const statusColors: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  on_hold: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  pending: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  ticketed: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
};

const DashboardIssueWithBalance = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // Fetch wallet balance
  const { data: walletData } = useQuery({
    queryKey: ["dashboard", "wallet"],
    queryFn: () => api.get<any>("/dashboard/wallet"),
  });
  const walletBalance = (walletData as any)?.balance ?? 0;

  // Fetch bookings that can be paid
  const { data: bookingsData, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "bookings", "payable", search],
    queryFn: () => api.get<any>("/dashboard/bookings", { status: "on_hold,pending,confirmed", search, limit: 50 }),
  });

  const bookings = (Array.isArray(bookingsData) ? bookingsData : (bookingsData as any)?.bookings || [])
    .filter((b: any) => {
      const amount = Number(b.amount || b.total_amount || b.details?.totalAmount || 0);
      return amount > 0 && ['on_hold', 'pending', 'confirmed'].includes(b.status);
    });

  // Pay with balance mutation
  const payMutation = useMutation({
    mutationFn: (data: { bookingId: string; amount: number }) =>
      api.post("/dashboard/wallet/pay", data),
    onSuccess: () => {
      setConfirmDialog(false);
      setSelectedBooking(null);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Payment Successful", description: "Booking paid with wallet balance. Ticket will be issued shortly." });
    },
    onError: (err: any) => {
      toast({ title: "Payment Failed", description: err.message || "Insufficient balance or error", variant: "destructive" });
    },
  });

  const handlePay = () => {
    if (!selectedBooking) return;
    const amount = Number(selectedBooking.amount || selectedBooking.total_amount || selectedBooking.details?.totalAmount || 0);
    payMutation.mutate({ bookingId: selectedBooking.id, amount });
  };

  const getAmount = (b: any) => Number(b.amount || b.total_amount || b.details?.totalAmount || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Issue With Balance</h1>

      {/* Wallet Balance Card */}
      <Card className="bg-gradient-to-br from-emerald-50 via-card to-emerald-50/30 dark:from-emerald-500/5 dark:to-emerald-500/5 border-emerald-200 dark:border-emerald-500/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center">
              <Wallet className="w-7 h-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">Available Wallet Balance</p>
              <p className="text-3xl font-bold text-foreground">৳{Number(walletBalance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by PNR or booking ID..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bookings Table */}
      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payable Bookings</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking ID</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                      No payable bookings found
                    </TableCell>
                  </TableRow>
                ) : bookings.map((b: any) => {
                  const amount = getAmount(b);
                  const canAfford = walletBalance >= amount;
                  const route = b.details?.origin && b.details?.destination
                    ? `${b.details.origin} → ${b.details.destination}`
                    : b.route || '—';

                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.booking_ref || b.id?.slice(0, 8)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Plane className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-sm">{route}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{b.pnr || b.details?.pnr || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColors[b.status] || ''}>
                          {b.status === 'on_hold' ? 'Reserved' : b.status?.charAt(0).toUpperCase() + b.status?.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">৳{amount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          disabled={!canAfford}
                          onClick={() => { setSelectedBooking(b); setConfirmDialog(true); }}
                          className="gap-1.5"
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          {canAfford ? 'Pay Now' : 'Insufficient'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      {/* Confirm Payment Dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Balance Payment</DialogTitle>
            <DialogDescription>
              Pay for this booking using your wallet balance.
            </DialogDescription>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-muted-foreground">Booking</Label>
                  <p className="font-medium">{selectedBooking.booking_ref || selectedBooking.id?.slice(0, 8)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">PNR</Label>
                  <p className="font-mono font-medium">{selectedBooking.pnr || selectedBooking.details?.pnr || '—'}</p>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Booking Amount</span>
                  <span className="font-semibold">৳{getAmount(selectedBooking).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Balance</span>
                  <span className="font-semibold text-emerald-600">৳{Number(walletBalance).toLocaleString()}</span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">After Payment</span>
                  <span className="font-semibold">৳{(walletBalance - getAmount(selectedBooking)).toLocaleString()}</span>
                </div>
              </div>
              {walletBalance < getAmount(selectedBooking) && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Insufficient wallet balance</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(false)}>Cancel</Button>
            <Button
              onClick={handlePay}
              disabled={payMutation.isPending || (selectedBooking && walletBalance < getAmount(selectedBooking))}
              className="gap-1.5"
            >
              <CheckCircle className="w-4 h-4" />
              {payMutation.isPending ? 'Processing...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardIssueWithBalance;
