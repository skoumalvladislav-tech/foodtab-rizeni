/**
 * Párování bankovních/pokladních transakcí s fakturami.
 *
 * Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5): VS přesná
 * shoda (+0.5), částka (+0.3), protistrana fuzzy (+0.2), blízkost data
 * (+0.1). Jistota ≥ `PRAH_NAVRHU` se NABÍDNE, nikdy se nepotvrdí sama —
 * potvrzení je vždy lidský klik (`platby_faktury.stav`).
 *
 * Čistá logika, žádné IO — proto bez `import 'server-only'`, testovatelná
 * přímo Nodem (scripts/finance-parovani.test.mjs). Volající (server akce
 * v app/[rozsah]/finance/platby/) si data z obou databází (hlavní +
 * Faktury) natáhne sama a sem předá jen tenhle tvar.
 */

export type KandidatTransakce = {
  id: string
  vs: string
  castkaHaleru: number
  protistrana: string
  datum: string
}

export type KandidatFaktura = {
  id: string
  vs: string | null
  castkaHaleru: number
  dodavatel: string | null
  datum: string | null
}

export type Navrh = {
  transakceId: string
  fakturaId: string
  jistota: number
}

/** Jistota ≥ tohle se nabídne jako návrh — ale nikdy se nepotvrdí sama. */
export const PRAH_NAVRHU = 0.9

/** Bez diakritiky, malá písmena, bez okrajových mezer — na porovnání textu, ne na zobrazení. */
function normalizovat(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Přesná shoda VS po trimu nuly vlevo nejsou — „123" a „0123" se neshodují, banky je nedoplňují samy. */
function shodaVs(a: string, b: string | null): boolean {
  if (!b) return false
  const ta = a.trim()
  const tb = b.trim()
  return ta.length > 0 && ta === tb
}

/** Podíl slov protistrany, která se objeví i v názvu dodavatele (a naopak) — nejhorší ze dvou směrů vyhrává přísnost. */
function podobnostProtistrany(a: string, b: string | null): number {
  if (!b) return 0
  const na = normalizovat(a)
  const nb = normalizovat(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.8

  const slovaA = new Set(na.split(' ').filter((s) => s.length > 2))
  const slovaB = new Set(nb.split(' ').filter((s) => s.length > 2))
  if (slovaA.size === 0 || slovaB.size === 0) return 0

  let shoda = 0
  for (const s of slovaA) if (slovaB.has(s)) shoda++
  return shoda / Math.max(slovaA.size, slovaB.size)
}

/** Dny mezi dvěma kalendářními daty (`'YYYY-MM-DD'`), bez posunu pásmem. */
function rozdilDni(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000
}

/** Plná váha do 3 dnů, lineárně klesá k nule po 30 dnech. */
function blizkostData(a: string, b: string | null): number {
  if (!b) return 0
  const d = rozdilDni(a, b)
  if (d <= 3) return 1
  if (d >= 30) return 0
  return 1 - (d - 3) / 27
}

/** Jistota shody jedné transakce s jednou fakturou, 0 až 1. */
export function jistotaShody(transakce: KandidatTransakce, faktura: KandidatFaktura): number {
  let jistota = 0
  if (shodaVs(transakce.vs, faktura.vs)) jistota += 0.5
  if (transakce.castkaHaleru === faktura.castkaHaleru) jistota += 0.3
  jistota += 0.2 * podobnostProtistrany(transakce.protistrana, faktura.dodavatel)
  jistota += 0.1 * blizkostData(transakce.datum, faktura.datum)
  return Math.min(1, Math.round(jistota * 1000) / 1000)
}

/**
 * Nejlepší návrh pro jednu transakci napříč fakturami — jen pod prahem
 * se nic nevrátí, ať se slabá shoda nenabízí jako by byla jistá.
 */
export function navrhnoutParovani(
  transakce: KandidatTransakce,
  faktury: readonly KandidatFaktura[],
): Navrh | null {
  let nejlepsi: Navrh | null = null
  for (const f of faktury) {
    const jistota = jistotaShody(transakce, f)
    if (jistota < PRAH_NAVRHU) continue
    if (!nejlepsi || jistota > nejlepsi.jistota) {
      nejlepsi = { transakceId: transakce.id, fakturaId: f.id, jistota }
    }
  }
  return nejlepsi
}

/* ---------------------------------------------------------------------
 * Automatické párování (Šéfík 8. 10. 2026: „faktury se mají automaticky
 * přesunout do uhrazených ve chvíli spárování s platbou z výpisu").
 *
 * Sama se potvrdí jen JEDNOZNAČNÁ shoda — vše ostatní zůstává návrhem
 * k ručnímu potvrzení (`navrhnoutParovani` výš). Jednoznačná znamená
 * všechno najednou (pravidla zpřísněná po dvou kolech kontroly kódu):
 *   - platba přišla Z BANKY přes API (Fio, agregátor) — ty zapisuje jen
 *     synchronizace (pojistka v databázi). Výpis CSV jen z dávky, kterou
 *     nahrál člověk s právem spravovat Faktury (volající ji předá);
 *     ruční zápis ani pokladna nikdy;
 *   - stejný variabilní symbol (přesně) A přesně stejná částka, obojí
 *     v Kč (párování se vede v haléřích); jméno protistrany musí sedět
 *     s dodavatelem (většina významných slov, bez „s.r.o.", „a.s.");
 *   - JEDNOZNAČNOST nad VŠEMI fakturami (i uhrazenými, archivovanými,
 *     odmítnutými) a všemi výdaji za 180 dní: VS se porovná bez mezer
 *     a úvodních nul („0012345" = „12345") a za soupeře se bere i faktura
 *     s nepřečtenou částkou. Opakovaná platba (nájem, leasing) se proto
 *     sama nespáruje nikdy — jinak by minulá platba „zaplatila" příští;
 *   - nevrátila se: příjem se stejnou částkou a stejným VS (nebo bez VS od
 *     stejné protistrany) do 30 dní po platbě = banka platbu vrátila.
 *     Když vrácení přijde až PO spárování, automatika párování sama
 *     nezruší — Platby ho ukážou k ruční kontrole (zrušit by mohla i
 *     nesouvisející párování a stav ve Fakturách se nedá vrátit spolehlivě);
 *   - platba i faktura jsou zatím bez párování a člověk tuhle dvojici
 *     nikdy nezrušil;
 *   - faktura je schválená k úhradě („Ke kontrole úhrady", „Neuhrazeno"),
 *     není duplicita ani archivovaná a má datum;
 *   - platba je nejvýš 30 dní před a 90 dní po datu faktury.
 * ------------------------------------------------------------------ */

export type AutoTransakce = KandidatTransakce & {
  alokovanoHaleru: number
  zdroj: string
  mena: string
  smer: 'vydaj' | 'prijem'
  davkaId: string | null
}
export type AutoFaktura = KandidatFaktura & {
  stav: string | null
  alokovanoHaleru: number
  duplicita: boolean
  archivovana: boolean
  mena: string | null
}

/** Stavy faktury, které se smí zaplatit samy (schválené k úhradě). */
export const STAVY_PRO_AUTOMATICKE_PAROVANI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno']

/** Platby z banky přes API — zapisuje je jen synchronizace (trigger hlida_zdroj_transakce). */
export const ZDROJE_Z_API: readonly string[] = ['fio_api', 'bankovni_agregator']

const NEJVIC_DNI_PRED_FAKTUROU = 30
const NEJVIC_DNI_PO_FAKTURE = 90
const DNI_NA_VRACENI = 30

export type AutomatickeParovani = { transakceId: string; fakturaId: string; castkaHaleru: number; castkaFakturyHaleru: number }

/**
 * VS pro posouzení jednoznačnosti: jen číslice, bez úvodních nul
 * („2026-001", „ 0002026001" i „2026001" → „2026001"). Bez číslic → null.
 */
export function normalizovatVs(vs: string | null | undefined): string | null {
  const cislice = String(vs ?? '').replace(/\D+/g, '')
  const bezNul = cislice.replace(/^0+/, '')
  return bezNul === '' ? null : bezNul
}

function mena(m: string | null | undefined): string {
  return (m ?? '').trim().toUpperCase() || 'CZK'
}

/** Kladně = `datum` PO `vychozi`. */
function dnyOd(datum: string, vychozi: string): number {
  const [ay, am, ad] = datum.split('-').map(Number)
  const [by, bm, bd] = vychozi.split('-').map(Number)
  return (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000
}

/** Slova, která o firmě nic neříkají (právní forma, země). */
const OBECNA_SLOVA = new Set([
  'sro', 'spol', 'ro', 'as', 'akc', 'spolecnost', 'vos', 'ks', 'se', 'zs', 'ops', 'zu',
  'ltd', 'gmbh', 'inc', 'ag', 'sa', 'bv', 'kg', 'llc', 'plc', 'co', 'and',
  'cz', 'cr', 'czech', 'republic', 'republika', 'ceska', 'cesko', 'praha', 'brno',
])

function vyznamnaSlova(text: string): Set<string> {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    // s.r.o. / a.s. / spol. s r.o. → sro / as / spol sro
    .replace(/\bs\.?\s*r\.?\s*o\.?/g, ' sro ').replace(/\ba\.?\s*s\.(?=\s|$|,)/g, ' as ')
    .replace(/[^a-z0-9]+/g, ' ')
  return new Set(t.split(' ').filter((s) => s.length >= 3 && !OBECNA_SLOVA.has(s)))
}

/**
 * Jde o tutéž firmu? Většina významných slov musí být společná (víc než
 * polovina z delšího jména): jedno společné slovo („gastro", křestní
 * jméno) nestačí. Zkrácené jméno z banky („MAKRO CASH") projde, dvě
 * různé firmy z jednoho oboru („Gastro Plus" / „Gastro Servis") ne.
 */
export function protistranaSedi(protistrana: string, dodavatel: string | null): boolean {
  const a = vyznamnaSlova(protistrana)
  const b = vyznamnaSlova(dodavatel ?? '')
  if (a.size === 0 || b.size === 0) return false
  let spolecna = 0
  for (const s of a) if (b.has(s)) spolecna++
  return spolecna / Math.max(a.size, b.size) > 0.5
}

/**
 * Vrátila banka tuhle platbu? Příjem nejvýš 30 dní po ní, částka stejná
 * nebo menší nejvýš o 3 % (strhnutý poplatek), se stejným VS — nebo bez
 * VS od stejné protistrany. Příjem s JINÝM VS je vrácení jiné platby.
 */
export function jeVracena(platba: Pick<AutoTransakce, 'vs' | 'castkaHaleru' | 'datum' | 'protistrana'>, prijmy: readonly Pick<AutoTransakce, 'vs' | 'castkaHaleru' | 'datum' | 'protistrana'>[]): boolean {
  const v = normalizovatVs(platba.vs)
  return prijmy.some((p) => {
    if (p.castkaHaleru > platba.castkaHaleru || p.castkaHaleru < Math.floor(platba.castkaHaleru * 0.97)) return false
    const po = dnyOd(p.datum, platba.datum)
    if (!Number.isFinite(po) || po < 0 || po > DNI_NA_VRACENI) return false
    const vsPrijmu = normalizovatVs(p.vs)
    if (vsPrijmu !== null) return vsPrijmu === v
    return p.protistrana.trim() !== '' && platba.protistrana.trim() !== '' && protistranaSedi(p.protistrana, platba.protistrana)
  })
}

/**
 * `transakce` = VŠECHNY pohyby (výdaje i příjmy) z posledních 180 dní,
 * `faktury` = VŠECHNY faktury (i uhrazené, archivované, odmítnuté, bez
 * částky) — jen tak jde poznat, že shoda není jednoznačná.
 * `zamitnute` = dvojice `transakceId|fakturaId`, které člověk zrušil;
 * `duveryhodneDavky` = dávky CSV výpisu, které nahrál člověk s právem
 * spravovat Faktury.
 */
export function vybratAutomatickaParovani(
  transakce: readonly AutoTransakce[],
  faktury: readonly AutoFaktura[],
  moznosti: { zamitnute?: ReadonlySet<string>; duveryhodneDavky?: ReadonlySet<string> } = {},
): AutomatickeParovani[] {
  const zamitnute = moznosti.zamitnute ?? new Set<string>()
  const duveryhodneDavky = moznosti.duveryhodneDavky ?? new Set<string>()

  const fakturyPodleVs = new Map<string, AutoFaktura[]>()
  const fakturyBezVs: AutoFaktura[] = []
  for (const f of faktury) {
    const v = normalizovatVs(f.vs)
    if (v) fakturyPodleVs.set(v, [...(fakturyPodleVs.get(v) ?? []), f])
    else fakturyBezVs.push(f)
  }
  const vydaje = transakce.filter((t) => t.smer === 'vydaj')
  const prijmy = transakce.filter((t) => t.smer === 'prijem')
  const vydajePodleKlice = new Map<string, number>()
  for (const t of vydaje) {
    const v = normalizovatVs(t.vs)
    if (v && t.castkaHaleru > 0) vydajePodleKlice.set(`${v}|${t.castkaHaleru}`, (vydajePodleKlice.get(`${v}|${t.castkaHaleru}`) ?? 0) + 1)
  }

  const vysledek: AutomatickeParovani[] = []
  for (const t of vydaje) {
    const v = normalizovatVs(t.vs)
    if (!v || t.castkaHaleru <= 0 || t.alokovanoHaleru !== 0) continue
    const zBanky = ZDROJE_Z_API.includes(t.zdroj) || (t.zdroj === 'csv_banka' && t.davkaId !== null && duveryhodneDavky.has(t.davkaId))
    if (!zBanky) continue
    if (vydajePodleKlice.get(`${v}|${t.castkaHaleru}`) !== 1) continue

    // Soupeři: stejný VS a stejná částka — nebo částka, kterou příjem nepřečetl.
    const souperi = (fakturyPodleVs.get(v) ?? []).filter((f) => f.castkaHaleru === t.castkaHaleru || !(f.castkaHaleru > 0))
    if (souperi.length !== 1) continue
    // …a faktura BEZ VS se stejnou částkou z téhož období (VS se nepřečetl
    // nebo ho člověk nevyplnil) — mohla to klidně být ona.
    const bezVsSoupei = fakturyBezVs.some((g) => g.castkaHaleru === t.castkaHaleru && !g.archivovana && g.stav !== 'Odmítnuto' &&
      g.datum !== null && Math.abs(dnyOd(t.datum, g.datum)) <= NEJVIC_DNI_PO_FAKTURE)
    if (bezVsSoupei) continue
    const f = souperi[0]
    if (f.castkaHaleru !== t.castkaHaleru || (f.vs ?? '').trim() !== t.vs.trim()) continue
    if (f.alokovanoHaleru !== 0 || f.duplicita || f.archivovana) continue
    if (f.stav === null || !STAVY_PRO_AUTOMATICKE_PAROVANI.includes(f.stav)) continue
    if (mena(f.mena) !== 'CZK' || mena(t.mena) !== 'CZK') continue
    if (!f.datum) continue
    const dny = dnyOd(t.datum, f.datum)
    if (!Number.isFinite(dny) || dny < -NEJVIC_DNI_PRED_FAKTUROU || dny > NEJVIC_DNI_PO_FAKTURE) continue
    if (t.protistrana.trim() !== '' && (f.dodavatel ?? '').trim() !== '' && !protistranaSedi(t.protistrana, f.dodavatel)) continue
    if (zamitnute.has(`${t.id}|${f.id}`)) continue

    // Vrácená platba. Když banka vrátí až PO spárování, Platby párování ukážou k ruční kontrole.
    if (jeVracena(t, prijmy)) continue

    vysledek.push({ transakceId: t.id, fakturaId: f.id, castkaHaleru: t.castkaHaleru, castkaFakturyHaleru: f.castkaHaleru })
  }
  return vysledek
}

/** Stavy, které dorovnání smí přepnout na „Uhrazeno" / „Částečně uhrazeno". */
const STAVY_K_DOROVNANI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno', 'Upomínka - zkontrolovat']

/**
 * Stav faktury podle POTVRZENÝCH párování: celá částka → „Uhrazeno",
 * část → „Částečně uhrazeno". Dorovná i ruční párování, u kterého se
 * přepnutí stavu ve Fakturách dřív nepovedlo (zapisuje se do jiné
 * databáze, „best-effort"). Jen ze stavů, kde to dává smysl — odmítnutou
 * nebo neschválenou fakturu dorovnání nepřepíše — a jen u faktur v Kč
 * (párování se vede v haléřích, cizí měnu by porovnalo s nesmyslem). Jen
 * směrem k zaplacení: „Uhrazeno" bez párování je ruční označení a to se
 * nevrací.
 */
export function dorovnatStavy(
  faktury: readonly { id: string; castkaHaleru: number; stav: string | null; mena?: string | null }[],
  alokovanoPodleFaktury: ReadonlyMap<string, number>,
): { fakturaId: string; stav: 'Uhrazeno' | 'Částečně uhrazeno'; puvodni: string }[] {
  const zmeny: { fakturaId: string; stav: 'Uhrazeno' | 'Částečně uhrazeno'; puvodni: string }[] = []
  for (const f of faktury) {
    const alokovano = alokovanoPodleFaktury.get(f.id) ?? 0
    if (alokovano <= 0 || f.castkaHaleru <= 0 || f.stav === null || !STAVY_K_DOROVNANI.includes(f.stav)) continue
    if (mena(f.mena) !== 'CZK') continue
    const cil = cilovyStavPodlePlateb(alokovano, f.castkaHaleru)
    if (cil && f.stav !== cil) zmeny.push({ fakturaId: f.id, stav: cil, puvodni: f.stav })
  }
  return zmeny
}

/** Stav podle součtu potvrzených plateb; null = žádná platba. */
export function cilovyStavPodlePlateb(alokovanoHaleru: number, castkaHaleru: number): 'Uhrazeno' | 'Částečně uhrazeno' | null {
  if (alokovanoHaleru <= 0) return null
  return castkaHaleru > 0 && alokovanoHaleru >= castkaHaleru ? 'Uhrazeno' : 'Částečně uhrazeno'
}

/* ---------------------------------------------------------------------
 * Ruční „Uhrazeno" a zpět (Faktury → Seznam). Čistá rozhodnutí, ať jdou
 * otestovat; akce v app/[rozsah]/finance/faktury/akce.ts je jen provede.
 * ------------------------------------------------------------------ */

/** Ručně „Uhrazeno" jen ze schválených stavů — jinak by se přes „Uhrazeno" a „Vrátit" dostal neschválený doklad mezi schválené. */
export const STAVY_PRO_RUCNI_UHRAZENI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']

export function smiOznacitUhrazenou(stav: string | null): boolean {
  return stav !== null && STAVY_PRO_RUCNI_UHRAZENI.includes(stav)
}

/**
 * Kam vrátit ručně uhrazenou fakturu: bez plateb → „Ke kontrole úhrady",
 * část zaplacená → „Částečně uhrazeno", zaplacená celá podle plateb →
 * null (vrátit nejde, nejdřív zrušit párování — jinak by ji dorovnání
 * vrátilo na „Uhrazeno").
 */
export function stavPoVraceni(alokovanoHaleru: number, castkaHaleru: number): 'Ke kontrole úhrady' | 'Částečně uhrazeno' | null {
  const podlePlateb = cilovyStavPodlePlateb(alokovanoHaleru, castkaHaleru)
  if (podlePlateb === null) return 'Ke kontrole úhrady'
  return podlePlateb === 'Částečně uhrazeno' ? 'Částečně uhrazeno' : null
}
