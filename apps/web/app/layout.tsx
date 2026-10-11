import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { TokenBridge } from "../components/TokenBridge";
import { AppChrome } from "../components/AppChrome";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkVerse AI",
  description:
    "Practise realistic workplace scenarios with AI colleagues in a 2D office and get evidence-grounded feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
    >
      <html lang="en" className={jetbrains.variable}>
        <body>
          <TokenBridge />
          <AppChrome>{children}</AppChrome>
        </body>
      </html>
    </ClerkProvider>
  );
}
