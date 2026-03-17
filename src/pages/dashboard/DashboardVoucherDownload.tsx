import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, Plane } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { generateTicketPDF } from "@/lib/pdf-generator";

const DashboardVoucherDownload = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "bookings", "vouchers", search],
    queryFn: () => api.get<any>("/dashboard/bookings", { search, limit: 100 }),
  });

  const bookings = (Array.isArray(data) ? data : (data as any)?.bookings || [])
    .filter((b: any) => b.pnr || b.details?.pnr);

  const handleDownload = async (booking: any) => {
    setDownloading(booking.id);
    try {
      await generateTicketPDF(booking);
      toast({ title: "Downloaded", description: "Voucher PDF downloaded successfully." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to generate PDF", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Voucher Download</h1>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by PNR or booking ID..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" /> Booking Vouchers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking ID</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                      No vouchers available
                    </TableCell>
                  </TableRow>
                ) : bookings.map((b: any) => {
                  const route = b.details?.origin && b.details?.destination
                    ? `${b.details.origin} → ${b.details.destination}` : b.route || '—';

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
                      <TableCell className="text-xs">{b.created_at ? new Date(b.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {b.status?.charAt(0).toUpperCase() + b.status?.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={downloading === b.id}
                          onClick={() => handleDownload(b)}
                          className="gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {downloading === b.id ? 'Generating...' : 'Download'}
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
    </div>
  );
};

export default DashboardVoucherDownload;
