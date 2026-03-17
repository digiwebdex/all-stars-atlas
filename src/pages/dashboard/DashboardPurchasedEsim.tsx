import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Smartphone, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useNavigate } from "react-router-dom";

const statusColors: Record<string, string> = {
  active: "bg-success/10 text-success",
  expired: "bg-muted text-muted-foreground",
  pending: "bg-warning/10 text-warning",
  used: "bg-primary/10 text-primary",
};

const DashboardPurchasedEsim = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'purchased-esim', search, filter],
    queryFn: () => api.get('/dashboard/purchased-esim', {
      search: search || undefined,
      status: filter !== 'all' ? filter : undefined,
    }).catch(() => ({ data: [] })),
  });

  const esims = ((data as any)?.data || (data as any)?.esims || []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            Purchased e-Sim
            <Badge variant="secondary" className="text-[10px]">new</Badge>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Your purchased eSIM plans</p>
        </div>
        <Button onClick={() => navigate('/dashboard/esim')} className="gap-1.5">
          <Smartphone className="w-4 h-4" /> Search Now
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Enter Search Word..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
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
                  <TableHead>Order #</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="hidden sm:table-cell">Data</TableHead>
                  <TableHead className="hidden md:table-cell">Validity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {esims.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No Data Found
                    </TableCell>
                  </TableRow>
                ) : esims.map((e: any) => (
                  <TableRow key={e.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs font-medium">{e.orderNo || e.id}</TableCell>
                    <TableCell className="text-sm">{e.country}</TableCell>
                    <TableCell className="text-sm font-medium">{e.planName}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{e.data}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.validity}</TableCell>
                    <TableCell className="font-semibold text-sm">৳{Number(e.price || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${statusColors[e.status] || ''}`}>{e.status}</Badge>
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

export default DashboardPurchasedEsim;
