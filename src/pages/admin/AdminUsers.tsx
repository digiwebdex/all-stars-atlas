import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MoreHorizontal, Eye, Ban, CheckCircle2, UserPlus, Download, Loader2, Users, UserCheck, UserX, UserCog, FileText, ExternalLink, Shield, Wallet, MinusCircle, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAdminUsers } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import DataLoader from "@/components/DataLoader";

import { downloadCSV } from "@/lib/csv-export";
import { config } from "@/lib/config";

const AdminUsers = () => {
  const [search, setSearch] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showViewUser, setShowViewUser] = useState<any>(null);
  const [showCommission, setShowCommission] = useState<any>(null);
  const [commissionForm, setCommissionForm] = useState({ discountPct: "", aitPct: "", markupPct: "", notes: "" });
  const [newUser, setNewUser] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", role: "customer", canApproveDeposits: false, initialWalletBalance: "" });
  const [actionLoading, setActionLoading] = useState(false);
  const [permForm, setPermForm] = useState({ partial: true, canManageBookings: false, canTogglePartial: false });
  const [permSaving, setPermSaving] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ amount: "", note: "" });
  const [creditForm, setCreditForm] = useState({ amount: "", note: "" });
  const [adjustLoading, setAdjustLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useAdminUsers(search ? { search } : undefined);

  const apiUsers = (data as any)?.users?.map((u: any) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone || "—",
    role: u.role || "customer", status: u.status || "active",
    canApproveDeposits: !!u.canApproveDeposits,
    canManageBookings: !!u.canManageBookings,
    canTogglePartial: !!u.canTogglePartial,
    bookings: u.bookings || 0, joined: u.joined || "—",
    idDocument: u.idDocument || null, idDocType: u.idDocType || null, idVerified: u.idVerified || false,
  })) || [];

  const apiStats = (data as any)?.stats;
  const users = apiUsers;

  const stats = apiStats || {
    total: users.length,
    active: users.filter((u: any) => u.status === "active").length,
    suspended: users.filter((u: any) => u.status === "suspended" || u.status === "inactive").length,
    newThisMonth: 0,
  };

  const filtered = search && apiUsers.length === 0
    ? users.filter((u: any) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users;

  const handleSuspend = async (user: any) => {
    setActionLoading(true);
    try {
      const newVerified = user.status === "active" ? false : true;
      await api.put(`/admin/users/${user.id}`, { emailVerified: newVerified });
      toast({ title: user.status === "active" ? "User Suspended" : "User Activated", description: `${user.name} has been updated` });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Could not update user", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyId = async (user: any, verified: boolean) => {
    setActionLoading(true);
    try {
      await api.put(`/admin/users/${user.id}`, { idVerified: verified });
      toast({ title: verified ? "ID Verified" : "ID Rejected", description: `${user.name}'s identity document has been ${verified ? 'verified' : 'rejected'}.` });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      refetch();
    } catch (err: any) {
      toast({ title: "Updated", description: `ID status updated for ${user.name}.` });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async (user: any) => {
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast({ title: "User Deleted", description: `${user.name} has been removed` });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Could not delete user", variant: "destructive" });
    }
  };

  const handleAddUser = async () => {
    if (!newUser.firstName || !newUser.email || !newUser.password) {
      toast({ title: "Error", description: "First name, email, and password are required", variant: "destructive" });
      return;
    }
    setActionLoading(true);
    try {
      const res = await api.post<any>('/admin/users', newUser);
      toast({ title: "User Created", description: `${newUser.firstName} added. ID: ${res?.userId?.slice(0, 8)}…` });
      setShowAddUser(false);
      setNewUser({ firstName: "", lastName: "", email: "", phone: "", password: "", role: "customer", canApproveDeposits: false, initialWalletBalance: "" });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Could not create user", variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const openCommission = async (user: any) => {
    setShowCommission(user);
    setCommissionForm({ discountPct: "", aitPct: "", markupPct: "", notes: "" });
    try {
      const res = await api.get<any>(`/admin/users/${user.id}/commission`);
      if (res?.override) {
        setCommissionForm({
          discountPct: res.override.discount_pct ?? "",
          aitPct: res.override.ait_pct ?? "",
          markupPct: res.override.markup_pct ?? "",
          notes: res.override.notes || "",
        });
      }
    } catch {}
  };

  const handleSaveCommission = async () => {
    if (!showCommission) return;
    setActionLoading(true);
    try {
      await api.put(`/admin/users/${showCommission.id}/commission`, {
        discountPct: commissionForm.discountPct === "" ? null : Number(commissionForm.discountPct),
        aitPct: commissionForm.aitPct === "" ? null : Number(commissionForm.aitPct),
        markupPct: commissionForm.markupPct === "" ? null : Number(commissionForm.markupPct),
        notes: commissionForm.notes,
      });
      toast({ title: "Commission Saved", description: `Updated for ${showCommission.name}` });
      setShowCommission(null);
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed", variant: "destructive" });
    } finally { setActionLoading(false); }
  };

  const openViewUser = async (u: any) => {
    setShowViewUser(u);
    setPermForm({ partial: false, canManageBookings: !!u.canManageBookings, canTogglePartial: !!u.canTogglePartial });
    try {
      const res = await api.get<any>(`/admin/users/${u.id}/partial-permission`);
      setPermForm(p => ({ ...p, partial: !!res?.enabled }));
    } catch {}
    loadWallet(u.id);
  };

  const loadWallet = async (userId: string) => {
    setWallet(null);
    setAdjustForm({ amount: "", note: "" });
    setWalletLoading(true);
    try {
      const res = await api.get<any>(`/admin/users/${userId}/wallet`);
      setWallet(res);
      setCreditForm({ amount: res?.creditLimit ? String(res.creditLimit) : "", note: res?.creditNote || "" });
    } catch (err: any) {
      toast({ title: "Balance load failed", description: err?.message, variant: "destructive" });
    } finally { setWalletLoading(false); }
  };

  const submitAdjust = async (action: "debit" | "credit") => {
    if (!showViewUser) return;
    const amount = Number(adjustForm.amount);
    if (!amount || amount <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    if (!adjustForm.note.trim()) { toast({ title: "User note is required", description: "Explain why the balance is being adjusted", variant: "destructive" }); return; }
    setAdjustLoading(true);
    try {
      await api.post(`/admin/users/${showViewUser.id}/wallet-adjust`, { action, amount, note: adjustForm.note.trim() });
      toast({ title: action === "debit" ? "Balance debited" : "Balance credited", description: `৳${amount.toLocaleString()} — ${showViewUser.name}` });
      await loadWallet(showViewUser.id);
    } catch (err: any) {
      toast({ title: "Adjustment failed", description: err?.message, variant: "destructive" });
    } finally { setAdjustLoading(false); }
  };

  const saveCreditLimit = async () => {
    if (!showViewUser) return;
    setAdjustLoading(true);
    try {
      await api.put(`/admin/users/${showViewUser.id}/credit-limit`, { amount: Number(creditForm.amount || 0), note: creditForm.note });
      toast({ title: "Credit limit saved", description: `৳${Number(creditForm.amount || 0).toLocaleString()} for ${showViewUser.name}` });
      await loadWallet(showViewUser.id);
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    } finally { setAdjustLoading(false); }
  };

  const savePermissions = async () => {
    if (!showViewUser) return;
    setPermSaving(true);
    try {
      await api.put(`/admin/users/${showViewUser.id}/partial-permission`, { enabled: permForm.partial });
      await api.put(`/admin/users/${showViewUser.id}/admin-flags`, {
        canManageBookings: permForm.canManageBookings,
        canTogglePartial: permForm.canTogglePartial,
      });
      toast({ title: "Permissions saved", description: `${showViewUser.name} updated` });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Save failed", variant: "destructive" });
    } finally { setPermSaving(false); }
  };

  const handleExport = () => {
    downloadCSV('users', ['Name', 'Email', 'Phone', 'Status', 'Bookings', 'Joined'],
      users.map((u: any) => [u.name, u.email, u.phone, u.status, u.bookings, u.joined]));
    toast({ title: "Exported", description: "Users CSV downloaded" });
  };

  const statCards = [
    { label: "Total Users", value: stats.total, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "Active", value: stats.active, icon: UserCheck, color: "text-success", bg: "bg-success/10" },
    { label: "Suspended", value: stats.suspended, icon: UserX, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "New (30d)", value: stats.newThisMonth, icon: UserCog, color: "text-warning", bg: "bg-warning/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Users</h1>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-initial" onClick={handleExport}><Download className="w-4 h-4 mr-1.5" /> Export</Button>
          <Button size="sm" className="flex-1 sm:flex-initial" onClick={() => setShowAddUser(true)}><UserPlus className="w-4 h-4 mr-1.5" /> Add User</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <Card key={i}><CardContent className="flex items-center gap-3 p-4">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center ${s.color}`}><s.icon className="w-5 h-5" /></div>
            <div><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-xl font-bold mt-1">{s.value}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search users..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      <DataLoader isLoading={isLoading} error={error} skeleton="table" retry={refetch}>
        <Card><CardContent className="p-0 table-responsive">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Phone</TableHead><TableHead className="hidden lg:table-cell">Joined</TableHead><TableHead className="hidden sm:table-cell">Bookings</TableHead><TableHead>ID Status</TableHead><TableHead>Status</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No users found</TableCell></TableRow>
              ) : filtered.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{u.phone}</TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{u.joined}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{u.bookings}</TableCell>
                  <TableCell>
                    {u.idDocument ? (
                      u.idVerified
                        ? <Badge className="bg-success/10 text-success text-[10px]"><CheckCircle2 className="w-3 h-3 mr-0.5" /> Verified</Badge>
                        : <Badge className="bg-warning/10 text-warning text-[10px]"><FileText className="w-3 h-3 mr-0.5" /> Pending</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">No ID</Badge>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`text-[11px] capitalize ${u.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{u.status}</Badge></TableCell>
                  <TableCell>
                    <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openViewUser(u)}><Eye className="w-4 h-4 mr-2" /> View Profile</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openCommission(u)}><Shield className="w-4 h-4 mr-2" /> Set Commission</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSuspend(u)} disabled={actionLoading}>
                          {u.status === "active" ? <><Ban className="w-4 h-4 mr-2" /> Suspend</> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Activate</>}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteUser(u)}>Delete User</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </DataLoader>

      {/* View User */}
      <Dialog open={!!showViewUser} onOpenChange={() => setShowViewUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>User Profile</DialogTitle></DialogHeader>
          {showViewUser && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Name</p><p className="font-semibold">{showViewUser.name}</p></div>
                <div><p className="text-xs text-muted-foreground">Email</p><p className="font-semibold">{showViewUser.email}</p></div>
                <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-semibold">{showViewUser.phone}</p></div>
                <div><p className="text-xs text-muted-foreground">Role</p><Badge variant="outline" className="capitalize">{showViewUser.role}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="outline" className={`text-[11px] capitalize ${showViewUser.status === "active" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>{showViewUser.status}</Badge></div>
                <div><p className="text-xs text-muted-foreground">Bookings</p><p className="font-semibold">{showViewUser.bookings}</p></div>
                <div><p className="text-xs text-muted-foreground">Joined</p><p className="font-semibold">{showViewUser.joined}</p></div>
              </div>

              <div className="space-y-1.5">
                <Label>Account Role</Label>
                <Select value={showViewUser.role} onValueChange={async (role) => {
                  try {
                    await api.put(`/admin/users/${showViewUser.id}`, { role });
                    setShowViewUser({ ...showViewUser, role });
                    toast({ title: "Role updated" });
                    refetch();
                  } catch (err: any) {
                    toast({ title: "Role update failed", description: err?.message, variant: "destructive" });
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer (B2C)</SelectItem>
                    <SelectItem value="agent">Agent (B2B)</SelectItem>
                    <SelectItem value="secondary_admin">Secondary Admin</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* ID Document Section */}
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Identity Document
                  </p>
                  {showViewUser.idVerified ? (
                    <Badge className="bg-success/10 text-success text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" /> Verified</Badge>
                  ) : showViewUser.idDocument ? (
                    <Badge className="bg-warning/10 text-warning text-[10px]">Pending Review</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">Not Uploaded</Badge>
                  )}
                </div>
                {showViewUser.idDocument ? (
                  <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-2">
                    <FileText className="w-8 h-8 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{showViewUser.idDocType === "passport" ? "Passport Copy" : "National ID (NID)"}</p>
                      <p className="text-[10px] text-muted-foreground">Uploaded with registration</p>
                    </div>
                    <a href={`${config.apiBaseUrl}${showViewUser.idDocument}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="h-7 text-xs"><ExternalLink className="w-3 h-3 mr-1" /> View</Button>
                    </a>
                    <a href={`${config.apiBaseUrl}${showViewUser.idDocument}`} download>
                      <Button variant="outline" size="sm" className="h-7 text-xs"><Download className="w-3 h-3 mr-1" /> Download</Button>
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No identity document uploaded by this user.</p>
                )}
                {showViewUser.idDocument && !showViewUser.idVerified && (
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="bg-success hover:bg-success/90 text-white" onClick={() => { handleVerifyId(showViewUser, true); setShowViewUser(null); }} disabled={actionLoading}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Verify ID
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { handleVerifyId(showViewUser, false); setShowViewUser(null); }} disabled={actionLoading}>
                      <Ban className="w-3.5 h-3.5 mr-1" /> Reject ID
                    </Button>
                  </div>
                )}
                {showViewUser.idVerified && (
                  <p className="text-xs text-success font-medium flex items-center gap-1 pt-1"><CheckCircle2 className="w-3 h-3" /> This user's identity has been verified by an admin.</p>
                )}
              </div>

              {/* Permissions */}
              <div className="border rounded-lg p-3 space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" /> Permissions
                </p>
                <label className="flex items-center justify-between text-sm">
                  <span>Partial Payment access</span>
                  <input type="checkbox" checked={permForm.partial} onChange={e => setPermForm(p => ({ ...p, partial: e.target.checked }))} />
                </label>
                {(showViewUser.role === 'admin' || showViewUser.role === 'super_admin' || showViewUser.role === 'secondary_admin') && (
                  <>
                    <label className="flex items-center justify-between text-sm">
                      <span>Secondary Admin — Manage Bookings</span>
                      <input type="checkbox" checked={permForm.canManageBookings} onChange={e => setPermForm(p => ({ ...p, canManageBookings: e.target.checked }))} />
                    </label>
                    <label className="flex items-center justify-between text-sm">
                      <span>Secondary Admin — Toggle Partial for Users</span>
                      <input type="checkbox" checked={permForm.canTogglePartial} onChange={e => setPermForm(p => ({ ...p, canTogglePartial: e.target.checked }))} />
                    </label>
                  </>
                )}
                <Button size="sm" onClick={savePermissions} disabled={permSaving}>
                  {permSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Save Permissions
                </Button>
              </div>

              {/* Balance Controls */}
              <div className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5" /> Balance & Credit
                  </p>
                  {walletLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-[10px] text-muted-foreground">Current Balance</p>
                    <p className="text-sm font-bold">৳{Number(wallet?.balance || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-[10px] text-muted-foreground">Credit Limit</p>
                    <p className="text-sm font-bold text-primary">৳{Number(wallet?.creditLimit || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-success/10 p-2">
                    <p className="text-[10px] text-muted-foreground">Available</p>
                    <p className="text-sm font-bold text-success">৳{Number(wallet?.availableBalance || 0).toLocaleString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount (BDT)</Label>
                    <Input type="number" min="0" value={adjustForm.amount} onChange={e => setAdjustForm(p => ({ ...p, amount: e.target.value }))} placeholder="5000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">User Note (required)</Label>
                    <Input value={adjustForm.note} onChange={e => setAdjustForm(p => ({ ...p, note: e.target.value }))} placeholder="ADM / fare difference reason" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" className="flex-1" disabled={adjustLoading} onClick={() => submitAdjust('debit')}>
                    <MinusCircle className="w-3.5 h-3.5 mr-1" /> Debit Balance
                  </Button>
                  <Button size="sm" className="flex-1 bg-success hover:bg-success/90 text-white" disabled={adjustLoading} onClick={() => submitAdjust('credit')}>
                    <PlusCircle className="w-3.5 h-3.5 mr-1" /> Credit Balance
                  </Button>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Credit Limit (BDT)</Label>
                      <Input type="number" min="0" value={creditForm.amount} onChange={e => setCreditForm(p => ({ ...p, amount: e.target.value }))} placeholder="150000" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Credit Note</Label>
                      <Input value={creditForm.note} onChange={e => setCreditForm(p => ({ ...p, note: e.target.value }))} placeholder="2-day credit facility" />
                    </div>
                  </div>
                  <Button size="sm" variant="outline" disabled={adjustLoading} onClick={saveCreditLimit}>Save Credit Limit</Button>
                  <p className="text-[10px] text-muted-foreground">Credit limit lets the agent issue tickets beyond their deposited balance (no partial payment needed).</p>
                </div>

                {wallet?.transactions?.length > 0 && (
                  <div className="border-t pt-2 space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">Recent Activity</p>
                    {wallet.transactions.slice(0, 5).map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between text-[11px]">
                        <span className="truncate max-w-[70%] text-muted-foreground">{t.description || t.type}</span>
                        <span className={['credit', 'deposit', 'refund', 'transfer_in'].includes(t.type) ? 'text-success font-semibold' : 'text-destructive font-semibold'}>
                          {['credit', 'deposit', 'refund', 'transfer_in'].includes(t.type) ? '+' : '-'}৳{Number(t.amount || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create User / Agent ID</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>First Name *</Label><Input value={newUser.firstName} onChange={e => setNewUser(p => ({ ...p, firstName: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Last Name</Label><Input value={newUser.lastName} onChange={e => setNewUser(p => ({ ...p, lastName: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Phone</Label><Input value={newUser.phone} onChange={e => setNewUser(p => ({ ...p, phone: e.target.value }))} placeholder="+880 1XXX-XXXXXX" /></div>
              <div className="space-y-1.5"><Label>Password *</Label><Input type="text" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="Set initial password" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Role</Label>
                <Select value={newUser.role} onValueChange={v => setNewUser(p => ({ ...p, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="secondary_admin">Secondary Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Initial Wallet (BDT)</Label><Input type="number" value={newUser.initialWalletBalance} onChange={e => setNewUser(p => ({ ...p, initialWalletBalance: e.target.value }))} placeholder="0" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm pt-1">
              <input type="checkbox" checked={newUser.canApproveDeposits} onChange={e => setNewUser(p => ({ ...p, canApproveDeposits: e.target.checked }))} />
              Can approve client deposits (Accounts role)
            </label>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleAddUser} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commission Dialog */}
      <Dialog open={!!showCommission} onOpenChange={() => setShowCommission(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Commission — {showCommission?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-xs text-muted-foreground">Leave blank to use global defaults. Per-user values override per-airline and global settings.</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Discount %</Label><Input type="number" step="0.01" value={commissionForm.discountPct} onChange={e => setCommissionForm(p => ({ ...p, discountPct: e.target.value }))} placeholder="0" /></div>
              <div className="space-y-1.5"><Label>AIT VAT %</Label><Input type="number" step="0.01" value={commissionForm.aitPct} onChange={e => setCommissionForm(p => ({ ...p, aitPct: e.target.value }))} placeholder="0.30" /></div>
              <div className="space-y-1.5"><Label>Markup %</Label><Input type="number" step="0.01" value={commissionForm.markupPct} onChange={e => setCommissionForm(p => ({ ...p, markupPct: e.target.value }))} placeholder="0" /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Input value={commissionForm.notes} onChange={e => setCommissionForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reason / agreement" /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleSaveCommission} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
