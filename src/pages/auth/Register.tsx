import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Lock, User, Phone, Eye, EyeOff, CheckCircle2, Upload, FileText, X, Shield,
  Building2, MapPin, Home, Hash, IdCard,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import IdUploadModal from "@/components/IdUploadModal";
import { useSiteLogo, useLogoSizes } from "@/hooks/useSiteLogo";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const CITIES_BD = [
  "Dhaka", "Chattogram", "Sylhet", "Khulna", "Rajshahi", "Barishal", "Rangpur", "Mymensingh",
  "Cox's Bazar", "Cumilla", "Narayanganj", "Gazipur", "Jashore", "Bogura", "Dinajpur",
];

type TabType = "personal" | "agency";

type AgencyForm = {
  agencyName: string; mocatLicense: string; country: string; city: string;
  address: string; postalCode: string;
  ownerFirstName: string; ownerLastName: string; ownerEmail: string; ownerMobile: string;
  email: string; mobile: string; password: string; confirmPassword: string;
};

const agencyInitial: AgencyForm = {
  agencyName: "", mocatLicense: "", country: "Bangladesh", city: "",
  address: "", postalCode: "",
  ownerFirstName: "", ownerLastName: "", ownerEmail: "", ownerMobile: "",
  email: "", mobile: "", password: "", confirmPassword: "",
};

const Register = () => {
  const logoUrl = useSiteLogo();
  const logoSizes = useLogoSizes();
  const [activeTab, setActiveTab] = useState<TabType>("personal");

  // Personal form state
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [showIdUpload, setShowIdUpload] = useState(false);
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [idDocType, setIdDocType] = useState<"nid" | "passport">("nid");
  const { register, socialLogin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Agency form state
  const [af, setAf] = useState<AgencyForm>(agencyInitial);
  const [agencyAgreed, setAgencyAgreed] = useState(false);
  const [agencyLoading, setAgencyLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [showPwd2, setShowPwd2] = useState(false);

  const aSet = (k: keyof AgencyForm) => (e: React.ChangeEvent<HTMLInputElement>) => setAf({ ...af, [k]: e.target.value });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: "Invalid File", description: "Please upload JPG, PNG, WebP, or PDF only.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File Too Large", description: "Maximum file size is 5MB.", variant: "destructive" });
      return;
    }
    setIdDocument(file);
  };

  const handlePersonalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone || !password) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (!idDocument) {
      toast({ title: "ID Required", description: "Please upload your National ID Card or Passport copy for verification.", variant: "destructive" });
      return;
    }
    if (!agreed) {
      toast({ title: "Error", description: "Please agree to the Terms & Privacy Policy", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await register({ firstName, lastName, email, phone, password });
      try {
        const formData = new FormData();
        formData.append("document", idDocument);
        formData.append("documentType", idDocType);
        await api.upload("/auth/upload-id-document", formData);
      } catch {
        console.warn("ID document upload deferred");
      }
      toast({ title: "Account Created!", description: "Welcome to Seven Trip. Your ID is under verification." });
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Registration Failed", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider);
    try {
      const result = await socialLogin(provider);
      if (result.needsIdUpload) {
        setShowIdUpload(true);
      } else {
        toast({ title: "Welcome!", description: `Account created with ${provider === 'google' ? 'Google' : 'Facebook'} successfully` });
        navigate("/dashboard", { replace: true });
      }
    } catch (err: any) {
      toast({ title: "Sign-up Failed", description: err?.message || `${provider} sign-up failed`, variant: "destructive" });
    } finally {
      setSocialLoading(null);
    }
  };

  const validateAgency = () => {
    if (!af.agencyName.trim()) return "Agency Name is required";
    if (!af.city) return "Please select a city";
    if (!af.address.trim()) return "Address is required";
    if (!af.ownerFirstName.trim()) return "Owner's first name required";
    if (!/^\S+@\S+\.\S+$/.test(af.ownerEmail)) return "Valid owner email required";
    if (!/^01[3-9]\d{8}$/.test(af.ownerMobile)) return "Owner mobile must be 11 digits, starting 013-019";
    if (!/^\S+@\S+\.\S+$/.test(af.email)) return "Valid account email required";
    if (!/^01[3-9]\d{8}$/.test(af.mobile)) return "Account mobile must be 11 digits, starting 013-019";
    if (af.password.length < 8) return "Password must be at least 8 characters";
    if (af.password !== af.confirmPassword) return "Passwords do not match";
    if (!agencyAgreed) return "Please agree to the Terms & Privacy Policy";
    return null;
  };

  const handleAgencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateAgency();
    if (err) { toast({ title: "Check your form", description: err, variant: "destructive" }); return; }
    setAgencyLoading(true);
    try {
      await api.post("/auth/register-agency", af);
      toast({
        title: "Agency Account Created ",
        description: "Your B2B account is pending admin verification. You will be notified once approved.",
      });
      navigate("/auth/login", { replace: true });
    } catch (e: any) {
      toast({ title: "Registration Failed", description: e?.message || "Please try again", variant: "destructive" });
    } finally { setAgencyLoading(false); }
  };

  const isAgency = activeTab === "agency";

  return (
    <>
      <div className="min-h-screen flex bg-muted/30">
        {/* ── Left Brand Panel ── */}
        <div className={`hidden lg:flex lg:w-1/2 relative items-start justify-center p-12 pt-32 transition-colors duration-500 ${isAgency ? "bg-gradient-to-br from-[hsl(217,91%,28%)] via-[hsl(217,91%,38%)] to-[hsl(167,72%,41%)]" : "bg-gradient-to-br from-[hsl(167,72%,41%)] to-[hsl(217,91%,50%)]"}`}>
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDE0VjBoLTJWMTRIMjBWMGgtMnYxNEgwdjJoMTR2MTRIMHYyaDE0djE0aDJ2LTE0aDE0djE0aDJ2LTE0aDE0di0ySDM2VjE2aDEydi0ySDM2eiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
          <div className="relative text-white max-w-md">
            <Link to="/" className="flex items-center gap-3 mb-8">
              <img src={logoUrl} alt="Seven Trip" style={{ height: `${logoSizes.auth}px` }} className="w-auto brightness-0 invert drop-shadow-[0_0_12px_rgba(29,106,229,0.5)]" />
            </Link>

            {isAgency ? (
              <>
                <span className="inline-block px-3 py-1 rounded-full bg-white/10 backdrop-blur text-xs font-bold tracking-widest uppercase mb-4">B2B Travel Partner</span>
                <h2 className="text-3xl font-black mb-4 leading-tight">Grow your agency with Seven Trip.</h2>
                <p className="text-white/70 text-sm mb-8 leading-relaxed">Get wholesale fares, dedicated credit lines, and a powerful agent dashboard built for high-volume travel businesses.</p>
                <div className="space-y-3">
                  {[
                    "Negotiated B2B airfares on 800+ airlines",
                    "Live GDS inventory with instant booking",
                    "Wallet, partial payment & post-paid credit",
                    "White-label vouchers under your brand",
                  ].map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-white/85 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />{t}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2 className="text-3xl font-black mb-4 leading-tight">Start Your Journey With Us Today</h2>
                <p className="text-white/60 text-sm mb-8 leading-relaxed">Join 500,000+ travellers who trust Seven Trip for their travel needs.</p>
                <div className="space-y-3">
                  {["No booking fees ever", "Exclusive member-only deals", "Save traveller profiles for faster booking", "Track all bookings in one place"].map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-white/80 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-secondary" />{f}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right Form Panel ── */}
        <div className={`flex-1 flex items-start justify-center px-4 py-12 ${isAgency ? "overflow-y-auto" : ""}`}>
          <Card className={`w-full border-0 shadow-none bg-transparent ${isAgency ? "max-w-2xl" : "max-w-md"}`}>
            <CardHeader className="text-center pb-2">
              <Link to="/" className="flex items-center justify-center gap-2 mb-4 lg:hidden">
                <img src={logoUrl} alt="Seven Trip" style={{ height: `${Math.round(logoSizes.auth * 0.67)}px` }} className="w-auto" />
              </Link>

              {/* ── Personal / Agency tabs ── */}
              <div className="flex items-center justify-center mb-4">
                <div className="inline-flex rounded-xl bg-muted p-1 border border-border">
                  <button
                    type="button"
                    onClick={() => setActiveTab("personal")}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === "personal" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("agency")}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === "agency" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Agency / B2B
                  </button>
                </div>
              </div>

              <CardTitle className="text-2xl">{isAgency ? "Create B2B Agency Account" : "Create Account"}</CardTitle>
              <CardDescription>{isAgency ? "Apply once — admin verification typically takes 24 hours." : "Start booking with Seven Trip today"}</CardDescription>
            </CardHeader>

            <CardContent className="pt-4">
              {activeTab === "personal" ? (
                /* ── PERSONAL FORM ── */
                <>
                  <form onSubmit={handlePersonalSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>First Name</Label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input placeholder="John" className="pl-10 h-11" value={firstName} onChange={e => setFirstName(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Last Name</Label>
                        <Input placeholder="Doe" className="h-11" value={lastName} onChange={e => setLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type="email" placeholder="you@example.com" className="pl-10 h-11" value={email} onChange={e => setEmail(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone Number</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type="tel" placeholder="+880 1XXX-XXXXXX" className="pl-10 h-11" value={phone} onChange={e => setPhone(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type={showPassword ? "text" : "password"} placeholder="Min 8 characters" className="pl-10 pr-10 h-11" value={password} onChange={e => setPassword(e.target.value)} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* NID / Passport Upload */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-primary" />
                        Identity Verification <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex gap-2 mb-2">
                        <button type="button" onClick={() => setIdDocType("nid")}
                          className={`flex-1 text-xs font-medium py-2 px-3 rounded-lg border transition-colors ${idDocType === "nid" ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"}`}>
                          National ID (NID)
                        </button>
                        <button type="button" onClick={() => setIdDocType("passport")}
                          className={`flex-1 text-xs font-medium py-2 px-3 rounded-lg border transition-colors ${idDocType === "passport" ? "bg-primary/10 border-primary text-primary" : "bg-muted border-border text-muted-foreground"}`}>
                          Passport Copy
                        </button>
                      </div>

                      {idDocument ? (
                        <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-lg p-3">
                          <FileText className="w-5 h-5 text-accent shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{idDocument.name}</p>
                            <p className="text-[10px] text-muted-foreground">{(idDocument.size / 1024).toFixed(0)} KB • {idDocType === "nid" ? "National ID" : "Passport"}</p>
                          </div>
                          <button type="button" onClick={() => setIdDocument(null)} className="text-muted-foreground hover:text-destructive">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground text-center">
                            Upload {idDocType === "nid" ? "NID card" : "Passport"} (front side)<br />
                            <span className="text-[10px]">JPG, PNG, WebP, or PDF — Max 5MB</span>
                          </span>
                          <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={handleFileChange} />
                        </label>
                      )}
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Shield className="w-3 h-3" /> Your ID is securely stored and only used for account verification.
                      </p>
                    </div>

                    <div className="flex items-start gap-2">
                      <Checkbox id="terms" className="mt-0.5" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
                      <label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                        I agree to the <Link to="/terms" className="text-primary font-medium hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-primary font-medium hover:underline">Privacy Policy</Link>
                      </label>
                    </div>

                    <Button type="submit" className="w-full h-11 font-bold shadow-lg shadow-primary/20" disabled={loading}>
                      {loading ? "Creating Account..." : "Create Account"}
                    </Button>
                  </form>

                  <div className="relative my-4">
                    <Separator />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs text-muted-foreground">or sign up with</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" className="h-11 font-medium" disabled={!!socialLoading} onClick={() => handleSocialLogin('google')}>
                      {socialLoading === 'google' ? (
                        <div className="w-4 h-4 mr-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      )}
                      Google
                    </Button>
                    <Button variant="outline" className="h-11 font-medium" disabled={!!socialLoading} onClick={() => handleSocialLogin('facebook')}>
                      {socialLoading === 'facebook' ? (
                        <div className="w-4 h-4 mr-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                      )}
                      Facebook
                    </Button>
                  </div>

                  <p className="text-center text-sm text-muted-foreground pt-4">
                    Already have an account? <Link to="/auth/login" className="text-primary font-semibold hover:underline">Sign In</Link>
                  </p>
                </>
              ) : (
                /* ── AGENCY FORM ── */
                <form onSubmit={handleAgencySubmit} className="space-y-6">
                  {/* Agency Details */}
                  <div>
                    <h3 className="text-sm font-bold mb-3">Agency Details</h3>
                    <div className="space-y-3">
                      <Field icon={<Building2 className="w-4 h-4" />} placeholder="Agency Name (as per MoCAT License)" value={af.agencyName} onChange={aSet("agencyName")} />
                      <Field icon={<IdCard className="w-4 h-4" />} placeholder="MoCAT License Number (optional)" value={af.mocatLicense} onChange={aSet("mocatLicense")} />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                          <Select value={af.country} onValueChange={v => setAf({ ...af, country: v })}>
                            <SelectTrigger className="pl-10 h-11"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="Bangladesh">Bangladesh</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                          <Select value={af.city} onValueChange={v => setAf({ ...af, city: v })}>
                            <SelectTrigger className="pl-10 h-11"><SelectValue placeholder="Select City" /></SelectTrigger>
                            <SelectContent>{CITIES_BD.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field icon={<Home className="w-4 h-4" />} placeholder="Address" value={af.address} onChange={aSet("address")} />
                        <Field icon={<Hash className="w-4 h-4" />} placeholder="Postal Code" value={af.postalCode} onChange={aSet("postalCode")} />
                      </div>
                    </div>
                  </div>

                  {/* Owner Details */}
                  <div>
                    <h3 className="text-sm font-bold mb-3">Owner Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field icon={<User className="w-4 h-4" />} placeholder="Agency Owner's First Name" value={af.ownerFirstName} onChange={aSet("ownerFirstName")} />
                      <Field icon={<User className="w-4 h-4" />} placeholder="Agency Owner's Last Name" value={af.ownerLastName} onChange={aSet("ownerLastName")} />
                      <Field icon={<Mail className="w-4 h-4" />} type="email" placeholder="Owner's Email" value={af.ownerEmail} onChange={aSet("ownerEmail")} />
                      <PhoneField placeholder="Owner's Mobile" value={af.ownerMobile} onChange={aSet("ownerMobile")} />
                    </div>
                  </div>

                  {/* Account Credentials */}
                  <div>
                    <h3 className="text-sm font-bold mb-3">Account Credentials</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field icon={<Mail className="w-4 h-4" />} type="email" placeholder="Email" value={af.email} onChange={aSet("email")} />
                      <PhoneField placeholder="Mobile" value={af.mobile} onChange={aSet("mobile")} />
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type={showPwd ? "text" : "password"} placeholder="Enter Password" className="pl-10 pr-10 h-11" value={af.password} onChange={aSet("password")} />
                        <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type={showPwd2 ? "text" : "password"} placeholder="Confirm Password" className="pl-10 pr-10 h-11" value={af.confirmPassword} onChange={aSet("confirmPassword")} />
                        <button type="button" onClick={() => setShowPwd2(!showPwd2)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPwd2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <Checkbox id="agency-terms" className="mt-0.5" checked={agencyAgreed} onCheckedChange={v => setAgencyAgreed(v === true)} />
                    <label htmlFor="agency-terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                      I confirm the information above is accurate and agree to the{" "}
                      <Link to="/terms" className="text-primary font-medium hover:underline">B2B Terms of Service</Link> and{" "}
                      <Link to="/privacy" className="text-primary font-medium hover:underline">Privacy Policy</Link>.
                    </label>
                  </div>

                  <Button type="submit" className="w-full h-12 font-bold shadow-lg shadow-primary/20" disabled={agencyLoading}>
                    {agencyLoading ? "Submitting Application..." : "Create Agency Account"}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground pt-2">
                    Already a partner? <Link to="/auth/login" className="text-primary font-semibold hover:underline">Sign In</Link>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <IdUploadModal
        open={showIdUpload}
        onOpenChange={setShowIdUpload}
        onComplete={() => {
          setShowIdUpload(false);
          toast({ title: "Welcome!", description: "Account verified. Redirecting to dashboard." });
          navigate("/dashboard", { replace: true });
        }}
      />
    </>
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

export default Register;
