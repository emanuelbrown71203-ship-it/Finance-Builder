import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isDemoMode, siteOrigin } from "@/lib/config";

/**
 * Sends signed-out visitors to the sign-in page before any app screen loads,
 * and visitors on any other address to the site's one real address.
 * This only checks that a session cookie exists; every API route verifies it.
 */
export function proxy(request: NextRequest) {
  if (isDemoMode()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  // The site has one real address (APP_URL). Any other address Vercel adds (like the short
  // project-name one) forwards there, because sign-in, cookies and Face ID only work on the real one.
  const origin = siteOrigin();
  if (origin && request.nextUrl.host !== new URL(origin).host) return NextResponse.redirect(new URL(pathname + search, origin), 308);
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const authPage = pathname === "/login" || pathname === "/signup";
  if (!signedIn && !authPage) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webmanifest)$).*)"],
};
