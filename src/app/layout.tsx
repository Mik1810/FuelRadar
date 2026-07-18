import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SITE_DESCRIPTION, SITE_NAME } from "@/config/site";

import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.png",
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
      <body>{children}</body>
    </html>
  );
}
