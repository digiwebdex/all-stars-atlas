import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XCircle, Search, Plane, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const DashboardCancelBooking = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "bookings", "cancellable", search],
    queryFn: () => api.get<any>("/dashboard/bookings", { search, limit: 100 }),
  });

  const bookings = (Array.isArray(data) ? data : (data as any)?.bookings || [])
    .filter((b: any) => ['on_hold', 'confirmed', 'pending'].includes(b.status));

  const cancelMutation = useMutation({
    mutationFn: (data: { bookingId: string; reason: string }) =>
      api.post("/flights/cancel", { bookingId: data.bookingId, reason: data.reason }),
    onSuccess: () => {
      setCancelTarget(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Booking Cancelled", description: "Your booking has been cancelled successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Cancellation Failed", description: err.message || "Failed to cancel", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Cancel Booking</h1>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by PNR or booking ID..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" /> Active Bookings
            </CardTitle>
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
                      No cancellable bookings found
                    </TableCell>
                  </TableRow>
                ) : bookings.map((b: any) => {
                  const route = b.details?.origin && b.details?.destination
                    ? `${b.details.origin} → ${b.details.destination}` : b.route || '—';
                  const amount = Number(b.amount || b.total_amount || b.details?.totalAmount || 0);

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
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          {b.status === 'on_hold' ? 'Reserved' : b.status?.charAt(0).toUpperCase() + b.status?.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">৳{amount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="destructive" onClick={() => setCancelTarget(b)} className="gap-1.5">
                          <XCircle className="w-3.5 h-3.5" /> Cancel
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

      {/* Cancel Confirmation Dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Cancel Booking
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. The booking will be permanently cancelled.
            </DialogDescription>
          </DialogHeader>
          {cancelTarget && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
                <p><strong>Booking:</strong> {cancelTarget.booking_ref || cancelTarget.id?.slice(0, 8)}</p>
                <p><strong>PNR:</strong> {cancelTarget.pnr || cancelTarget.details?.pnr || '—'}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason for cancellation</label>
                <Textarea
                  placeholder="Please provide a reason..."
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep Booking</Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelTarget && cancelMutation.mutate({ bookingId: cancelTarget.id, reason })}
              className="gap-1.5"
            >
              <XCircle className="w-4 h-4" />
              {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardCancelBooking;
