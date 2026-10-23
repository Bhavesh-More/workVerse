import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/login(.*)", "/signup(.*)"]);

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
    // Skip Next internals and static files unless they are API/trpc routes.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
