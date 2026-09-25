import Link from "next/link";

import Ikona from "../ikona";
import type { IkonaKlic } from "../nabidka";

/**
 * Záložky Docházky: Docházka · Výdělky · Zálohy (24. 9. 2026).
 *
 * Zadání majitele: „sloučit kartu zálohy do karty docházka“ a ukazovat
 * výdělky lidí. Zálohy měly v nabídce vlastní položku; teď bydlí pod
 * /dochazka/zalohy a starou adresu drží přesměrování v next.config.ts.
 *
 * Stejný vzor jako PcZalozky (Vzkazy a úkoly): odkazy, přepíná se
 * adresou, funguje bez JavaScriptu a odkaz jde poslat dál.
 *
 * PRÁVA TADY NEJSOU. Které záložky se kreslí, spočítala stránka
 * (`zalozky-prava.ts`) a poslala to sem. Schovaná záložka navíc není
 * zámek — každá podstránka si právo ověřuje sama a v databázi hlídá
 * druhá linie.
 */

export type KlicZalozky = "dochazka" | "vydelky" | "zalohy";

const ZALOZKY: {
  klic: KlicZalozky;
  nazev: string;
  ikona: IkonaKlic;
  adresa: (rozsah: string) => string;
  /** Záložka umí `?mesic=` — přepnutím se nemá ztratit vybraný měsíc. */
  sMesicem: boolean;
}[] = [
  { klic: "dochazka", nazev: "Docházka", ikona: "hodiny", adresa: (r) => `/${r}/dochazka`, sMesicem: true },
  { klic: "vydelky", nazev: "Výdělky", ikona: "mince", adresa: (r) => `/${r}/dochazka/vydelky`, sMesicem: true },
  // Zálohy ukazují vždy běžící měsíc, parametr by jen visel v adrese.
  { klic: "zalohy", nazev: "Zálohy", ikona: "kniha", adresa: (r) => `/${r}/dochazka/zalohy`, sMesicem: false },
];

export default function DochazkaZalozky({
  rozsah,
  aktivni,
  viditelne,
  mesic = null,
}: {
  rozsah: string;
  aktivni: KlicZalozky;
  /** Záložky, na které člověk má právo. Ostatní se nekreslí vůbec. */
  viditelne: KlicZalozky[];
  /** Měsíc z adresy (RRRR-MM), už ověřený stránkou; jinak nic. */
  mesic?: string | null;
}) {
  const zalozky = ZALOZKY.filter((z) => viditelne.includes(z.klic));

  // Jediná záložka není volba. Číšník, který vidí jen svou docházku,
  // nemá dostat lištu s jedním odkazem na stránku, na které už stojí.
  if (zalozky.length < 2) return null;

  return (
    <nav className="ds-zalozky" aria-label="Docházka">
      {zalozky.map((z) => (
        <Link
          key={z.klic}
          href={mesic && z.sMesicem ? `${z.adresa(rozsah)}?mesic=${mesic}` : z.adresa(rozsah)}
          aria-current={z.klic === aktivni ? "page" : undefined}
        >
          <Ikona klic={z.ikona} />
          {z.nazev}
        </Link>
      ))}
    </nav>
  );
}
