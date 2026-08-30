import type { Metadata } from "next";
import { IBM_Plex_Mono, Archivo, Newsreader } from "next/font/google";

import "./globals.css";
import PwaRegistration from "./pwa-registration";

const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-newsreader",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

// Mono jen na časy, data a čísla ve sloupcích. Číslice mají stejnou
// šířku, takže se pod sebou nehoupou.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Foodtab – řízení restaurací",
  description:
    "Interní operační systém pro řízení restaurací, týmu a firemních znalostí.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Foodtab",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#131a2b",
};

/**
 * Volba režimu se čte ještě před vykreslením.
 *
 * Kdyby ji nastavoval až React po připojení, stihla by se stránka
 * vykreslit ve špatném režimu a probliknout. Proto tenhle krátký skript
 * v hlavičce: přečte localStorage a nastaví data-theme dřív, než se
 * cokoli nakreslí. Bez uložené volby atribut nenastaví vůbec, takže
 * rozhodne prefers-color-scheme.
 */
const REZIM_SKRIPT = `
try {
  var v = localStorage.getItem("foodtab-rezim");
  if (v === "light" || v === "dark") {
    document.documentElement.setAttribute("data-theme", v);
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className={`${archivo.variable} ${newsreader.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: REZIM_SKRIPT }} />
      </head>
      <body className="antialiased">
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
