import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ShieldCheck, Download, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { downloadCSV } from "@/lib/csv-export";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  active: "bg-success/10 text-success",
  expired: "bg-muted text-muted-foreground",
  pending: "bg-warning/10 text-warning",
  cancelled: "bg-destructive/10 text-destructive",
};

const DashboardInsurance = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'insurance', search, filter],
    queryFn: () => api.get('/dashboard/insurance', {
      search: search || undefined,
      status: filter !== 'all' ? filter : undefined,
    }).catch(() => ({ data: [] })),
  });

  const policies = ((data as any)?.data || (data as any)?.policies || []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> Insurance
            <Badge variant="secondary" className="text-[10px]">new</Badge>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Your travel insurance policies</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          downloadCSV('insurance', ['Policy #', 'Type', 'Coverage', 'Valid From', 'Valid To', 'Status'],
            policies.map((p: any) => [p.policyNo, p.type, p.coverage, p.validFrom, p.validTo, p.status]));
          toast({ title: "Exported" });
        }}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search policies..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card>
          <CardContent className="p-0 table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Coverage</TableHead>
                  <TableHead className="hidden md:table-cell">Valid From</TableHead>
                  <TableHead className="hidden md:table-cell">Valid To</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No insurance policies found
                    </TableCell>
                  </TableRow>
                ) : policies.map((p: any) => (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs font-medium">{p.policyNo}</TableCell>
                    <TableCell className="text-sm capitalize">{p.type}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">৳{Number(p.coverage || 0).toLocaleString()}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{p.validFrom}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{p.validTo}</TableCell>
                    <TableCell className="font-semibold text-sm">৳{Number(p.premium || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${statusColors[p.status] || ''}`}>{p.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </DataLoader>
    </div>
  );
};

export default DashboardInsurance;
