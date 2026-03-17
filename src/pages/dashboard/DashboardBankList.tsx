import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Copy, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const DashboardBankList = () => {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "bank-list"],
    queryFn: () => api.get<any>("/dashboard/bank-accounts"),
  });

  const banks = ((data as any)?.banks || (data as any)?.data || []) as any[];

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copied!", description: "Account number copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Bank Account List</h1>
        <Badge variant="outline" className="text-xs">{banks.length} Accounts</Badge>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        {banks.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No bank accounts configured</p>
              <p className="text-sm mt-1">Admin will configure bank accounts for payments.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {banks.map((bank: any, i: number) => (
              <Card key={bank.id || i} className="hover:border-primary/30 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{bank.bankName || bank.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Account Name</span>
                    <span className="font-medium">{bank.accountName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Account Number</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{bank.accountNumber}</span>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyToClipboard(bank.accountNumber, bank.id || String(i))}>
                        {copiedId === (bank.id || String(i)) ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </div>
                  {bank.branch && <div className="flex justify-between"><span className="text-muted-foreground">Branch</span><span>{bank.branch}</span></div>}
                  {bank.routingNumber && <div className="flex justify-between"><span className="text-muted-foreground">Routing No.</span><span className="font-mono">{bank.routingNumber}</span></div>}
                  {bank.swiftCode && <div className="flex justify-between"><span className="text-muted-foreground">SWIFT</span><span className="font-mono">{bank.swiftCode}</span></div>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DataLoader>
    </div>
  );
};

export default DashboardBankList;
