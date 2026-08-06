/**
 * Admin Enterprise — consolidated controls for:
 *  • Booking Rules (B2C partial toggle, min-hours, upfront %)
 *  • Airline Route Restrictions (Road-to-Road)
 *  • Per-Booking Override (deadline + force-allow partial)
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Loader2, Plane, Shield, CalendarClock, Trash2, Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface Restriction {
  id: string;
  airline_code: string;
  blocked_origin_country?: string | null;
  blocked_dest_country?: string | null;
  allowed_origin_country?: string | null;
  allowed_dest_country?: string | null;
  notes?: string | null;
}

const AdminEnterprise = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Booking rules
  const [b2cPartial, setB2cPartial] = useState(true);
  const [minHours, setMinHours] = useState(96);
  const [upfrontPct, setUpfrontPct] = useState(30);

  // Route restrictions
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [newR, setNewR] = useState<Partial<Restriction>>({ airline_code: "" });

  // Per-booking override
  const [bookingId, setBookingId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [b2bPartial, setB2bPartial] = useState(true);
  const [partialOverride, setPartialOverride] = useState(false);
  const [splitPct, setSplitPct] = useState<number | "">("");
  const [savingBooking, setSavingBooking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data: any = await api.get("/admin/settings");
        const s = data?.settings || {};
        const enB2b = s.b2b_partial_enabled;
        setB2bPartial(enB2b === undefined ? true : String(enB2b).toLowerCase() === 'true');
        const en = s.b2c_partial_enabled;
        setB2cPartial(en === undefined ? true : String(en).toLowerCase() === "true");
        if (s.partial_min_hours) setMinHours(Number(s.partial_min_hours));
        if (s.partial_upfront_pct) setUpfrontPct(Number(s.partial_upfront_pct));
      } catch {}
      try {
        const r: any = await api.get("/admin/airline-restrictions");
        setRestrictions(r?.restrictions || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const saveRules = async () => {
    setSaving(true);
    try {
      await api.put("/admin/settings", {
        section: "booking_rules",
        b2c_partial_enabled: b2cPartial ? "true" : "false",
        b2b_partial_enabled: b2bPartial ? "true" : "false",
        partial_min_hours: String(minHours),
        partial_upfront_pct: String(upfrontPct),
      });
      toast({ title: "Saved", description: "Booking rules updated." });
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const addRestriction = async () => {
    if (!newR.airline_code) { toast({ title: "Airline code required", variant: "destructive" }); return; }
    try {
      await api.post("/admin/airline-restrictions", {
        airlineCode: newR.airline_code,
        blockedOriginCountry: newR.blocked_origin_country || null,
        blockedDestCountry: newR.blocked_dest_country || null,
        allowedOriginCountry: newR.allowed_origin_country || null,
        allowedDestCountry: newR.allowed_dest_country || null,
        notes: newR.notes || null,
      });
      const r: any = await api.get("/admin/airline-restrictions");
      setRestrictions(r?.restrictions || []);
      setNewR({ airline_code: "" });
      toast({ title: "Restriction added" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  };

  const removeRestriction = async (id: string) => {
    try {
      await api.delete(`/admin/airline-restrictions/${id}`);
      setRestrictions(restrictions.filter(r => r.id !== id));
      toast({ title: "Removed" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    }
  };

  const saveBookingOverride = async () => {
    if (!bookingId.trim()) { toast({ title: "Booking ID required", variant: "destructive" }); return; }
    setSavingBooking(true);
    try {
      await api.put(`/admin/bookings/${bookingId.trim()}/payment-deadline`, {
        paymentDeadline: deadline || null,
        partialOverride,
        partialSplitPct: splitPct === "" ? null : Number(splitPct),
      });
      toast({ title: "Booking updated", description: `Deadline/override saved for ${bookingId}` });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message || "Booking not found", variant: "destructive" });
    } finally { setSavingBooking(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
        <span className="text-muted-foreground">Loading enterprise settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-primary" /> Enterprise Controls</h1>
        <p className="text-sm text-muted-foreground mt-1">Partial-payment rules, airline route restrictions, and per-booking overrides.</p>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules"><CalendarClock className="w-4 h-4 mr-1.5" /> Booking Rules</TabsTrigger>
          <TabsTrigger value="restrictions"><Plane className="w-4 h-4 mr-1.5" /> Route Restrictions</TabsTrigger>
          <TabsTrigger value="override"><Search className="w-4 h-4 mr-1.5" /> Per-Booking Override</TabsTrigger>
        </TabsList>

        {/* Booking Rules */}
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle>Partial Payment Rules (B2C & B2B)</CardTitle>
              <CardDescription>Governs when customers and agents see the "Pay Later / Partial" option on international refundable flights.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <Label className="text-sm font-semibold">Show Partial Payment to B2C Users</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">When OFF, no customer will ever see Pay-Later (admin overrides still work).</p>
                </div>
                <Switch checked={b2cPartial} onCheckedChange={setB2cPartial} />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                <div>
                  <Label className="text-sm font-semibold">Show Partial Payment to B2B Agents</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Per-agent access can still be switched off in Users → Permissions.</p>
                </div>
                <Switch checked={b2bPartial} onCheckedChange={setB2bPartial} />
              </div>


              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum hours before departure</Label>
                  <Input type="number" value={minHours} onChange={(e) => setMinHours(Number(e.target.value) || 0)} />
                  <p className="text-[10px] text-muted-foreground">Default: 96. Bookings within this window cannot use Partial.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Upfront payment %</Label>
                  <Input type="number" value={upfrontPct} onChange={(e) => setUpfrontPct(Number(e.target.value) || 0)} />
                  <p className="text-[10px] text-muted-foreground">Default: 30. Remaining 70% due by the deadline.</p>
                </div>
              </div>

              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                <p className="font-semibold mb-1">Rules enforced server-side:</p>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  <li>Domestic flights → partial never allowed</li>
                  <li>Non-refundable fares → partial never allowed</li>
                  <li>Departure within {minHours}h → partial blocked</li>
                  <li>Admin override on a booking bypasses all of the above</li>
                </ul>
              </div>

              <Button onClick={saveRules} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save Rules
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Route Restrictions */}
        <TabsContent value="restrictions">
          <Card>
            <CardHeader>
              <CardTitle>Airline Route Restrictions (Road-to-Road)</CardTitle>
              <CardDescription>Example: block Saudia (SV) inbound to BD — set <code>blocked_dest_country = BD</code>.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Airline</Label>
                  <Input placeholder="SV" maxLength={3} className="font-mono uppercase" value={newR.airline_code || ""} onChange={(e) => setNewR({ ...newR, airline_code: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Blocked Origin</Label>
                  <Input placeholder="—" maxLength={2} className="font-mono uppercase" value={newR.blocked_origin_country || ""} onChange={(e) => setNewR({ ...newR, blocked_origin_country: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Blocked Dest</Label>
                  <Input placeholder="BD" maxLength={2} className="font-mono uppercase" value={newR.blocked_dest_country || ""} onChange={(e) => setNewR({ ...newR, blocked_dest_country: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Allowed Origin</Label>
                  <Input placeholder="—" maxLength={2} className="font-mono uppercase" value={newR.allowed_origin_country || ""} onChange={(e) => setNewR({ ...newR, allowed_origin_country: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Allowed Dest</Label>
                  <Input placeholder="—" maxLength={2} className="font-mono uppercase" value={newR.allowed_dest_country || ""} onChange={(e) => setNewR({ ...newR, allowed_dest_country: e.target.value.toUpperCase() })} />
                </div>
                <Button onClick={addRestriction}><Plus className="w-4 h-4 mr-1" /> Add</Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Airline</TableHead>
                    <TableHead>Blocked Orig</TableHead>
                    <TableHead>Blocked Dest</TableHead>
                    <TableHead>Allowed Orig</TableHead>
                    <TableHead>Allowed Dest</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {restrictions.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No restrictions configured</TableCell></TableRow>
                  ) : restrictions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Badge variant="outline" className="font-mono">{r.airline_code}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{r.blocked_origin_country || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.blocked_dest_country || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.allowed_origin_country || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.allowed_dest_country || "—"}</TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => removeRestriction(r.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Per-Booking Override */}
        <TabsContent value="override">
          <Card>
            <CardHeader>
              <CardTitle>Per-Booking Payment Override</CardTitle>
              <CardDescription>Set/edit a booking's payment deadline and force-allow partial on flights that normally wouldn't qualify.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Booking ID / Ref</Label>
                  <Input placeholder="EXOZSO" value={bookingId} onChange={(e) => setBookingId(e.target.value)} className="font-mono uppercase" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Deadline (date & time)</Label>
                  <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div>
                    <Label className="text-xs font-semibold">Force-allow Partial Payment</Label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Bypasses domestic / refundable / 96h rules.</p>
                  </div>
                  <Switch checked={partialOverride} onCheckedChange={setPartialOverride} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Upfront Split % (optional override)</Label>
                  <Input type="number" placeholder={`Default ${upfrontPct}`} value={splitPct} onChange={(e) => setSplitPct(e.target.value === "" ? "" : Number(e.target.value))} />
                </div>
              </div>
              <Button onClick={saveBookingOverride} disabled={savingBooking}>
                {savingBooking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save to Booking
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminEnterprise;
