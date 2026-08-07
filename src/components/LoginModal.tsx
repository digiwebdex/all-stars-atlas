import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSiteLogo } from "@/hooks/useSiteLogo";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LoginModal = ({ open, onOpenChange }: LoginModalProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, socialLogin } = useAuth();
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const logoUrl = useSiteLogo();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Error", description: "Please enter email and password", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await login({ email, password });

      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'secondary_admin') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          toast({ title: "Access Denied", description: "Admin users must log in through the admin panel.", variant: "destructive" });
          setLoading(false);
          return;
        }
      }

      toast({ title: "Welcome back!", description: "You've been signed in successfully" });
      onOpenChange(false);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Login Failed", description: err?.message || "Invalid credentials", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider);
    try {
      await socialLogin(provider);
      toast({ title: "Welcome!", description: `Signed in with ${provider === 'google' ? 'Google' : 'Facebook'}` });
      onOpenChange(false);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Sign-in failed", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setSocialLoading(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden border-border/50">
        <div className="p-6 pb-2">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-muted-foreground text-sm">Welcome to</span>
            <img src={logoUrl} alt="Seven Trip" className="h-8 w-auto logo-3d" />
          </div>
          <h2 className="text-xl font-extrabold text-foreground">Book Flight</h2>
        </div>

        <div className="px-6 pb-6 pt-2">
          <h3 className="text-base font-bold text-foreground mb-0.5">Sign in</h3>
          <p className="text-xs text-muted-foreground mb-5">Sign In To Continue To The Dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Email</Label>
              <div className="relative">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  className="pr-10 h-11 bg-muted/50 border-border"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="pr-10 h-11 bg-muted/50 border-border"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex justify-end">
                <a href="/auth/forgot-password" className="text-xs text-primary font-semibold hover:underline">
                  Forgot Password?
                </a>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 font-bold text-sm shadow-lg shadow-primary/20" disabled={loading}>
              {loading ? "Signing in..." : "Login"}
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">or continue with</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-11 font-medium" disabled={!!socialLoading} onClick={() => handleSocial('google')}>
              {socialLoading === 'google' ? 'Please wait...' : 'Google'}
            </Button>
            <Button variant="outline" className="h-11 font-medium" disabled={!!socialLoading} onClick={() => handleSocial('facebook')}>
              {socialLoading === 'facebook' ? 'Please wait...' : 'Facebook'}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground pt-4">
            <a href="/auth/login-otp" className="text-primary font-semibold hover:underline">Sign in with OTP (SMS / Email)</a>
          </p>

          <p className="text-center text-sm text-muted-foreground pt-2">
            New here?{" "}
            <a href="/auth/register" className="text-primary font-bold hover:underline">
              Sign Up Now!
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;
