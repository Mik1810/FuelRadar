import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { BrowserStateBootstrap } from "@/browser/browser-state";
import { SITE_DESCRIPTION, SITE_NAME } from "@/config/site";

import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://fuelradar.michaelpiccirilli.it"),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "prezzi carburante",
    "distributori",
    "benzina",
    "diesel",
    "GPL",
    "metano",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    type: "website",
    locale: "it_IT",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/logo.png",
        width: 1_254,
        height: 1_254,
        alt: `${SITE_NAME} — ${SITE_DESCRIPTION}`,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7f9b84",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="it">
      <body>
        <BrowserStateBootstrap />
        {children}
      </body>
    </html>
  );
}
