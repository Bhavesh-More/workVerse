"use client";

import { useEffect } from "react";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { setTokenGetter } from "../lib/api";

/**
 * Registers a token getter with the API client. Clerk session tokens are short-lived and may
 * not be available for a brief moment right after sign-in, so the getter polls briefly until a
 * token exists. The getter is set during render so it is available before child effects fire.
 */
export function TokenBridge() {
  const { getToken } = useClerkAuth();

  setTokenGetter(async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const token = await getToken();
        if (token) return token;
      } catch {
        // Clerk not ready yet; retry.
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  });

  useEffect(() => () => setTokenGetter(null), []);

  return null;
}
