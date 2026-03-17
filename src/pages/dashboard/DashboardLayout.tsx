import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Ticket, CreditCard, Receipt, Users, Settings, LogOut, Plane, Menu, X,
  Heart, FileText, Search, Clock, Smartphone, Gift, ChevronDown, ChevronRight, ChevronLeft, Phone, Mail, ArrowLeft,
  BookOpen, BarChart3, Headphones, Users2, ShieldCheck, CircleDollarSign, Wallet, Building2, Send, History, Utensils
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Suspense, useState, useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AnimatePresence, motion } from "framer-motion";
import DashboardBreadcrumb from "@/components/dashboard/DashboardBreadcrumb";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type SidebarItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  badge?: string;
  children?: { label: string; href: string }[];
};

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, iconColor: "text-blue-600", iconBg: "bg-blue-100 dark:bg-blue-500/20" },
  { label: "All Booking", href: "/dashboard/bookings", icon: Ticket, iconColor: "text-violet-600", iconBg: "bg-violet-100 dark:bg-violet-500/20" },
  { label: "Hotel Booking", href: "/dashboard/bookings?type=hotel", icon: Building2, iconColor: "text-teal-600", iconBg: "bg-teal-100 dark:bg-teal-500/20", badge: "new" },
  {
    label: "Booking History",
    href: "/dashboard/bookings",
    icon: Clock,
    iconColor: "text-cyan-600",
    iconBg: "bg-cyan-100 dark:bg-cyan-500/20",
    children: [
      { label: "Flight", href: "/dashboard/bookings?type=flight" },
      { label: "Void", href: "/dashboard/bookings?status=voided" },
      { label: "Refund", href: "/dashboard/bookings?status=refunded" },
      { label: "Reissue", href: "/dashboard/bookings?status=reissued" },
    ],
  },
  { label: "Partial Payment", href: "/dashboard/pay-later", icon: CircleDollarSign, iconColor: "text-purple-600", iconBg: "bg-purple-100 dark:bg-purple-500/20" },
  {
    label: "Payment",
    href: "/dashboard/payments",
    icon: CreditCard,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-100 dark:bg-amber-500/20",
    children: [
      { label: "Instant Payment", href: "/dashboard/payments" },
      { label: "Send Payment Request", href: "/dashboard/send-payment-request" },
      { label: "Payment History", href: "/dashboard/transactions" },
      { label: "Bank List", href: "/dashboard/bank-list" },
      { label: "MFS List", href: "/dashboard/mfs-list" },
    ],
  },
  { label: "e-Sim", href: "/dashboard/purchased-esim", icon: Smartphone, iconColor: "text-sky-600", iconBg: "bg-sky-100 dark:bg-sky-500/20", badge: "new" },
  { label: "Insurance", href: "/dashboard/insurance", icon: ShieldCheck, iconColor: "text-green-600", iconBg: "bg-green-100 dark:bg-green-500/20", badge: "new" },
  { label: "Account Ledger", href: "/dashboard/account-ledger", icon: BookOpen, iconColor: "text-indigo-600", iconBg: "bg-indigo-100 dark:bg-indigo-500/20" },
  { label: "Report", href: "/dashboard/report", icon: BarChart3, iconColor: "text-rose-600", iconBg: "bg-rose-100 dark:bg-rose-500/20" },
  { label: "My Profile", href: "/dashboard/settings", icon: Settings, iconColor: "text-slate-600", iconBg: "bg-slate-100 dark:bg-slate-500/20" },
  { label: "Reward Points", href: "/dashboard/rewards", icon: Gift, iconColor: "text-orange-600", iconBg: "bg-orange-100 dark:bg-orange-500/20" },
  {
    label: "Traveller",
    href: "/dashboard/travellers",
    icon: Users,
    iconColor: "text-pink-600",
    iconBg: "bg-pink-100 dark:bg-pink-500/20",
    children: [
      { label: "All Travellers", href: "/dashboard/travellers" },
      { label: "Wishlist", href: "/dashboard/wishlist" },
    ],
  },
  {
    label: "Sub Users",
    href: "/dashboard/sub-users",
    icon: Users2,
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-100 dark:bg-indigo-500/20",
    children: [
      { label: "Manage Users", href: "/dashboard/sub-users" },
    ],
  },
  { label: "Support", href: "/dashboard/support", icon: Headphones, iconColor: "text-emerald-600", iconBg: "bg-emerald-100 dark:bg-emerald-500/20" },
];

const SidebarNav = ({
  location,
  onNav,
  collapsed = false,
}: {
  location: ReturnType<typeof useLocation>;
  onNav?: () => void;
  collapsed?: boolean;
}) => {
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    sidebarItems.forEach((item) => {
      if (item.children?.some((c) => location.pathname.startsWith(c.href))) {
        initial[item.label] = true;
      }
    });
    return initial;
  });

  const isActive = (href: string) => {
    if (href === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(href);
  };

  const toggleMenu = (label: string) => {
    setOpenMenus((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {sidebarItems.map((item) => {
        const hasChildren = !!item.children;
        const isOpen = openMenus[item.label];
        const active = !hasChildren && isActive(item.href);
        const childActive = hasChildren && item.children?.some((c) => isActive(c.href));

        if (hasChildren) {
          if (collapsed) {
            // In collapsed mode, show icon with tooltip
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    onClick={onNav}
                    className={cn(
                      "dash-sidebar-item justify-center !px-0",
                      childActive ? "dash-sidebar-item-active" : "dash-sidebar-item-inactive"
                    )}
                  >
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.iconBg)}>
                      <item.icon className={cn("w-3.5 h-3.5", item.iconColor)} />
                    </div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <div key={item.label}>
              <button
                onClick={() => toggleMenu(item.label)}
                className={cn(
                  "dash-sidebar-item w-full",
                  childActive && "dash-sidebar-item-parent-active"
                )}
              >
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.iconBg)}>
                  <item.icon className={cn("w-3.5 h-3.5", item.iconColor)} />
                </div>
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 transition-transform duration-200",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-6 border-l-2 border-border pl-3 py-1 flex flex-col gap-0.5">
                      {item.children?.map((child) => {
                        const cActive = isActive(child.href);
                        return (
                          <Link
                            key={child.href}
                            to={child.href}
                            onClick={onNav}
                            className={cn(
                              "dash-sidebar-child",
                              cActive ? "dash-sidebar-child-active" : "dash-sidebar-child-inactive"
                            )}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.3)" }} />
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        }

        if (collapsed) {
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  to={item.href}
                  onClick={onNav}
                  className={cn(
                    "dash-sidebar-item justify-center !px-0",
                    active ? "dash-sidebar-item-active" : "dash-sidebar-item-inactive"
                  )}
                >
                    <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.iconBg)}>
                      <item.icon className={cn("w-3.5 h-3.5", item.iconColor)} />
                    </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        }

        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={onNav}
            className={cn(
              "dash-sidebar-item",
              active ? "dash-sidebar-item-active" : "dash-sidebar-item-inactive"
            )}
          >
            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.iconBg)}>
              <item.icon className={cn("w-3.5 h-3.5", item.iconColor)} />
            </div>
            <span>{item.label}</span>
            {item.badge && (
              <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
      {/* Logout — bottom of sidebar */}
      {!collapsed && (
        <button
          onClick={() => {
            // Dispatch logout from parent
            window.dispatchEvent(new Event('sidebar:logout'));
          }}
          className="dash-sidebar-item dash-sidebar-item-inactive mt-2 text-destructive hover:bg-destructive/10"
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-100 dark:bg-red-500/20">
            <LogOut className="w-3.5 h-3.5 text-red-600" />
          </div>
          <span>Logout</span>
        </button>
      )}
    </nav>
  );
};

const DashboardLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Sidebar logout event
  import { useEffect } from "react";

  const sidebarWidth = sidebarCollapsed ? "w-[56px]" : "w-60";
  const mainMargin = sidebarCollapsed ? "md:ml-[56px]" : "md:ml-60";

  // Fetch reward points balance
  const { data: rewardsData } = useQuery({
    queryKey: ["rewards", "balance"],
    queryFn: () => api.get<any>("/rewards/balance"),
  });
  const pointsBalance = (rewardsData as any)?.balance ?? 0;

  // Fetch wallet balance
  const { data: walletData } = useQuery({
    queryKey: ["dashboard", "wallet-balance"],
    queryFn: () => api.get<any>("/dashboard/wallet"),
  });
  const walletBalance = (walletData as any)?.balance ?? 0;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-muted/30">
        {/* Top Bar */}
        <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-card border-b border-border flex items-center px-4 md:px-6">
          <button
            className="md:hidden mr-3 p-2 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link to="/" className="flex items-center gap-2 mr-6">
            <img
              src="/images/seven-trip-logo.png"
              alt="Seven Trip"
              className="h-9 w-auto"
            />
          </Link>

          {/* Support Info - Desktop */}
          <div className="hidden lg:flex items-center gap-6 text-xs text-muted-foreground border-l border-border pl-6">
            <div>
              <p className="font-semibold text-foreground/70">Support & Reservation</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> 09613001005</span>
                <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> support@seventrip.com</span>
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Reward Points Badge */}
            <Link
              to="/dashboard/rewards"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20 hover:bg-warning/20 transition-colors cursor-pointer"
            >
              <Gift className="w-3.5 h-3.5 text-warning" />
              <span className="text-xs font-bold text-warning">{Math.round(pointsBalance).toLocaleString()} Points</span>
            </Link>

            {/* Wallet Balance Badge */}
            <Link
              to="/dashboard/wallet"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">৳{Number(walletBalance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
            </Link>

            <ThemeToggle />

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-3 h-3 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">{user?.email || 'My Account'}</span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => {
                logout();
                navigate("/");
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="flex pt-14 relative">
          {/* Sidebar - Desktop */}
          <aside className={cn(
            "hidden md:flex bg-card border-r border-border fixed top-14 bottom-0 flex-col overflow-y-auto transition-all duration-300 ease-in-out",
            sidebarWidth
          )}>
            {/* Logo + collapse toggle */}
            <div className="p-3 border-b border-border flex items-center justify-between">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{user?.name || user?.email?.split('@')[0] || 'User'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{user?.email || ''}</p>
                  </div>
                </div>
              )}
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              </button>
            </div>
            <SidebarNav location={location} collapsed={sidebarCollapsed} />
          </aside>

          {/* Sidebar - Mobile overlay */}
          <AnimatePresence>
            {sidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm md:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: -260 }}
                  animate={{ x: 0 }}
                  exit={{ x: -260 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  className="fixed top-14 left-0 bottom-0 z-50 w-60 bg-card border-r border-border py-2 md:hidden overflow-y-auto"
                >
                  <SidebarNav location={location} onNav={() => setSidebarOpen(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          {/* Content */}
          <main className={cn("flex-1 min-w-0 p-4 md:p-6 lg:p-8 transition-all duration-300 ease-in-out overflow-x-hidden", mainMargin)}>
            <DashboardBreadcrumb />
            <Suspense fallback={
              <div className="flex items-center justify-center py-20">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <Plane className="absolute inset-0 m-auto w-4 h-4 text-primary animate-pulse" />
                </div>
              </div>
            }>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }}
              >
                <Outlet />
              </motion.div>
            </Suspense>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default DashboardLayout;
