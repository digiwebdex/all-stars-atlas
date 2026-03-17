import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Clock, Plane, CheckCircle, XCircle, AlertTriangle, CreditCard, FileText, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import DataLoader from "@/components/DataLoader";
import { useState } from "react";

const eventIcons: Record<string, any> = {
  created: Clock,
  confirmed: CheckCircle,
  ticketed: FileText,
  cancelled: XCircle,
  payment: CreditCard,
  on_hold: AlertTriangle,
  voided: XCircle,
  refunded: CreditCard,
  expired: Clock,
};

const eventColors: Record<string, string> = {
  created: "bg-blue-100 text-blue-600 dark:bg-blue-500/20",
  confirmed: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20",
  ticketed: "bg-green-100 text-green-600 dark:bg-green-500/20",
  cancelled: "bg-red-100 text-red-600 dark:bg-red-500/20",
  payment: "bg-amber-100 text-amber-600 dark:bg-amber-500/20",
  on_hold: "bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20",
  voided: "bg-rose-100 text-rose-600 dark:bg-rose-500/20",
  refunded: "bg-purple-100 text-purple-600 dark:bg-purple-500/20",
  expired: "bg-gray-100 text-gray-600 dark:bg-gray-500/20",
};

const DashboardTimeline = () => {
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "bookings", "timeline", search],
    queryFn: () => api.get<any>("/dashboard/bookings", { search, limit: 100 }),
  });

  const bookings = Array.isArray(data) ? data : (data as any)?.bookings || [];

  // Build timeline events from bookings
  const events = bookings.flatMap((b: any) => {
    const items: any[] = [];
    const ref = b.booking_ref || b.id?.slice(0, 8);
    const route = b.details?.origin && b.details?.destination
      ? `${b.details.origin} → ${b.details.destination}`
      : b.route || '';

    items.push({
      id: `${b.id}-created`,
      date: b.created_at || b.booking_date,
      type: 'created',
      title: `Booking Created`,
      description: `${ref} • ${route}`,
      bookingId: b.id,
    });

    if (b.status === 'confirmed' || b.status === 'ticketed') {
      items.push({
        id: `${b.id}-confirmed`,
        date: b.updated_at || b.created_at,
        type: 'confirmed',
        title: 'Booking Confirmed',
        description: `${ref} • Payment received`,
        bookingId: b.id,
      });
    }

    if (b.status === 'ticketed') {
      items.push({
        id: `${b.id}-ticketed`,
        date: b.updated_at,
        type: 'ticketed',
        title: 'Ticket Issued',
        description: `${ref} • PNR: ${b.pnr || b.details?.pnr || '—'}`,
        bookingId: b.id,
      });
    }

    if (b.status === 'cancelled' || b.status === 'voided') {
      items.push({
        id: `${b.id}-${b.status}`,
        date: b.updated_at,
        type: b.status,
        title: b.status === 'voided' ? 'Booking Voided' : 'Booking Cancelled',
        description: `${ref} • ${route}`,
        bookingId: b.id,
      });
    }

    if (b.status === 'refunded') {
      items.push({
        id: `${b.id}-refunded`,
        date: b.updated_at,
        type: 'refunded',
        title: 'Refund Processed',
        description: `${ref} • ${route}`,
        bookingId: b.id,
      });
    }

    if (b.status === 'expired') {
      items.push({
        id: `${b.id}-expired`,
        date: b.updated_at,
        type: 'expired',
        title: 'Booking Expired',
        description: `${ref} • Time limit exceeded`,
        bookingId: b.id,
      });
    }

    return items;
  }).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const formatDate = (d: string) => {
    if (!d) return '—';
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Booking Timeline</h1>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search bookings..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <DataLoader isLoading={isLoading} error={error} skeleton="dashboard" retry={refetch}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Activity Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No booking activity yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-6">
                  {events.map((event: any) => {
                    const Icon = eventIcons[event.type] || Clock;
                    const colorClass = eventColors[event.type] || eventColors.created;

                    return (
                      <div key={event.id} className="relative flex items-start gap-4 pl-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${colorClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold">{event.title}</p>
                            <Badge variant="outline" className="text-[10px]">
                              {event.type}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                          <p className="text-[11px] text-muted-foreground/70 mt-1">{formatDate(event.date)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </DataLoader>
    </div>
  );
};

export default DashboardTimeline;
