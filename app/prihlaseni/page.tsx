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
  searchParams: Promise<{ chyba?: string }>;
}) {
  const { chyba } = await searchParams;
  return <PrihlasovaciFormular chybaZOdkazu={chyba === "odkaz"} />;
}
