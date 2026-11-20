import { merchantKey } from "./recurring";

/**
 * Where to go to manage or cancel well-known subscriptions. Kept short and to
 * each company's own account page, which changes far less often than deep links.
 */
export type CancelHelp = { url?: string; label?: string; how: string };

const DIRECTORY: { match: string; help: CancelHelp }[] = [
  { match: "netflix", help: { url: "https://www.netflix.com/cancelplan", label: "Open Netflix", how: "Sign in, then choose Cancel membership. You keep access until the end of the month you’ve paid for." } },
  { match: "spotify", help: { url: "https://www.spotify.com/account/subscription/", label: "Open Spotify", how: "On your account page, choose Change plan, then Cancel Premium. It can’t be cancelled inside the phone app." } },
  { match: "hulu", help: { url: "https://secure.hulu.com/account", label: "Open Hulu", how: "On your account page, choose Cancel under Your Subscription." } },
  { match: "disney", help: { url: "https://www.disneyplus.com/account", label: "Open Disney+", how: "On your account page, pick the subscription, then Cancel subscription." } },
  { match: "adobe", help: { url: "https://account.adobe.com/plans", label: "Open Adobe", how: "Choose Manage plan, then Cancel your plan. Yearly plans paid monthly can charge a fee for leaving early, so check before confirming." } },
  { match: "new york times", help: { url: "https://www.nytimes.com/account", label: "Open The New York Times", how: "On your account page, choose Manage subscription, then Cancel." } },
  { match: "amazon prime", help: { url: "https://www.amazon.com/gp/primecentral", label: "Open Amazon Prime", how: "Choose Manage membership, then End membership." } },
  { match: "youtube", help: { url: "https://www.youtube.com/paid_memberships", label: "Open YouTube", how: "Under Memberships, choose Manage membership, then Deactivate." } },
  { match: "audible", help: { url: "https://www.audible.com/account/overview", label: "Open Audible", how: "On your account page, choose Cancel membership. Use your credits first: they go away when you cancel." } },
  { match: "dropbox", help: { url: "https://www.dropbox.com/account/plan", label: "Open Dropbox", how: "On the Plan page, choose Cancel plan. Your files stay, but you drop back to the free amount of space." } },
  { match: "paramount", help: { url: "https://www.paramountplus.com/account/", label: "Open Paramount+", how: "On your account page, choose Cancel subscription." } },
  { match: "peacock", help: { url: "https://www.peacocktv.com/account/plans", label: "Open Peacock", how: "Under Plans & Payments, choose Cancel plan." } },
  { match: "microsoft", help: { url: "https://account.microsoft.com/services", label: "Open Microsoft", how: "Under Services & subscriptions, choose Manage, then Cancel subscription." } },
  { match: "google one", help: { url: "https://one.google.com/settings", label: "Open Google One", how: "In Settings, choose Cancel membership." } },
  { match: "apple", help: { url: "https://apps.apple.com/account/subscriptions", label: "Open Apple subscriptions", how: "On an iPhone: Settings, your name at the top, then Subscriptions. Pick the one to cancel." } },
  { match: "fitness", help: { how: "Gyms usually need you to cancel in person or in writing, with notice. Check your contract for how many days." } },
  { match: "gym", help: { how: "Gyms usually need you to cancel in person or in writing, with notice. Check your contract for how many days." } },
];

export function cancelHelp(name: string): CancelHelp {
  const key = merchantKey(name);
  const known = DIRECTORY.find((d) => key.includes(d.match));
  if (known) return known.help;
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(`how to cancel ${name}`)}`,
    label: `Search how to cancel ${name}`,
    how: "Most services let you cancel from the account or billing page on their website.",
  };
}

/** True for merchants that are almost always a subscription, even after a single charge. */
export function isKnownSubscription(name: string): boolean {
  const key = merchantKey(name);
  return DIRECTORY.some((d) => d.help.url && key.includes(d.match));
}
