import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Lock, User, Phone, Eye, EyeOff, Building2, MapPin, Home, Hash, IdCard, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useSiteLogo, useLogoSizes } from "@/hooks/useSiteLogo";

const CITIES_BD = [
  "Dhaka", "Chattogram", "Sylhet", "Khulna", "Rajshahi", "Barishal", "Rangpur", "Mymensingh",
  "Cox's Bazar", "Cumilla", "Narayanganj", "Gazipur", "Jashore", "Bogura", "Dinajpur",
];

type Form = {
  agencyName: string; mocatLicense: string; country: string; city: string;
  address: string; postalCode: string;
  ownerFirstName: string; ownerLastName: string; ownerEmail: string; ownerMobile: string;
  email: string; mobile: string; password: string; confirmPassword: string;
};

const initial: Form = {
  agencyName: "", mocatLicense: "", country: "Bangladesh", city: "",
  address: "", postalCode: "",
  ownerFirstName: "", ownerLastName: "", ownerEmail: "", ownerMobile: "",
  email: "", mobile: "", password: "", confirmPassword: "",
};

const RegisterAgency = () => {
  const logoUrl = useSiteLogo();
  const logoSizes = useLogoSizes();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState<Form>(initial);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    if (!f.agencyName.trim()) return "Agency Name is required";
    if (!f.city) return "Please select a city";
    if (!f.address.trim()) return "Address is required";
    if (!f.ownerFirstName.trim()) return "Owner's first name required";
    if (!/^\S+@\S+\.\S+$/.test(f.ownerEmail)) return "Valid owner email required";
    if (!/^01[3-9]\d{8}$/.test(f.ownerMobile)) return "Owner mobile must be 11 digits, starting 013-019";
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return "Valid account email required";
    if (!/^01[3-9]\d{8}$/.test(f.mobile)) return "Account mobile must be 11 digits, starting 013-019";
    if (f.password.length < 8) return "Password must be at least 8 characters";
    if (f.password !== f.confirmPassword) return "Passwords do not match";
    if (!agreed) return "Please agree to the Terms & Privacy Policy";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { toast({ title: "Check your form", description: err, variant: "destructive" }); return; }
    setLoading(true);
    try {
      await api.post("/auth/register-agency", f);
      toast({
        title: "Agency Account Created ✓",
        description: "Your B2B account is pending admin verification. You will be notified once approved.",
      });
      navigate("/auth/login", { replace: true });
    } catch (e: any) {
      toast({ title: "Registration Failed", description: e?.message || "Please try again", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* ── Left Brand Panel ── */}
      <div className="hidden lg:flex lg:w-2/5 relative bg-gradient-to-br from-[hsl(217,91%,28%)] via-[hsl(217,91%,38%)] to-[hsl(167,72%,41%)] items-start justify-center p-12 pt-24">
        <div className="relative text-primary-foreground max-w-md">
          <Link to="/" className="flex items-center gap-3 mb-8">
            <img src={logoUrl} alt="Seven Trip" style={{ height: `${logoSizes.auth}px` }} className="w-auto brightness-0 invert drop-shadow-[0_0_12px_rgba(29,106,229,0.5)]" />
          </Link>
          <span className="inline-block px-3 py-1 rounded-full bg-white/10 backdrop-blur text-xs font-bold tracking-widest uppercase mb-4">B2B Travel Partner</span>
          <h2 className="text-3xl font-black mb-4 leading-tight">Grow your agency with Seven Trip.</h2>
          <p className="text-primary-foreground/70 text-sm mb-8 leading-relaxed">Get wholesale fares, dedicated credit lines, and a powerful agent dashboard built for high-volume travel businesses.</p>
          <div className="space-y-3">
            {[
              "Negotiated B2B airfares on 800+ airlines",
              "Live GDS inventory with instant booking",
              "Wallet, partial payment & post-paid credit",
              "White-label vouchers under your brand",
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-primary-foreground/85 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />{t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right Form Panel ── */}
      <div className="flex-1 flex items-start justify-center px-4 py-10 overflow-y-auto">
        <Card className="w-full max-w-2xl border-0 shadow-none bg-transparent">
          <CardHeader className="text-center pb-2">
            <Link to="/" className="flex items-center justify-center gap-2 mb-4 lg:hidden">
              <img src={logoUrl} alt="Seven Trip" style={{ height: `${Math.round(logoSizes.auth * 0.67)}px` }} className="w-auto" />
            </Link>
            <CardTitle className="text-2xl">Create B2B Agency Account</CardTitle>
            <CardDescription>Apply once — admin verification typically takes 24 hours.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Agency Details */}
              <div>
                <h3 className="text-sm font-bold mb-3">Agency Details</h3>
                <div className="space-y-3">
                  <Field icon={<Building2 className="w-4 h-4" />} placeholder="Agency Name (as per MoCAT License)" value={f.agencyName} onChange={set("agencyName")} />
                  <Field icon={<IdCard className="w-4 h-4" />} placeholder="MoCAT License Number (optional)" value={f.mocatLicense} onChange={set("mocatLicense")} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                      <Select value={f.country} onValueChange={v => setF({ ...f, country: v })}>
                        <SelectTrigger className="pl-10 h-11"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="Bangladesh">Bangladesh</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                      <Select value={f.city} onValueChange={v => setF({ ...f, city: v })}>
                        <SelectTrigger className="pl-10 h-11"><SelectValue placeholder="Select City" /></SelectTrigger>
                        <SelectContent>{CITIES_BD.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field icon={<Home className="w-4 h-4" />} placeholder="Address" value={f.address} onChange={set("address")} />
                    <Field icon={<Hash className="w-4 h-4" />} placeholder="Postal Code" value={f.postalCode} onChange={set("postalCode")} />
                  </div>
                </div>
              </div>

              {/* Owner Details */}
              <div>
                <h3 className="text-sm font-bold mb-3">Owner Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field icon={<User className="w-4 h-4" />} placeholder="Agency Owner's First Name" value={f.ownerFirstName} onChange={set("ownerFirstName")} />
                  <Field icon={<User className="w-4 h-4" />} placeholder="Agency Owner's Last Name" value={f.ownerLastName} onChange={set("ownerLastName")} />
                  <Field icon={<Mail className="w-4 h-4" />} type="email" placeholder="Owner's Email" value={f.ownerEmail} onChange={set("ownerEmail")} />
                  <PhoneField placeholder="Owner's Mobile" value={f.ownerMobile} onChange={set("ownerMobile")} />
                </div>
              </div>

              {/* Account Credentials */}
              <div>
                <h3 className="text-sm font-bold mb-3">Account Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field icon={<Mail className="w-4 h-4" />} type="email" placeholder="Email" value={f.email} onChange={set("email")} />
                  <PhoneField placeholder="Mobile" value={f.mobile} onChange={set("mobile")} />
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input type={showPwd ? "text" : "password"} placeholder="Enter Password" className="pl-10 pr-10 h-11" value={f.password} onChange={set("password")} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input type={showPwd2 ? "text" : "password"} placeholder="Confirm Password" className="pl-10 pr-10 h-11" value={f.confirmPassword} onChange={set("confirmPassword")} />
                    <button type="button" onClick={() => setShowPwd2(!showPwd2)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox id="terms" className="mt-0.5" checked={agreed} onCheckedChange={v => setAgreed(v === true)} />
                <label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  I confirm the information above is accurate and agree to the{" "}
                  <Link to="/terms" className="text-primary font-medium hover:underline">B2B Terms of Service</Link> and{" "}
                  <Link to="/privacy" className="text-primary font-medium hover:underline">Privacy Policy</Link>.
                </label>
              </div>

              <Button type="submit" className="w-full h-12 font-bold shadow-lg shadow-primary/20" disabled={loading}>
                {loading ? "Submitting Application..." : "Create Agency Account"}
              </Button>

              <p className="text-center text-sm text-muted-foreground pt-2">
                Already a partner? <Link to="/auth/login" className="text-primary font-semibold hover:underline">Sign In</Link>
                <span className="mx-2 text-border">|</span>
                Personal account? <Link to="/auth/register" className="text-primary font-semibold hover:underline">Customer Sign Up</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

/* ── Reusable Inputs ── */
const Field = ({ icon, ...props }: { icon: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="relative">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
    <Input {...props} className="pl-10 h-11" />
  </div>
);

const PhoneField = ({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }) => (
  <div className="relative flex items-stretch h-11 rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring">
    <span className="flex items-center gap-1 px-3 text-sm text-muted-foreground border-r border-input bg-muted/40">
      <Phone className="w-4 h-4" /> +88
    </span>
    <input type="tel" placeholder={placeholder} value={value} onChange={onChange} maxLength={11}
      className="flex-1 px-3 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
  </div>
);

export default RegisterAgency;
