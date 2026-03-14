import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const tiemposHeadline = localFont({
  src: "../public/fonts/TiemposHeadline-Regular.otf",
  variable: "--font-tiempos",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lead Gen Dashboard",
  description: "Website visibility & lead intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${tiemposHeadline.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
