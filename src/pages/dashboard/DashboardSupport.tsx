import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageCircle, Plus, Eye, Clock, CheckCircle, AlertCircle, Send, Headphones } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";

const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning/10 text-warning",
  high: "bg-destructive/10 text-destructive",
  urgent: "bg-destructive text-destructive-foreground",
};

const statusColors: Record<string, string> = {
  open: "bg-warning/10 text-warning",
  in_progress: "bg-primary/10 text-primary",
  resolved: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
};

const DashboardSupport = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");
  const [message, setMessage] = useState("");
  const [viewTicket, setViewTicket] = useState<any>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'support-tickets'],
    queryFn: () => api.get('/dashboard/support-tickets').catch(() => ({ data: [] })),
  });

  const tickets = ((data as any)?.data || (data as any)?.tickets || []);

  const submitMutation = useMutation({
    mutationFn: (payload: any) => api.post('/dashboard/support-tickets', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'support-tickets'] });
      toast({ title: "Ticket Created", description: "Your support ticket has been submitted." });
      setShowNew(false); setSubject(""); setMessage(""); setCategory("general"); setPriority("medium");
    },
    onError: () => toast({ title: "Error", description: "Failed to create ticket.", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!subject.trim() || !message.trim()) {
      toast({ title: "Required", description: "Please fill subject and message.", variant: "destructive" });
      return;
    }
    submitMutation.mutate({ subject, category, priority, message });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Support</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Get help with your bookings and account</p>
        </div>
        <Button onClick={() => setShowNew(!showNew)} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Ticket
        </Button>
      </div>

      {showNew && (
        <Card>
          <CardHeader><CardTitle className="text-base">Create Support Ticket</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="booking">Booking Issue</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                  <SelectItem value="refund">Refund</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Describe your issue in detail..." rows={4} value={message} onChange={e => setMessage(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={submitMutation.isPending} className="gap-1.5">
                <Send className="w-4 h-4" /> Submit Ticket
              </Button>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card>
          <CardContent className="p-0 table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket #</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      <Headphones className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No support tickets yet
                    </TableCell>
                  </TableRow>
                ) : tickets.map((t: any) => (
                  <TableRow key={t.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs">#{t.id}</TableCell>
                    <TableCell className="text-sm font-medium max-w-[200px] truncate">{t.subject}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px] capitalize">{t.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${priorityColors[t.priority] || ''}`}>{t.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${statusColors[t.status] || ''}`}>
                        {t.status === 'in_progress' ? 'In Progress' : t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString('en-GB') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewTicket(t)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Ticket #{t.id}</DialogTitle></DialogHeader>
                          <div className="space-y-3 py-2">
                            <p className="font-semibold">{t.subject}</p>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.message}</p>
                            {t.reply && (
                              <div className="bg-muted rounded-lg p-3 text-sm">
                                <p className="text-xs font-semibold text-primary mb-1">Support Reply:</p>
                                <p>{t.reply}</p>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
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

export default DashboardSupport;
