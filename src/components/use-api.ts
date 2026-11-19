"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Something went wrong. Try again.");
  return data as T;
}

/** How often live screens re-check for new activity. */
export const LIVE_INTERVAL = 5000;

export function useApi<T>(url: string | null, options?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(url, (u: string) => request<T>(u), { keepPreviousData: true, revalidateOnFocus: true, ...options });
}

/** Sends a change, then refreshes every screen’s data so numbers agree. */
export async function send<T = { ok: true }>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const result = await request<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
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

function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Light or dark: the saved choice if there is one, otherwise whatever the device uses. */
export function useTheme(): [boolean, () => void] {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("passbook-theme", next);
    } catch {}
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return [dark, toggle];
}
