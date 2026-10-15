import { ClerkProvider } from "@clerk/nextjs";
import { TokenBridge } from "../../components/TokenBridge";
import { AppChrome } from "../../components/AppChrome";

// Clerk (and its ~250 KB of client JS) loads only for routes that need identity;
// the marketing landing page at "/" stays outside this group.
export default function AppGroupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
    >
      <TokenBridge />
      <AppChrome>{children}</AppChrome>
    </ClerkProvider>
  );
}
