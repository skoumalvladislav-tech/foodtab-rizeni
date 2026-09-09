import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Newsreader } from "next/font/google";

import "./globals.css";

const archivo = Archivo({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-archivo", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-newsreader", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "FoodTab Marketing AI",
  description: "Tvorba, schvalování a publikování gastro obsahu pro restaurace FoodTab.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "FoodTab Marketing" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#241d1a",
};

const REZIM_SKRIPT = `try{var v=localStorage.getItem("foodtab-rezim");if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={`${archivo.variable} ${newsreader.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: REZIM_SKRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
