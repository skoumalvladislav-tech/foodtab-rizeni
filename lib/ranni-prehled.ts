import { hodinyAMinuty, koruny } from './mzdy.ts'
import { pocet, prisudek, sklonovat } from './sklonovani.ts'

/**
 * Ranní přehled majiteli — text e-mailu.
 *
 * Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíl 8.
 *
 * PÍŠE HO KÓD, NE JAZYKOVÝ MODEL (pravidlo 8). Až přijdou agenti,
 * tenhle e-mail k nim nepatří — jde v něm o docházku a peníze.
 *
 * A JSOU V NĚM JEN ČÍSLA. Žádná jména, žádné příchody po lidech, žádné
 * částky po lidech. E-mail leží v cizí schránce, na telefonu i v záloze
 * poštovní služby; osobní údaje zaměstnanců by tím z aplikace odešly
 * nadobro a už by se nedaly vzít zpět.
 *
 * Tenhle soubor je proto úmyslně hloupý: dostane hotová čísla
 * z `public.ranni_prehled` a skládá z nich věty. Nic si nedotahuje.
 */

/** Jeden řádek z public.ranni_prehled. Samá čísla, schválně. */
export type PrehledPobocky = {
  pobocka: string
  lidi: number
  odpracovano_minut: number
  rucnich_zapisu: number
  nedokoncenych: number
  zaloh: number
  zaloh_haleru: number
  zaloh_nepotvrzenych: number
}

const DNY = [
  'neděle',
  'pondělí',
  'úterý',
  'středa',
  'čtvrtek',
  'pátek',
  'sobota',
]

/** „pondělí 1. 9.“ z „2026-09-01“. */
export function nazevDne(den: string): string {
  const [r, m, d] = den.split('-').map(Number)
  // Poledne UTC, ne půlnoc: půlnoc se v našem pásmu posune na předchozí
  // den a přehled by měl v nadpisu jiný den než v číslech.
  const datum = new Date(Date.UTC(r, m - 1, d, 12))
  return `${DNY[datum.getUTCDay()]} ${d}. ${m}.`
}

/**
 * Souhrn jedné pobočky. Vrací věty, ne odrážky — přehled se čte na
 * telefonu ještě před kávou.
 */
export function vetyPobocky(p: PrehledPobocky): string[] {
  const vety: string[] = []

  if (p.lidi === 0) {
    vety.push('Nikdo si nepíchl. Buď se nepracovalo, nebo se nepíchalo.')
  } else {
    vety.push(
      `Odpracovalo ${pocet(p.lidi, 'člověk', 'lidi', 'lidí')}, ` +
        `${hodinyAMinuty(p.odpracovano_minut)}.`,
    )
  }

  if (p.rucnich_zapisu > 0) {
    vety.push(
      `${pocet(p.rucnich_zapisu, 'ruční zápis', 'ruční zápisy', 'ručních zápisů')}.`,
    )
  }

  if (p.nedokoncenych > 0) {
    vety.push(
      `${pocet(p.nedokoncenych, 'příchod', 'příchody', 'příchodů')} ` +
        `bez odchodu — do hodin ` +
        `${prisudek(p.nedokoncenych, 'se nezapočítal', 'se nezapočítaly')}.`,
    )
  }

  if (p.zaloh > 0) {
    let z =
      `Zálohy: ${pocet(p.zaloh, 'výplata', 'výplaty', 'výplat')}, ` +
      `${koruny(p.zaloh_haleru)}.`
    if (p.zaloh_nepotvrzenych > 0) {
      z +=
        ` ${pocet(p.zaloh_nepotvrzenych, 'nepotvrzená', 'nepotvrzené', 'nepotvrzených')}.`
    }
    vety.push(z)
  }

  return vety
}

/** Prostý text e-mailu. */
export function textPrehledu(den: string, pobocky: PrehledPobocky[]): string {
  const casti = pobocky.map((p) =>
    [`${p.pobocka} — ${nazevDne(den)}`, ...vetyPobocky(p)].join('\n'),
  )
  return [
    ...casti,
    '',
    'Jména, příchody a částky po lidech jsou v aplikaci po přihlášení —',
    'do e-mailu nepatří.',
  ].join('\n\n')
}

/** HTML e-mailu. Bez obrázků a bez stylopisu ze sítě. */
export function htmlPrehledu(
  den: string,
  pobocky: PrehledPobocky[],
  odkaz: string,
): string {
  const casti = pobocky
    .map(
      (p) => `<h2 style="margin:24px 0 6px;font-size:16px">${bezpecne(
        p.pobocka,
      )} — ${bezpecne(nazevDne(den))}</h2>
<p style="margin:0;font-size:15px;line-height:1.55">${vetyPobocky(p)
        .map(bezpecne)
        .join('<br>')}</p>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="cs"><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917">
${casti}
<p style="margin:24px 0 0"><a href="${bezpecne(odkaz)}" style="display:inline-block;padding:10px 18px;background:#8a6a3b;color:#fff;border-radius:10px;text-decoration:none">Podrobnosti v aplikaci</a></p>
<p style="margin:16px 0 0;font-size:12.5px;color:#57534e">Jména, příchody a částky
po lidech jsou v aplikaci po přihlášení — do e-mailu nepatří.</p>
</body></html>`
}

/**
 * Název pobočky píše zákazník, takže do HTML nesmí jít, jak přišel.
 * Pobočka „Bar &lt;U Karla&gt;“ by jinak rozbila značky.
 */
function bezpecne(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Předmět. Jedna pobočka jménem, víc jich počtem. */
export function predmetPrehledu(den: string, pobocky: PrehledPobocky[]): string {
  if (pobocky.length === 1) {
    return `Foodtab — ${pobocky[0].pobocka}, ${nazevDne(den)}`
  }
  return `Foodtab — ${nazevDne(den)}, ${pocet(
    pobocky.length,
    'pobočka',
    'pobočky',
    'poboček',
  )}`
}

export { sklonovat }
