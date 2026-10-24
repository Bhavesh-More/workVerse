import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/signup(.*)",
  // Dev-only animation preview; the page itself 404s in production.
  ...(process.env.NODE_ENV === "production" ? [] : ["/intro-preview", "/tool-preview", "/office-preview"]),
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
    return;
  }
  // Signed-in users have no reason to see the landing or auth pages: send them to the app.
  const { userId } = await auth();
  if (userId) return NextResponse.redirect(new URL("/dashboard", req.url));
});

export const config = {
  matcher: [
    // Skip Next internals, public/assets (game data such as map/atlas JSON) and static files
    // unless they are API/trpc routes. Assets must never be auth-gated or redirected.
    "/((?!_next|assets/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
