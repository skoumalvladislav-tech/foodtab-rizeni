/**
 * Kam vede holá adresa rozsahu — `/<rozsah>` bez obrazovky.
 *
 * Do 25. 9. 2026 tam stál Rozcestník: mřížka dlaždic „Kam dál" se vším,
 * na co člověk dosáhne. Šéfík 24. 9.: „odstraň kartu rozcestník — je
 * zbytečná". Domovská obrazovka je od 16. 9. pro každého Dnes
 * (`app/page.tsx`) a menu se vším ostatním je na telefonu pod „Více"
 * ve spodní liště (`components/shell/MobileVice.tsx`).
 *
 * Adresa ale nemizí. Je v záložkách a v historii prohlížeče, vede na ni
 * logo v horní liště a přepnutí rozsahu z obrazovky, která v nabídce
 * nemá položku (upozornění, rozhovory). Proto přesměrování, ne 404 —
 * a tahle funkce říká kam.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ PROSTĚ „/dnes"
 *
 * V praxi to „/dnes" vyjde vždycky: Dnes je v Provozu, který firma má
 * napořád, a žádné právo nechce. Kdyby ale Dnes jednou z nabídky
 * zmizela nebo dostala právo, holá adresa by vedla na obrazovku, kam
 * člověka nepustí — a to je přesně to, co tu dřív řešil rozcestník
 * („Zatím tu pro vás nic není"). Proto: Dnes, když ji člověk má,
 * jinak první hotová obrazovka, kterou smí.
 *
 * Na firemní úrovni se přeskakují obrazovky vázané na pobočku
 * (`jenPobocka`, dnes Docházka) — ze stejného důvodu, z jakého je
 * přeskakuje přepnutí rozsahu v AppShell.cilRozsahu.
 *
 * Čistá funkce bez importů schválně: volá ji serverová stránka
 * (`app/[rozsah]/page.tsx`) i klientský rám (logo, přepnutí rozsahu)
 * a zkouší ji `scripts/nabidka.test.mjs` bez sestavení aplikace.
 */

/** Segment domovské obrazovky. Šéfíkovo rozhodnutí z 16. 9. 2026. */
export const DOMOVSKA_OBRAZOVKA = 'dnes'

/** Tolik z položky nabídky, kolik je k rozhodnutí potřeba. */
export type ObrazovkaNabidky = {
  segment: string
  hotovo: boolean
  jenPobocka?: boolean
  /** Obrazovka jen pro celou firmu (Kontakty, Integrace, Faktury) — na pobočce výchozí být nemůže. */
  jenFirma?: boolean
  /** Osobní obrazovka mimo rozsah (Moje údaje) — výchozí být nemůže. */
  adresa?: string
}

/**
 * Segment obrazovky, na kterou vede `/<rozsah>`, nebo `null`, když
 * člověk nemá jedinou hotovou obrazovku, na kterou by v tomhle rozsahu
 * dosáhl.
 *
 * `polozky` jsou už vyfiltrované podle práv a zapnutých modulů
 * (`viditelnaNabidka`) — tady se o přístupu nerozhoduje, jen vybírá.
 */
export function vychoziObrazovka(
  polozky: readonly ObrazovkaNabidky[],
  naFirme: boolean,
): string | null {
  const kandidati = polozky.filter(
    (p) => p.hotovo && !p.adresa && !(naFirme && p.jenPobocka) && !(!naFirme && p.jenFirma),
  )
  const domovska = kandidati.find((p) => p.segment === DOMOVSKA_OBRAZOVKA)
  return (domovska ?? kandidati[0])?.segment ?? null
}

/** Položka s adresou — kolik je potřeba k poznání, kde člověk je. */
export type PolozkaNaCeste = {
  segment: string
  dalsiSegmenty?: string[]
}

/**
 * Položka nabídky, na jejíž obrazovce člověk je (`segment` = cesta za
 * `/<rozsah>/`). Vyhrává NEJDELŠÍ shoda: na `finance/cashflow` je to
 * Cashflow, ne Přehled (`finance`), i když Přehled stojí v nabídce dřív.
 * Do 13. 10. 2026 vyhrávala první shoda a přepnutí rozsahu z kterékoli
 * podstránky Financí končilo na Přehledu.
 */
export function polozkaNaCeste<T extends PolozkaNaCeste>(segment: string | null, polozky: readonly T[]): T | undefined {
  if (segment === null) return undefined
  const delka = (s: string) => (segment === s || segment.startsWith(s + '/') ? s.length : -1)
  let nejlepsi: T | undefined
  let nejdelsi = -1
  for (const p of polozky) {
    const d = Math.max(delka(p.segment), ...(p.dalsiSegmenty ?? []).map(delka))
    if (d > nejdelsi) {
      nejlepsi = p
      nejdelsi = d
    }
  }
  return nejdelsi >= 0 ? nejlepsi : undefined
}

/**
 * Kam vede přepnutí rozsahu z obrazovky `zde` na rozsah `novy`.
 *
 * Drží se stejná obrazovka (podadresa se zahazuje — identifikátor patří
 * jiné pobočce). Obrazovka vázaná na pobočku (`jenPobocka`) se na firmě
 * a obrazovka jen pro firmu (`jenFirma`) na pobočce nahradí první
 * hotovou obrazovkou téhož modulu, ať se nepřistane na hlášce.
 * Obrazovka bez položky v nabídce vede na výchozí obrazovku rozsahu.
 */
export function cilPrepnutiRozsahu(
  zde: (ObrazovkaNabidky & { modul?: string }) | undefined,
  novy: string,
  segmentFirmy: string,
  polozky: readonly (ObrazovkaNabidky & { modul?: string })[],
): string {
  const naFirmu = novy === segmentFirmy
  if (!zde) {
    const vychoziTam = vychoziObrazovka(polozky, naFirmu)
    return vychoziTam ? `/${novy}/${vychoziTam}` : `/${novy}`
  }
  if ((naFirmu && zde.jenPobocka) || (!naFirmu && zde.jenFirma)) {
    const nahrada = polozky.find(
      (p) => p.modul === zde.modul && p.hotovo && !p.adresa && !(naFirmu ? p.jenPobocka : p.jenFirma),
    )
    return nahrada ? `/${novy}/${nahrada.segment}` : `/${novy}`
  }
  return `/${novy}/${zde.segment}`
}
