"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The server wants the person to confirm their password or Face ID first. */
    public reauth = false,
  ) {
    super(message);
  }
}

/** Opens the "Confirm it's you" sheet. Set by the component that draws it. */
let reauthHandler: (() => Promise<boolean>) | null = null;
export function setReauthHandler(handler: () => Promise<boolean>) {
  reauthHandler = handler;
}

const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "x-time-zone": timeZone, ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (response.status === 401 && !url.startsWith("/api/auth")) {
    // A full page load on purpose: it drops every cached response from the signed-out session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    throw new ApiError(401, "Sign in to continue.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  const body = (data && typeof data === "object" ? data : {}) as { error?: string; reauth?: boolean };
  if (!response.ok) throw new ApiError(response.status, body.error ?? "Something went wrong. Try again.", body.reauth === true);
  // An answer that isn't data (a page instead of numbers, or nothing at all) is an error, never an empty
  // result: screens can count on what they get having the shape they asked for.
  if (!data || typeof data !== "object") throw new ApiError(502, "That didn’t load properly. Pull down to refresh.");
  return data as T;
}

/** Reads something once (not kept up to date like useApi). */
export function getJson<T>(url: string): Promise<T> {
  return request<T>(url);
}

/** How often live screens re-check for new activity. */
export const LIVE_INTERVAL = 5000;

export function useApi<T>(url: string | null, options?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(url, (u: string) => request<T>(u), { keepPreviousData: true, revalidateOnFocus: true, ...options });
}

/** Sends a change, then refreshes every screen’s data so numbers agree. */
export async function send<T = { ok: true }>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };
  const result = await request<T>(url, init).catch(async (error: unknown) => {
    // Some changes need a fresh "confirm it's you". Ask, then carry on with what the person was doing.
    if (!(error instanceof ApiError) || !error.reauth || !reauthHandler) throw error;
    if (!(await reauthHandler())) throw new ApiError(403, "Cancelled. Nothing was changed.");
    return request<T>(url, init);
  });
  await globalMutate((key) => typeof key === "string" && key.startsWith("/api/"));
  return result;
}

/** The current time, re-read on an interval. Zero until the page is live in the browser. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

const THEME_EVENT = "passbook-theme-change";
const THEME_KEY = "passbook-theme";
export type ThemeChoice = "system" | "light" | "dark";

function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function currentTheme(): ThemeChoice {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? chosen : "system";
}

/** Keeps the phone's status bar the same colour as the page. */
function paintStatusBar(choice: ThemeChoice) {
  const colors = { light: "#eef1f8", dark: "#0d1220" };
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const own = meta.media.includes("dark") ? colors.dark : colors.light;
    meta.content = choice === "system" ? own : colors[choice];
  });
}

/**
 * Light, dark, or whatever the device uses. Saved on this device only, the
 * same way the owner's other apps do it.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore<ThemeChoice>(subscribeTheme, currentTheme, () => "system");
  const set = (next: ThemeChoice) => {
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    paintStatusBar(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return [choice, set];
}
