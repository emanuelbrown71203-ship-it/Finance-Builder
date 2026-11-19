"use client";

import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { usePlaidLink } from "react-plaid-link";
import type { Me } from "@/lib/types";
import { Button, Dialog, ErrorNote } from "./ui";
import { send, useApi } from "./use-api";

/** Opens Plaid Link once its script is ready, then hands the result to our server. */
function Launcher({ token, institutionId, onDone, onError }: { token: string; institutionId?: string; onDone: () => void; onError: (message: string) => void }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        await send("POST", "/api/plaid/exchange", {
          publicToken,
          institution: { id: metadata.institution?.institution_id, name: metadata.institution?.name },
          repairedInstitutionId: institutionId,
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : "Couldn’t finish linking. Try again.");
      }
      onDone();
    },
    onExit: onDone,
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

/**
 * "Link a bank" (or, with institutionId, "Sign in again" for a connection
 * that stopped working).
 */
export function LinkBankButton({ institutionId, children, variant = "primary", size = "md" }: { institutionId?: string; children?: ReactNode; variant?: "primary" | "quiet"; size?: "md" | "sm" }) {
  const { data: me } = useApi<Me>("/api/me");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);

  const start = async () => {
    if (!me?.bankLinking.available) {
      setExplain(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { linkToken } = await send<{ linkToken: string }>("POST", "/api/plaid/link-token", { institutionId });
      setToken(linkToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t start linking. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={start} disabled={busy}>
        {children ?? (
          <>
            <Plus size={16} /> Link a bank
          </>
        )}
      </Button>
      {token && (
        <Launcher
          token={token}
          institutionId={institutionId}
          onError={setError}
          onDone={() => {
            setToken(null);
            setBusy(false);
          }}
        />
      )}
      <Dialog open={error !== null} onClose={() => setError(null)} title="Linking didn’t finish" footer={<Button onClick={() => setError(null)}>Close</Button>}>
        {error && <ErrorNote message={error} />}
      </Dialog>
      <Dialog open={explain} onClose={() => setExplain(false)} title="Bank linking isn’t switched on yet" footer={<Button onClick={() => setExplain(false)}>Got it</Button>}>
        <div className="flex flex-col gap-3 text-ink-2">
          <p>You’re looking at a sample household so you can try every screen. The numbers here are made up and reset each day.</p>
          <p>Linking real banks goes through Plaid. Once this app has its Plaid keys, this button opens your bank’s sign-in and your own accounts replace the samples.</p>
        </div>
      </Dialog>
    </>
  );
}
