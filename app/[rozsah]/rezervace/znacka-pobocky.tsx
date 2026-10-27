import type { PobockaKalendare } from '@/lib/rezervace-pobocky'

/**
 * Štítek se zkratkou pobočky („RČP“) v její barvě — plný obdélník, ať se
 * nesplete s bledými pilulkami stavů. Barva nikdy sama: zkratka je
 * napsaná, celý název je v `title` a pro odečítač. Kde celý název stojí
 * hned vedle (legenda, hlavička oddílu), odečítač štítek přeskočí.
 *
 * Vlastní soubor bez dotazů a akcí: kreslí ho kalendář Rezervací
 * (serverově) i okénko hostů v Rozpisu směn (v prohlížeči).
 */
export function ZnackaPobocky({ pobocka, vedleNazvu = false }: { pobocka: PobockaKalendare; vedleNazvu?: boolean }) {
  return (
    <span className="ds-rez-znacka" data-branch={pobocka.barva} title={pobocka.nazev} aria-hidden={vedleNazvu ? true : undefined}>
      <span aria-hidden="true">{pobocka.zkratka}</span>
      {vedleNazvu ? null : <span className="sr-only">{pobocka.nazev}</span>}
    </span>
  )
}
