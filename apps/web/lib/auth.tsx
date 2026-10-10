"use client";

import { useUser, useClerk } from "@clerk/nextjs";

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
