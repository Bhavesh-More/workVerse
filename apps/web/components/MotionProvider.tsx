"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

// Animation features (incl. layout/layoutId) arrive in a separate chunk after first paint;
// `m.*` components render their static state until then. `strict` flags any stray `motion.*`.
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {/* Honour the OS "reduce motion" setting for every framer animation in the app. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
