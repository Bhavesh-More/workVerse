import type { Metadata } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { MotionProvider } from "../components/MotionProvider";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Display face: DESIGN.md's listed substitute for Swizzy, used at weight 500 only.
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-schibsted",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkVerse AI",
  description:
    "A safe place for students and early-career engineers to practise real workplace moments — incidents, updates, tough conversations — with AI colleagues, then get feedback that cites what you actually said.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${schibsted.variable}`}>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
