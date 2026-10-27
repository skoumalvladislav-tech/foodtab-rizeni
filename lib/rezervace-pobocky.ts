/**
 * Pobočky v kalendáři rezervací — zkratka, barva a souhrn za období.
 *
 * Zadání Šéfíka 27. 10. 2026: v kalendáři za celou firmu má mít každá
 * pobočka vlastní rámeček a barvu, u každé souhrn rezervací a hostů za
 * zobrazené období a v měsíci u každé rezervace zkratku restaurace.
 *
 * Čistý modul (importy s `.ts`, žádné IO) — testuje ho
 * scripts/rezervace-pobocky.test.mjs.
 *
 * ---------------------------------------------------------------------
 * ZKRATKA SE NEUKLÁDÁ, POČÍTÁ SE Z NÁZVU
 *
 * Je to `zkratkyPobocek` z Rozpisu směn: první písmeno každého slova
 * názvu i s diakritikou („Restaurace Černá Perla“ → „RČP“), a když se
 * dvě potkají, prodlužují se. Rozpis ji tak ukazuje od 20. 9. 2026, takže
 * táž pobočka má v obou modulech tutéž zkratku a nová pobočka (i u jiného
 * zákazníka) ji má hned po založení, bez nastavování.
 *
 * Počítá se ze VŠECH poboček, které člověk vidí, ne jen z rozsahu stránky
 * — jinak by se na pobočkovém kalendáři zkracovala jinak než na firemním.
 *
 * ---------------------------------------------------------------------
 * BARVA: Z NASTAVENÍ, KDYŽ SE NEPOPLETE
 *
 * Klíč z Nastavení → Pobočky (`branches.color`) se v kalendáři použije,
 * jen když je v BARVY_KALENDARE a nepotká se s barvou jiné pobočky.
 * Ostatní pobočky dostanou první volnou z BARVY_KALENDARE.
 *
 * Proč ne vždycky barva z nastavení: obě pobočky mají dnes tutéž
 * (Růžovou, docs/prechod-mezi-pobockami-zadani.md) a růžová je skoro
 * stejná jako „Zrušená“ a vínová Akce. Jantarová se plete s „Předběžnou“,
 * smaragdová a modrozelená s „Potvrzenou“, břidlicová je šedá jako
 * „Proběhla“. Kalendář je jediné místo, kde barva pobočky stojí přímo
 * vedle barev stavů — proto si tady bere jen ty, které se nepletou.
 *
 * Barva nikdy sama: u každé rezervace je i napsaná zkratka a v legendě
 * celý název. Od třetí pobočky se barvy opakují — dvě bezpečné, navzájem
 * rozlišitelné jsou jen dvě (viz NEROZLISITELNE) — a pobočku pozná
 * člověk podle zkratky.
 */

import { pridatDny, posunoutMesic, dnyTydne, hosteText, souhrnDne, type Pohled, type RezervaceVKalendari, type SouhrnDne } from './rezervace-kalendar.ts'
import { zkratkyPobocek } from './rozpis-desktop.ts'
import { pocet } from './sklonovani.ts'

/**
 * Klíče palety poboček (app/_tokeny.css), které se v kalendáři smějí
 * použít, v pořadí, v jakém se rozdávají. Každý z nich je od barev stavů
 * rezervace (dobre, pozor, bad, vino) aspoň ΔE2000 15 ve světlém a 14
 * v tmavém režimu a není šedý — měří to scripts/rezervace-pobocky.test.mjs
 * přímo z _tokeny.css a spadne, když se odstíny změní.
 */
export const BARVY_KALENDARE = ['sky', 'violet', 'indigo'] as const

export type BarvaKalendare = (typeof BARVY_KALENDARE)[number]

/** Dvojice z BARVY_KALENDARE, které od sebe oko nepozná (ΔE2000 pod hranicí — měří test). */
export const NEROZLISITELNE: readonly (readonly [BarvaKalendare, BarvaKalendare])[] = [['violet', 'indigo']]

export function jeBarvaKalendare(x: unknown): x is BarvaKalendare {
  return typeof x === 'string' && (BARVY_KALENDARE as readonly string[]).includes(x)
}

export function rozlisitelne(a: BarvaKalendare, b: BarvaKalendare): boolean {
  if (a === b) return false
  return !NEROZLISITELNE.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

/**
 * Barva každé pobočky v kalendáři. `pobocky` v pořadí, v jakém je vrací
 * kontext (podle názvu) — na tom pořadí závisí, kdo dostane kterou volnou.
 *
 * Dvě kola: nejdřív pobočky, jejichž barva z nastavení se do kalendáře
 * hodí (aby ji nesebrala pobočka, která svou použít nemůže a jen by si
 * vzala první volnou), pak ostatní.
 */
export function barvyPobocek(pobocky: readonly { id: string; color?: string | null }[]): Map<string, BarvaKalendare> {
  const vysledek = new Map<string, BarvaKalendare>()
  const pridelene: BarvaKalendare[] = []
  const lzePridat = (b: BarvaKalendare) => pridelene.every((x) => rozlisitelne(x, b))
  const pridelit = (id: string, b: BarvaKalendare) => {
    vysledek.set(id, b)
    pridelene.push(b)
  }

  for (const p of pobocky) {
    if (jeBarvaKalendare(p.color) && lzePridat(p.color)) pridelit(p.id, p.color)
  }
  for (const p of pobocky) {
    if (vysledek.has(p.id)) continue
    pridelit(
      p.id,
      BARVY_KALENDARE.find(lzePridat) ??
        BARVY_KALENDARE.find((b) => !pridelene.includes(b)) ??
        BARVY_KALENDARE[pridelene.length % BARVY_KALENDARE.length],
    )
  }
  return vysledek
}

export type VzhledPobocky = { zkratka: string; barva: BarvaKalendare }

/** Co o pobočce potřebuje štítek, legenda a okénko hostů: zkratku a barvu spočítal přístup Rezervací. */
export type PobockaKalendare = { id: string; nazev: string } & VzhledPobocky

/** Zkratka a barva každé pobočky. `pobocky` = všechny, které člověk vidí (`ctx.branches`). */
export function vzhledPobocek(pobocky: readonly { id: string; name: string; color?: string | null }[]): Map<string, VzhledPobocky> {
  const zkratky = zkratkyPobocek(pobocky.map((p) => p.name))
  const barvy = barvyPobocek(pobocky)
  return new Map(pobocky.map((p) => [p.id, { zkratka: zkratky.get(p.name) ?? p.name, barva: barvy.get(p.id) ?? BARVY_KALENDARE[0] }]))
}

/* ---------- souhrn za období --------------------------------------------- */

/**
 * Dny, za které se počítá souhrn poboček: týden pondělí–neděle, měsíc
 * jen jeho vlastní dny (ne sousední, které mřížka ukazuje do celých
 * týdnů), den sám.
 */
export function obdobiPohledu(pohled: Pohled, iso: string): { od: string; do: string } {
  if (pohled === 'den') return { od: iso, do: iso }
  if (pohled === 'tyden') {
    const dny = dnyTydne(iso)
    return { od: dny[0], do: dny[6] }
  }
  return { od: `${iso.slice(0, 7)}-01`, do: pridatDny(posunoutMesic(iso, 1), -1) }
}

/**
 * Souhrn každé pobočky za období. Pobočka bez rezervací má nuly — v legendě
 * má být vidět i ta, kde zatím nic není (Perla se teprve připojuje).
 */
export function souhrnyPobocek<T extends RezervaceVKalendari & { branch_id: string }>(
  rezervace: readonly T[],
  pobocky: readonly string[],
  obdobi: { od: string; do: string },
): Map<string, SouhrnDne> {
  return new Map(
    pobocky.map((id) => [id, souhrnDne(rezervace.filter((r) => r.branch_id === id && r.den >= obdobi.od && r.den <= obdobi.do))]),
  )
}

/** „12 rezervací · 2 akce · 87 hostů“; bez zrušených a nedorazivších. */
export function souhrnText(s: SouhrnDne): string {
  if (s.rezervaci + s.akci === 0) return 'Nic zapsaného'
  return [
    pocet(s.rezervaci, 'rezervace', 'rezervace', 'rezervací'),
    s.akci ? pocet(s.akci, 'akce', 'akce', 'akcí') : null,
    hosteText(s),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Rezervace rozdělené po pobočkách v jejich pořadí. Pobočky bez
 * rezervací se vynechají — v buňce dne by jen zabíraly místo.
 */
export function poPobockach<T extends { branch_id: string }>(rezervace: readonly T[], poradi: readonly string[]): { id: string; rezervace: T[] }[] {
  return poradi.map((id) => ({ id, rezervace: rezervace.filter((r) => r.branch_id === id) })).filter((s) => s.rezervace.length > 0)
}

/* ---------- hosté v Rozpisu směn ---------------------------------------- */

/**
 * Hosté z rezervací pro Rozpis směn (Šéfík 27. 10. 2026: „když najedu myší
 * na konkrétní den, aby se ukazoval počet hostů na jednotlivých pobočkách
 * — podle toho budu vědět, kolik dát zaměstnanců“).
 *
 * `null` místo celého objektu = člověk rezervace nevidí (nemá právo nebo
 * rozsah) a okénko se mu nekreslí vůbec. `chyba` = rezervace se načíst
 * nepovedlo: okénko to řekne, NEUKÁŽE NULY — prázdný den by vypadal jako
 * „nikdo nepřijde“ a vedoucí by naplánoval málo lidí.
 */
export type HosteDnu = {
  /** Pobočky rozsahu, na kterých člověk rezervace vidí, v pořadí kontextu. */
  pobocky: PobockaKalendare[]
  /** Provozní den → pobočka → souhrn. Den nebo pobočka, která chybí, nemá nic. */
  dny: Record<string, Record<string, SouhrnDne>>
  chyba: boolean
}

/**
 * Souhrn po provozních dnech a pobočkách. Den je `rezervace.den` — PROVOZNÍ
 * den, který počítá databáze z pásma a začátku dne pobočky (rezervace
 * v 1:30 patří k večeru předtím), stejně jako `shifts.shift_date`.
 * Zrušené a nedorazivší se do hostů nepočítají (souhrnDne).
 */
type RadekHostu = Pick<RezervaceVKalendari, 'den' | 'druh' | 'stav' | 'pocet_osob'> & { branch_id: string }

export function souhrnyPoDnech(rezervace: readonly RadekHostu[]): HosteDnu['dny'] {
  const skupiny = new Map<string, RadekHostu[]>()
  for (const r of rezervace) {
    const klic = `${r.den}|${r.branch_id}`
    const seznam = skupiny.get(klic)
    if (seznam) seznam.push(r)
    else skupiny.set(klic, [r])
  }
  const dny: HosteDnu['dny'] = {}
  for (const [klic, seznam] of skupiny) {
    const [den, pobocka] = klic.split('|')
    dny[den] = { ...dny[den], [pobocka]: souhrnDne(seznam) }
  }
  return dny
}

/**
 * Jen vybrané pobočky (filtr „Zobrazit“ v Rozpisu). Prázdný výběr = všechny.
 * Když ve výběru nezbude žádná pobočka s právem na rezervace, okénko nemá
 * co ukázat → `null`.
 */
export function hostePobocek(hoste: HosteDnu | null, vybrane: readonly string[]): HosteDnu | null {
  if (!hoste || vybrane.length === 0) return hoste && hoste.pobocky.length > 0 ? hoste : null
  const pobocky = hoste.pobocky.filter((p) => vybrane.includes(p.id))
  return pobocky.length > 0 ? { ...hoste, pobocky } : null
}

/** Součet poboček za den (do spouštěče okénka a řádku „Celkem“). */
export function celkemDne(hoste: Pick<HosteDnu, 'pobocky' | 'dny'>, den: string): SouhrnDne {
  const prazdny = souhrnDne([])
  return hoste.pobocky.reduce((s, p) => {
    const x = hoste.dny[den]?.[p.id]
    if (!x) return s
    return {
      rezervaci: s.rezervaci + x.rezervaci,
      akci: s.akci + x.akci,
      hostu: s.hostu + x.hostu,
      bezPoctu: s.bezPoctu + x.bezPoctu,
      zrusenych: s.zrusenych + x.zrusenych,
    }
  }, prazdny)
}
