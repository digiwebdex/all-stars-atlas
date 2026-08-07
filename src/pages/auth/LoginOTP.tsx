import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Phone, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSiteLogo } from "@/hooks/useSiteLogo";

const LoginOTP = () => {
  const logoUrl = useSiteLogo();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"request" | "verify">("request");
  const [loading, setLoading] = useState(false);

  const request = async () => {
    if (!identifier) return toast({ title: "Enter your " + (channel === "email" ? "email" : "mobile"), variant: "destructive" });
    setLoading(true);
    try {
      await api.post("/auth/login-otp/request", { identifier, channel });
      toast({ title: "OTP sent", description: `Check your ${channel === "email" ? "inbox" : "phone"}.` });
      setStage("verify");
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message || "Could not send OTP", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!code) return toast({ title: "Enter the OTP", variant: "destructive" });
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/login-otp/verify", { identifier, channel, code });
      localStorage.setItem("auth_token", res.accessToken);
      localStorage.setItem("refresh_token", res.refreshToken);
      localStorage.setItem("user", JSON.stringify(res.user));
      toast({ title: "Welcome back!" });
      navigate("/dashboard", { replace: true });
      // Force re-init of auth context
      window.location.reload();
    } catch (err: any) {
      toast({ title: "Verification failed", description: err?.message || "Invalid OTP", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link to="/" className="flex items-center justify-center mb-4">
            <img src={logoUrl} alt="Seven Trip" className="h-10 w-auto logo-3d" />
          </Link>
          <CardTitle>Sign in with OTP</CardTitle>
          <CardDescription>Passwordless login via {channel === "email" ? "email" : "SMS"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === "request" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant={channel === "email" ? "default" : "outline"} onClick={() => setChannel("email")}>
                  <Mail className="w-4 h-4 mr-2" /> Email
                </Button>
                <Button variant={channel === "sms" ? "default" : "outline"} onClick={() => setChannel("sms")}>
                  <Phone className="w-4 h-4 mr-2" /> SMS
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>{channel === "email" ? "Email" : "Mobile (01XXXXXXXXX)"}</Label>
                <Input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder={channel === "email" ? "you@example.com" : "01712345678"} />
              </div>
              <Button className="w-full" onClick={request} disabled={loading}>
                {loading ? "Sending..." : "Send OTP"}
              </Button>
            </>
          )}
          {stage === "verify" && (
            <>
              <div className="space-y-1.5">
                <Label>Enter 6-digit code</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={code} onChange={e => setCode(e.target.value)} placeholder="123456" className="pl-10 tracking-widest text-center" maxLength={6} />
                </div>
              </div>
              <Button className="w-full" onClick={verify} disabled={loading}>
                {loading ? "Verifying..." : "Verify & Sign In"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStage("request")}>Use a different identifier</Button>
            </>
          )}
          <p className="text-center text-sm text-muted-foreground pt-2">
            Prefer password? <Link to="/auth/login" className="text-primary font-semibold hover:underline">Sign in with password</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginOTP;
