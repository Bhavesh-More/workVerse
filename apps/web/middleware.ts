import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/signup(.*)",
  "/company/login(.*)",
  "/company/signup(.*)",
  // Candidates read their invite before signing in.
  "/invite(.*)",
  // Dev-only animation preview; the page itself 404s in production.
  ...(process.env.NODE_ENV === "production" ? [] : ["/intro-preview", "/tool-preview", "/office-preview"]),
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    // Company pages send signed-out visitors to the company log-in, then back.
    if (req.nextUrl.pathname.startsWith("/company")) {
      const { userId } = await auth();
      if (!userId) {
        const login = new URL("/company/login", req.url);
        login.searchParams.set("redirect", req.nextUrl.pathname);
        return NextResponse.redirect(login);
      }
      return;
    }
    await auth.protect();
    return;
  }
  // Signed-in users have no reason to see the landing or auth pages: send them to the app.
  if (req.nextUrl.pathname.startsWith("/invite")) return;
  const { userId } = await auth();
  if (userId) {
    const home = req.nextUrl.pathname.startsWith("/company") ? "/company" : "/dashboard";
    return NextResponse.redirect(new URL(home, req.url));
  }
});

export const config = {
  matcher: [
    // Skip Next internals, public/assets (game data such as map/atlas JSON) and static files
    // unless they are API/trpc routes. Assets must never be auth-gated or redirected.
    "/((?!_next|assets/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
