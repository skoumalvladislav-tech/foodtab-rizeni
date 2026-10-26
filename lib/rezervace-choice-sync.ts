import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { rozsifrovat } from './integrace-klice.ts'
import {
  chybaBehu,
  KLIC_CHOICE,
  NEJMENE_NA_PRIPOJENI_MS,
  poradiSynchronizace,
  precistKurzor,
  probehnoutChoice,
  ROZESTUP_DOTAZU_MS,
  vytvoritChoice,
  type ChybaChoice,
  type FetchFn,
  type SouhrnZapisu,
  type ZapisChoice,
} from './rezervace-choice.ts'
import type { RadekImportu } from './rezervace-import.ts'
import { funkceNeexistuje } from './supabase/dotaz.ts'
import { klientUlohy } from './supabase/uloha.ts'

/**
 * Choice — načítání rezervací na serveru (síť, databáze, zámek, fronta).
 * Čistá logika je v lib/rezervace-choice.ts, tohle ji jen zapojuje.
 *
 * Kdo to volá (výjimky ze `service_role`, zapsané i v lib/supabase/uloha.ts):
 *   * naplánovaná úloha `app/api/uloha/rezervace-choice` (všechna
 *     ověřená připojení Choice, za CRON_SECRET),
 *   * „Načíst teď“ a „Ověřit znovu“ v Rezervace → Napojení — až po
 *     přihlášení, právu na pobočce připojení a dohledání připojení
 *     uživatelským klientem (RLS),
 *   * callback `/api/rezervace/choice/callback` — ověření tokenu přes
 *     frontu a první načtení po připojení.
 *
 * `service_role` je tu kvůli třem věcem, které přihlášený dělat nesmí:
 * frontě dotazů na Choice (kdokoli by si jinak zabíral čas dopředu),
 * tokenu (rozšifruje ho jen server) a zápisu rezervací ze zdroje
 * (`rezervace_importovat_zdroj` je jen pro service_role).
 *
 * Tlačítka (a callback) čekají ve frontě nejvýš dva rozestupy, delší
 * čekání má jen naplánovaná úloha (`NEJDELE_CEKA_TLACITKO_MS`); když se
 * tlačítko nevejde, jednou počká (nejvýš jeden rozestup) a zkusí to
 * znovu (`NEJDELE_PRED_OPAKOVANIM_MS`). Úloha jde do fronty vlastním
 * vstupem, bez pravidla firmy (migrace 20261102100000). „Ověřit znovu“
 * jde na připojení nejvýš jednou za minutu (`overitZnovu`).
 *
 * „PŘIPOJENO“ zapisuje v celém modulu JEDINÁ funkce, `zapsatVysledekTestu`,
 * a jen po úspěšném živém testu (`GET /bookings/list?perPage=1`). Databáze
 * to hlídá podruhé (`integrace_pripojeni_rezervace_overeno`).
 */

/**
 * Rezerva před tvrdým koncem (`konecMs`): dotaz na Choice (časový limit
 * 15 s) a zápis jeho stránky. Nový dotaz se po `konecMs - REZERVA` nezačne.
 * Odečítá se JEDNOU za celý běh (úloha: jednou za celou úlohu), ne
 * z každého dílu času — jinak by díly připojení skoro celé snědla.
 */
export const REZERVA_DOTAZU_MS = 20_000

/**
 * Kolik smí ve frontě dotazů na Choice čekat TLAČÍTKO („Ověřit znovu“,
 * „Načíst teď“, test a první načtení po připojení v callbacku): nejvýš
 * DVA rozestupy (11 s). Jinak hned „zkuste za chvíli“.
 *
 * Proč strop vůbec (prověrka 26. 10.): fronta je společná celé
 * instalaci a pravidlo „firma nejvýš jeden zabraný dotaz“ (migrace
 * 20261031100000) platí na firmu — jenže firmu si může založit kdokoli
 * přihlášený (`app.create_tenant`). Kdyby tlačítko smělo čekat 30 s,
 * kdo ovládá šest firem, zabral by frontu ~33 s dopředu a naplánovaná
 * úloha ostatních by čekala skoro celý svůj čas. Se stropem dva
 * rozestupy si tlačítko dotaz zabere, jen když je fronta volná
 * nejpozději za 11 s — tlačítka dohromady tak posunou frontu nejvýš
 * o tři rozestupy (~16,5 s), ať je firem kolik chce.
 *
 * Proč ne jeden rozestup (nezávislé ověření 26. 10.): běžící načítání
 * jiné firmy si další dotaz zabírá hned po odpovědi na předchozí, tedy
 * o rozestup dopředu — fronta je pak volná až za 11 s minus doba
 * odpovědi. S jedním rozestupem se tlačítko vedle JEDINÉHO běžícího
 * načítání do fronty skoro nikdy nevešlo (měřeno 9–36 % okamžiků):
 * callback po připojení skončil „ověřit později“ a připojení zůstalo
 * neověřené. Se dvěma rozestupy se vedle jednoho běhu vejde vždy
 * (scripts/rezervace-choice.test.mjs to zkouší v každé fázi jeho cyklu).
 *
 * Delší čekání (celý svůj díl času) má jen naplánovaná úloha
 * (`synchronizovatChoice(…, { uloha: true })`). Databáze neví, kdo se
 * ptá — rozhoduje tenhle server, jediný, kdo frontu volá (service_role).
 */
export const NEJDELE_CEKA_TLACITKO_MS = 2 * ROZESTUP_DOTAZU_MS

/**
 * Když se tlačítko do fronty nevejde, databáze řekne, za kolik ms to má
 * smysl zkusit znovu (migrace 20261102100000: až odejde dotaz, který
 * má firma zabraný, a až se fronta posune). Tlačítko pak JEDNOU počká
 * — nejvýš tohle, jeden rozestup — a zkusí to znovu.
 *
 * Proč (nezávislé ověření po sloučení #162): vedle běžícího načítání
 * TÉŽE firmy (první načtení pobočky 1 a callback pobočky 2) a vedle
 * DVOU běhů jiných firem se tlačítko vešlo jen v okně mezi odchodem
 * dotazu běhu a jeho odpovědí (4–52 % okamžiků). Chvíle, kterou vrátí
 * databáze, padne přesně do toho okna. Běh tlačítka (první načtení,
 * „Načíst teď“) opakuje stejně, takže se dva běhy téže firmy střídají
 * a tlačítko běh neusekne. Opakování nic nezabírá — strop dvou
 * rozestupů ve frontě (a tři rozestupy pro všechna tlačítka dohromady)
 * platí dál.
 */
export const NEJDELE_PRED_OPAKOVANIM_MS = ROZESTUP_DOTAZU_MS

/**
 * „Načíst teď“ má na celý běh (od kliku po uložení) tolik — stránka
 * Napojení má strop 60 s (`maxDuration`), 5 s zbývá na vykreslení po
 * přesměrování. Poslední dotaz smí odejít `REZERVA_DOTAZU_MS` před
 * koncem, tedy 35 s po kliku.
 *
 * Proč ne 50 s jako „Ověřit znovu“ (nezávislé ověření po sloučení #162):
 * vedle běžícího načítání jdou dotazy „Načíst teď“ po dvou rozestupech
 * (střídají se s ním). První může čekat až dva rozestupy, tři dotazy
 * (blízko, nové, stránka okna) tak potřebují až 33 s — s posledním
 * dotazem do 30 s skončilo v půlce okamžiků jen dvěma („načtena
 * část“). scripts/rezervace-choice.test.mjs to zkouší v každé fázi
 * běžícího načítání.
 */
export const KONEC_NACIST_TED_MS = 55_000

/** Nejdelší čekání ve frontě vůbec (i pro úlohu; databáze víc nepustí). */
const NEJDELE_CEKA_ULOHA_MS = 120_000

/**
 * Kdo se ptá — rozhoduje, jak dlouho smí čekat ve frontě. Cokoli jiného
 * než `'uloha'` čeká jako tlačítko (bezpečná výchozí).
 */
export type KdoSePta = 'tlacitko' | 'uloha'

/**
 * „Ověřit znovu“ na jednom připojení nejvýš jednou za tuhle dobu (jako
 * minutový odstup „Načíst teď“). Drží ho databáze
 * (`rezervace_choice_zabrat_overeni`, odstup a dotaz ve frontě jedním
 * voláním), ne `posledni_test_kdy` v registru — ten si správce napojení
 * může přepsat. Klik, který se do fronty nevejde, odstup nespotřebuje.
 */
export const ODSTUP_OVERENI_MS = 60_000

const MINUT_NEZ_JE_BEH_ZASEKNUTY = 10

/** Síť a hodiny — v testu se podstrčí, jinak skutečné. */
export type ProstrediChoice = {
  fetch: FetchFn
  ted: () => number
  spat: (ms: number) => Promise<void>
}

const SKUTECNE: ProstrediChoice = {
  fetch: (url, init) => fetch(url, init),
  ted: () => Date.now(),
  spat: (ms) => new Promise((hotovo) => setTimeout(hotovo, ms)),
}

/** Fronta dotazů v databázi chybí (kód před migrací) nebo selhala — na Choice se pak nesahá vůbec. */
export class ChybaFronty extends Error {
  readonly bezMigrace: boolean
  constructor(bezMigrace: boolean) {
    super(bezMigrace ? 'Fronta dotazů na Choice čeká na migraci 20261031100000.' : 'Fronta dotazů na Choice selhala.')
    this.bezMigrace = bezMigrace
  }
}

/**
 * Zabere v databázi čas na jeden dotaz a počká na něj.
 * `posledniDotazMs` = nejpozdější okamžik, kdy smí dotaz ODEJÍT (rezervu
 * na odpověď a zápis už odečetl volající — tady se neodečítá podruhé).
 *
 * `kdo`:
 *   * `'tlacitko'` — fronta za firmu (`rezervace_choice_zabrat_dotaz`,
 *     firma nejvýš jeden zabraný dotaz), čeká nejvýš
 *     `NEJDELE_CEKA_TLACITKO_MS`; když se nevejde, jednou počká (nejvýš
 *     `NEJDELE_PRED_OPAKOVANIM_MS`) a zkusí to znovu,
 *   * `'uloha'` — vlastní vstup úlohy (`rezervace_choice_zabrat_dotaz_ulohy`,
 *     bez pravidla firmy), čeká až do `posledniDotazMs`, neopakuje.
 *     S `dil` (díl času jednoho připojení, `DilUlohy`) smí PRVNÍ dotaz
 *     čekat až do `posledniDotazMs` a díl se počítá až od chvíle, kdy
 *     první dotaz odešel; do `dil.konecMs` se zapíše, do kdy smějí odejít
 *     další.
 *
 * `false` = nevejde se (ani po opakování), nebo firma už má zabraný jiný
 * dotaz; nic se nezabralo. Bez fronty se NEPOSÍLÁ nic — výjimka, ne
 * „pošli to bez ní“.
 */
export function cekatNaFrontu(
  sluzba: SupabaseClient,
  tenantId: string,
  posledniDotazMs: number,
  kdo: KdoSePta,
  p: ProstrediChoice = SKUTECNE,
  dil?: DilUlohy,
): () => Promise<boolean> {
  if (kdo === 'uloha') {
    let konec = posledniDotazMs
    let prvni = true
    return async () => {
      const zabrano = await zabratUlohou(sluzba, tenantId, konec, p)
      if (zabrano && prvni && dil) {
        // Teď odchází první dotaz (`zabratUlohou` počkala na jeho čas).
        konec = konecDiluUlohy(p.ted(), dil.ms, posledniDotazMs)
        dil.konecMs = konec
      }
      prvni = false
      return zabrano
    }
  }
  return async () => {
    for (let pokus = 1; ; pokus++) {
      const nejdele = nejdeleCekat(posledniDotazMs, 'tlacitko', p)
      if (nejdele === null) return false
      const { data, error } = await sluzba.rpc('rezervace_choice_zabrat_dotaz', {
        p_tenant: tenantId,
        p_rozestup_ms: ROZESTUP_DOTAZU_MS,
        p_nejdele_cekat_ms: nejdele,
      })
      if (error) throw new ChybaFronty(funkceNeexistuje(error))
      const z = vylozitFrontu(data)
      if (z.stav === 'zabrano') {
        await pockat(z.cekatMs, p)
        return true
      }
      if (!zkusitZnovu(z, pokus)) return false
      await p.spat(z.zaMs)
    }
  }
}

/**
 * Díl času jednoho připojení naplánované úlohy (app/api/uloha/
 * rezervace-choice). `ms` = délka dílu od route; `konecMs` doplní
 * `cekatNaFrontu`, až odejde první dotaz připojení: do kdy smějí odcházet
 * další. Route podle něj počítá, kolik času zbývá dalším připojením
 * (`synchronizovatChoice` ho vrací jako `konecDiluMs`).
 */
export type DilUlohy = { ms: number; konecMs: number | null }

/**
 * Do kdy smějí odcházet dotazy připojení úlohy, když jeho první dotaz
 * odešel v `prvniMs`.
 *
 * Proč díl až od prvního dotazu (nezávislé ověření PR #163): díl dalšího
 * připojení se dřív počítal od chvíle, kdy předchozí skončilo. Když
 * tlačítko vzalo poslední místo dílu předchozího připojení, další
 * připojení čekalo na frontu (až dva rozestupy) UVNITŘ svého dílu —
 * místo 3 dotazů 2 a na třetí připojení díl nezbyl. Úloha tak přišla
 * o dotaz víc, než kolik jich tlačítko samo udělalo. Čekání na první
 * místo ve frontě proto díl neukusuje.
 *
 * Když po dílu nezbude celý nejmenší díl (`NEJMENE_NA_PRIPOJENI_MS`) na
 * další připojení, dočte zbytek úlohy tohle připojení — jinak by ten čas
 * propadl, protože další připojení by route nezačala. Route se rozhoduje
 * podle TÉHOŽ konce dílu (`konecDiluMs` ve výsledku), ne podle chvíle,
 * kdy připojení doběhlo: to je o odpověď na poslední dotaz později a ve
 * škvíře mezi oběma okamžiky by čas propadl taky (úloha se 3 připojeními
 * a frontou obsazenou do ~4 s by udělala 4 dotazy místo 7).
 */
export function konecDiluUlohy(prvniMs: number, dilMs: number, posledniDotazMs: number): number {
  const konecDilu = prvniMs + dilMs
  return posledniDotazMs - konecDilu < NEJMENE_NA_PRIPOJENI_MS ? posledniDotazMs : konecDilu
}

/**
 * Úloha: vlastní vstup do společné fronty, bez pravidla firmy (úloha je
 * v instalaci jediná, migrace 20261102100000). Databáze před tou
 * migrací funkci nemá (PGRST202) — pak úloha čeká jako dřív, frontou
 * za firmu, a místo „zkuste znovu“ (záporné číslo) prostě končí.
 */
async function zabratUlohou(sluzba: SupabaseClient, tenantId: string, posledniDotazMs: number, p: ProstrediChoice): Promise<boolean> {
  const nejdele = nejdeleCekat(posledniDotazMs, 'uloha', p)
  if (nejdele === null) return false
  let odpoved = await sluzba.rpc('rezervace_choice_zabrat_dotaz_ulohy', {
    p_rozestup_ms: ROZESTUP_DOTAZU_MS,
    p_nejdele_cekat_ms: nejdele,
  })
  if (odpoved.error && funkceNeexistuje(odpoved.error)) {
    odpoved = await sluzba.rpc('rezervace_choice_zabrat_dotaz', {
      p_tenant: tenantId,
      p_rozestup_ms: ROZESTUP_DOTAZU_MS,
      p_nejdele_cekat_ms: nejdele,
    })
  }
  if (odpoved.error) throw new ChybaFronty(funkceNeexistuje(odpoved.error))
  const z = vylozitFrontu(odpoved.data)
  if (z.stav !== 'zabrano') return false
  await pockat(z.cekatMs, p)
  return true
}

/** Kolik ms smí volající ve frontě čekat (strop podle toho, kdo se ptá); `null` = dotaz už odejít nesmí. */
function nejdeleCekat(posledniDotazMs: number, kdo: KdoSePta, p: ProstrediChoice): number | null {
  const nejdele = Math.floor(posledniDotazMs - p.ted())
  if (nejdele < 0) return null
  return Math.min(nejdele, kdo === 'uloha' ? NEJDELE_CEKA_ULOHA_MS : NEJDELE_CEKA_TLACITKO_MS)
}

type OdpovedFronty =
  | { stav: 'zabrano'; cekatMs: number }
  | { stav: 'znovu'; zaMs: number }
  | { stav: 'nic' }

/**
 * Odpověď fronty (migrace 20261102100000, „TVAR ODPOVĚDI“): `>= 0` =
 * zabráno, za kolik ms smí dotaz odejít; `<= -2` = nic, zkusit znovu za
 * |n| ms; `NULL` = nic, nezkoušet (databáze před tou migrací, úloha).
 * `-1` je u fronty nesmysl (patří jen odstupu „Ověřit znovu“, ten ho
 * vyřídí sám) — nesmysl z databáze = chyba fronty, ne „pošli hned“.
 */
function vylozitFrontu(data: unknown): OdpovedFronty {
  if (data === null || data === undefined) return { stav: 'nic' }
  const n = typeof data === 'number' ? data : NaN
  if (!Number.isInteger(n) || n === -1) throw new ChybaFronty(false)
  return n >= 0 ? { stav: 'zabrano', cekatMs: n } : { stav: 'znovu', zaMs: -n }
}

/** Tlačítko zkusí frontu podruhé jen jednou a jen když čekání na to nepřesáhne jeden rozestup. */
function zkusitZnovu(z: OdpovedFronty, pokus: number): z is { stav: 'znovu'; zaMs: number } {
  return z.stav === 'znovu' && pokus === 1 && z.zaMs <= NEJDELE_PRED_OPAKOVANIM_MS
}

/** Počká, za kolik ms smí dotaz podle fronty odejít. */
async function pockat(cekatMs: number, p: ProstrediChoice): Promise<void> {
  if (cekatMs > 0) await p.spat(cekatMs)
}

/** Chyby v datech: opakování nepomůže, dávka se zkusí po jedné a vadné rezervace se ohlásí. */
const CHYBY_DAT = new Set(['22001', '22003', '22007', '22008', '22P02', '22P05', '23514'])

function souhrnZDatabaze(data: unknown): Omit<SouhrnZapisu, 'odmitnute'> {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { nove: Number(d.nove ?? 0), zmenene: Number(d.zmenene ?? 0), bezeZmeny: Number(d.beze_zmeny ?? 0), zastarale: Number(d.zastarale ?? 0) }
}

/** Zápis stránky přes `public.rezervace_importovat_zdroj` — stejná pravidla jako CSV a příjmové API. */
export function zapisDoFoodtabu(sluzba: SupabaseClient, pripojeniId: string): ZapisChoice {
  const zavolat = (radky: RadekImportu[]) => sluzba.rpc('rezervace_importovat_zdroj', { p_pripojeni: pripojeniId, p_radky: radky })
  // Připojení mezitím odpojené nebo neověřené: to není vada rezervace.
  const pripojeniNeplati = (e: { code?: string; message?: string }) => e.code === 'P0002' || /ověřené/.test(e.message ?? '')

  return async (radky) => {
    const { data, error } = await zavolat(radky)
    if (!error) return { stav: 'ok', souhrn: { ...souhrnZDatabaze(data), odmitnute: [] } }
    if (pripojeniNeplati(error)) return { stav: 'chyba', duvod: 'Připojení Choice mezitím přestalo platit (odpojené nebo neověřené).' }
    if (!CHYBY_DAT.has(error.code ?? '')) return { stav: 'chyba', duvod: `Zápis rezervací do Foodtabu selhal (${error.code ?? 'neznámá chyba'}) — zkusí se příště.` }

    // Dávka je celá nebo nic — kvůli jedné vadné by se nezapsala žádná.
    const celkem: SouhrnZapisu = { nove: 0, zmenene: 0, bezeZmeny: 0, zastarale: 0, odmitnute: [] }
    for (const radek of radky) {
      const jedna = await zavolat([radek])
      if (jedna.error) {
        if (pripojeniNeplati(jedna.error)) return { stav: 'chyba', duvod: 'Připojení Choice mezitím přestalo platit (odpojené nebo neověřené).' }
        if (!CHYBY_DAT.has(jedna.error.code ?? '')) return { stav: 'chyba', duvod: `Zápis rezervací do Foodtabu selhal (${jedna.error.code ?? 'neznámá chyba'}) — zkusí se příště.` }
        celkem.odmitnute.push({ id: radek.externi_id, duvod: jedna.error.code ?? '' })
        continue
      }
      const s = souhrnZDatabaze(jedna.data)
      celkem.nove += s.nove
      celkem.zmenene += s.zmenene
      celkem.bezeZmeny += s.bezeZmeny
      celkem.zastarale += s.zastarale
    }
    return { stav: 'ok', souhrn: celkem }
  }
}

/* ---------------------------------------------------------------------
 * Živý test a „připojeno“
 * ------------------------------------------------------------------ */

export type VysledekTestu =
  | { stav: 'ok' }
  | { stav: 'chyba'; druh: ChybaChoice['druh'] | 'fronta' | 'cas'; duvod: string }

const BEZ_KLICE: VysledekTestu = { stav: 'chyba', druh: 'fronta', duvod: 'Server nemá nastavený přístup k databázi pro úlohy (SUPABASE_SERVICE_ROLE_KEY).' }
// Dotaz se do fronty nevešel: nic se nezabralo a odstup „Ověřit znovu“
// se nespotřeboval — zkusit to jde hned, jak se fronta uvolní.
const FRONTA_PLNA: VysledekTestu = {
  stav: 'chyba',
  druh: 'cas',
  duvod: 'Dotazy na Choice jdou jeden po druhém a Foodtab z Choice zrovna načítá, na volný dotaz by se čekalo déle — za chvíli klikněte na „Ověřit znovu“.',
}
const chybaFronty = (bezMigrace: boolean): VysledekTestu => ({
  stav: 'chyba',
  druh: 'fronta',
  duvod: bezMigrace ? 'Napojení Choice čeká na aktualizaci databáze (migrace 20261031100000).' : 'Fronta dotazů na Choice selhala — zkuste to znovu.',
})

/** Samotný živý test — volá se, až když má dotaz ve frontě zabraný čas a ten nastal. */
async function poslatTest(token: string, p: ProstrediChoice): Promise<VysledekTestu> {
  const r = await vytvoritChoice(p.fetch).nacistStranku(token, null)
  return r.stav === 'ok' ? { stav: 'ok' } : { stav: 'chyba', druh: r.druh, duvod: r.duvod }
}

/**
 * Živý test tokenu: `GET /bookings/list?page=1&perPage=1` — přes frontu,
 * jako každý jiný dotaz, za firmu připojení (`tenantId` z připojení
 * ověřeného volajícím). Volá ho callback po výměně kódu, až po
 * přihlášení a právu `integrace.manage` na pobočce („Ověřit znovu“ jde
 * přes `overitZnovu`). Ve frontě čeká JAKO TLAČÍTKO (nejvýš
 * `NEJDELE_CEKA_TLACITKO_MS`, jednou zkusí znovu) a dotaz odejde
 * nejpozději `REZERVA_DOTAZU_MS` před tvrdým koncem `konecMs`. Souběžné
 * testy jedné firmy si frontu nezaberou: firma má nejvýš jeden zabraný
 * dotaz tlačítka, další počkají na jeho odchod, nebo dostanou „zkuste
 * za chvíli“.
 */
export async function otestovatToken(token: string, tenantId: string, konecMs: number, p: ProstrediChoice = SKUTECNE): Promise<VysledekTestu> {
  const sluzba = klientUlohy()
  if (!sluzba) return BEZ_KLICE
  try {
    if (!(await cekatNaFrontu(sluzba, tenantId, konecMs - REZERVA_DOTAZU_MS, 'tlacitko', p)())) return FRONTA_PLNA
  } catch (e) {
    return chybaFronty(e instanceof ChybaFronty && e.bezMigrace)
  }
  return poslatTest(token, p)
}

/**
 * „Ověřit znovu“: odstup na připojení (nejvýš jednou za
 * `ODSTUP_OVERENI_MS`) a dotaz ve frontě JEDNÍM voláním databáze
 * (`rezervace_choice_zabrat_overeni`), pak živý test.
 *
 * Proč jedním voláním (nezávislé ověření 26. 10.): dřív se odstup zabral
 * zvlášť a před frontou. Když se pak dotaz do fronty nevešel, minuta
 * propadla bez jediného dotazu a další klik dostal „ověřovalo se před
 * chvílí“. Opačné pořadí (fronta, pak odstup) by zase zahozeným klikem
 * zabíralo frontu ostatním. Databáze proto obojí rozhodne naráz: kdo
 * je v odstupu, nic nezabere; kdo se nevejde do fronty, odstup
 * nespotřebuje.
 *
 * Když se dotaz do fronty nevejde, odstup se nespotřebuje a tlačítko
 * jednou počká (nejvýš `NEJDELE_PRED_OPAKOVANIM_MS`) a zavolá databázi
 * znovu — i s odstupem, takže souběžný klik mezitím vyhraje poctivě.
 *
 * `'brzy'` = ověřovalo se před chvílí — na frontu ani na Choice se
 * nesáhlo a u napojení se nic nezapisuje. Chyba databáze = žádný dotaz
 * na Choice (ne „otestovat bez odstupu“). `pripojeniId` a `tenantId`
 * jsou z připojení ověřeného volajícím (RLS a právo).
 */
export async function overitZnovu(
  token: string,
  tenantId: string,
  pripojeniId: string,
  konecMs: number,
  p: ProstrediChoice = SKUTECNE,
): Promise<VysledekTestu | 'brzy'> {
  const sluzba = klientUlohy()
  if (!sluzba) return BEZ_KLICE
  for (let pokus = 1; ; pokus++) {
    const nejdele = nejdeleCekat(konecMs - REZERVA_DOTAZU_MS, 'tlacitko', p)
    if (nejdele === null) return FRONTA_PLNA
    const { data, error } = await sluzba.rpc('rezervace_choice_zabrat_overeni', {
      p_pripojeni: pripojeniId,
      p_tenant: tenantId,
      p_odstup_ms: ODSTUP_OVERENI_MS,
      p_rozestup_ms: ROZESTUP_DOTAZU_MS,
      p_nejdele_cekat_ms: nejdele,
    })
    if (error) return chybaFronty(funkceNeexistuje(error))
    if (data === -1) return 'brzy'
    let z: OdpovedFronty
    try {
      z = vylozitFrontu(data)
    } catch {
      return chybaFronty(false)
    }
    if (z.stav === 'zabrano') {
      await pockat(z.cekatMs, p)
      return poslatTest(token, p)
    }
    if (!zkusitZnovu(z, pokus)) return FRONTA_PLNA
    await p.spat(z.zaMs)
  }
}

/**
 * Výsledek živého testu do registru — pod PŘIHLÁŠENÝM (RLS: integrace.manage).
 *
 * JEDINÉ místo v modulu, které zapisuje „připojeno“, a jen v téže změně
 * s `posledni_test_ok: true`. Odmítnutý přístup nebo nesmyslná odpověď =
 * „chyba“; dočasná nedostupnost, 429 a fronta stav nemění (připojené
 * připojení kvůli výpadku Choice nespadne), jen zapíšou důvod.
 */
export async function zapsatVysledekTestu(supabase: SupabaseClient, pripojeniId: string, test: VysledekTestu): Promise<boolean> {
  const ted = new Date().toISOString()
  let zmena: Record<string, unknown>
  if (test.stav === 'ok') {
    zmena = { stav: 'pripojeno', posledni_test_ok: true, posledni_test_kdy: ted, posledni_chyba: null }
  } else if (test.druh === 'pristup' || test.druh === 'data') {
    zmena = { stav: 'chyba', posledni_test_ok: false, posledni_test_kdy: ted, posledni_chyba: test.duvod }
  } else {
    zmena = { posledni_chyba: test.duvod }
  }
  const { data, error } = await supabase
    .from('integrace_pripojeni')
    .update(zmena)
    .eq('id', pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .select('id')
  return !error && (data ?? []).length === 1
}

/**
 * Je tentýž podnik Choice (varSymbol) připojený u jiné pobočky téže
 * firmy? Rezervace by se pak zapisovaly dvakrát. `service_role`, protože
 * přihlášený nemusí jiné pobočky vidět — vrací se jen ano/ne, firma je
 * z připojení ověřeného volajícím.
 */
export async function jinePripojeniTehozPodniku(tenantId: string, pripojeniId: string, varSymbol: string): Promise<boolean> {
  const sluzba = klientUlohy()
  if (!sluzba) return false
  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .neq('id', pripojeniId)
    .eq('externi_ucet->>var_symbol', varSymbol)
    .limit(1)
  return (data ?? []).length > 0
}

/* ---------------------------------------------------------------------
 * Načtení jednoho připojení
 * ------------------------------------------------------------------ */

export type VysledekSynchronizaceChoice = {
  stav: 'ok' | 'preskoceno' | 'chyba'
  /** Choice vrátil 429 — v tomhle běhu už další připojení nezkoušet. */
  omezeno: boolean
  /** Došel čas a zbytek se načte příště (není to chyba). */
  pokracovani: boolean
  dotazu: number
  nacteno: number
  duvod: string | null
  /**
   * Jen úloha s dílem (`dilMs`): do kdy smějí odcházet dotazy tohohle
   * připojení (`DilUlohy.konecMs`); `null`, když žádný dotaz neodešel.
   */
  konecDiluMs: number | null
}

type Pripojeni = { id: string; tenant_id: string; stav: string; externi_ucet: Record<string, unknown> | null }

async function zamknout(sluzba: SupabaseClient, p: Pripojeni, nejmeneOdMinulehoMs: number, ted: number): Promise<{ stav: 'ok'; behId: string } | { stav: 'preskoceno'; duvod: string }> {
  const { data: posledni } = await sluzba
    .from('synchronizace_behy')
    .select('id, stav, zahajeno_kdy')
    .eq('integrace_pripojeni_id', p.id)
    .order('zahajeno_kdy', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (posledni) {
    const stariMs = ted - new Date(posledni.zahajeno_kdy as string).getTime()
    if (posledni.stav === 'bezi') {
      if (stariMs < MINUT_NEZ_JE_BEH_ZASEKNUTY * 60_000) return { stav: 'preskoceno', duvod: 'Načítání z Choice už běží.' }
      // Zaseknutý běh (restart uprostřed) nesmí připojení zamknout navždy.
      await sluzba.from('synchronizace_behy').update({ stav: 'chyba', dokonceno_kdy: new Date(ted).toISOString(), chyba: 'timeout — běh se nedokončil' }).eq('id', posledni.id)
    } else if (stariMs < nejmeneOdMinulehoMs) {
      return { stav: 'preskoceno', duvod: 'Z Choice se načítalo před chvílí.' }
    }
  }

  const { data: beh, error } = await sluzba
    .from('synchronizace_behy')
    .insert({ tenant_id: p.tenant_id, integrace_pripojeni_id: p.id, stav: 'bezi' })
    .select('id')
    .single()
  if (error || !beh) return { stav: 'preskoceno', duvod: 'Načítání z Choice právě začalo jinde.' }
  return { stav: 'ok', behId: beh.id as string }
}

async function nacistToken(sluzba: SupabaseClient, pripojeniId: string): Promise<string | null> {
  const { data } = await sluzba.from('integrace_tajemstvi').select('sifra').eq('pripojeni_id', pripojeniId).maybeSingle()
  if (!data) return null
  try {
    const token = rozsifrovat(data.sifra as string).token
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

/**
 * Jeden běh načítání jednoho připojení Choice. `konecMs` = TVRDÝ konec
 * (kdy musí být všechno uložené); poslední dotaz smí odejít nejpozději
 * `konecMs - REZERVA_DOTAZU_MS`. Úloha s víc připojeními dá každému díl
 * času přes `posledniDotazMs` (rezervu odečetla jednou za celou úlohu).
 * `nejmeneOdMinulehoMs`: „Načíst teď“ nepustí nový běh hned po předchozím.
 * `uloha: true` předává JEN naplánovaná úloha — jde do fronty vlastním
 * vstupem bez pravidla firmy a smí čekat celý svůj díl času. Bez něj
 * (Načíst teď, první načtení po připojení) se čeká jako tlačítko: nejvýš
 * dva rozestupy (`NEJDELE_CEKA_TLACITKO_MS`) a jednou znovu, takže se
 * běh střídá s jiným během téže firmy, místo aby skončil.
 * `dilMs` (jen s `uloha: true`): díl času připojení, který se počítá až
 * od odchodu jeho prvního dotazu (`DilUlohy`, `konecDiluUlohy`);
 * `posledniDotazMs` je pak konec celé úlohy. Do kdy díl doopravdy sahá,
 * vrací `konecDiluMs`.
 */
export async function synchronizovatChoice(
  pripojeniId: string,
  moznosti: { konecMs: number; posledniDotazMs?: number; dilMs?: number; nejmeneOdMinulehoMs?: number; uloha?: boolean; prostredi?: ProstrediChoice },
): Promise<VysledekSynchronizaceChoice> {
  const p = moznosti.prostredi ?? SKUTECNE
  const dil: DilUlohy | undefined = moznosti.uloha === true && moznosti.dilMs !== undefined ? { ms: moznosti.dilMs, konecMs: null } : undefined
  const vysledek = (stav: VysledekSynchronizaceChoice['stav'], duvod: string | null, x: Partial<VysledekSynchronizaceChoice> = {}): VysledekSynchronizaceChoice =>
    ({ stav, duvod, omezeno: false, pokracovani: false, dotazu: 0, nacteno: 0, konecDiluMs: dil?.konecMs ?? null, ...x })

  const sluzba = klientUlohy()
  if (!sluzba) return vysledek('chyba', 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.')

  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id, tenant_id, stav, externi_ucet')
    .eq('id', pripojeniId)
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .is('odpojeno_kdy', null)
    .maybeSingle()
  const pripojeni = data as Pripojeni | null
  if (!pripojeni) return vysledek('chyba', 'Připojení Choice neexistuje nebo je odpojené.')
  if (pripojeni.stav !== 'pripojeno') return vysledek('preskoceno', 'Připojení Choice není ověřené.')

  const zamek = await zamknout(sluzba, pripojeni, moznosti.nejmeneOdMinulehoMs ?? 0, p.ted())
  if (zamek.stav === 'preskoceno') return vysledek('preskoceno', zamek.duvod)

  const ucet = pripojeni.externi_ucet ?? {}
  const varSymbol = typeof ucet.var_symbol === 'string' ? ucet.var_symbol : ''
  const dokoncit = async (stav: 'hotovo' | 'chyba', chyba: string | null, novych: number | null) => {
    await sluzba.from('synchronizace_behy').update({
      stav,
      dokonceno_kdy: new Date(p.ted()).toISOString(),
      pocet_novych_radku: novych,
      chyba,
    }).eq('id', zamek.behId)
  }

  const token = await nacistToken(sluzba, pripojeni.id)
  if (!token || !varSymbol) {
    const duvod = 'Token k Choice chybí nebo nejde rozšifrovat — připojte podnik znovu.'
    await sluzba.from('integrace_pripojeni').update({ stav: 'vyzaduje_pozornost', posledni_test_ok: false, posledni_chyba: duvod }).eq('id', pripojeni.id).is('odpojeno_kdy', null)
    await dokoncit('chyba', duvod, 0)
    return vysledek('chyba', duvod)
  }

  let beh
  try {
    beh = await probehnoutChoice({
      api: vytvoritChoice(p.fetch),
      token,
      varSymbol,
      kurzor: precistKurzor(ucet.kurzor),
      tedMs: p.ted(),
      pockatNaDotaz: cekatNaFrontu(
        sluzba,
        pripojeni.tenant_id,
        Math.min(moznosti.konecMs - REZERVA_DOTAZU_MS, moznosti.posledniDotazMs ?? Infinity),
        moznosti.uloha === true ? 'uloha' : 'tlacitko',
        p,
        dil,
      ),
      zapsat: zapisDoFoodtabu(sluzba, pripojeni.id),
    })
  } catch (e) {
    const duvod = e instanceof ChybaFronty && e.bezMigrace
      ? 'Napojení Choice čeká na aktualizaci databáze (migrace 20261031100000) — nic se nenačetlo.'
      : 'Načítání z Choice spadlo — zkusí se příště.'
    if (!(e instanceof ChybaFronty)) console.error('[rezervace-choice] běh spadl:', e instanceof Error ? e.name : typeof e)
    await sluzba.from('integrace_pripojeni').update({ posledni_chyba: duvod }).eq('id', pripojeni.id).is('odpojeno_kdy', null)
    await dokoncit('chyba', duvod, 0)
    return vysledek('chyba', duvod)
  }

  const chyba = chybaBehu(beh)
  const zmena: Record<string, unknown> = {
    externi_ucet: { ...ucet, kurzor: beh.kurzor },
    posledni_chyba: chyba,
  }
  if (beh.uspesnych > 0) {
    zmena.posledni_sync_kdy = new Date(p.ted()).toISOString()
    zmena.posledni_sync_pocet_radku = beh.nacteno
  }
  if (beh.konec === 'pristup') {
    zmena.stav = 'vyzaduje_pozornost'
    zmena.posledni_test_ok = false
  }
  // Jen dokud jde o tentýž podnik — připojení mezitím připojené znovu
  // (jiný varSymbol) nebo odpojené se nepřepíše starým kurzorem.
  await sluzba
    .from('integrace_pripojeni')
    .update(zmena)
    .eq('id', pripojeni.id)
    .is('odpojeno_kdy', null)
    .eq('externi_ucet->>var_symbol', varSymbol)

  const selhalo = beh.konec === 'limit' || beh.konec === 'pristup' || beh.konec === 'chyba'
  // Běh, který se na Choice ani jednou nezeptal (do fronty se nevešel),
  // zapíše počet nových řádků PRÁZDNÝ. Pořadí úlohy
  // (`choiceKSynchronizaci`) ho pak nepočítá — jinak by „Načíst teď“,
  // které nic nenačetlo, odsunulo připojení na konec, jako by se právě
  // načetlo. Minutový odstup „Načíst teď“ (`zamknout`) ho počítá dál.
  await dokoncit(selhalo ? 'chyba' : 'hotovo', chyba, beh.dotazu > 0 ? beh.nove : null)
  return vysledek(selhalo ? 'chyba' : 'ok', chyba, {
    omezeno: beh.konec === 'limit',
    pokracovani: beh.konec === 'cas',
    dotazu: beh.dotazu,
    nacteno: beh.nacteno,
  })
}

/**
 * Ověřená připojení Choice k načtení v pořadí pro úlohu
 * (`poradiSynchronizace`: firmy se střídají, nejdéle nenačtené první,
 * tentýž podnik u firmy jen jednou). Poslední běh se bere ze
 * `synchronizace_behy` (píše jen server), ne z `posledni_sync_kdy`
 * v registru, který může přepsat i správce napojení.
 *
 * Počítají se jen DOKONČENÉ běhy, které se na Choice zeptaly (vyplněný
 * `pocet_novych_radku`, viz `synchronizovatChoice`). Běh bez jediného
 * dotazu (fronta byla plná) připojení neodsune; běžící běh taky ne —
 * úloha ho pak hned přeskočí („už běží“), čas jí to nevezme.
 */
export async function choiceKSynchronizaci(): Promise<string[]> {
  const sluzba = klientUlohy()
  if (!sluzba) return []
  const { data } = await sluzba
    .from('integrace_pripojeni')
    .select('id, tenant_id, externi_ucet, vytvoreno_kdy')
    .eq('oblast', 'rezervace')
    .eq('poskytovatel', KLIC_CHOICE)
    .eq('stav', 'pripojeno')
    .is('odpojeno_kdy', null)
  const radky = (data ?? []) as { id: string; tenant_id: string; externi_ucet: Record<string, unknown> | null; vytvoreno_kdy: string | null }[]

  // Po jednom dotazu na připojení (index synchronizace_behy_pripojeni);
  // připojení Choice je v instalaci pár.
  const kandidati = await Promise.all(radky.map(async (r) => {
    const { data: beh } = await sluzba
      .from('synchronizace_behy')
      .select('zahajeno_kdy')
      .eq('integrace_pripojeni_id', r.id)
      .not('pocet_novych_radku', 'is', null)
      .order('zahajeno_kdy', { ascending: false })
      .limit(1)
      .maybeSingle()
    const vs = r.externi_ucet?.var_symbol
    return {
      id: r.id,
      tenantId: r.tenant_id,
      varSymbol: typeof vs === 'string' ? vs : '',
      zalozeno: r.vytvoreno_kdy,
      posledniBeh: (beh?.zahajeno_kdy as string | undefined) ?? null,
    }
  }))
  return poradiSynchronizace(kandidati)
}
