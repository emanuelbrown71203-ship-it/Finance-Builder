"use client";

import { ChevronRight, Landmark, LogOut } from "lucide-react";
import Link from "next/link";
import { CelebrationsRow, ClaudeSection, PasskeySection, RulesSection, TasksSection } from "@/components/settings-sections";
import { Button, Fold, PageHeader, Segmented, Sheet, SheetHeader, confirm, toast } from "@/components/ui";
import { send, useApi, useTheme, type ThemeChoice } from "@/components/use-api";
import { APP_NAME, APP_VERSION } from "@/lib/config";
import type { Me } from "@/lib/types";

export default function SettingsPage() {
  const { data: me } = useApi<Me>("/api/me");
  const [theme, setTheme] = useTheme();

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // A full page load on purpose: it clears everything the signed-in session had cached.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  const leave = () => {
    // A full page load on purpose: it clears everything the signed-in session had cached.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };
  const signOutEverywhere = async () => {
    if (!(await confirm({ title: "Sign out of every device?", body: "Every phone, tablet and computer signed in to your account, including this one, will need to sign in again.", confirmLabel: "Sign out everywhere" }))) return;
    await send("POST", "/api/auth/logout-all").then(leave, (e) => toast(e instanceof Error ? e.message : "Couldn’t do that. Try again.", { tone: "error" }));
  };
  const deleteAccount = async () => {
    if (!(await confirm({ title: "Delete your account for good?", body: "Your bank connections, transactions, budgets, goals and sign-in are all removed. This can’t be undone.", confirmLabel: "Delete everything", danger: true }))) return;
    await send("DELETE", "/api/me").then(leave, (e) => toast(e instanceof Error ? e.message : "Couldn’t do that. Try again.", { tone: "error" }));
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-2xl grid-cols-1 gap-4">
        <Sheet>
          <SheetHeader title="Appearance" hint="Automatic follows your phone’s light or dark setting. Saved on this device only." />
          <Segmented<ThemeChoice>
            full
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: "Automatic" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <CelebrationsRow />
        </Sheet>

        <PasskeySection demo={me?.demo ?? true} />
        <ClaudeSection />
        <TasksSection />
        <RulesSection />

        <Sheet>
          <SheetHeader title="Your banks" />
          <Link href="/accounts" className="sec-accounts -mx-1 flex min-h-[60px] items-center gap-3 rounded-2xl px-1 active:bg-sunk">
            <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-xl bg-sunk text-ink-2">
              <Landmark size={19} />
            </span>
            <span className="flex-1">
              <span className="block font-bold">Accounts</span>
              <span className="block text-small text-ink-3">Link or remove banks, cards and lenders</span>
            </span>
            <ChevronRight size={18} className="text-ink-3" />
          </Link>
        </Sheet>

        <Sheet>
          <SheetHeader title="Use it like an app" hint="Put Passbook on your home screen and it opens full screen, without the browser bars." />
          <Fold title="On an iPhone or iPad" className="border-t border-line-soft">
            <ol className="list-decimal space-y-1 pb-3 pl-5 text-ink-2">
              <li>Open this page in Safari.</li>
              <li>Tap the Share button (the square with an arrow).</li>
              <li>Choose “Add to Home Screen”, then Add.</li>
            </ol>
          </Fold>
          <Fold title="On an Android phone" className="border-t border-line-soft">
            <ol className="list-decimal space-y-1 pb-3 pl-5 text-ink-2">
              <li>Open this page in Chrome.</li>
              <li>Tap the three dots in the corner.</li>
              <li>Choose “Add to Home screen” or “Install app”.</li>
            </ol>
          </Fold>
          <p className="border-t border-line-soft pt-3 text-small text-ink-3">Once it’s there, pull down at the top of any screen to refresh. That also loads a new version when one is out.</p>
        </Sheet>

        <Sheet>
          <SheetHeader title="Your account" />
          {me?.demo ? (
            <p className="text-ink-2">You’re looking at a sample household, so there’s nothing to sign in to. The numbers are made up and start over each day.</p>
          ) : (
            <>
              <dl className="divide-y divide-line-soft border-y border-line-soft">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-2">Name</dt>
                  <dd className="font-bold">{me?.user.name}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-2">Email</dt>
                  <dd className="truncate font-bold">{me?.user.email}</dd>
                </div>
              </dl>
              <Button className="mt-4 w-full" onClick={signOut}>
                <LogOut size={17} /> Sign out
              </Button>
              <Button className="mt-2 w-full" onClick={signOutEverywhere}>
                Sign out of every device
              </Button>
              <p className="mt-2 text-small text-ink-3">Use this if a phone or computer was lost. You’re also signed out on any device you haven’t used for two weeks.</p>
              <Fold title="Delete my account" className="mt-3 border-t border-line-soft">
                <p className="text-small text-ink-2">This disconnects every bank and permanently deletes your account and everything Passbook keeps for you. Nothing changes at your banks.</p>
                <Button className="mb-2 mt-3 w-full" variant="danger" onClick={deleteAccount}>
                  Delete my account
                </Button>
              </Fold>
            </>
          )}
        </Sheet>

        <p className="px-1 pb-4 text-small text-ink-3">
          {APP_NAME} · Version {APP_VERSION}
        </p>
      </div>
    </>
  );
}
