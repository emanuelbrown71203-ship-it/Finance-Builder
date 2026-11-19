"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/config";
import { Logo } from "./shell";
import { Button, ErrorNote, Field, Input } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or the app is showing sample data): go straight in.
  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        await response.text();
        if (response.ok) window.location.replace("/");
      })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      // A full page load so every screen starts from the new session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  const signup = mode === "signup";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <Logo size={32} />
        <span className="display text-title">{APP_NAME}</span>
      </div>
      <h1 className="display text-headline">{signup ? "Create your account" : "Sign in"}</h1>
      <p className="mt-2 text-ink-2">{signup ? "Then link a bank and your money shows up in about a minute." : "Pick up where your money left off."}</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4 rounded-sheet border border-line-soft bg-sheet p-6">
        {signup && <Field label="First name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={80} />}</Field>}
        <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
        <Field label="Password" hint={signup ? "At least 10 characters." : undefined}>
          {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : undefined} />}
        </Field>
        {error && <ErrorNote message={error} />}
        <Button variant="primary" type="submit" disabled={busy}>
          {signup ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-5 text-small text-ink-2">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? "/login" : "/signup"} className="font-medium text-accent-text hover:underline">
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </main>
  );
}
