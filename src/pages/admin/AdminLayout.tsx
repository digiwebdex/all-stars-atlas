import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Ticket, CreditCard, FileText, Settings,
  BarChart3, Image, Globe, LogOut, Megaphone, Menu, X,
  PenLine, Mail, MapPin, Home, Search as SearchIcon, PanelBottom,
  Shield, ChevronDown, ChevronRight, DollarSign, Coins, ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Suspense, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
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
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, iconColor: "text-blue-400", iconBg: "bg-blue-500/15" },
  { label: "Bookings", href: "/admin/bookings", icon: Ticket, iconColor: "text-violet-400", iconBg: "bg-violet-500/15" },
  { label: "Users", href: "/admin/users", icon: Users, iconColor: "text-cyan-400", iconBg: "bg-cyan-500/15" },
  {
    label: "Finance",
    href: "/admin/payments",
    icon: CreditCard,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/15",
    children: [
      { label: "Payments", href: "/admin/payments" },
      { label: "Payment Approvals", href: "/admin/payment-approvals" },
      { label: "Discounts & Pricing", href: "/admin/discounts" },
      { label: "Invoices", href: "/admin/invoices" },
      { label: "Reports", href: "/admin/reports" },
    ],
  },
  {
    label: "CMS",
    href: "/admin/cms/pages",
    icon: PenLine,
    iconColor: "text-amber-400",
    iconBg: "bg-amber-500/15",
    children: [
      { label: "All Pages", href: "/admin/cms/pages" },
      { label: "Booking Forms", href: "/admin/cms/booking-forms" },
      { label: "Homepage", href: "/admin/cms/homepage" },
      { label: "Popups & Banners", href: "/admin/cms/popups" },
      { label: "Footer", href: "/admin/cms/footer" },
      { label: "SEO", href: "/admin/cms/seo" },
      { label: "Blog", href: "/admin/cms/blog" },
      { label: "Destinations", href: "/admin/cms/destinations" },
      { label: "Media", href: "/admin/cms/media" },
      { label: "Email Templates", href: "/admin/cms/email-templates" },
    ],
  },
  {
    label: "Services",
    href: "/admin/visa",
    icon: Globe,
    iconColor: "text-rose-400",
    iconBg: "bg-rose-500/15",
    children: [
      { label: "Visa", href: "/admin/visa" },
      { label: "Markup & Revenue", href: "/admin/markup" },
      { label: "Currency", href: "/admin/currency" },
      { label: "Settings", href: "/admin/settings" },
    ],
  },
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
    if (href === "/admin") return location.pathname === "/admin";
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
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link
                    to={item.href}
                    onClick={onNav}
                    className={cn(
                      "admin-sidebar-item justify-center !px-0",
                      childActive ? "admin-sidebar-item-active" : "admin-sidebar-item-inactive"
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
                  "admin-sidebar-item w-full",
                  childActive && "admin-sidebar-item-parent-active"
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
                    <div className="ml-6 border-l-2 border-white/10 pl-3 py-1 flex flex-col gap-0.5">
                      {item.children?.map((child) => {
                        const cActive = isActive(child.href);
                        return (
                          <Link
                            key={child.href}
                            to={child.href}
                            onClick={onNav}
                            className={cn(
                              "admin-sidebar-child",
                              cActive ? "admin-sidebar-child-active" : "admin-sidebar-child-inactive"
                            )}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: cActive ? "hsl(217 91% 65%)" : "rgba(255,255,255,0.25)" }}
                            />
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
                    "admin-sidebar-item justify-center !px-0",
                    active ? "admin-sidebar-item-active" : "admin-sidebar-item-inactive"
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
              "admin-sidebar-item",
              active ? "admin-sidebar-item-active" : "admin-sidebar-item-inactive"
            )}
          >
            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", item.iconBg)}>
              <item.icon className={cn("w-3.5 h-3.5", item.iconColor)} />
            </div>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
};

const AdminLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sidebarWidth = sidebarCollapsed ? "w-[56px]" : "w-60";
  const mainMargin = sidebarCollapsed ? "md:ml-[56px]" : "md:ml-60";

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-background">
        {/* Admin Top Bar */}
        <header className="fixed top-0 left-0 right-0 z-50 h-14 admin-topbar-clean flex items-center px-4 md:px-6">
          <button
            className="md:hidden mr-3 p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link to="/admin" className="flex items-center gap-3 mr-6">
            <img src="/images/seven-trip-logo.png" alt="Seven Trip" className="h-8 w-auto" />
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground px-2 py-1 rounded-md bg-muted border border-border">
              <Shield className="w-3 h-3" />
              Admin
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <ThemeToggle className="text-muted-foreground hover:text-foreground hover:bg-muted" />
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-muted-foreground font-medium">{user?.email || 'Admin'}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => {
                logout();
                navigate("/admin/login", { replace: true });
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="flex pt-14 relative">
          {/* Desktop sidebar */}
          <aside className={cn(
            "hidden md:flex admin-sidebar-clean fixed top-14 bottom-0 flex-col overflow-y-auto transition-all duration-300 ease-in-out",
            sidebarWidth
          )}>
            {/* Admin badge + collapse toggle */}
            <div className="p-3 border-b border-border flex items-center justify-between">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 border border-border flex items-center justify-center flex-shrink-0">
                    <Shield className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Admin Panel</p>
                    <p className="text-[10px] text-muted-foreground">Full Access</p>
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

          {/* Mobile sidebar */}
          <AnimatePresence>
            {sidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
                <motion.aside
                  initial={{ x: -260 }}
                  animate={{ x: 0 }}
                  exit={{ x: -260 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  className="fixed top-14 left-0 bottom-0 z-50 w-60 admin-sidebar-clean py-2 overflow-y-auto md:hidden"
                >
                  <SidebarNav location={location} onNav={() => setSidebarOpen(false)} />
                </motion.aside>
              </>
            )}
          </AnimatePresence>

          <main className={cn("flex-1 p-4 md:p-6 lg:p-8 transition-all duration-300 ease-in-out", mainMargin)}>
            <Suspense fallback={
              <div className="flex items-center justify-center py-20">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] as const }}
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

export default AdminLayout;
