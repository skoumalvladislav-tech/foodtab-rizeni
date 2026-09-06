import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/authz";
import { bezpecnyCil } from "@/lib/prihlaseni";
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
  searchParams: Promise<{
    chyba?: string;
    qr?: string;
    odhlaseno?: string;
    kam?: string;
  }>;
}) {
  const { chyba, qr, odhlaseno, kam: kamZAdresy } = await searchParams;

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
    KAM SE PO PŘIHLÁŠENÍ VRÁTIT.

    Přednost má `?kam=` z adresy: tu tam zabalil ten, kdo člověka
    odmítl (`lib/prihlaseni-adresa.ts`), a je to jediné místo, kde se
    původní cesta ještě ví. Hlavička `x-foodtab-adresa` je tady totiž
    už `/prihlaseni` — přesměrování je nový požadavek.

    Hlavička zůstává jako záloha pro případ, že by se sem někdo dostal
    přímo. Obojí je jen NÁVRH; ověřuje se to až v akci přes
    `bezpecnyCil`, aby se odsud nedalo poslat člověka na cizí doménu.
  */
  const hlavicky = await headers();
  const kam = bezpecnyCil(kamZAdresy ?? hlavicky.get("x-foodtab-adresa"));

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
