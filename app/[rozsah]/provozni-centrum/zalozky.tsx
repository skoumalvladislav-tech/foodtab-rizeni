import Link from 'next/link'

import Ikona from '../ikona'
import type { IkonaKlic } from '../nabidka'

/**
 * Záložky Provozního centra: Přehled · Komunikace · Úkoly · Checklisty · Nástěnka.
 *
 * NIC SE NEPŘESOUVÁ. Záložky jsou jen společná navigace nad trasami, které
 * už existují (Dnes, Vzkazy, Úkoly, Nástěnka) — adresy, odkazy z upozornění
 * a přesměrování zůstávají. Jedna lišta místo čtyř různých míst, kam se
 * chodí zjistit, jestli se něco děje.
 *
 * Přepíná se adresou, ne skriptem (funguje i bez JavaScriptu, odkaz jde
 * poslat dál). Čísla u záložek jsou nepřečtené věci z TÉHOŽ zdroje jako
 * odznak ve zvonečku — nepočítají se tu podruhé po svém.
 */

export type KlicZalozky = 'prehled' | 'komunikace' | 'ukoly' | 'checklisty' | 'nastenka'

const ZALOZKY: {
  klic: KlicZalozky
  nazev: string
  ikona: IkonaKlic
  adresa: (rozsah: string) => string
}[] = [
  { klic: 'prehled', nazev: 'Přehled', ikona: 'hodiny', adresa: (r) => `/${r}/dnes` },
  { klic: 'komunikace', nazev: 'Komunikace', ikona: 'zprava', adresa: (r) => `/${r}/vzkazy` },
  { klic: 'ukoly', nazev: 'Úkoly', ikona: 'fajfkaCtverec', adresa: (r) => `/${r}/ukoly` },
  { klic: 'checklisty', nazev: 'Checklisty', ikona: 'seznam', adresa: (r) => `/${r}/ukoly#checklisty` },
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
  /** Nepřečtené / otevřené věci u jednotlivých záložek; nula se nekreslí. */
  pocty?: Partial<Record<KlicZalozky, number>>
  /** Záložky, na které člověk nemá právo (úkoly a checklisty) — nekreslí se. */
  skryte?: KlicZalozky[]
}) {
  return (
    <nav className="pc-zalozky" aria-label="Provozní centrum">
      {ZALOZKY.filter((z) => !skryte.includes(z.klic)).map((z) => {
        const pocet = pocty[z.klic] ?? 0
        return (
          <Link
            key={z.klic}
            href={z.adresa(rozsah)}
            aria-current={z.klic === aktivni ? 'page' : undefined}
          >
            <Ikona klic={z.ikona} />
            {z.nazev}
            {pocet > 0 ? (
              <span className="pc-pocet">
                <span className="sr-only">{pocet} nepřečtených: </span>
                {pocet > 99 ? '99+' : pocet}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
