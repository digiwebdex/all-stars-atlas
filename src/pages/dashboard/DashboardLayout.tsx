import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Ticket, CreditCard, Receipt, Users, Settings, LogOut, Plane, Menu, X,
  Heart, FileText, Search, Clock, Smartphone, Gift, ChevronDown, ChevronRight, Phone, Mail
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Suspense, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AnimatePresence, motion } from "framer-motion";
import DashboardBreadcrumb from "@/components/dashboard/DashboardBreadcrumb";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type SidebarItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  children?: { label: string; href: string }[];
};

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "My Bookings", href: "/dashboard/bookings", icon: Ticket },
  { label: "E-Tickets", href: "/dashboard/tickets", icon: FileText },
  {
    label: "Finance",
    href: "/dashboard/transactions",
    icon: Receipt,
    children: [
      { label: "Transactions", href: "/dashboard/transactions" },
      { label: "E-Transactions", href: "/dashboard/e-transactions" },
      { label: "Payments", href: "/dashboard/payments" },
      { label: "Invoices", href: "/dashboard/invoices" },
      { label: "Pay Later", href: "/dashboard/pay-later" },
    ],
  },
  { label: "Travellers", href: "/dashboard/travellers", icon: Users },
  { label: "Wishlist", href: "/dashboard/wishlist", icon: Heart },
  { label: "Reward Points", href: "/dashboard/rewards", icon: Gift },
  { label: "Search History", href: "/dashboard/search-history", icon: Search },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

const SidebarNav = ({ location, onNav }: { location: ReturnType<typeof useLocation>; onNav?: () => void }) => {
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(() => {
    // Auto-open parent if child is active
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
    <nav className="flex flex-col gap-0.5 px-3 py-2">
      {sidebarItems.map((item) => {
        const hasChildren = !!item.children;
        const isOpen = openMenus[item.label];
        const active = !hasChildren && isActive(item.href);
        const childActive = hasChildren && item.children?.some((c) => isActive(c.href));

        if (hasChildren) {
          return (
            <div key={item.label}>
              <button
                onClick={() => toggleMenu(item.label)}
                className={cn(
                  "dash-sidebar-item w-full",
                  childActive && "dash-sidebar-item-parent-active"
                )}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
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
            <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
            <span>{item.label}</span>
            {item.badge && (
              <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
};

const DashboardLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
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
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20">
            <Gift className="w-3.5 h-3.5 text-warning" />
            <span className="text-xs font-bold text-warning">Points</span>
          </div>

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
        <aside className="hidden md:flex w-60 bg-card border-r border-border fixed top-14 bottom-0 flex-col overflow-y-auto">
          {/* User Card */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{user?.name || user?.email?.split('@')[0] || 'User'}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user?.email || ''}</p>
              </div>
            </div>
          </div>
          <SidebarNav location={location} />
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
        <main className="flex-1 md:ml-60 p-4 md:p-6 lg:p-8">
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
  );
};

export default DashboardLayout;
