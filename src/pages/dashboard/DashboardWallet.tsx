import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, ArrowUpRight, ArrowDownLeft, Plus, CreditCard, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { downloadCSV } from "@/lib/csv-export";
import { useToast } from "@/hooks/use-toast";

const DashboardWallet = () => {
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "wallet"],
    queryFn: () => api.get<any>("/dashboard/wallet"),
  });

  const wallet = (data as any) || {};
  const balance = wallet.balance ?? 0;
  const transactions = wallet.transactions || [];

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
                <Button size="sm" className="gap-1.5">
                  <Plus className="w-4 h-4" /> Add Funds
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Send className="w-4 h-4" /> Transfer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:border-primary/30 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Issue With Balance</p>
                <p className="text-xs text-muted-foreground">Pay for bookings using wallet</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
                <ArrowDownLeft className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold">Total Credited</p>
                <p className="text-xs text-muted-foreground">৳{wallet.totalCredited?.toLocaleString() || '0.00'}</p>
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
                <p className="text-xs text-muted-foreground">৳{wallet.totalDebited?.toLocaleString() || '0.00'}</p>
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
    </div>
  );
};

export default DashboardWallet;
