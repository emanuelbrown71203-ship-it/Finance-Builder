import type { NextConfig } from "next";

/**
 * A name for this exact build. The app compares the one it is running with
 * the one the server has, so pulling down to refresh can load a newer version.
 */
// Off Vercel there is no commit id, so every local build shares one name and never asks to reload.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

const dev = process.env.NODE_ENV !== "production";

/**
 * What the browser is allowed to load and where it may send data. Scripts
 * only from this site and Plaid's bank sign-in; data only to this site and
 * Plaid; no plugins; and no other site may put this one in a frame.
 * (Inline scripts are allowed because the pages are prebuilt; see the
 * framework's guide on content security policy.)
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cdn.plaid.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://*.plaid.com${dev ? " ws: wss:" : ""}`,
  "frame-src https://cdn.plaid.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Always https, including sub-domains, for two years.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Don't guess file types, don't allow framing, don't leak the address of a page to other sites.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // Plaid's bank sign-in opens a pop-up that has to talk back to this page.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // No camera or location. The microphone only for this site itself, so you can talk to Nickel (and only
  // after the phone asks you); never for anything embedded. Face ID sign-in only from this site itself.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=(), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
];

const nextConfig: NextConfig = {
  // Don't advertise what the site is built with.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships a WebAssembly build of Postgres; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
