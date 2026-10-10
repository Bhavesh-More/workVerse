"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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

  if (isPublic || isSimulation) {
    return <>{children}</>;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <motion.div
        className="app-content"
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
