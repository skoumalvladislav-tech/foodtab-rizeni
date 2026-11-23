/**
 * Párování bankovních/pokladních transakcí s fakturami.
 *
 * Finance Fáze 0, krok 2 (docs/finance-faze0-zadani.md): (1) VS + částka
 * + IBAN dodavatele = jisté, spáruje se samo (`vybratAutomatickaParovani`,
 * v databázi `app.posoudit_jistou_shodu`); (2) částka + dodavatel + datum
 * v rozumném okně = návrh (`navrhyParovani`, potvrzuje vždy člověk);
 * (3) jinak nespárováno (fronta Platby bez faktury). Dřívější bodování
 * (VS +0.5, částka +0.3, …) nahradily pevné stupně návrhů.
 *
 * Čistá logika, žádné IO — proto bez `import 'server-only'`, testovatelná
 * přímo Nodem (scripts/finance-parovani.test.mjs). Volající (server akce
 * v app/[rozsah]/finance/platby/) si data z obou databází (hlavní +
 * Faktury) natáhne sama a sem předá jen tenhle tvar.
 */

import { ZDROJ_BANKY_API } from './banka/konektor.ts'
import { ibanZUctu, protistranaNeboUcet } from './banka/ucet.ts'

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
  /** V nejmenší jednotce MĚNY FAKTURY (u EUR centy, ne haléře). */
  castkaHaleru: number
  dodavatel: string | null
  datum: string | null
  /** Měna faktury; chybí = Kč. Ruční párování podle ní píše částku. */
  mena?: string | null
}

/* ---------------------------------------------------------------------
 * Automatické párování (Šéfík 8. 10. 2026: „faktury se mají automaticky
 * přesunout do uhrazených ve chvíli spárování s platbou z výpisu").
 *
 * Sama se potvrdí jen JEDNOZNAČNÁ shoda — vše ostatní zůstává návrhem
 * k ručnímu potvrzení (`navrhyParovani` níž). Finance Fáze 0, krok 2:
 * jistá shoda = VS + částka + IBAN dodavatele. Jednoznačná znamená
 * všechno najednou (pravidla zpřísněná po dvou kolech kontroly kódu):
 *   - platba přišla Z BANKY přes API (zdroj `banka_api`) — ty zapisuje jen
 *     synchronizace (pojistka v databázi) — nebo řádek výpisu, který
 *     potvrdilo stažení z banky (`platbaZBanky`); ruční zápis ani pokladna
 *     nikdy. Dávku výpisu, kterou právě nahrál člověk, posuzuje jen
 *     databáze (`sparovat_jiste_z_davky`, práva i počet řádků dávky);
 *   - nestornovaná a nestornující;
 *   - stejný variabilní symbol (bez mezer a úvodních nul) A přesně stejná
 *     částka, obojí ve STEJNÉ vyplněné měně — prázdná měna nikdy jistě
 *     (otázka 111); jméno protistrany musí sedět s dodavatelem (většina
 *     významných slov, bez „s.r.o.", „a.s.");
 *   - účet protistrany je platný IBAN (nebo český účet převeditelný na
 *     IBAN) a je to TÝŽ účet, který je na faktuře (`ibanZUctu`);
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
  /** Účet protistrany (normalizovaný), prázdný, když ho banka nedala. */
  protiucet?: string
  alokovanoHaleru: number
  zdroj: string
  mena: string
  smer: 'vydaj' | 'prijem'
  davkaId: string | null
  /**
   * Řádek výpisu (`csv_banka`), který potvrdilo stažení z banky — banka
   * k němu poslala id pohybu (tabulka `transakce_potvrzeni_banky`, zapisuje
   * ji jen import pod službou). Stažení se pak podruhé nezapíše, takže
   * tenhle řádek je ta platba z banky.
   */
  potvrzenoBankou?: boolean
  /** Pohyb je storno jiného, nebo ho jiný pohyb stornoval (`transakce.storno_of`). */
  stornovano?: boolean
}

/*
 * Výčty sloupců `transakce` pro místa, která protistranu ukazují nebo
 * s ní párují. Od kroku 1 leží číslo účtu protistrany ve vlastním sloupci
 * `protiucet` (dřív stálo v `protistrana`, když jméno chybělo). Výčet bez
 * něj by u platby bez jména ukázal prázdno a párování by přišlo o signál.
 * Proto jsou tady, na jednom místě; že každý nese i protiúčet a že je
 * appka opravdu používá, hlídá scripts/finance-parovani.test.mjs.
 */

/** Úloha automatického párování (lib/finance-automaticke-parovani.ts). */
export const SLOUPCE_AUTOMATICKEHO_PAROVANI = 'id, vs, castka_haleru, protistrana, protiucet, datum, zdroj, mena, smer, import_davka_id, storno_of'

/** Platby → potvrzená párování: platba u faktury. */
export const SLOUPCE_POTVRZENEHO_PAROVANI = 'id, datum, protistrana, protiucet, vs, castka_haleru'

/** Platby → příjmy, mezi kterými se hledá vrácení spárované platby. */
export const SLOUPCE_PRIJMU_PRO_VRACENI = 'vs, castka_haleru, datum, protistrana, protiucet'

/** Finance → Přehled, „Co vyžaduje pozornost": návrhy párování. */
export const SLOUPCE_NAVRHU_POZORNOSTI = 'id, castka_haleru, datum, protistrana, protiucet, vs, platebni_ucty(branch_id, nazev)'

/** Platby → seznam plateb; na pobočce jen platby účtů pobočky (`!inner`). */
export function sloupceSeznamuPlateb(naPobocce: boolean): string {
  const zaklad = 'id, smer, castka_haleru, datum, protistrana, protiucet, vs, zdroj'
  return naPobocce ? `${zaklad}, platebni_ucty!inner(branch_id)` : zaklad
}

/** Řádek `transakce` tak, jak ho čte automatické párování. */
export type RadekTransakceParovani = {
  id: string; vs: string | null; castka_haleru: number; protistrana: string | null; protiucet: string | null; datum: string
  zdroj: string; mena: string | null; smer: string; import_davka_id: string | null
  storno_of?: string | null
}

/**
 * Řádek z databáze → tvar pro `vybratAutomatickaParovani`. Protistrana
 * je jméno, a když chybí, číslo účtu (protistranaNeboUcet) — přesně
 * jak to pravidla níž dostávala před rozdělením na dva sloupce: pohyb
 * bez jména s cizím účtem se dodavateli sám nespáruje a vrácená platba
 * bez VS z téhož účtu se pozná.
 *
 * `potvrzeneBankou` = id řádků výpisu, které potvrdilo stažení z banky
 * (`transakce_potvrzeni_banky.transakce_id`). `stornovane` = id pohybů,
 * na které ukazuje `storno_of` jiného pohybu (stornované bankou).
 *
 * Měna se NEDOPLŇUJE: prázdná zůstane prázdná a jistá shoda ji nevezme
 * (otázka 111) — pro součty a stav platí prázdná = CZK (`menaNeboCzk`).
 */
export function autoTransakceZRadku(
  t: RadekTransakceParovani,
  potvrzeneBankou?: ReadonlySet<string>,
  stornovane?: ReadonlySet<string>,
): AutoTransakce {
  return {
    id: t.id, vs: t.vs ?? '', castkaHaleru: t.castka_haleru,
    protistrana: protistranaNeboUcet(t.protistrana, t.protiucet), protiucet: t.protiucet ?? '',
    datum: t.datum, alokovanoHaleru: 0, zdroj: t.zdroj, mena: t.mena ?? '',
    smer: t.smer === 'prijem' ? 'prijem' : 'vydaj', davkaId: t.import_davka_id,
    potvrzenoBankou: t.zdroj === 'csv_banka' && (potvrzeneBankou?.has(t.id) ?? false),
    stornovano: (t.storno_of ?? null) !== null || (stornovane?.has(t.id) ?? false),
  }
}

/**
 * Věří se platbě jako platbě Z BANKY (pro úlohu bez přihlášeného)?
 * Stažení přes API (zapisuje jen synchronizace) nebo řádek výpisu
 * potvrzený stažením z banky. Ruční zápis ani pokladna nikdy. Dávku
 * výpisu, kterou právě nahrál člověk, posuzuje databáze sama
 * (`sparovat_jiste_z_davky` — kdo ji nahrál, jeho práva, počet řádků).
 */
export function platbaZBanky(t: Pick<AutoTransakce, 'zdroj' | 'potvrzenoBankou'>): boolean {
  if (ZDROJE_Z_API.includes(t.zdroj)) return true
  return t.zdroj === 'csv_banka' && t.potvrzenoBankou === true
}
export type AutoFaktura = KandidatFaktura & {
  stav: string | null
  alokovanoHaleru: number
  duplicita: boolean
  archivovana: boolean
  mena: string | null
  /** Účet dodavatele z faktury (`faktury.ucet_dodavatele`), jak ho přečetl příjem. */
  ucetDodavatele?: string | null
}

/** Stavy faktury, které se smí zaplatit samy (schválené k úhradě). */
export const STAVY_PRO_AUTOMATICKE_PAROVANI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno']

/**
 * Platby z banky přes API — zapisuje je jen synchronizace (trigger
 * hlida_zdroj_transakce). Jeden zdroj pro všechny banky (migrace
 * 20261119100000) — která banka to byla, ví jen připojení.
 */
export const ZDROJE_Z_API: readonly string[] = [ZDROJ_BANKY_API]

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

/** Měna pro součty, stav a návrhy: prázdná = CZK (jako `app.mena_nebo_czk`). */
export function menaNeboCzk(m: string | null | undefined): string {
  return mena(m)
}

/** Měna pro JISTOU shodu: prázdná = neznámá (null), nikdy „asi Kč". */
function menaJiste(m: string | null | undefined): string | null {
  return (m ?? '').trim().toUpperCase() || null
}

/** Je faktura v Kč (stejné pravidlo jako automatické párování)? */
export function jeVKorunach(m: string | null | undefined): boolean {
  return mena(m) === 'CZK'
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
 * VS od stejné protistrany (stejný účet protistrany, nebo stejné jméno).
 * Příjem s JINÝM VS je vrácení jiné platby.
 */
type PohybVraceni = Pick<AutoTransakce, 'vs' | 'castkaHaleru' | 'datum' | 'protistrana' | 'protiucet'>
export function jeVracena(platba: PohybVraceni, prijmy: readonly PohybVraceni[]): boolean {
  const v = normalizovatVs(platba.vs)
  const ucetPlatby = (platba.protiucet ?? '').trim()
  return prijmy.some((p) => {
    if (p.castkaHaleru > platba.castkaHaleru || p.castkaHaleru < Math.floor(platba.castkaHaleru * 0.97)) return false
    const po = dnyOd(p.datum, platba.datum)
    if (!Number.isFinite(po) || po < 0 || po > DNI_NA_VRACENI) return false
    const vsPrijmu = normalizovatVs(p.vs)
    if (vsPrijmu !== null) return vsPrijmu === v
    // Účet protistrany je jistější než jméno (to se mezi bankou a výpisem liší
    // a vrácení ho často nemá vůbec).
    if (ucetPlatby !== '' && (p.protiucet ?? '').trim() === ucetPlatby) return true
    return p.protistrana.trim() !== '' && platba.protistrana.trim() !== '' && protistranaSedi(p.protistrana, platba.protistrana)
  })
}

/**
 * `transakce` = VŠECHNY pohyby (výdaje i příjmy) z posledních 180 dní,
 * `faktury` = VŠECHNY faktury (i uhrazené, archivované, odmítnuté, bez
 * částky) — jen tak jde poznat, že shoda není jednoznačná.
 * `zamitnute` = dvojice `transakceId|fakturaId`, které člověk zrušil.
 *
 * Databáze (`app.posoudit_jistou_shodu`) totéž ověří znovu a přísněji
 * (soupeři i mezi stornovanými, ruční úhrady, Jiné platby); tohle je
 * výběr kandidátů, ne rozhodnutí. Navíc proti databázi: jméno
 * protistrany a faktura bez VS se stejnou částkou — ty databáze nemá
 * (otázka 135).
 */
export function vybratAutomatickaParovani(
  transakce: readonly AutoTransakce[],
  faktury: readonly AutoFaktura[],
  moznosti: { zamitnute?: ReadonlySet<string> } = {},
): AutomatickeParovani[] {
  const zamitnute = moznosti.zamitnute ?? new Set<string>()

  const fakturyPodleVs = new Map<string, AutoFaktura[]>()
  const fakturyBezVs: AutoFaktura[] = []
  for (const f of faktury) {
    const v = normalizovatVs(f.vs)
    if (v) fakturyPodleVs.set(v, [...(fakturyPodleVs.get(v) ?? []), f])
    else fakturyBezVs.push(f)
  }
  const vydaje = transakce.filter((t) => t.smer === 'vydaj')
  const prijmy = transakce.filter((t) => t.smer === 'prijem')
  // Soupeřící platby: stejný VS a částka; stornovaný pár se nepočítá
  // (stejně jako souper_platba v databázi).
  const vydajePodleKlice = new Map<string, number>()
  for (const t of vydaje) {
    const v = normalizovatVs(t.vs)
    if (v && t.castkaHaleru > 0 && !t.stornovano) vydajePodleKlice.set(`${v}|${t.castkaHaleru}`, (vydajePodleKlice.get(`${v}|${t.castkaHaleru}`) ?? 0) + 1)
  }

  const vysledek: AutomatickeParovani[] = []
  for (const t of vydaje) {
    const v = normalizovatVs(t.vs)
    if (!v || t.castkaHaleru <= 0 || t.alokovanoHaleru !== 0) continue
    if (t.stornovano) continue
    if (!platbaZBanky(t)) continue
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
    // VS už sedí po normalizaci (klíč mapy) — „0012345" = „12345" jako v databázi.
    if (f.castkaHaleru !== t.castkaHaleru) continue
    if (f.alokovanoHaleru !== 0 || f.duplicita || f.archivovana) continue
    if (f.stav === null || !STAVY_PRO_AUTOMATICKE_PAROVANI.includes(f.stav)) continue
    // Stejná VYPLNĚNÁ měna na obou stranách (prázdná nikdy jistě).
    const menaPlatby = menaJiste(t.mena)
    if (menaPlatby === null || menaPlatby !== menaJiste(f.mena)) continue
    // IBAN: platný a stejný na platbě i na faktuře.
    const iban = ibanZUctu(t.protiucet)
    if (iban === null || iban !== ibanZUctu(f.ucetDodavatele)) continue
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

/**
 * Stavy, které dorovnání smí přepnout na „Uhrazeno" / „Částečně uhrazeno"
 * (jako `app.faktura_stav_podle_plateb`: upomínku ani neschválenou ne).
 */
const STAVY_K_DOROVNANI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']

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
 * Návrhy párování (Finance Fáze 0, krok 2). Ukládají se jako
 * `platby_faktury` ve stavu 'navrzeno' (fronta Finance → Platby →
 * Návrhy párování) a potvrzuje je vždy člověk. Hledá je
 * lib/finance-navrhy-parovani.ts nad VŠEMI nespárovanými pohyby; databáze
 * (`app.zapsat_navrhy_parovani`) zápis ještě jednou ověří a částku omezí
 * zbytkem platby i faktury.
 *
 * Stupně (pro jeden pohyb vyhrává nejvyšší, stejných nejvýš 3):
 *   vs+castka+ucet          0.95  VS, částka i IBAN (jistá shoda, kterou
 *                                 automatika nevzala — soupeř, výpis…)
 *   vs+castka               0.90  VS a částka (zbytek faktury)
 *   castka+dodavatel+okno   0.70  částka, dodavatel (jméno nebo IBAN)
 *                                 a datum v okně kolem faktury
 *   dobropis+vratka         0.80  příjem = zbytek dobropisu téhož dodavatele
 *   jina_mena               0.50  jiná měna, stejný VS a dodavatel —
 *                                 potvrzení je ruční úhrada v měně faktury
 * ------------------------------------------------------------------ */

export type DuvodNavrhu = 'vs+castka+ucet' | 'vs+castka' | 'castka+dodavatel+okno' | 'dobropis+vratka' | 'jina_mena'

/** Pro lidi: proč appka dvojici navrhla. */
export const DUVODY_NAVRHU: Readonly<Record<DuvodNavrhu, string>> = {
  'vs+castka+ucet': 'Stejný variabilní symbol, částka i účet dodavatele',
  'vs+castka': 'Stejný variabilní symbol a částka',
  'castka+dodavatel+okno': 'Stejná částka a dodavatel, platba v době splatnosti',
  'dobropis+vratka': 'Dodavatel vrátil peníze za dobropis',
  'jina_mena': 'Stejný variabilní symbol, ale platba je v jiné měně než faktura',
}

const JISTOTA_NAVRHU: Readonly<Record<DuvodNavrhu, number>> = {
  'vs+castka+ucet': 0.95,
  'vs+castka': 0.9,
  'dobropis+vratka': 0.8,
  'castka+dodavatel+okno': 0.7,
  'jina_mena': 0.5,
}

// ROZHODNOUT: okno návrhu „částka + dodavatel" — platba nejdřív 3 dny před
// vystavením a nejpozději 30 dní po splatnosti (bez splatnosti 30 dní po
// vystavení). Otázka 127.
export const OKNO_NAVRHU_PRED_VYSTAVENIM = 3
export const OKNO_NAVRHU_PO_SPLATNOSTI = 30
/** Nejvýš tolik stejně dobrých návrhů na jeden pohyb; víc = nechat na člověku. */
export const NEJVIC_NAVRHU_NA_POHYB = 3

/** Stavy faktury, ke kterým se návrh smí nabídnout (jako `app.zapsat_navrhy_parovani`). */
export const STAVY_PRO_NAVRH: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']

export type NavrhovanyPohyb = {
  id: string
  vs: string
  /** ZBYTEK pohybu (částka minus potvrzená párování a úhrady Jiných plateb), v haléřích jeho měny. */
  zbyvaHaleru: number
  protistrana: string
  protiucet: string
  datum: string
  mena: string | null
  smer: 'vydaj' | 'prijem'
  stornovano?: boolean
}

export type NavrhovanaFaktura = {
  id: string
  vs: string | null
  /** Částka se znaménkem (dobropis záporně), v nejmenší jednotce měny faktury. */
  castkaHaleru: number
  /** Zbývá zaplatit (absolutně): |částka| − párování v měně faktury − ruční úhrady. */
  zbyvaHaleru: number
  dodavatel: string | null
  ucetDodavatele: string | null
  datumVystaveni: string | null
  splatnost: string | null
  mena: string | null
  stav: string | null
  duplicita: boolean
  archivovana: boolean
}

export type NavrhParovani = {
  transakceId: string
  fakturaId: string
  castkaHaleru: number
  duvod: DuvodNavrhu
  jistota: number
}

function vOkne(datum: string, f: Pick<NavrhovanaFaktura, 'datumVystaveni' | 'splatnost'>): boolean {
  const zacatek = f.datumVystaveni ?? f.splatnost
  if (!zacatek) return false
  const od = dnyOd(datum, zacatek)
  if (!Number.isFinite(od) || od < -OKNO_NAVRHU_PRED_VYSTAVENIM) return false
  const konec = f.splatnost ?? f.datumVystaveni
  const po = dnyOd(datum, konec as string)
  return Number.isFinite(po) && po <= OKNO_NAVRHU_PO_SPLATNOSTI
}

/** Stupeň návrhu pro dvojici; null = nenavrhovat. */
function duvodNavrhu(t: NavrhovanyPohyb, f: NavrhovanaFaktura): DuvodNavrhu | null {
  // Směr: faktura (kladná) ↔ výdaj, dobropis (záporný) ↔ příjem.
  if (f.castkaHaleru > 0 && t.smer !== 'vydaj') return null
  if (f.castkaHaleru < 0 && t.smer !== 'prijem') return null
  if (f.castkaHaleru === 0 || f.zbyvaHaleru <= 0 || t.zbyvaHaleru <= 0) return null

  const vs = normalizovatVs(t.vs)
  const stejnyVs = vs !== null && vs === normalizovatVs(f.vs)
  const iban = ibanZUctu(t.protiucet)
  const stejnyUcet = iban !== null && iban === ibanZUctu(f.ucetDodavatele)
  const stejnyDodavatel = stejnyUcet || (t.protistrana.trim() !== '' && protistranaSedi(t.protistrana, f.dodavatel))
  const stejnaCastka = t.zbyvaHaleru === f.zbyvaHaleru

  if (menaNeboCzk(t.mena) !== menaNeboCzk(f.mena)) {
    // Částky v různých měnách porovnat nejde: VS a dodavatel musí sedět.
    return stejnyVs && stejnyDodavatel ? 'jina_mena' : null
  }
  if (f.castkaHaleru < 0) {
    return stejnaCastka && (stejnyVs || stejnyDodavatel) ? 'dobropis+vratka' : null
  }
  if (stejnyVs && stejnaCastka) return stejnyUcet ? 'vs+castka+ucet' : 'vs+castka'
  if (stejnaCastka && stejnyDodavatel && vOkne(t.datum, f)) return 'castka+dodavatel+okno'
  return null
}

/**
 * Návrhy pro nespárované zbytky pohybů. `vyloucene` = dvojice
 * `transakceId|fakturaId`, které už v `platby_faktury` jsou (potvrzené,
 * zamítnuté i navržené) — znovu se nenavrhují.
 */
export function navrhyParovani(
  pohyby: readonly NavrhovanyPohyb[],
  faktury: readonly NavrhovanaFaktura[],
  moznosti: { vyloucene?: ReadonlySet<string> } = {},
): NavrhParovani[] {
  const vyloucene = moznosti.vyloucene ?? new Set<string>()
  const otevrene = faktury.filter((f) => !f.archivovana && !f.duplicita && f.stav !== null
    && STAVY_PRO_NAVRH.includes(f.stav) && f.castkaHaleru !== 0 && f.zbyvaHaleru > 0)

  const vysledek: NavrhParovani[] = []
  for (const t of pohyby) {
    if (t.stornovano || t.zbyvaHaleru <= 0) continue
    const kandidati: { f: NavrhovanaFaktura; duvod: DuvodNavrhu; jistota: number; odstup: number }[] = []
    for (const f of otevrene) {
      if (vyloucene.has(`${t.id}|${f.id}`)) continue
      const duvod = duvodNavrhu(t, f)
      if (!duvod) continue
      const datumFaktury = f.splatnost ?? f.datumVystaveni
      const odstup = datumFaktury ? Math.abs(dnyOd(t.datum, datumFaktury)) : Number.POSITIVE_INFINITY
      kandidati.push({ f, duvod, jistota: JISTOTA_NAVRHU[duvod], odstup: Number.isFinite(odstup) ? odstup : Number.POSITIVE_INFINITY })
    }
    if (kandidati.length === 0) continue
    const nejlepsi = Math.max(...kandidati.map((k) => k.jistota))
    const vybrani = kandidati.filter((k) => k.jistota === nejlepsi)
      .sort((a, b) => a.odstup - b.odstup || a.f.id.localeCompare(b.f.id))
      .slice(0, NEJVIC_NAVRHU_NA_POHYB)
    for (const k of vybrani) {
      // Částka: nejvýš zbytek pohybu i faktury (u jiné měny jen zbytek pohybu).
      const castka = k.duvod === 'jina_mena' ? t.zbyvaHaleru : Math.min(t.zbyvaHaleru, k.f.zbyvaHaleru)
      vysledek.push({ transakceId: t.id, fakturaId: k.f.id, castkaHaleru: castka, duvod: k.duvod, jistota: k.jistota })
    }
  }
  return vysledek
}

/* ---------------------------------------------------------------------
 * Ruční „Uhrazeno" a zpět (Faktury → Seznam). Od Finance Fáze 0, kroku 2
 * rozhoduje databáze (`rucne_uhradit_fakturu`, `vratit_fakturu_mezi_
 * neuhrazene`); tady zůstává jen, kdy appka tlačítko vůbec nabídne.
 * ------------------------------------------------------------------ */

/** Ručně „Uhrazeno" jen ze schválených stavů (jako `app.faktura_k_rucni_uhrade`). */
export const STAVY_PRO_RUCNI_UHRAZENI: readonly string[] = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno']

export function smiOznacitUhrazenou(stav: string | null): boolean {
  return stav !== null && STAVY_PRO_RUCNI_UHRAZENI.includes(stav)
}
