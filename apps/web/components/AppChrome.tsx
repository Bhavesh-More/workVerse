"use client";

import { usePathname } from "next/navigation";
import { m } from "framer-motion";
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/onboarding");
  const isSimulation = pathname.startsWith("/session/") && !pathname.endsWith("/debrief");

  return (
    <>
      {isPublic || isSimulation ? (
        children
      ) : (
        <div className="app-layout">
          <Sidebar />
          <m.div
            className="app-content"
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </m.div>
        </div>
      )}
    </>
  );
}
