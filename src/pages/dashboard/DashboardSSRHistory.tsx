import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, Download, Utensils, Armchair, Luggage, Accessibility, Baby, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { downloadCSV } from "@/lib/csv-export";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ssrTypeIcons: Record<string, any> = {
  meal: Utensils,
  seat: Armchair,
  baggage: Luggage,
  wheelchair: Accessibility,
  infant: Baby,
};

const ssrStatusColors: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400",
};

const DashboardSSRHistory = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [viewSSR, setViewSSR] = useState<any>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "ssr-history", search],
    queryFn: () => api.get<any>("/dashboard/ssr-history", { params: { search: search || undefined } }),
  });

  const resolved = (data as any) || {};
  const ssrRequests = resolved.data || resolved.ssrHistory || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">SSR History</h1>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
          downloadCSV('ssr-history', ['Booking Ref', 'SSR Type', 'Passenger', 'Details', 'Status', 'Date'],
            ssrRequests.map((s: any) => [s.bookingRef, s.ssrType, s.passengerName, s.details, s.status, s.createdAt]));
          toast({ title: "Exported", description: "SSR history CSV downloaded." });
        }}>
          <Download className="w-4 h-4" /> Export
        </Button>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total SSRs", value: ssrRequests.length, color: "text-primary" },
            { label: "Confirmed", value: ssrRequests.filter((s: any) => s.status === 'confirmed').length, color: "text-emerald-600" },
            { label: "Pending", value: ssrRequests.filter((s: any) => s.status === 'pending').length, color: "text-amber-600" },
            { label: "Rejected", value: ssrRequests.filter((s: any) => s.status === 'rejected').length, color: "text-rose-600" },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by booking ref or passenger..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking Ref</TableHead>
                  <TableHead>SSR Type</TableHead>
                  <TableHead>Passenger</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ssrRequests.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No SSR requests found</TableCell></TableRow>
                ) : ssrRequests.map((ssr: any, i: number) => {
                  const IconComp = ssrTypeIcons[ssr.ssrType?.toLowerCase()] || Utensils;
                  return (
                    <TableRow key={ssr.id || i}>
                      <TableCell className="font-mono text-xs">{ssr.bookingRef || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <IconComp className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm capitalize">{ssr.ssrType || 'N/A'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{ssr.passengerName || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{ssr.details || ssr.description || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ssrStatusColors[ssr.status] || ''}>
                          {ssr.status || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{ssr.createdAt || ssr.date || '—'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setViewSSR(ssr)}><Eye className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      {/* SSR Detail Dialog */}
      <Dialog open={!!viewSSR} onOpenChange={() => setViewSSR(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>SSR Request Details</DialogTitle></DialogHeader>
          {viewSSR && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-muted-foreground text-xs">Booking Ref</p><p className="font-mono font-semibold">{viewSSR.bookingRef}</p></div>
                <div><p className="text-muted-foreground text-xs">SSR Type</p><p className="capitalize font-semibold">{viewSSR.ssrType}</p></div>
                <div><p className="text-muted-foreground text-xs">Passenger</p><p>{viewSSR.passengerName}</p></div>
                <div><p className="text-muted-foreground text-xs">Status</p><Badge variant="outline" className={ssrStatusColors[viewSSR.status] || ''}>{viewSSR.status}</Badge></div>
                <div className="col-span-2"><p className="text-muted-foreground text-xs">Details</p><p>{viewSSR.details || viewSSR.description || 'No details'}</p></div>
                {viewSSR.gdsResponse && <div className="col-span-2"><p className="text-muted-foreground text-xs">GDS Response</p><pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40">{typeof viewSSR.gdsResponse === 'string' ? viewSSR.gdsResponse : JSON.stringify(viewSSR.gdsResponse, null, 2)}</pre></div>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardSSRHistory;
