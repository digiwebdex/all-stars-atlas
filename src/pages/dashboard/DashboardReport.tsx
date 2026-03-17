import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, BarChart3, Calendar, Filter, RotateCcw } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";

const DashboardReport = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [perPage, setPerPage] = useState("20");
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'report', search, typeFilter, page, perPage, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: () => api.get('/dashboard/bookings', {
      search: search || undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
      page, limit: Number(perPage),
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
      endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
    }),
  });

  const resolved = (data as any) || {};
  const bookings = (resolved?.data || resolved?.bookings || []).map((b: any) => {
    const details = typeof b.details === 'string' ? JSON.parse(b.details || '{}') : (b.details || {});
    const legs = details?.legs || details?.segments || [];
    const origin = details?.origin || legs[0]?.origin || '';
    const destination = details?.destination || legs[legs.length - 1]?.destination || '';
    const route = origin && destination ? `${origin}-${destination}` : '—';
    return {
      id: b.id,
      bookingId: b.booking_ref || b.bookingRef || `BK${String(b.id).padStart(8, '0')}`,
      type: b.trip_type || b.type || 'Oneway',
      route,
      bookingTime: b.created_at || b.date || '—',
      customerPrice: b.total_amount || b.amount || 0,
      status: b.status || 'pending',
      paymentStatus: b.payment_status || 'unpaid',
    };
  });

  const totalPaid = bookings.filter((b: any) => b.paymentStatus === 'paid' || b.status === 'ticketed').reduce((s: number, b: any) => s + Number(b.customerPrice), 0);
  const totalDue = bookings.filter((b: any) => b.paymentStatus !== 'paid' && b.status !== 'ticketed').reduce((s: number, b: any) => s + Number(b.customerPrice), 0);
  const totalRefund = bookings.filter((b: any) => b.status === 'refunded').reduce((s: number, b: any) => s + Number(b.customerPrice), 0);
  const totalVoid = bookings.filter((b: any) => b.status === 'voided').reduce((s: number, b: any) => s + Number(b.customerPrice), 0);
  const totalReissue = bookings.filter((b: any) => b.status === 'reissued').reduce((s: number, b: any) => s + Number(b.customerPrice), 0);

  const total = resolved?.total || bookings.length;
  const totalPages = Math.ceil(total / Number(perPage)) || 1;

  const resetFilters = () => {
    setSearch(""); setTypeFilter("all"); setStartDate(undefined); setEndDate(undefined); setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Sales Report <span className="text-base font-normal text-muted-foreground">Total: {total}</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="oneway">One Way</SelectItem>
              <SelectItem value="return">Return</SelectItem>
              <SelectItem value="multicity">Multi City</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="default" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4" /> More Filter
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 items-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Calendar className="w-4 h-4" />
                {startDate ? format(startDate, 'dd MMM yyyy') : 'Start Date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Calendar className="w-4 h-4" />
                {endDate ? format(endDate, 'dd MMM yyyy') : 'End Date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={endDate} onSelect={setEndDate} />
            </PopoverContent>
          </Popover>
          <Button size="sm" className="h-9" onClick={() => { setPage(1); refetch(); }}>
            <Search className="w-4 h-4 mr-1" /> Search
          </Button>
          <Button variant="destructive" size="sm" className="h-9" onClick={resetFilters}>
            <RotateCcw className="w-4 h-4 mr-1" /> Reset
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Badge className="bg-success text-success-foreground px-3 py-1.5 text-xs font-semibold">Total Paid: ৳{totalPaid.toLocaleString()}</Badge>
        <Badge variant="outline" className="px-3 py-1.5 text-xs font-semibold">Total Due: ৳{totalDue.toLocaleString()}</Badge>
        <Badge className="bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-semibold">Total refund: ৳{totalRefund.toLocaleString()}</Badge>
        <Badge className="bg-warning text-warning-foreground px-3 py-1.5 text-xs font-semibold">Total reissue: ৳{totalReissue.toLocaleString()}</Badge>
        <Badge className="bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold">Total void: ৳{totalVoid.toLocaleString()}</Badge>
      </div>

      <Button variant="outline" size="sm" onClick={() => {
        downloadCSV('sales-report', ['Booking ID', 'Type', 'Route', 'Booking Time', 'Customer Price'],
          bookings.map((b: any) => [b.bookingId, b.type, b.route, b.bookingTime, b.customerPrice]));
        toast({ title: "Exported", description: "Sales report CSV downloaded." });
      }}><Download className="w-4 h-4 mr-1.5" /> Download CSV</Button>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card>
          <CardContent className="p-0 table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking Id</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Booking Time</TableHead>
                  <TableHead className="text-right">Customer Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No bookings found
                    </TableCell>
                  </TableRow>
                ) : bookings.map((b: any) => (
                  <TableRow key={b.id} className="hover:bg-muted/50">
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs bg-primary/5">{b.bookingId}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{b.type}</TableCell>
                    <TableCell className="text-sm font-medium">{b.route}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.bookingTime !== '—' ? new Date(b.bookingTime).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">৳{Number(b.customerPrice).toLocaleString()} BDT</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{total} items</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage(1)}>«</Button>
          <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</Button>
          <Button variant="outline" size="sm" className="h-8 w-8 bg-primary text-primary-foreground">{page}</Button>
          <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</Button>
          <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
        </div>
      </div>
    </div>
  );
};

export default DashboardReport;
