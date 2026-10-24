"use client";

import { useEffect, useState } from "react";
import { api, peek, revalidate } from "./api";

/** Cached read: returns the last known data immediately, then refreshes it. */
export function useApi<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => peek<T>(key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    revalidate(key, fetcher).then(
      (d) => live && setData(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load."),
    );
    return () => {
      live = false;
    };
    // `fetcher` is an api.* method reference; `key` identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, setData };
}

/** Data each sidebar page needs, so hovering a link can warm the cache before the click. */
const ROUTE_DATA: Record<string, [string, () => Promise<unknown>][]> = {
  "/dashboard": [
    ["/me", api.getMe],
    ["/progress", api.progress],
    ["/sessions", api.listSessions],
    ["/progress/competencies", api.competencies],
  ],
  "/scenarios": [
    ["/scenario-templates", api.listTemplates],
    ["/sessions", api.listSessions],
  ],
  "/progress": [
    ["/progress", api.progress],
    ["/progress/competencies", api.competencies],
  ],
  "/profile": [["/me", api.getMe]],
  "/sessions": [["/sessions", api.listSessions]],
};

export function prefetchRoute(href: string) {
  for (const [key, fetcher] of ROUTE_DATA[href] ?? []) {
    if (peek(key) === undefined) revalidate(key, fetcher).catch(() => {});
  }
}
