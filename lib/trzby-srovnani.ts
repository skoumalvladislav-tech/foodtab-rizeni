/**
 * Graf srovnání tržeb (Finance → Tržby) — čistá logika, žádné IO.
 *
 * Šéfík 4. 11. 2026: „Ve financích potřebuju u tržeb udělat podobný graf
 * srovnání tržeb" (podle karty „Měsíční tržby" z administrace Dotykačky).
 *
 * Sloupce = zobrazené období, čára = srovnávací období, slot po slotu:
 *   * Po měsících (rok): měsíce 1–12 proti měsícům 1–12 předchozího roku.
 *     „Předchozí období" a „stejné období loni" je u roku totéž, takže
 *     přepínač se tam nekreslí.
 *   * Po dnech (měsíc): dny 1–31 proti dnům 1–31 předchozího měsíce
 *     („obdobi"), nebo téhož měsíce o rok dřív („rok"). Den 31 proti
 *     únoru srovnávací den nemá — slot ho prostě nemá, žádná nula.
 *   * Po rocích se nesrovnává (předchozích deset let nikdo nečte).
 *
 * Data jsou TÁŽ jako zbytek stránky: `pokladna_prehled_trzeb` přes
 * uživatelského klienta (lib/pokladna-trzby-nacteni.ts), na pobočce
 * zúžený `jenPobocka` dřív, než sem dojde. Tady se jen skládá.
 *
 * Nic se nevymýšlí:
 *   * slot bez prodejů je „bez dat" (`null`), ne 0 Kč — čára se v něm
 *     přeruší, sloupec chybí;
 *   * když srovnávací období nemá data vůbec nebo jen zčásti (pokladna
 *     napojená později), řekne to `pokryti` a graf to napíše nahlas;
 *   * rozběhnutý měsíc/den je `bezi`: graf ho kreslí jinak a rozdíl
 *     v procentech u něj neukazuje (půlka měsíce proti celému by vždycky
 *     „padala", viz lib/finance-obdobi.ts);
 *   * za celou firmu se hlídá i sada provozoven: když v témž slotu mají
 *     data jiné provozovny než ve srovnání (Bernard Bar připojený až od
 *     28. 2.), je to `jinePobocky` — jinak by graf ukázal falešný růst;
 *   * a počet prodejních dní: měsíc, kdy byla pokladna napojená až v půlce
 *     (12 dní proti 31), by dal stejně falešný rozdíl — to je `maloDni`.
 *
 * Testy: scripts/trzby-srovnani.test.mjs.
 */

import { obdobiVRozsahu, popisObdobi, type PrehledTrzeb } from './pokladna-trzby.ts'

export type CleneniGrafu = 'den' | 'mesic'
export type DruhSrovnani = 'obdobi' | 'rok'

export function jeDruhSrovnani(v: unknown): v is DruhSrovnani {
  return v === 'obdobi' || v === 'rok'
}

export type Rozsah = { od: string; doData: string }

const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
const MESICE_KRATCE = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

function dva(n: number): string {
  return String(n).padStart(2, '0')
}
function posledniDen(rok: number, mesic: number): number {
  return new Date(Date.UTC(rok, mesic, 0)).getUTCDate()
}
const ZACATEK_MESICE = /^(\d{4})-(0[1-9]|1[0-2])-01$/
const ZACATEK_ROKU = /^(\d{4})-01-01$/

function rokMesic(od: string, cleneni: CleneniGrafu): [number, number] {
  const shoda = cleneni === 'mesic' ? ZACATEK_ROKU.exec(od) : ZACATEK_MESICE.exec(od)
  if (!shoda) throw new Error(`Graf srovnání: „${od}" není začátek ${cleneni === 'mesic' ? 'roku' : 'měsíce'}.`)
  return [Number(shoda[1]), cleneni === 'mesic' ? 1 : Number(shoda[2])]
}

/** CELÉ zobrazené období (ne jen do dneška): rok → 1. 1.–31. 12., měsíc → 1.–poslední den. */
export function celeObdobi(cleneni: CleneniGrafu, od: string): Rozsah {
  const [r, m] = rokMesic(od, cleneni)
  if (cleneni === 'mesic') return { od, doData: `${r}-12-31` }
  return { od, doData: `${r}-${dva(m)}-${dva(posledniDen(r, m))}` }
}

/**
 * Srovnávací období k zobrazenému (`od` = jeho první den), vždy celé:
 * rok → předchozí rok (u roku je „předchozí období" = „loni");
 * měsíc → předchozí měsíc (`obdobi`), nebo týž měsíc loni (`rok`).
 */
export function srovnavaciObdobi(cleneni: CleneniGrafu, od: string, druh: DruhSrovnani): Rozsah {
  const [r, m] = rokMesic(od, cleneni)
  if (cleneni === 'mesic') return { od: `${r - 1}-01-01`, doData: `${r - 1}-12-31` }
  const [rs, ms] = druh === 'rok' ? [r - 1, m] : m === 1 ? [r - 1, 12] : [r, m - 1]
  return { od: `${rs}-${dva(ms)}-01`, doData: `${rs}-${dva(ms)}-${dva(posledniDen(rs, ms))}` }
}

/** „září 2026" / „2025" — název srovnávacího (i zobrazeného) období do vět a legendy. */
export function nazevObdobi(cleneni: CleneniGrafu, od: string): string {
  const [r, m] = rokMesic(od, cleneni)
  return cleneni === 'mesic' ? String(r) : `${MESICE[m - 1]} ${r}`
}

function popisDne(iso: string, sRokem = false): string {
  const d = Number(iso.slice(8, 10))
  const m = Number(iso.slice(5, 7))
  return sRokem ? `${d}. ${m}. ${iso.slice(0, 4)}` : `${d}. ${m}.`
}

/** „1. 9. – 30. 9. 2026" — podnadpis grafu („porovnání vůči …"). */
export function popisRozsahu(r: Rozsah): string {
  return `${popisDne(r.od, r.od.slice(0, 4) !== r.doData.slice(0, 4))} – ${popisDne(r.doData, true)}`
}

// ---------------------------------------------------------------------
// Sloty
// ---------------------------------------------------------------------

/** Tržba jednoho slotu jednoho období. `null` místo něj = pokladna nic neposlala. */
export type HodnotaSlotu = {
  haleru: number
  /**
   * Dní s prodeji JEDNÉ provozovny — nejvíc a nejméně přes provozovny
   * slotu (u dne 1, u měsíce kolik dní ho pokrývá). Dny dvou provozoven
   * se NESČÍTAJÍ: 31 + 31 není „62 dní".
   */
  dnu: number
  dnuNejmene: number
  /** Provozovny, které v tom slotu mají prodeje (seřazené). */
  pobocky: string[]
  /** Dní s prodeji po provozovnách (id → dní). */
  dnyPobocek: Readonly<Record<string, number>>
}

/**
 * Kolik prodejních dní musí mít kratší strana srovnání proti delší (u každé
 * provozovny), aby rozdíl v procentech ještě dával smysl. Pod tím je to
 * skoro jistě pokladna napojená v půlce měsíce (nebo dlouho zavřeno)
 * a rozdíl by lhal. Týden dovolené (24 z 31) ještě projde.
 * ROZHODNOUT: hranice 2/3 — viz docs/hlaseni/otazky.md, otázka 86.
 */
export const NEJMENE_DNI_PROTI = 2 / 3

export type StavSlotu = 'uzavrene' | 'bezi' | 'budouci'

export type SlotGrafu = {
  /** Začátek slotu zobrazeného období (ISO). */
  obdobi: string
  /** Začátek odpovídajícího slotu srovnání; `null` = srovnání ho nemá (31. den proti únoru). */
  obdobiSrovnani: string | null
  /** Popisek osy: „1"–„31" / „1"–„12". */
  osa: string
  /** Kratší popisek měsíce na širokou osu („led"…); u dnů totéž co `osa`. */
  osaSlovem: string
  /** „po 12. 10." / „Říjen 2026". */
  popis: string
  /** „so 12. 9." / „Říjen 2025"; `null` jako `obdobiSrovnani`. */
  popisSrovnani: string | null
  aktualni: HodnotaSlotu | null
  srovnani: HodnotaSlotu | null
  stav: StavSlotu
  /**
   * Obě období mají data, ale z jiných provozoven (jen za celou firmu).
   * Rozdíl by pak srovnával jablka s hruškami — graf to u slotu napíše.
   */
  jinePobocky: boolean
  /**
   * Uzavřený slot, stejné provozovny, ale jedna z nich má na jedné straně
   * výrazně méně prodejních dní (pod `NEJMENE_DNI_PROTI` druhé strany) —
   * ta nejhorší. Jinak `null`.
   */
  maloDni: { branchId: string; dnu: number; dnuSrovnani: number } | null
  /**
   * Rozdíl proti srovnání v procentech, jen když se dá říct poctivě:
   * uzavřený slot, obě období s daty, stejné provozovny se srovnatelným
   * počtem prodejních dní, srovnání > 0.
   */
  rozdilProcent: number | null
}

/**
 * Jak srovnávací období pokrývá své sloty:
 *   * `nenacteno` — dotaz selhal (graf to řekne, sloupce kreslí dál);
 *   * `bez_dat` — ani jeden slot nemá prodeje;
 *   * `castecne` — prodeje jen v úseku `od`–`do` (první a poslední slot
 *     s daty), před ním nebo za ním nic: typicky pokladna napojená až
 *     v půlce. Mezery UPROSTŘED úseku (zavřeno) se za neúplnost nepočítají;
 *   * `uplne` — data od prvního do posledního slotu.
 */
export type Pokryti =
  | { druh: 'nenacteno' }
  | { druh: 'bez_dat' }
  | { druh: 'castecne'; od: string; do: string }
  | { druh: 'uplne' }

export type GrafSrovnani = {
  cleneni: CleneniGrafu
  druh: DruhSrovnani
  sloty: SlotGrafu[]
  /** „říjen 2026" / „2026". */
  nazevAktualniho: string
  /** „září 2026" / „říjen 2025" / „2025". */
  nazevSrovnani: string
  rozsahSrovnani: Rozsah
  pokryti: Pokryti
  /** Popisy slotů s `jinePobocky` (pro větu pod grafem). */
  slotySJinymiPobockami: string[]
  /** Popisy slotů s `maloDni` (pro větu pod grafem). */
  slotySMaloDny: string[]
  /** Rozběhnutý slot s daty (sloupec je zatím jen část) — nebo `null`. */
  bezi: SlotGrafu | null
  /** Do kdy má rozběhnutý slot data (dnešní provozní den). */
  dnes: string
}

function hodnota(p: PrehledTrzeb, obdobi: string, branchId: string | null): HodnotaSlotu | null {
  let haleru = 0
  const dnyPobocek = new Map<string, number>()
  for (const t of p.trzby) {
    if (t.obdobi !== obdobi || (branchId !== null && t.branchId !== branchId) || t.dnu <= 0) continue
    haleru += t.trzbaHaleru
    dnyPobocek.set(t.branchId, (dnyPobocek.get(t.branchId) ?? 0) + t.dnu)
  }
  if (dnyPobocek.size === 0) return null
  const dny = [...dnyPobocek.values()]
  return {
    haleru,
    dnu: Math.max(...dny),
    dnuNejmene: Math.min(...dny),
    pobocky: [...dnyPobocek.keys()].sort(),
    dnyPobocek: Object.fromEntries(dnyPobocek),
  }
}

/** Provozovna, u které se počty prodejních dní liší nejvíc — pod hranicí, jinak `null`. */
function nejmeneDni(a: HodnotaSlotu, s: HodnotaSlotu): SlotGrafu['maloDni'] {
  let nejhorsi: SlotGrafu['maloDni'] = null
  let nejhorsiPomer = NEJMENE_DNI_PROTI
  for (const b of a.pobocky) {
    const da = a.dnyPobocek[b] ?? 0
    const ds = s.dnyPobocek[b] ?? 0
    const pomer = Math.min(da, ds) / Math.max(da, ds)
    if (pomer < nejhorsiPomer) {
      nejhorsiPomer = pomer
      nejhorsi = { branchId: b, dnu: da, dnuSrovnani: ds }
    }
  }
  return nejhorsi
}

function stejne(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function kratkyPopis(cleneni: CleneniGrafu, iso: string): string {
  return cleneni === 'mesic' ? `${MESICE[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : popisDne(iso, true)
}

/** „březen – prosinec 2025" / „15. 9. – 30. 9. 2026" — úsek s daty ve srovnání. */
export function popisUseku(cleneni: CleneniGrafu, od: string, doData: string): string {
  if (od === doData) return kratkyPopis(cleneni, od)
  if (cleneni === 'mesic') {
    const rok = od.slice(0, 4) === doData.slice(0, 4)
    return `${rok ? MESICE[Number(od.slice(5, 7)) - 1] : kratkyPopis(cleneni, od)} – ${kratkyPopis(cleneni, doData)}`
  }
  return `${popisDne(od, od.slice(0, 4) !== doData.slice(0, 4))} – ${popisDne(doData, true)}`
}

/**
 * Sestaví graf. `aktualni` a `srovnavaci` jsou přehledy za CELÁ období
 * (`celeObdobi`, `srovnavaciObdobi`) — stejný výstup `pokladna_prehled_trzeb`
 * jako zbytek stránky, na pobočce už zúžený (`jenPobocka`). `srovnavaci`
 * `null` = dotaz na srovnání selhal. `branchId` = vybraná provozovna za
 * celou firmu (přepínač), jinak `null`. `dnes` = PROVOZNÍ den.
 */
export function sestavitGraf(vstup: {
  cleneni: CleneniGrafu
  druh: DruhSrovnani
  od: string
  dnes: string
  aktualni: PrehledTrzeb
  srovnavaci: PrehledTrzeb | null
  branchId: string | null
}): GrafSrovnani {
  const { cleneni, od, dnes, aktualni, srovnavaci, branchId } = vstup
  // U roku je „předchozí období" = „loni" — jeden druh, ať odkazy nemají dvě adresy pro totéž.
  // ROZHODNOUT: po měsících bez přepínače, jen proti loňsku — otázka 85 v docs/hlaseni/otazky.md.
  const druh: DruhSrovnani = cleneni === 'mesic' ? 'obdobi' : vstup.druh
  const cele = celeObdobi(cleneni, od)
  const rozsahSrovnani = srovnavaciObdobi(cleneni, od, druh)
  const slotyAkt = obdobiVRozsahu(cele.od, cele.doData, cleneni)
  const slotySrov = obdobiVRozsahu(rozsahSrovnani.od, rozsahSrovnani.doData, cleneni)
  const bezici = cleneni === 'mesic' ? `${dnes.slice(0, 7)}-01` : dnes

  const sloty: SlotGrafu[] = slotyAkt.map((o, i) => {
    // Párování podle pořadí: 1. s 1., březen s březnem (ne den v týdnu s týmž dnem v týdnu).
    // ROZHODNOUT: po dnech podle čísla dne — otázka 84 v docs/hlaseni/otazky.md.
    const os = slotySrov[i] ?? null
    const a = hodnota(aktualni, o, branchId)
    const s = os !== null && srovnavaci !== null ? hodnota(srovnavaci, os, branchId) : null
    const stav: StavSlotu = o < bezici ? 'uzavrene' : o === bezici ? 'bezi' : 'budouci'
    const jinePobocky = a !== null && s !== null && !stejne(a.pobocky, s.pobocky)
    const maloDni = stav === 'uzavrene' && a !== null && s !== null && !jinePobocky ? nejmeneDni(a, s) : null
    const rozdilProcent =
      stav === 'uzavrene' && a !== null && s !== null && !jinePobocky && maloDni === null && s.haleru > 0
        ? ((a.haleru - s.haleru) / s.haleru) * 100
        : null
    const cislo = cleneni === 'mesic' ? Number(o.slice(5, 7)) : Number(o.slice(8, 10))
    return {
      obdobi: o,
      obdobiSrovnani: os,
      osa: String(cislo),
      osaSlovem: cleneni === 'mesic' ? MESICE_KRATCE[cislo - 1] : String(cislo),
      popis: popisObdobi(o, cleneni),
      popisSrovnani: os === null ? null : popisObdobi(os, cleneni),
      aktualni: a,
      srovnani: s,
      stav,
      jinePobocky,
      maloDni,
      rozdilProcent,
    }
  })

  let pokryti: Pokryti
  if (srovnavaci === null) pokryti = { druh: 'nenacteno' }
  else {
    const existujici = sloty.filter((s) => s.obdobiSrovnani !== null)
    const sDaty = existujici.filter((s) => s.srovnani !== null)
    if (sDaty.length === 0) pokryti = { druh: 'bez_dat' }
    else {
      const prvni = sDaty[0].obdobiSrovnani!
      const posledni = sDaty[sDaty.length - 1].obdobiSrovnani!
      pokryti =
        prvni === existujici[0].obdobiSrovnani && posledni === existujici[existujici.length - 1].obdobiSrovnani
          ? { druh: 'uplne' }
          : { druh: 'castecne', od: prvni, do: posledni }
    }
  }

  return {
    cleneni,
    druh,
    sloty,
    nazevAktualniho: nazevObdobi(cleneni, od),
    nazevSrovnani: nazevObdobi(cleneni, rozsahSrovnani.od),
    rozsahSrovnani,
    pokryti,
    slotySJinymiPobockami: sloty.filter((s) => s.jinePobocky).map((s) => s.popis),
    slotySMaloDny: sloty.filter((s) => s.maloDni !== null).map((s) => s.popis),
    bezi: sloty.find((s) => s.stav === 'bezi' && s.aktualni !== null) ?? null,
    dnes,
  }
}

// ---------------------------------------------------------------------
// Osa
// ---------------------------------------------------------------------

/**
 * Hladké dělení svislé osy od nuly: 4–6 dílků o „hezkém" kroku
 * (1, 2, 2,5, 5 × 10ⁿ Kč). Vstup i výstup v haléřích. Nulové maximum
 * (žádná data) → osa 0–1 000 Kč, ať se graf nezhroutí do čáry.
 */
export function dilkyOsy(maxHaleru: number): number[] {
  const maxKc = Math.max(0, maxHaleru) / 100
  if (maxKc <= 0) return [0, 25_000, 50_000, 75_000, 100_000]
  const hrubyKrok = maxKc / 4
  const rad = 10 ** Math.floor(Math.log10(hrubyKrok))
  const krokKc = [1, 2, 2.5, 5, 10].map((k) => k * rad).find((k) => maxKc / k <= 5) ?? 10 * rad
  const pocet = Math.max(1, Math.ceil(maxKc / krokKc - 1e-9))
  return Array.from({ length: pocet + 1 }, (_, i) => Math.round(i * krokKc * 100))
}

/**
 * Popisky dílků osy (jednotku Kč nese titulek osy). Jeden styl na osu:
 * sahá-li osa na 10 000 Kč, jsou všechny zkrácené („5 tis.", „200 tis.",
 * „1,25 mil."), jinak všechny celé („2 500"). Mezery pevné.
 */
export function popiskyOsy(dilky: readonly number[]): string[] {
  const zkracene = Math.max(0, ...dilky) >= 1_000_000 // haléřů = 10 000 Kč
  const pevna = (s: string) => s.replace(/\s/g, ' ')
  return dilky.map((haleru) => {
    const kc = Math.round(haleru / 100)
    if (kc === 0) return '0'
    if (!zkracene) return pevna(kc.toLocaleString('cs-CZ'))
    if (Math.abs(kc) >= 1_000_000) return pevna(`${(kc / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} mil.`)
    return pevna(`${(kc / 1_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} tis.`)
  })
}

/** „+12,4 %" / „−3,0 %" / „0,0 %" — pravé minus, ať se znaménko nepřehlédne. */
export function popisRozdilu(procent: number): string {
  const zaokrouhleno = Math.round(procent * 10) / 10
  const text = Math.abs(zaokrouhleno).toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${zaokrouhleno > 0 ? '+' : zaokrouhleno < 0 ? '−' : ''}${text} %`
}
