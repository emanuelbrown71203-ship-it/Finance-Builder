"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button, Dialog, ErrorNote, Field, Input } from "./ui";
import { setReauthHandler, useApi } from "./use-api";

/*
 * "Confirm it's you." Before anything that changes how the account is reached
 * (a new Face ID device, a new Claude link, deleting the account) the app
 * asks for the password or Face ID again, unless that was done in the last
 * few minutes. So a phone left unlocked on a table can't be used to quietly
 * add a way in.
 */

let pending: ((ok: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function ask(): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.(false);
    pending = resolve;
    emit();
  });
}
setReauthHandler(ask);

const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const problem = async (response: Response, fallback: string) => ((await response.json().catch(() => ({}))) as { error?: string }).error ?? fallback;

function ReauthForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const { data } = useApi<{ passkeys: unknown[] }>("/api/auth/passkeys");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUsePasskey = (data?.passkeys.length ?? 0) > 0 && browserSupportsWebAuthn();

  const withPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await post("/api/auth/confirm", { password });
      if (!response.ok) return setError(await problem(response, "That didn’t work. Try again."));
      await response.text();
      onDone(true);
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await post("/api/auth/passkey/login-options");
      if (!options.ok) throw new Error(await problem(options, "Couldn’t start. Try again."));
      const answer = await startAuthentication({ optionsJSON: await options.json() });
      const done = await post("/api/auth/passkey/login", answer);
      if (!done.ok) throw new Error(await problem(done, "That didn’t work. Try again."));
      await done.text();
      onDone(true);
    } catch (e) {
      // Closing the Face ID prompt just goes back to the form.
      if (!(e instanceof Error && e.name === "NotAllowedError")) setError(e instanceof Error ? e.message : "That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-ink-2">This changes how your account can be reached, so Passbook checks it’s really you first.</p>
      {canUsePasskey && (
        <>
          <Button className="mt-5 w-full" variant="primary" onClick={withPasskey} disabled={busy}>
            <Fingerprint size={19} /> Use Face ID or fingerprint
          </Button>
          <p className="mt-4 text-center text-small text-ink-3">or use your password</p>
        </>
      )}
      <form onSubmit={withPassword} className={`${canUsePasskey ? "mt-3" : "mt-5"} flex flex-col gap-4`}>
        <Field label="Password">{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
        {error && <ErrorNote message={error} />}
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" type="button" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button className="flex-1" variant={canUsePasskey ? "quiet" : "primary"} type="submit" disabled={busy || !password}>
            Confirm
          </Button>
        </div>
      </form>
    </>
  );
}

export function ReauthHost() {
  const open = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending !== null,
    () => false,
  );
  const answer = (ok: boolean) => {
    pending?.(ok);
    pending = null;
    emit();
  };
  return (
    <Dialog open={open} onClose={() => answer(false)} title="Confirm it’s you">
      {open && <ReauthForm onDone={answer} />}
    </Dialog>
  );
}

/* ---------- Change password ---------- */

function PasswordForm({ onDone }: { onDone: (changed: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await post("/api/auth/password", { current, next });
      if (!response.ok) return setError(await problem(response, "That didn’t work. Try again."));
      await response.text();
      onDone(true);
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-ink-2">Every other phone, tablet and computer is signed out when you change it.</p>
      <Field label="Password now">{(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />}</Field>
      <Field label="New password" hint="At least 10 characters.">
        {(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} />}
      </Field>
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" type="button" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button className="flex-1" variant="primary" type="submit" disabled={busy || !current || next.length < 10}>
          Change
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  return (
    <Dialog open={open} onClose={() => onClose(false)} title="Change password">
      {open && <PasswordForm onDone={onClose} />}
    </Dialog>
  );
}
