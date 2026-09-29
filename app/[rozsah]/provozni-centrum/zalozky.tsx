import Link from 'next/link'

import { odznakPoctu, popisPoctu, type KlicZalozky } from '@/lib/komunikace/zalozky'
import Ikona from '../ikona'
import type { IkonaKlic } from '../nabidka'

export type { KlicZalozky }

/**
 * Záložky „Vzkazy a úkoly“ (do 22. 9. „Provozní centrum“): Komunikace ·
 * Úkoly · Checklisty · Nástěnka.
 *
 * NIC SE NEPŘESOUVÁ. Záložky jsou jen společná navigace nad trasami, které
 * už existují (Vzkazy, Úkoly, Nástěnka) — adresy, odkazy z upozornění
 * a přesměrování zůstávají. Jedna lišta místo víc různých míst, kam se
 * chodí zjistit, jestli se něco děje.
 *
 * Záložka „Přehled“ (odkaz na /dnes) 22. 9. odpadla — Dnes má vlastní
 * položku v levém sloupci, takže to byla druhá cesta ke stejné obrazovce.
 *
 * Přepíná se adresou, ne skriptem (funguje i bez JavaScriptu, odkaz jde
 * poslat dál).
 *
 * ČÍSLA A SKRYTÉ ZÁLOŽKY POČÍTÁ JEDNA FUNKCE (`nactiZalozky` v
 * `pocty.ts`) a každá stránka je sem jen posílá (27. 9.). Dřív si je
 * každá stránka počítala po svém a při přepínání se objevovala a mizela.
 */

const ZALOZKY: {
  klic: KlicZalozky
  nazev: string
  ikona: IkonaKlic
  adresa: (rozsah: string) => string
}[] = [
  { klic: 'komunikace', nazev: 'Komunikace', ikona: 'zprava', adresa: (r) => `/${r}/vzkazy` },
  { klic: 'ukoly', nazev: 'Úkoly', ikona: 'fajfkaCtverec', adresa: (r) => `/${r}/ukoly` },
  { klic: 'checklisty', nazev: 'Checklisty', ikona: 'seznam', adresa: (r) => `/${r}/ukoly/checklisty` },
  { klic: 'nastenka', nazev: 'Nástěnka', ikona: 'praporek', adresa: (r) => `/${r}/vzkazy?zalozka=nastenka` },
]

export default function PcZalozky({
  rozsah,
  aktivni,
  pocty = {},
  skryte = [],
}: {
  rozsah: string
  aktivni: KlicZalozky
  /** Nepřečtené (u Úkolů otevřené) věci u jednotlivých záložek; nula se nekreslí. */
  pocty?: Partial<Record<KlicZalozky, number>>
  /** Záložky, na které člověk nemá právo — nekreslí se (`skryteZalozky`). */
  skryte?: KlicZalozky[]
}) {
  return (
    <nav className="pc-zalozky" aria-label="Vzkazy a úkoly">
      {ZALOZKY.filter((z) => !skryte.includes(z.klic)).map((z) => {
        const pocet = pocty[z.klic] ?? 0
        const odznak = odznakPoctu(pocet)
        return (
          <Link
            key={z.klic}
            href={z.adresa(rozsah)}
            aria-current={z.klic === aktivni ? 'page' : undefined}
          >
            <Ikona klic={z.ikona} />
            {z.nazev}
            {odznak ? (
              <span className="pc-pocet">
                <span className="sr-only">{`, ${popisPoctu(z.klic, pocet)}`}</span>
                <span aria-hidden="true">{odznak}</span>
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
