import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, BookOpen, Calendar } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";

const DashboardAccountLedger = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [perPage, setPerPage] = useState("20");
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'account-ledger', search, page, perPage, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: () => api.get('/dashboard/transactions', {
      search: search || undefined,
      page, limit: Number(perPage),
      startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
      endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
    }),
  });

  const resolved = (data as any) || {};
  const transactions = (resolved?.data || resolved?.transactions || []).map((t: any) => ({
    id: t.id,
    transactionId: t.transactionId || t.reference || `TXN${String(t.id).padStart(8, '0')}`,
    reference: t.reference || t.bookingRef || '—',
    runningBalance: t.runningBalance ?? t.balance ?? 0,
    debit: t.debit ?? (t.entryType === 'debit' ? t.amount : 0) ?? 0,
    credit: t.credit ?? (t.entryType === 'credit' ? t.amount : 0) ?? 0,
    date: t.date || t.createdAt || '—',
    description: t.description || t.notes || '—',
  }));

  const totalCredits = transactions.reduce((s: number, t: any) => s + (Number(t.credit) || 0), 0);
  const totalDebits = transactions.reduce((s: number, t: any) => s + (Number(t.debit) || 0), 0);
  const total = resolved?.total || transactions.length;
  const totalPages = Math.ceil(total / Number(perPage)) || 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Account Ledger</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Complete transaction history with running balance</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-success/10 text-success border-success/30 px-3 py-1.5 text-sm font-semibold">
            Credits: ৳{totalCredits.toLocaleString()}
          </Badge>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 px-3 py-1.5 text-sm font-semibold">
            Debits: ৳{totalDebits.toLocaleString()}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by transaction ID, reference..." className="pl-10" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 gap-1.5">
              <Calendar className="w-4 h-4" />
              {startDate ? format(startDate, 'dd MMM') : 'Start Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 gap-1.5">
              <Calendar className="w-4 h-4" />
              {endDate ? format(endDate, 'dd MMM') : 'End Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent mode="single" selected={endDate} onSelect={setEndDate} />
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" className="h-10" onClick={() => {
          downloadCSV('account-ledger', ['Transaction ID', 'Reference', 'Running Balance', 'Debit', 'Credit'],
            transactions.map((t: any) => [t.transactionId, t.reference, t.runningBalance, t.debit, t.credit]));
          toast({ title: "Exported", description: "Account ledger CSV downloaded." });
        }}><Download className="w-4 h-4 mr-1.5" /> Download CSV</Button>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card>
          <CardContent className="p-0 table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Running Balance</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No transactions found
                    </TableCell>
                  </TableRow>
                ) : transactions.map((txn: any) => (
                  <TableRow key={txn.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs font-medium">{txn.transactionId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs bg-primary/5">{txn.reference}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">৳{Number(txn.runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right text-sm text-destructive font-medium">{Number(txn.debit) > 0 ? `৳${Number(txn.debit).toLocaleString()}` : '0'}</TableCell>
                    <TableCell className="text-right text-sm text-success font-medium">{Number(txn.credit) > 0 ? `৳${Number(txn.credit).toLocaleString()}` : '0'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Show</span>
          <Select value={perPage} onValueChange={v => { setPerPage(v); setPage(1); }}>
            <SelectTrigger className="w-[70px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="20">20</SelectItem><SelectItem value="50">50</SelectItem></SelectContent>
          </Select>
          <span className="text-muted-foreground">per page • {total} items</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <Button variant="outline" size="sm" className="h-8 w-8 bg-primary text-primary-foreground">{page}</Button>
          <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
};

export default DashboardAccountLedger;
