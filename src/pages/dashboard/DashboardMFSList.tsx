import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Smartphone, Copy, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const mfsColors: Record<string, { bg: string; text: string; border: string }> = {
  bkash: { bg: "bg-pink-50 dark:bg-pink-500/10", text: "text-pink-700 dark:text-pink-400", border: "border-pink-200 dark:border-pink-500/20" },
  nagad: { bg: "bg-orange-50 dark:bg-orange-500/10", text: "text-orange-700 dark:text-orange-400", border: "border-orange-200 dark:border-orange-500/20" },
  rocket: { bg: "bg-purple-50 dark:bg-purple-500/10", text: "text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-500/20" },
  upay: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-500/20" },
};

const DashboardMFSList = () => {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "mfs-list"],
    queryFn: () => api.get<any>("/dashboard/mfs-accounts"),
  });

  const accounts = ((data as any)?.accounts || (data as any)?.data || []) as any[];

  const copyNumber = (number: string, id: string) => {
    navigator.clipboard.writeText(number);
    setCopiedId(id);
    toast({ title: "Copied!", description: "MFS number copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">MFS Account List</h1>
        <Badge variant="outline" className="text-xs">{accounts.length} Accounts</Badge>
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        {accounts.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No MFS accounts configured</p>
              <p className="text-sm mt-1">Admin will configure bKash, Nagad, and other MFS accounts.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acc: any, i: number) => {
              const provider = (acc.provider || acc.type || 'bkash').toLowerCase();
              const colors = mfsColors[provider] || mfsColors.bkash;
              return (
                <Card key={acc.id || i} className={`${colors.border} hover:shadow-md transition-all`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center`}>
                        <Smartphone className={`w-5 h-5 ${colors.text}`} />
                      </div>
                      <div>
                        <p className="font-semibold capitalize">{acc.provider || acc.type || 'bKash'}</p>
                        <p className="text-xs text-muted-foreground">{acc.accountType || 'Merchant'}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Number</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{acc.number || acc.phone}</span>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyNumber(acc.number || acc.phone, acc.id || String(i))}>
                            {copiedId === (acc.id || String(i)) ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </Button>
                        </div>
                      </div>
                      {acc.name && <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{acc.name}</span></div>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DataLoader>
    </div>
  );
};

export default DashboardMFSList;
