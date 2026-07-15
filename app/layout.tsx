import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const neueMontreal = localFont({
  src: "../public/fonts/PPNeueMontreal-Regular.otf",
  variable: "--font-neue-montreal",
  display: "swap",
});

const tiemposHeadline = localFont({
  src: "../public/fonts/TiemposHeadline-Regular.otf",
  variable: "--font-tiempos",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lead Gen Dashboard",
  description: "Website visibility & lead intelligence",
  icons: {
    icon: [
      {
        url: "/mmg-icon.png",
        type: "image/png",
        sizes: "136x136",
      },
    ],
    shortcut: "/mmg-icon.png",
    apple: "/mmg-icon.png",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${neueMontreal.variable} ${tiemposHeadline.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
