"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return <div className="app-main spinner">Restoring session…</div>;
  }
  if (!user) {
    return <div className="app-main spinner">Redirecting to sign in…</div>;
  }
  return <>{children}</>;
}
