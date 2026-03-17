import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Ticket, CreditCard, FileText, Settings,
  BarChart3, Image, Globe, LogOut, Megaphone, Menu, X,
  PenLine, Mail, MapPin, Home, Search as SearchIcon, PanelBottom,
  Shield, ChevronDown, DollarSign, Coins
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Suspense, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";

type SidebarItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  children?: { label: string; href: string }[];
};

const sidebarItems: SidebarItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Bookings", href: "/admin/bookings", icon: Ticket },
  { label: "Users", href: "/admin/users", icon: Users },
  {
    label: "Finance",
    href: "/admin/payments",
    icon: CreditCard,
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
    children: [
      { label: "Visa", href: "/admin/visa" },
      { label: "Markup & Revenue", href: "/admin/markup" },
      { label: "Currency", href: "/admin/currency" },
      { label: "Settings", href: "/admin/settings" },
    ],
  },
];

const SidebarNav = ({ location, onNav }: { location: ReturnType<typeof useLocation>; onNav?: () => void }) => {
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
                  "admin-sidebar-item w-full",
                  childActive && "admin-sidebar-item-parent-active"
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
            <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
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

  return (
    <div className="min-h-screen bg-[hsl(224,20%,7%)]">
      {/* Admin Top Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 admin-topbar-clean flex items-center px-4 md:px-6">
        <button
          className="md:hidden mr-3 p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Link to="/admin" className="flex items-center gap-3 mr-6">
          <img src="/images/seven-trip-logo.png" alt="Seven Trip" className="h-8 w-auto brightness-0 invert" />
          <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-bold text-white/80 px-2 py-1 rounded-md bg-white/5 border border-white/10">
            <Shield className="w-3 h-3" />
            Admin
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle className="text-white/40 hover:text-white hover:bg-white/10" />
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/8">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-white/50 font-medium">{user?.email || 'Admin'}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-white/40 hover:text-white hover:bg-white/10"
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
        <aside className="hidden md:flex w-60 admin-sidebar-clean fixed top-14 bottom-0 flex-col overflow-y-auto">
          {/* Admin badge */}
          <div className="p-4 border-b border-white/8">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">Admin Panel</p>
                <p className="text-[10px] text-white/40">Full Access</p>
              </div>
            </div>
          </div>
          <SidebarNav location={location} />
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

        <main className="flex-1 md:ml-60 p-4 md:p-6 lg:p-8">
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
  );
};

export default AdminLayout;
