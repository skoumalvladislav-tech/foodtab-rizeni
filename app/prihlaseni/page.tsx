import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/authz";
import PrihlaseniKodem from "./prihlaseni-kodem";

export const metadata: Metadata = {
  title: "Přihlášení – Foodtab",
};

// Serverová schválně: přečte si ?chyba= a ?qr= z adresy. Kdyby to dělala
// komponenta v prohlížeči přes useSearchParams, musela by být zabalená
// v Suspense, jinak by neprošlo statické vykreslení.
export const dynamic = "force-dynamic";

export default async function Prihlaseni({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string; qr?: string; odhlaseno?: string }>;
}) {
  const { chyba, qr, odhlaseno } = await searchParams;

  /*
    PŘIHLÁŠENÝ ČLOVĚK SEM NEPATŘÍ.

    Není to jen pohodlí. Do 6. 9. tahle branka chyběla a přihlášený
    člověk mohl na téhle stránce zůstat otevřený — a stará podoba
    formuláře si tu stavěla `getBrowserSupabase()`. Ten klient si sám
    obnovuje token a zapisuje sezení do `document.cookie`, tedy
    javascriptem; Safari takovou cookie zkracuje na sedm dní. Odsud se
    tedy dalo serverem zapsanou cookii nechtěně přepsat tou horší.

    Browser klient odsud zmizel, ale branka zůstává: přihlášenému
    nemáme co nabízet a jedna cesta k té chybě navíc není potřeba.
    Odhlášení je na Moje údaje.
  */
  if (odhlaseno !== "1") {
    const user = await getUser();
    if (user) redirect("/");
  }

  /*
    Kam se po přihlášení vrátit. Adresu podává `proxy.ts` hlavičkou —
    layout ani stránka `searchParams` z původního požadavku nedostanou.
    Ověřuje se až na serveru v akci, tady je to jen návrh.
  */
  const hlavicky = await headers();
  const kam = hlavicky.get("x-foodtab-adresa") ?? "/";

  /*
    Kdo naskenoval kód z tabletu a nebyl přihlášený, přistane tady.
    Než dokliká přihlášení, kód je dávno mrtvý — a to mu má aplikace
    říct rovnou, ne až u druhého neúspěšného ťuknutí.
    Viz docs/qr-na-kiosku-zadani.md, oddíl 4.
  */
  return (
    <PrihlaseniKodem
      chybaZOdkazu={chyba === "odkaz"}
      zQr={qr === "1"}
      odhlaseny={odhlaseno === "1"}
      kam={kam}
    />
  );
}
