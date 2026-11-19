import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isDemoMode } from "@/lib/config";

/**
 * Sends signed-out visitors to the sign-in page before any app screen loads.
 * This only checks that a session cookie exists; every API route verifies it.
 */
export function proxy(request: NextRequest) {
  if (isDemoMode()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const authPage = pathname === "/login" || pathname === "/signup";
  if (!signedIn && !authPage) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webmanifest)$).*)"],
};
