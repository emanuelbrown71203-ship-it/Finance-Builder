import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signupCode } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // Worked out when the site is built: a changed setting on the host only reaches a new deployment anyway.
  // (The sign-up route checks the code itself on every request.)
  return <AuthForm mode="login" open={signupCode() !== null} />;
}
