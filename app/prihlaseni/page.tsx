import type { Metadata } from "next";

import PrihlasovaciFormular from "./formular";

export const metadata: Metadata = {
  title: "Přihlášení – Foodtab",
};

// Stránka je serverová jen kvůli tomu, aby si přečetla ?chyba= z adresy.
// Kdyby to dělala komponenta v prohlížeči přes useSearchParams, musela by
// být zabalená v Suspense, jinak by neprošlo statické vykreslení.
export default async function Prihlaseni({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string; qr?: string }>;
}) {
  const { chyba, qr } = await searchParams;
  /*
    Kdo naskenoval kód z tabletu a nebyl přihlášený, přistane tady.
    Než dokliká přihlášení, kód je dávno mrtvý — a to mu má aplikace
    říct rovnou, ne až u druhého neúspěšného ťuknutí.
    Viz docs/qr-na-kiosku-zadani.md, oddíl 4.
  */
  return (
    <PrihlasovaciFormular chybaZOdkazu={chyba === "odkaz"} zQr={qr === "1"} />
  );
}
