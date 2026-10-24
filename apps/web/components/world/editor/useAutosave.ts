"use client";

// Autosave for the world draft. Saves 1.2s after the last committed change (never on pointer
// moves), one request at a time, each carrying the version it was based on so a stale tab gets a
// conflict instead of overwriting newer work. "Saved" only shows after the server confirms.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../../lib/api";
import { workplaceApi } from "../../../lib/workplace";
import type { WorldDoc } from "../../../lib/world/types";

export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";

export function useAutosave(doc: WorldDoc, revision: number, initialVersion: number) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const version = useRef(initialVersion);
  const savedRevision = useRef(revision);
  const inflight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ doc, revision });
  latest.current = { doc, revision };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);

  const save = useCallback(async (): Promise<boolean> => {
    if (blocked.current) return false;
    if (inflight.current) await inflight.current;
    const { doc: d, revision: rev } = latest.current;
    if (rev === savedRevision.current && version.current > 0) return true;
    setStatus("saving");
    const run = (async () => {
      try {
        const res = await workplaceApi.saveDraft(d, version.current);
        version.current = res.draft_version;
        savedRevision.current = rev;
        setSavedAt(new Date(res.saved_at));
        setError(null);
        setStatus(latest.current.revision === rev ? "saved" : "pending");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setStatus("conflict");
          setError(e.message);
        } else {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Save failed.");
        }
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    const ok = await run;
    // Changes made while saving get their own save.
    if (ok && latest.current.revision !== savedRevision.current) schedule();
    return ok;
    // schedule is defined below and stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  }, [save]);

  useEffect(() => {
    if (revision === savedRevision.current) return;
    if (!blocked.current) setStatus((s) => (s === "saving" ? s : "pending"));
    schedule();
  }, [revision, schedule]);

  // Warn before leaving with unsaved work.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (latest.current.revision !== savedRevision.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return {
    status,
    error,
    savedAt,
    version: () => version.current,
    /** Save right now (e.g. before publishing). Resolves false if it couldn't. */
    flush: async () => {
      if (timer.current) clearTimeout(timer.current);
      return save();
    },
    retry: () => {
      setStatus("pending");
      void save();
    },
    /** After a conflict: adopt the server's version (the caller reloads the doc) or overwrite. */
    resolve: (serverVersion: number, overwrite: boolean) => {
      version.current = serverVersion;
      blocked.current = false;
      if (overwrite) void save();
      else {
        savedRevision.current = latest.current.revision;
        setStatus("saved");
        setError(null);
      }
    },
    markSaved: (v: number) => {
      version.current = v;
      savedRevision.current = latest.current.revision;
    },
    dirty: () => latest.current.revision !== savedRevision.current,
  };
}
