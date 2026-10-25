"use client";

// The emailed invitation link. Signed in: the invitation is linked to this account and you land on
// its briefing in Company assessments (nothing is accepted or started). Signed out: a short
// preview, then sign in or create an account and come straight back here.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { AuthShell, FormError } from "../../../../components/AuthShell";
import { companyApi, type InvitePreview } from "../../../../lib/company";
import { useAuth } from "../../../../lib/auth";
import { formatWhen, zoneAbbr } from "../../../../lib/time";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { isSignedIn, isLoaded } = useClerkAuth();
  const { signOut } = useAuth();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const claimed = useRef(false);
  const back = `/invite/${token}`;

  useEffect(() => {
    companyApi.invitePreview(token).then(setInvite, (e: unknown) => setError(e instanceof Error ? e.message : "This invite link is not valid."));
  }, [token]);

  // Signed in: link it to this account and open the briefing. This never accepts or starts it.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !invite || claimed.current) return;
    claimed.current = true;
    companyApi.claimInvite(token).then(
      (r) => router.replace(`/assessments/${r.invite_id}`),
      (e: unknown) => setClaimError(e instanceof Error ? e.message : "Could not open this invitation."),
    );
  }, [isLoaded, isSignedIn, invite, token, router]);

  return (
    <AuthShell>
      {!invite ? (
        error ? (
          <div className="stack" data-testid="invite-invalid">
            <span className="eyebrow">Assessment invitation</span>
            <h1 className="page-title" style={{ fontSize: 30 }}>This link doesn&apos;t work</h1>
            <FormError message={error} />
            <p className="small muted">Check that you copied the whole link from the email, or ask the company to send the invitation again.</p>
          </div>
        ) : (
          <div className="skeleton" style={{ height: 220 }} />
        )
      ) : (
        <div className="stack" data-testid="invite-preview">
          <span className="eyebrow">{invite.company} · assessment invitation</span>
          <h1 className="page-title" style={{ fontSize: 32 }}>{invite.assessment}</h1>
          {invite.tagline && <p className="small" style={{ margin: 0 }}>{invite.tagline}</p>}
          <p className="small muted" style={{ margin: 0 }}>
            {invite.candidate_name ? `Hi ${invite.candidate_name}, ` : ""}
            {invite.company} invited you to a short simulated workday on WorkVerse (about 15 minutes, not timed).
          </p>
          {invite.due_at && (
            <div className="banner">
              <span>
                <strong>Due {formatWhen(invite.due_at, undefined, true)}</strong> <span className="muted">your time ({zoneAbbr(invite.due_at)})</span>
              </span>
            </div>
          )}
          {!invite.open && (
            <div className="banner banner--error" role="alert" data-testid="invite-closed">
              <span>
                <strong>{invite.label}.</strong> {invite.note}
              </span>
            </div>
          )}
          {claimError && (
            <div className="stack--sm stack">
              <FormError message={claimError} />
              <button className="btn btn--ghost btn--block" onClick={() => signOut({ redirectUrl: back })}>Sign in with a different account</button>
            </div>
          )}
          {!isLoaded ? null : isSignedIn ? (
            !claimError && <p className="small muted" data-testid="invite-opening"><span className="busy-dots">Opening the invitation</span></p>
          ) : (
            <div className="stack--sm stack">
              <p className="small" style={{ margin: 0 }}>
                Sign in to review the details. <b>Nothing starts until you choose to.</b>
              </p>
              <Link className="btn btn--block" href={`/login?redirect=${encodeURIComponent(back)}`} data-testid="invite-login">
                Sign in to review →
              </Link>
              <Link className="btn btn--ghost btn--block" href={`/signup?redirect=${encodeURIComponent(back)}`} data-testid="invite-signup">
                Create an account
              </Link>
              <p className="xsmall muted" style={{ textAlign: "center" }}>Use {invite.email} so it&apos;s matched to you automatically.</p>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
