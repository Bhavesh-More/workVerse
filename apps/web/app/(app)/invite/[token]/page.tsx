"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { AuthShell, FormError } from "../../../../components/AuthShell";
import { companyApi, type InvitePreview } from "../../../../lib/company";
import { useAuth } from "../../../../lib/auth";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { user, signOut } = useAuth();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = `/invite/${token}`;

  useEffect(() => {
    companyApi.invitePreview(token).then(setInvite, (e: unknown) => setError(e instanceof Error ? e.message : "This invite link is not valid."));
  }, [token]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await companyApi.acceptInvite(token);
      router.push(
        res.status === "completed" ? `/session/${res.session_id}/debrief` : `/briefing/${res.scenario_instance_id}?session=${res.session_id}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the assessment.");
      setBusy(false);
    }
  };

  const signedInAs = user?.primaryEmailAddress?.emailAddress;

  return (
    <AuthShell>
      {!invite ? (
        error ? <FormError message={error} /> : <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div className="stack">
          <span className="eyebrow">{invite.company} · assessment invite</span>
          <h1 className="page-title" style={{ fontSize: 34 }}>{invite.assessment}</h1>
          <p className="small muted">
            {invite.candidate_name ? `Hi ${invite.candidate_name}, ` : ""}
            {invite.company} invited you to a short simulated workday (about 15 minutes). You&apos;ll talk to AI colleagues, investigate a
            realistic problem and decide what to do.
          </p>
          {invite.message && <div className="banner"><span><strong>Note from {invite.company}:</strong> {invite.message}</span></div>}
          {invite.description && (
            <div className="card card--flat">
              <span className="eyebrow">About this assessment</span>
              <p className="small">{invite.description}</p>
            </div>
          )}
          <ul className="list-reset small stack--sm stack">
            <li>• Walk the office or use the quick panel; chat by text or voice.</li>
            <li>• Ask short questions — colleagues know different things.</li>
            <li>• Your report is shared with {invite.company} when you finish.</li>
          </ul>
          <FormError message={error} />
          {!invite.open ? (
            <div className="banner banner--error">This assessment is closed.</div>
          ) : !isLoaded ? null : isSignedIn ? (
            <>
              <button className="btn btn--block" onClick={start} disabled={busy} data-testid="start-assessment">
                {busy ? <span className="busy-dots">Preparing your office</span> : invite.started ? "Continue assessment →" : "Start assessment →"}
              </button>
              <p className="xsmall muted" style={{ textAlign: "center" }}>
                Signed in as {signedInAs}
                {signedInAs && signedInAs.toLowerCase() !== invite.email && <> (invite was sent to {invite.email})</>} ·{" "}
                <button className="text-link xsmall" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => signOut({ redirectUrl: back })}>
                  switch account
                </button>
              </p>
            </>
          ) : (
            <div className="stack--sm stack">
              <Link className="btn btn--block" href={`/signup?redirect=${encodeURIComponent(back)}`} data-testid="invite-signup">
                Create an account to start →
              </Link>
              <Link className="btn btn--ghost btn--block" href={`/login?redirect=${encodeURIComponent(back)}`}>
                I already have an account
              </Link>
              <p className="xsmall muted" style={{ textAlign: "center" }}>Use {invite.email} so {invite.company} can match your result.</p>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
