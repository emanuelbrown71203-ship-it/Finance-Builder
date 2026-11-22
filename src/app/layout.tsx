import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "See every account, bill, budget and goal in one place, updated as your money moves.",
  manifest: "/manifest.webmanifest",
  // Lets the app open full screen from an iPhone home screen, like the owner's other apps.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  // Nickel on a night-arcade tile. New file names, so phones fetch the new picture instead of a cached one.
  icons: { icon: [{ url: "/icon-nickel.svg", type: "image/svg+xml" }, { url: "/nickel-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/nickel-touch.png", sizes: "180x180" }] },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home bar; the app pads for them itself.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1eeff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d26" },
  ],
};

/** Applies a saved light/dark choice before first paint so the page never flashes. */
const themeScript = `try{var t=localStorage.getItem("passbook-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Reports anything that breaks in the browser, from the very first moment: a
 * script that fails to load or to run, a promise nobody caught, or something
 * the security policy blocked. Plain inline code on purpose, so it still works
 * when the app's own scripts are what failed. Sends only the error text, the
 * path and the browser's name, at most six notes per page load.
 */
const errorScript = `(function(){var n=0;function r(k,m,s){if(n>5)return;n++;try{fetch("/api/client-error",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({kind:k,message:String(m||"").slice(0,500),stack:s?String(s).slice(0,2500):undefined,path:location.pathname,build:${JSON.stringify(process.env.NEXT_PUBLIC_BUILD_ID ?? "")},agent:navigator.userAgent.slice(0,200)})}).catch(function(){})}catch(e){}}
addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){r("resource","Failed to load "+(t.src||t.href));return}r("error",e.message,(e.error&&e.error.stack)||((e.filename||"")+":"+e.lineno+":"+e.colno))},true);
addEventListener("unhandledrejection",function(e){var x=e.reason;r("rejection",(x&&x.message)||x,x&&x.stack)});
addEventListener("securitypolicyviolation",function(e){r("csp","Blocked by "+e.effectiveDirective+": "+e.blockedURI)});})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: errorScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
