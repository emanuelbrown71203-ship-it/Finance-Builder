/*
 * Passbook's service worker. It only shows notifications and opens the screen one is about. It doesn't
 * cache or touch anything the app loads, so the app is always the newest version.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only ever a screen on this site: the link is worked out in full first, then its site compared. */
function safeUrl(url) {
  try {
    const resolved = new URL(typeof url === "string" ? url : "/", self.location.origin);
    if (resolved.origin === self.location.origin) return resolved.href;
  } catch {}
  return new URL("/", self.location.origin).href;
}

function deviceLabel() {
  const ua = self.navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "This device";
}

self.addEventListener("push", (event) => {
  let note = {};
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    note = {};
  }
  const title = typeof note.title === "string" && note.title ? note.title.slice(0, 120) : "Passbook";
  const body = typeof note.body === "string" ? note.body.slice(0, 300) : "";
  // A phone must be shown something for every push, or it stops delivering them.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof note.tag === "string" ? note.tag.slice(0, 80) : undefined,
      icon: "/nickel-192.png",
      badge: "/nickel-192.png",
      data: { url: safeUrl(note.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// The browser renewed this device's push address: hand the new one over, so notes keep arriving. Only
// while still signed in (the request carries the sign-in), and never for a device removed from the list.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const sub = event.newSubscription || (old && old.options ? await self.registration.pushManager.subscribe(old.options) : null);
      if (!sub) return;
      await fetch("/api/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel(), auto: true }),
      }).catch(() => {});
    })(),
  );
});
