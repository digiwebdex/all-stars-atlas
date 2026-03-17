import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Users2, Trash2, Edit, Shield, ShieldCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const permissionsList = [
  { id: "bookings", label: "View Bookings" },
  { id: "create_booking", label: "Create Bookings" },
  { id: "payments", label: "View Payments" },
  { id: "reports", label: "View Reports" },
  { id: "travellers", label: "Manage Travellers" },
  { id: "support", label: "Support Tickets" },
];

const DashboardSubUsers = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", role: "viewer", permissions: [] as string[] });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'sub-users'],
    queryFn: () => api.get('/dashboard/sub-users').catch(() => ({ data: [] })),
  });

  const subUsers = ((data as any)?.data || (data as any)?.subUsers || []);

  const addMutation = useMutation({
    mutationFn: (payload: any) => api.post('/dashboard/sub-users', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'sub-users'] });
      toast({ title: "Success", description: "Sub-user added." });
      setShowAdd(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", role: "viewer", permissions: [] });
    },
    onError: () => toast({ title: "Error", description: "Failed to add sub-user.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/dashboard/sub-users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'sub-users'] });
      toast({ title: "Deleted", description: "Sub-user removed." });
    },
  });

  const togglePermission = (perm: string) => {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(perm) ? prev.permissions.filter(p => p !== perm) : [...prev.permissions, perm],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Sub Users</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Manage team members who can access your account</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Sub User
        </Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add New Sub User</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>First Name</Label><Input value={form.firstName} onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} /></div>
              <div><Label>Last Name</Label><Input value={form.lastName} onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(p => ({ ...p, role: v }))}>
                <SelectTrigger className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">Permissions</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {permissionsList.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.permissions.includes(p.id)} onCheckedChange={() => togglePermission(p.id)} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => addMutation.mutate(form)} disabled={addMutation.isPending}>Add User</Button>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      <Users2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No sub-users added yet
                    </TableCell>
                  </TableRow>
                ) : subUsers.map((u: any) => (
                  <TableRow key={u.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium text-sm">{u.first_name || u.name} {u.last_name || ''}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">{u.phone || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize gap-1">
                        {u.role === 'manager' ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className={`text-[10px] ${u.status === 'active' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                        {u.status || 'active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                        if (confirm('Remove this sub-user?')) deleteMutation.mutate(u.id);
                      }}><Trash2 className="w-4 h-4" /></Button>
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

export default DashboardSubUsers;
