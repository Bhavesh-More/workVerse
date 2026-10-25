"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

export function clerkErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? fallback;
  }
  return fallback;
}

export type AppUser = {
  fullName: string | null;
  firstName: string | null;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
};

export type AppAuth = {
  user: AppUser | null;
  loading: boolean;
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
};

/**
 * Thin wrapper over Clerk so pages can read the current user and sign out without depending
 * on Clerk's prebuilt UI. Session tokens are supplied to the API client by <TokenBridge/>.
 */
export function useAuth(): AppAuth {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  return {
    user: user
      ? {
          fullName: user.fullName,
          firstName: user.firstName,
          imageUrl: user.imageUrl,
          primaryEmailAddress: user.primaryEmailAddress
            ? { emailAddress: user.primaryEmailAddress.emailAddress }
            : null,
        }
      : null,
    loading: !isLoaded,
    signOut: (options) => signOut(options),
  };
}

/** Where to go after sign-in/up: a same-site ?redirect= path (e.g. back to an invite) or the default. */
export function authRedirect(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const target = new URLSearchParams(window.location.search).get("redirect");
  return target && target.startsWith("/") && !target.startsWith("//") ? target : fallback;
}

/** Carry the ?redirect= along when switching between log-in and sign-up (read after mount to match SSR). */
export function useWithRedirect(href: string): string {
  const [out, setOut] = useState(href);
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("redirect");
    setOut(target ? `${href}?redirect=${encodeURIComponent(target)}` : href);
  }, [href]);
  return out;
}
