import type { Metadata } from "next";
import { Geist_Mono, Geist } from "next/font/google";
import { type PropsWithChildren } from "react";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "next-wsync playground",
  description: "Local dev playground for next-wsync",
};

export default function RootLayout({ children }: Readonly<PropsWithChildren>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", geistMono.variable, "font-sans", geist.variable)}>
      <body className="min-h-full flex flex-col font-mono">{children}</body>
    </html>
  );
}
