import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Shield, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const AdminLogin = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { adminLogin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({ title: "Error", description: "Please enter credentials", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await adminLogin({ email, password });
      toast({ title: "Welcome", description: "Admin access granted" });
      navigate("/admin", { replace: true });
    } catch (err: any) {
      toast({ title: "Access Denied", description: err?.message || "Invalid admin credentials", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-foreground px-4">
      <Card className="w-full max-w-md border-border/30 bg-card/95 backdrop-blur-xl">
        <CardHeader className="text-center pb-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-xl">Admin Access</CardTitle>
          <CardDescription>Seven Trip Administration Panel</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Admin Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type="email" placeholder="admin@seventrip.net" className="pl-10" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type={showPassword ? "text" : "password"} placeholder="••••••••" className="pl-10 pr-10" value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full h-11" disabled={loading}>
              <Shield className="w-4 h-4 mr-1.5" /> {loading ? "Signing in..." : "Sign In to Admin"}
            </Button>
            <p className="text-center text-xs text-muted-foreground pt-2">
              This is a restricted area. Unauthorized access is prohibited.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminLogin;
