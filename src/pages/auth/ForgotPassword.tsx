import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useSiteLogo } from "@/hooks/useSiteLogo";

const ForgotPassword = () => {
  const logoUrl = useSiteLogo();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { forgotPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: "Error", description: "Please enter your email address", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email);
      setSubmitted(true);
      toast({ title: "OTP Sent", description: "Check your email for the verification code" });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to send reset link. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold">Check Your Email</h2>
            <p className="text-sm text-muted-foreground">
              We've sent a verification code to <strong>{email}</strong>. Enter the code to reset your password.
            </p>
            <Button onClick={() => navigate(`/auth/verify-otp?email=${encodeURIComponent(email)}`)} className="w-full font-bold">
              Enter OTP <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
            <button onClick={() => { setSubmitted(false); setLoading(false); }} className="text-sm text-primary hover:underline">
              Didn't receive it? Resend
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link to="/" className="flex justify-center mb-4">
            <img src={logoUrl} alt="Seven Trip" className="h-24 w-auto" />
          </Link>
          <CardTitle className="text-xl">Forgot Password?</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Enter your email and we'll send you a verification code</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type="email" placeholder="you@example.com" className="pl-10 h-11" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
            <Button type="submit" className="w-full h-11 font-bold" disabled={loading}>
              {loading ? "Sending..." : "Send Verification Code"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Remember your password? <Link to="/auth/login" className="text-primary font-semibold hover:underline">Sign In</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPassword;