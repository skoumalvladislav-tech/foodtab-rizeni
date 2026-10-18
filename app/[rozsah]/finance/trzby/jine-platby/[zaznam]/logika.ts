/**
 * Jiné platby — detail záznamu: čistá logika obrazovky a serverových akcí.
 *
 * Žádná síť, databáze ani React. Proto tu jsou věci, které se musí dát
 * vyzkoušet bez serveru (scripts/jine-platby-detail.test.mjs):
 *
 *   * převod formuláře návrhu na `HlavickaNavrhu` + `PolozkaNavrhu[]`
 *     (nejasná hodnota = chyba u pole, nic se nedomýšlí);
 *   * vyhodnocení kontroly proti pokladně (tržba, sklad) z účtů, které
 *     pokladna vrátila — co je „nalezeno“, co jen „pravděpodobně“ a kdy
 *     „nenalezeno“ opravdu něco dokazuje;
 *   * převod řádku `pos_operace` a dohledání účtu na tvary orchestrátoru
 *     (lib/jine-platby-pos-operace.ts);
 *   * české hlášky chyb z databáze a popisky pro obrazovku.
 *
 * Importy s příponou `.ts` a relativní cestou (ne `@/`): soubor načítá
 * přímo Node v testu i prohlížeč v klientské komponentě editoru.
 */

import type {
  DruhPolozky,
  HlavickaNavrhu,
  PolozkaNavrhu,
  PuvodCastky,
  TypDokladu,
  VysledekKontrolySkladu,
  VysledekKontrolyTrzby,
  ZdrojKontroly,
} from '../../../../../../lib/jine-platby-typy.ts'
import { DRUHY_BEZ_SKLADU, DRUHY_POLOZEK, TYPY_DOKLADU } from '../../../../../../lib/jine-platby-typy.ts'
import { formatHaleru, prevestCastku, prevestMnozstvi } from '../../../../../../lib/jine-platby-castky.ts'
import {
  platneDatum,
  potvrditRadek,
  rozdelitDuvody,
  soucetPolozek,
  spojitDuvody,
  zkontrolovatNavrh,
  type Nesoulad,
} from '../../../../../../lib/jine-platby-kontrola.ts'
import { prepocitatPosMnozstvi, type ProduktKatalogu } from '../../../../../../lib/jine-platby-mapovani.ts'
import { normalizovatUcet } from '../../../../../../lib/jine-platby-duplicity.ts'
import { STAVY_OPERACE, type OperacePos, type StavOperace, type VysledekDohledani } from '../../../../../../lib/jine-platby-pos-operace.ts'
import { oknoProvoznihoDne, posunoutDen } from '../../../../../../lib/pokladna-cas.ts'
import type { UcetPos } from '../../../../../../lib/pos-provider-contract.ts'

/* ------------------------------------------------------------------ */
/* Výsledek serverové akce                                              */
/* ------------------------------------------------------------------ */

/**
 * Stav formuláře s `useActionState`. `chyby` = hlášky u konkrétních polí
 * (klíč = `name` pole), jen u formuláře návrhu.
 */
export type StavAkce = { stav: 'nic' | 'ok' | 'chyba'; text: string; chyby?: Record<string, string> }

export const KLID: StavAkce = { stav: 'nic', text: '' }

export const HLASKA_VERZE = 'Záznam mezitím upravil někdo jiný, načtěte ho znovu.'
export const HLASKA_PRAVO = 'Na tohle nemáte oprávnění.'
export const HLASKA_OBECNA = 'Akce se nepodařila. Zkuste to prosím znovu.'
export const HLASKA_NENALEZENO = 'Záznam se nenašel.'
export const HLASKA_BEZ_AI = 'Rozpoznání přes AI není zapnuté — zadejte položky ručně.'
export const HLASKA_BEZ_DOHLEDANI = 'Pokladna dohledání účtů neumí — použijte ruční prohlášení s důvodem.'
/**
 * Bankovní platby (`transakce`) a Kontakty pustí RLS jen s finančním
 * přehledem ZA CELOU FIRMU (`has_access(…, 'finance.read', null)`) —
 * stejné pravidlo jako vstup do Financí na pobočce (zkusPristupFinanci).
 */
export const HLASKA_BEZ_FINANCI_FIRMY = 'Bankovní platby a Kontakty vidí jen finanční přehled celé firmy — zadejte číslo faktury ručně.'

/** Nejvýš položek v jednom návrhu (stejně jako formulář a `jine_platby_ulozit_navrh`). */
export const MAX_POLOZEK_NAVRHU = 200

/** Hláška databáze o možné duplicitě (`jine_platby_potvrdit_trzbu`, `jine_platby_rozhodnout_vydej`) — chce důvod. */
export function jeHlaskaDuplicity(text: string): boolean {
  return /^Možná duplicita/.test(text.trim())
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function jeUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * Chyba databázové funkce → česká hláška pro člověka.
 *
 *   40001  verze nesedí (optimistický zámek)
 *   23514  obchodní pravidlo — funkce `jine_platby_*` hlásí česky, smí se ukázat
 *   42501  bez práva
 *   P0002  záznam nenalezen nebo cizí
 *   23505  duplicita (soubor, prodej v pokladně) — česky jen z našich funkcí;
 *          hláška unikátního indexu („duplicate key…“) nese jména tabulek
 *
 * Cokoli jiného: obecná hláška BEZ detailu (může nést názvy tabulek a sloupců).
 */
export function textChybyDb(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const kod = e?.code ?? ''
  const zprava = typeof e?.message === 'string' ? e.message.trim() : ''
  if (kod === '40001') return HLASKA_VERZE
  if (kod === '23514') return zprava !== '' ? zprava : HLASKA_OBECNA
  if (kod === '42501') return HLASKA_PRAVO
  if (kod === 'P0002') return HLASKA_NENALEZENO
  if (kod === '23505') {
    if (zprava === '' || /duplicate key|constraint|violates/i.test(zprava)) return 'Tohle už je propojené u jiného záznamu.'
    return zprava
  }
  return HLASKA_OBECNA
}

/* ------------------------------------------------------------------ */
/* Formulář                                                             */
/* ------------------------------------------------------------------ */

/** Co z formuláře čteme — `FormData` v aplikaci, prostý objekt v testu. */
export type VstupFormulare = { get(nazev: string): string | null; getAll(nazev: string): string[] }

export function zFormData(fd: FormData): VstupFormulare {
  return {
    get: (n) => {
      const v = fd.get(n)
      return typeof v === 'string' ? v : null
    },
    getAll: (n) => fd.getAll(n).filter((v): v is string => typeof v === 'string'),
  }
}

/** Text pole bez okrajových mezer; chybějící pole = ''. */
export function pole(f: VstupFormulare, nazev: string): string {
  return (f.get(nazev) ?? '').trim()
}

/** Verze záznamu z formuláře (optimistický zámek). `null` = chybí nebo nesmysl. */
export function verzeZFormulare(f: VstupFormulare): number | null {
  const s = pole(f, 'verze')
  if (!/^\d{1,9}$/.test(s)) return null
  const v = Number(s)
  return v >= 1 ? v : null
}

/** Klíč řádku položky ve formuláři (`radek`) — jen písmena a číslice. */
const KLIC_RADKU = /^[a-z0-9]{1,20}$/i

export type PolozkaSId = PolozkaNavrhu & { id: string }

export type VysledekNavrhu =
  | {
      stav: 'ok'
      hlavicka: HlavickaNavrhu
      polozky: PolozkaNavrhu[]
      /** Člověk zaškrtl „zapamatovat přiřazení“ — `jine_platby_ulozit_mapovani`. */
      zapamatovat: { alias: string; posProduktId: string }[]
      /** Co po uložení zůstává ke kontrole (zkontrolovatNavrh). */
      duvody: string[]
    }
  | { stav: 'chyba'; text: string; chyby: Record<string, string> }

const prazdnaPolozka = (): PolozkaNavrhu => ({
  nazevPuvodni: '',
  nazev: '',
  mnozstvi: null,
  jednotka: null,
  cenaJednotkovaHaleru: null,
  cenaCelkemHaleru: null,
  sazbaDph: null,
  jistota: null,
  zdroj: 'rucne',
  druh: 'nezarazeno',
  posProduktId: null,
  posProduktNazev: null,
  posMnozstvi: null,
  mapovani: 'nenamapovano',
  vyzadujeKontrolu: false,
  duvodKontroly: '',
})

/** Sazba DPH z políčka („21“, „12,5“, „21 %“) → text pro numeric(5,2), nebo chyba. */
function prevestSazbu(text: string): { stav: 'ok'; sazba: string | null } | { stav: 'chyba'; duvod: string } {
  const s = text.replace(/[%\s ]/g, '').replace(',', '.')
  if (s === '') return { stav: 'ok', sazba: null }
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return { stav: 'chyba', duvod: 'Sazba DPH musí být číslo v procentech (21, 12…)' }
  const des = (m[2] ?? '').replace(/0+$/, '')
  const cele = String(Number(m[1]))
  if (Number(m[1]) > 100) return { stav: 'chyba', duvod: 'Sazba DPH nemůže být víc než 100 %' }
  return { stav: 'ok', sazba: des === '' ? cele : `${cele}.${des}` }
}

/**
 * Formulář návrhu (hlavička + položky) → data pro `jine_platby_ulozit_navrh`.
 *
 * Co se z formuláře NEBERE (vezme se z databáze, `puvodni`): název
 * z dokladu, jistota a zdroj řádku (ai/ručně) a důvody ke kontrole ze
 * čtení dokladu. Formulář nese jen `id` existujícího řádku — kdo by
 * poslal cizí nebo vymyšlené id, dostane nový ruční řádek.
 *
 * Přiřazení k pokladně:
 *   * druh bez skladu → 'neskladova', bez produktu;
 *   * bez produktu → 'nenamapovano';
 *   * produkt ZMĚNĚNÝ člověkem, nebo zaškrtnuté „přiřazení ověřeno“ → 'overeno'
 *     (ověřené přiřazení dělá jen člověk, lib/jine-platby-mapovani.ts);
 *   * jinak původní stav ('navrh' zůstane návrhem).
 *   Množství pro pokladnu se přepočítá z katalogu (`prepocitatPosMnozstvi`).
 *
 * Původ celkové částky: beze změny proti záznamu = původní původ;
 * „vypočtený součet“ jen když částka opravdu sedí se součtem položek;
 * jinak „ručně“. Prohlížeč „z dokladu“ nevyrobí.
 */
export function nacistNavrh(
  f: VstupFormulare,
  kontext: {
    zaznam: { castkaHaleru: number | null; castkaPuvod: PuvodCastky | null; kontaktId: string | null }
    puvodni: readonly PolozkaSId[]
    katalog: readonly ProduktKatalogu[]
  },
): VysledekNavrhu {
  const chyby: Record<string, string> = {}

  // --- Hlavička ---
  const datumText = pole(f, 'datum')
  let datumProdeje: string | null = null
  if (datumText !== '') {
    if (platneDatum(datumText)) datumProdeje = datumText
    else chyby.datum = 'Datum musí být platný den (RRRR-MM-DD).'
  }

  const oznaceni = pole(f, 'oznaceni')
  if (oznaceni.length > 200) chyby.oznaceni = 'Označení může mít nejvýš 200 znaků.'

  const menaText = pole(f, 'mena').toUpperCase()
  let mena: string | null = null
  if (menaText !== '') {
    if (/^[A-Z]{3}$/.test(menaText)) mena = menaText
    else chyby.mena = 'Měna musí být třípísmenný kód (CZK, EUR…).'
  }

  let castkaHaleru: number | null = null
  const castka = prevestCastku(f.get('castka'))
  if (castka.stav === 'nejasne') chyby.castka = castka.duvod
  else if (castka.stav === 'ok') {
    if (castka.haleru < 0) chyby.castka = 'Celková cena prodeje nesmí být záporná.'
    else castkaHaleru = castka.haleru
  }

  const typText = pole(f, 'typ')
  let typDokladu: TypDokladu = 'nezjisteno'
  if (typText !== '') {
    if ((TYPY_DOKLADU as readonly string[]).includes(typText)) typDokladu = typText as TypDokladu
    else chyby.typ = 'Neznámý typ dokladu.'
  }

  const externi = pole(f, 'externi')
  if (externi.length > 100) chyby.externi = 'Číslo účtu může mít nejvýš 100 znaků.'

  // Odběratel: pole chybí (kontakty nevidí) = beze změny; prázdné = žádný.
  let kontaktId = kontext.zaznam.kontaktId
  const kontaktPole = f.get('kontakt')
  if (kontaktPole !== null) {
    const k = kontaktPole.trim()
    if (k === '') kontaktId = null
    else if (jeUuid(k)) kontaktId = k
    else chyby.kontakt = 'Vybraný odběratel není platný.'
  }

  // --- Položky ---
  const klice = [...new Set(f.getAll('radek').map((k) => k.trim()))]
  if (klice.some((k) => !KLIC_RADKU.test(k))) chyby.radky = 'Formulář je poškozený — načtěte stránku znovu.'
  if (klice.length > MAX_POLOZEK_NAVRHU) chyby.radky = `Návrh může mít nejvýš ${MAX_POLOZEK_NAVRHU} položek.`

  const podleId = new Map(kontext.puvodni.map((p) => [p.id, p]))
  const katalog = kontext.katalog.filter((k) => !k.smazano)
  const polozky: PolozkaNavrhu[] = []
  const potvrdit: boolean[] = []
  const zapamatovat: { alias: string; posProduktId: string }[] = []

  for (const k of klice.filter((x) => KLIC_RADKU.test(x))) {
    const p = (n: string) => `p_${k}_${n}`
    const id = pole(f, p('id'))
    const puvodni = jeUuid(id) ? podleId.get(id) : undefined
    const zaklad: PolozkaNavrhu = puvodni ? stripId(puvodni) : prazdnaPolozka()

    const nazev = pole(f, p('nazev'))
    if (nazev === '') chyby[p('nazev')] = 'Napište název položky.'
    else if (nazev.length > 300) chyby[p('nazev')] = 'Název může mít nejvýš 300 znaků.'

    let mnozstvi: string | null = null
    const m = prevestMnozstvi(f.get(p('mnozstvi')))
    if (m.stav === 'nejasne') chyby[p('mnozstvi')] = m.duvod
    else if (m.stav === 'ok') mnozstvi = m.mnozstvi

    const jednotkaText = pole(f, p('jednotka'))
    if (jednotkaText.length > 20) chyby[p('jednotka')] = 'Jednotka může mít nejvýš 20 znaků.'
    const jednotka = jednotkaText === '' ? null : jednotkaText

    const cenaJ = prevestCastku(f.get(p('cena_j')))
    if (cenaJ.stav === 'nejasne') chyby[p('cena_j')] = cenaJ.duvod
    const cenaC = prevestCastku(f.get(p('cena_c')))
    if (cenaC.stav === 'nejasne') chyby[p('cena_c')] = cenaC.duvod

    const dph = prevestSazbu(pole(f, p('dph')))
    if (dph.stav === 'chyba') chyby[p('dph')] = dph.duvod

    const druhText = pole(f, p('druh')) || 'nezarazeno'
    const druh: DruhPolozky = (DRUHY_POLOZEK as readonly string[]).includes(druhText) ? (druhText as DruhPolozky) : 'nezarazeno'
    if (druh !== druhText) chyby[p('druh')] = 'Neznámý druh položky.'

    let radek: PolozkaNavrhu = {
      ...zaklad,
      nazev,
      mnozstvi,
      jednotka,
      cenaJednotkovaHaleru: cenaJ.stav === 'ok' ? cenaJ.haleru : null,
      cenaCelkemHaleru: cenaC.stav === 'ok' ? cenaC.haleru : null,
      sazbaDph: dph.stav === 'ok' ? dph.sazba : null,
      druh,
    }

    // Přiřazení k produktu pokladny.
    const produktId = pole(f, p('produkt'))
    const overit = f.get(p('overit')) === 'ano'
    if (DRUHY_BEZ_SKLADU.includes(druh)) {
      radek = { ...radek, posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'neskladova' }
    } else if (produktId === '') {
      radek = { ...radek, posProduktId: null, posProduktNazev: null, posMnozstvi: null, mapovani: 'nenamapovano' }
    } else {
      const produkt = katalog.find((x) => x.externiId === produktId)
      const zmeneno = produktId !== zaklad.posProduktId
      if (!produkt) {
        // Pokladna bez katalogu: produkt beze změny se nechá, jak byl (nic se nepřepočítá).
        if (katalog.length === 0 && !zmeneno) {
          radek = { ...radek, mapovani: overit ? 'overeno' : zaklad.mapovani }
        } else {
          chyby[p('produkt')] = 'Vybraný produkt v katalogu pokladny není.'
        }
      } else {
        const mapovani = zmeneno || overit ? 'overeno' : zaklad.mapovani === 'overeno' ? 'overeno' : 'navrh'
        radek = prepocitatPosMnozstvi({ ...radek, posProduktId: produkt.externiId, posProduktNazev: produkt.nazev, mapovani }, katalog)
        if (f.get(p('zapamatovat')) === 'ano') {
          // Náhradní název nečitelného řádku („Položka č. 3 (název nečitelný)“) se jako alias nepamatuje.
          const alias = (zaklad.nazevPuvodni.trim() || nazev).slice(0, 300)
          if (alias !== '' && !jeNahradniNazev(alias)) zapamatovat.push({ alias, posProduktId: produkt.externiId })
        }
      }
    }

    polozky.push(radek)
    potvrdit.push(f.get(p('potvrdit')) === 'ano')
  }

  if (Object.keys(chyby).length > 0) {
    return { stav: 'chyba', text: 'Některá pole nejdou přečíst — opravte je (jsou označená u pole). Nic se neuložilo.', chyby }
  }

  const zakladHlavicky: HlavickaNavrhu = {
    datumProdeje,
    oznaceni,
    mena,
    castkaHaleru,
    castkaPuvod: null,
    typDokladu,
    externiUcet: externi === '' ? null : externi,
    kontaktId,
  }

  // Přepočet příznaků (věcné problémy, převod do jednotek pokladny); potvrzené
  // řádky přijdou o důvody ze čtení dokladu, věcné problémy zůstanou.
  const kontrola = zkontrolovatNavrh(polozky, zakladHlavicky)
  const hotove = kontrola.polozky.map((r, i) => (potvrdit[i] ? potvrditRadek(r, mena) : r))

  let castkaPuvod: PuvodCastky | null = null
  if (castkaHaleru !== null) {
    const chceVypocet = pole(f, 'castka_puvod') === 'vypocet'
    const soucet = soucetPolozek(hotove)
    if (chceVypocet && soucet !== null && soucet === castkaHaleru) castkaPuvod = 'vypocet'
    else if (castkaHaleru === kontext.zaznam.castkaHaleru && kontext.zaznam.castkaPuvod !== null) castkaPuvod = kontext.zaznam.castkaPuvod
    else castkaPuvod = 'rucne'
  }

  return {
    stav: 'ok',
    hlavicka: { ...zakladHlavicky, castkaPuvod },
    polozky: hotove,
    zapamatovat,
    duvody: kontrola.duvody,
  }
}

function stripId(p: PolozkaSId): PolozkaNavrhu {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...bez } = p
  return bez
}

/* ------------------------------------------------------------------ */
/* Co zkontrolovat před „Označit jako zkontrolované“                    */
/* ------------------------------------------------------------------ */

/**
 * `ano`         označení BLOKUJE (databáze ho odmítne);
 * `bez_duvodu`  blokuje, dokud člověk nenapíše, proč to nevadí (nesoulad součtu);
 * `ne`          jen upozornění — označení nebrání.
 */
export type BodKontroly = { text: string; blokuje: 'ano' | 'bez_duvodu' | 'ne' }

const MAX_RADKU_V_PREHLEDU = 10
const HLAVICKA_CHYBI = ['Chybí datum prodeje (provozní den)', 'Chybí měna', 'Chybí celková cena prodeje']

/**
 * Co v uloženém návrhu zkontrolovat a co z toho „Označit jako
 * zkontrolované“ BLOKUJE. Zrcadlí `jine_platby_oznacit_zkontrolovano`:
 *
 *   blokuje     chybí datum, měna nebo celková cena; řádek s příznakem
 *               ke kontrole (`vyzaduje_kontrolu` tak, jak je ULOŽENÝ —
 *               databáze se ptá na uložené řádky);
 *   bez důvodu  součet položek nesedí s celkovou cenou (zkontrolovatNavrh) —
 *               projde jen s `p_duvod_rozdilu` („Proč rozdíl nevadí“);
 *   upozornění  všechno ostatní, co zkontrolovatNavrh hlásí.
 *
 * `nesoulad` ≠ null → formulář ukáže povinné pole „Proč rozdíl nevadí“.
 */
export function coZkontrolovat(polozky: readonly PolozkaNavrhu[], hlavicka: HlavickaNavrhu): { body: BodKontroly[]; nesoulad: Nesoulad | null } {
  const k = zkontrolovatNavrh(polozky, hlavicka)
  const body: BodKontroly[] = []
  if (hlavicka.datumProdeje === null) body.push({ text: HLAVICKA_CHYBI[0], blokuje: 'ano' })
  if (hlavicka.mena === null) body.push({ text: HLAVICKA_CHYBI[1], blokuje: 'ano' })
  if (hlavicka.castkaHaleru === null) body.push({ text: HLAVICKA_CHYBI[2], blokuje: 'ano' })

  const sPriznakem = polozky.map((p, i) => ({ p, cislo: i + 1 })).filter(({ p }) => p.vyzadujeKontrolu)
  for (const { p, cislo } of sPriznakem.slice(0, MAX_RADKU_V_PREHLEDU)) {
    const nazev = p.nazev.trim() ? ` „${p.nazev.trim().slice(0, 60)}“` : ''
    body.push({ text: `Položka ${cislo}${nazev}: ${p.duvodKontroly.trim() || 'označena ke kontrole'} — ověřte ji (zaškrtnutí u řádku) nebo opravte`, blokuje: 'ano' })
  }
  if (sPriznakem.length > MAX_RADKU_V_PREHLEDU) {
    body.push({ text: `… a dalších ${sPriznakem.length - MAX_RADKU_V_PREHLEDU} položek s příznakem ke kontrole`, blokuje: 'ano' })
  }

  if (k.nesoulad) body.push({ text: k.nesoulad.popis, blokuje: 'bez_duvodu' })
  for (const d of k.duvody) {
    if (HLAVICKA_CHYBI.includes(d) || d === k.nesoulad?.popis) continue
    body.push({ text: d, blokuje: 'ne' })
  }
  return { body, nesoulad: k.nesoulad }
}

/* ------------------------------------------------------------------ */
/* Rozpoznání přes AI: výběr souborů a nečitelné názvy                  */
/* ------------------------------------------------------------------ */

export type LimityAi = { maxSouboru: number; maxObrazek: number; maxPdf: number; maxCelkem: number }

const MB = 1024 * 1024
const mb = (b: number) => String(Math.round((b / MB) * 10) / 10).replace('.', ',')

/**
 * Které soubory jdou do jednoho rozpoznání — PO POŘADÍ (stránky jedné
 * sjetiny), podle velikosti uložené u souboru:
 *   * fotka nad `maxObrazek` a PDF nad `maxPdf` se přeskočí (řekne se které);
 *   * bere se, dokud součet nepřekročí `maxCelkem` a počet `maxSouboru` —
 *     první soubor, který by strop překročil, výběr UKONČÍ (zbytek se
 *     nepřeskakuje na menší soubory dál, ať AI nedostane stránky s dírou).
 * Skutečné bajty po stažení ověří ještě `zkontrolovatPodklad`.
 */
export function vybratSouboryProAi<T extends { poradi: number; mime: string; velikost: number }>(
  soubory: readonly T[],
  l: LimityAi,
): { vybrane: T[]; preskocene: { poradi: number; duvod: string }[] } {
  const vybrane: T[] = []
  const preskocene: { poradi: number; duvod: string }[] = []
  let celkem = 0
  let konec: string | null = null
  for (const s of soubory) {
    if (konec) {
      preskocene.push({ poradi: s.poradi, duvod: konec })
      continue
    }
    const pdf = s.mime === 'application/pdf'
    const obrazek = s.mime.startsWith('image/')
    if (!pdf && !obrazek) {
      preskocene.push({ poradi: s.poradi, duvod: 'není fotka ani PDF' })
      continue
    }
    const strop = pdf ? l.maxPdf : l.maxObrazek
    if (!(s.velikost > 0) || s.velikost > strop) {
      preskocene.push({ poradi: s.poradi, duvod: `${pdf ? 'PDF' : 'fotka'} nad ${mb(strop)} MB` })
      continue
    }
    if (vybrane.length >= l.maxSouboru) konec = `najednou jde nejvýš ${l.maxSouboru} souborů`
    else if (celkem + s.velikost > l.maxCelkem) konec = `dohromady by soubory překročily ${mb(l.maxCelkem)} MB`
    if (konec) {
      preskocene.push({ poradi: s.poradi, duvod: konec })
      continue
    }
    vybrane.push(s)
    celkem += s.velikost
  }
  return { vybrane, preskocene }
}

/** Věta „Do rozpoznání nešly: č. 3 (fotka nad 5 MB), č. 7 (…)“; prázdný seznam → ''. */
export function popisPreskocenych(preskocene: readonly { poradi: number; duvod: string }[]): string {
  if (preskocene.length === 0) return ''
  return `Do rozpoznání nešly soubory: ${preskocene.map((p) => `č. ${p.poradi} (${p.duvod})`).join(', ')}.`
}

export const DUVOD_NECITELNY_NAZEV = 'Název položky na dokladu nejde přečíst — doplňte ho podle dokladu'
const NAHRADNI_NAZEV = /^Položka č\. \d+ \(název nečitelný\)$/

export function jeNahradniNazev(s: string): boolean {
  return NAHRADNI_NAZEV.test(s.trim())
}

/**
 * Řádek, jehož název AI nepřečetla: „Položka č. N (název nečitelný)“,
 * název z dokladu zůstane prázdný a řádek jde ke kontrole s důvodem,
 * který uložením nezmizí (věcné „Chybí název položky“ by po přepočtu
 * zmizelo, protože náhradní název prázdný není). Nic se nedomýšlí.
 */
export function doplnitNecitelneNazvy(polozky: readonly PolozkaNavrhu[]): PolozkaNavrhu[] {
  return polozky.map((p, i) =>
    p.nazev.trim() !== ''
      ? p
      : {
          ...p,
          nazev: `Položka č. ${i + 1} (název nečitelný)`,
          nazevPuvodni: '',
          vyzadujeKontrolu: true,
          duvodKontroly: spojitDuvody([...rozdelitDuvody(p.duvodKontroly).filter((d) => !d.startsWith('Chybí název položky')), DUVOD_NECITELNY_NAZEV]),
        },
  )
}

/* ------------------------------------------------------------------ */
/* Jednotky z katalogu pokladny                                         */
/* ------------------------------------------------------------------ */

const JEDNOTKY: Record<string, string> = { piece: 'ks', liter: 'l', milliliter: 'ml', kilogram: 'kg', gram: 'g' }

/** Jednotka produktu z katalogu pokladny česky (Piece → ks, Liter → l…); neznámá zůstane, jak je; chybí → ''. */
export function jednotkaCesky(j: string | null | undefined): string {
  const t = (j ?? '').trim()
  return JEDNOTKY[t.toLowerCase()] ?? t
}

/* ------------------------------------------------------------------ */
/* Kontrola proti pokladně                                              */
/* ------------------------------------------------------------------ */

export type DotazUctu = { provozovna: string; ucty: readonly UcetPos[]; uplne: boolean }

export type Okno = { odMs: number; doMs: number }

/**
 * Okna dotazů do pokladny kolem provozního dne prodeje `datum`:
 *   uzavrene  podle data UZAVŘENÍ účtu, provozní den −1 až +2 (včetně) —
 *             účet z fotky mohl být uzavřený i den dva po prodeji;
 *   otevrene  jen otevřené účty, podle VYTVOŘENÍ, od dne −60 do dne +2 —
 *             otevřený účet může běžet týdny (firemní účet, akce).
 */
export function oknaKontroly(datum: string, denZacina: string, pasmo: string): { uzavrene: Okno; otevrene: Okno } {
  const konec = oknoProvoznihoDne(posunoutDen(datum, 2), denZacina, pasmo).doMs
  return {
    uzavrene: { odMs: oknoProvoznihoDne(posunoutDen(datum, -1), denZacina, pasmo).odMs, doMs: konec },
    otevrene: { odMs: oknoProvoznihoDne(posunoutDen(datum, -60), denZacina, pasmo).odMs, doMs: konec },
  }
}

/**
 * Výsledky obou dotazů jedné provozovny dohromady, bez opakování podle
 * `externiId`. Tentýž účet v obou (mezi dotazy se uzavřel) platí jako
 * UZAVŘENÝ — prodej je pak v tržbách pokladny. Úplné jen když jsou úplné oba.
 */
export function sloucitUcty(
  provozovna: string,
  uzavrene: { ucty: readonly UcetPos[]; uplne: boolean },
  otevrene: { ucty: readonly UcetPos[]; uplne: boolean },
): DotazUctu {
  const podleId = new Map<string, UcetPos>()
  for (const u of [...uzavrene.ucty, ...otevrene.ucty]) {
    const byl = podleId.get(u.externiId)
    if (!byl || (byl.stav !== 'uzavreny' && u.stav === 'uzavreny')) podleId.set(u.externiId, u)
  }
  return { provozovna, ucty: [...podleId.values()], uplne: uzavrene.uplne === true && otevrene.uplne === true }
}

export type VysledekKontroly<V extends string> = {
  vysledek: V
  /** Do `kontrola_*.detail` (bez tajemství). `pos_prodej_id` čte `jine_platby_potvrdit_trzbu`. */
  detail: Record<string, unknown>
  /** Věta pro člověka — proč tenhle výsledek. */
  popis: string
}

/**
 * Pokladna neumí hledat účty podle data uzavření (vrátila trvalou chybu).
 * Bez toho nejde vyloučit, že prodej z fotky v pokladně je — výsledek je
 * „nelze ověřit“ / „nelze zjistit“, žádný odhad z okna podle vytvoření.
 */
export function vysledekBezHledaniPodleUzavreni(
  druh: 'trzba' | 'sklad',
  duvodPokladny: string,
  okna: { uzavrene: Okno },
  provozovny: readonly string[],
): VysledekKontroly<'nelze_overit' | 'nelze_zjistit'> {
  return {
    vysledek: druh === 'trzba' ? 'nelze_overit' : 'nelze_zjistit',
    detail: {
      uplne: false,
      okno_podle: 'uzavreni',
      okno_od: new Date(okna.uzavrene.odMs).toISOString(),
      okno_do: new Date(okna.uzavrene.doMs).toISOString(),
      provozovny: [...provozovny],
      chyba_pokladny: duvodPokladny.slice(0, 300),
    },
    popis:
      `Pokladna účty podle data uzavření nevyhledala — neumí to, nebo dotaz odmítla (${duvodPokladny.slice(0, 200)}). ` +
      'Bez toho nejde vyloučit, že prodej v pokladně je — appka nic neodhaduje. Ověřte to v pokladně a doložte ručním prohlášením s důvodem.',
  }
}

type ZaznamProKontrolu = { externiUcet: string | null; castkaHaleru: number | null; mena: string | null; typDokladu?: TypDokladu | null }

/** Fotka OTEVŘENÉHO účtu: bez shody čísla dokladu se z pokladny nedá dokázat „není tam“. */
const POPIS_OTEVRENY_DOKLAD =
  'Doklad je fotka otevřeného účtu a pokladna účet se stejným číslem nevrátila. „Není v pokladně“ by nic nedokazovalo — účet mohl být uzavřený pod jiným číslem nebo pořád běží. Ověřte ho v pokladně a doložte ručně s důvodem.'

const shodaCisla = (u: UcetPos, cislo: string) => normalizovatUcet(u.cisloDokladu) === cislo || normalizovatUcet(u.externiId) === cislo

const shodaCastky = (u: UcetPos, z: ZaznamProKontrolu) =>
  z.castkaHaleru !== null && u.celkemHaleru === z.castkaHaleru && (u.mena === null || z.mena === null || u.mena === z.mena)

const popisUctu = (u: UcetPos) => (u.cisloDokladu ? `č. ${u.cisloDokladu}` : `id ${u.externiId}`)

function strucne(u: UcetPos) {
  return { externi_id: u.externiId, cislo_dokladu: u.cisloDokladu, stav: u.stav, celkem_haleru: u.celkemHaleru }
}

type Shody = {
  uplne: boolean
  pocetUctu: number
  cislo: string | null
  /** Účty se stejným číslem jako na dokladu, podle stavu v pokladně. */
  poCisle: { uzavrene: UcetPos[]; otevrene: UcetPos[]; zrusene: UcetPos[]; nezname: UcetPos[] }
  /** Účty se stejnou částkou (a měnou), bez shody čísla. */
  poCastce: { uzavrene: UcetPos[]; otevrene: UcetPos[] }
}

function najitShody(z: ZaznamProKontrolu, dotazy: readonly DotazUctu[]): Shody {
  const ucty = dotazy.flatMap((d) => d.ucty)
  const cislo = normalizovatUcet(z.externiUcet)
  const sCislem = cislo ? ucty.filter((u) => shodaCisla(u, cislo)) : []
  const bezCisla = ucty.filter((u) => !sCislem.includes(u))
  return {
    uplne: dotazy.length > 0 && dotazy.every((d) => d.uplne === true),
    pocetUctu: ucty.length,
    cislo,
    poCisle: {
      uzavrene: sCislem.filter((u) => u.stav === 'uzavreny'),
      otevrene: sCislem.filter((u) => u.stav === 'otevreny'),
      zrusene: sCislem.filter((u) => u.stav === 'zruseny'),
      nezname: sCislem.filter((u) => u.stav === 'neznamy'),
    },
    poCastce: {
      uzavrene: bezCisla.filter((u) => u.stav === 'uzavreny' && shodaCastky(u, z)),
      otevrene: bezCisla.filter((u) => u.stav === 'otevreny' && shodaCastky(u, z)),
    },
  }
}

/** `okno` = okno uzavřených účtů (podle uzavření); `otevrene` = okno otevřených účtů (podle vytvoření), když se ptalo. */
type OknaKontroly = Okno & { otevrene?: Okno }

function zakladDetailu(s: Shody, okno: OknaKontroly, dotazy: readonly DotazUctu[]) {
  return {
    uplne: s.uplne,
    pocet_uctu: s.pocetUctu,
    okno_od: new Date(okno.odMs).toISOString(),
    okno_do: new Date(okno.doMs).toISOString(),
    ...(okno.otevrene
      ? {
          okno_podle: 'uzavreni',
          okno_otevrene_od: new Date(okno.otevrene.odMs).toISOString(),
          okno_otevrene_do: new Date(okno.otevrene.doMs).toISOString(),
        }
      : {}),
    provozovny: dotazy.map((d) => d.provozovna),
    hledane_cislo: s.cislo,
  }
}

/**
 * Je prodej z dokladu už v tržbách pokladny?
 *
 *   nalezeno       uzavřený účet se STEJNÝM ČÍSLEM (jediný, nebo jediný se
 *                  stejnou částkou) — `pos_prodej_id` jde do detailu,
 *                  tržba se jen propojí;
 *   pravdepodobne  uzavřený účet jen se stejnou částkou (samotná částka
 *                  k jistotě nestačí — „2× pivo“ se ten den prodalo
 *                  určitě), nebo víc uzavřených se stejným číslem;
 *   nelze_overit   účet je v pokladně OTEVŘENÝ (po uzavření ho pokladna
 *                  zapíše do tržeb sama — nová tržba by se započítala
 *                  dvakrát), stav účtu neznámý, seznam není úplný, nebo
 *                  je doklad fotka OTEVŘENÉHO účtu (`typDokladu`
 *                  'otevreny_ucet') a účet se stejným číslem v pokladně
 *                  není — takový doklad „nenalezeno“ nikdy nedostane;
 *   nenalezeno     nic z toho a pokladna vrátila ÚPLNÝ seznam účtů.
 *
 * `dotazy` = výsledky obou dotazů (uzavřené podle uzavření + otevřené),
 * sloučené `sloucitUcty`.
 */
export function vyhodnotitKontroluTrzby(z: ZaznamProKontrolu, dotazy: readonly DotazUctu[], okno: OknaKontroly): VysledekKontroly<VysledekKontrolyTrzby> {
  const s = najitShody(z, dotazy)
  const zaklad = zakladDetailu(s, okno, dotazy)
  const castka = (h: number | null) => (h === null ? 'neuvedeno' : formatHaleru(h, z.mena))

  if (dotazy.length === 0) {
    return { vysledek: 'nelze_overit', detail: zaklad, popis: 'Provozovna pokladny k pobočce není přiřazená — není kde hledat.' }
  }

  // 1. Shoda čísla dokladu.
  const uz = s.poCisle.uzavrene
  const jediny = uz.length === 1 ? uz[0] : uz.filter((u) => shodaCastky(u, z)).length === 1 ? uz.filter((u) => shodaCastky(u, z))[0] : null
  if (jediny) {
    const sedi = shodaCastky(jediny, z)
    return {
      vysledek: 'nalezeno',
      detail: { ...zaklad, shoda: 'cislo_dokladu', pos_prodej_id: jediny.externiId, ucet: strucne(jediny), castka_sedi: sedi },
      popis:
        `Účet ${popisUctu(jediny)} je v pokladně uzavřený — prodej je v jejích tržbách.` +
        (sedi ? '' : ` Pozor: částka v pokladně (${castka(jediny.celkemHaleru)}) se liší od dokladu (${castka(z.castkaHaleru)}).`),
    }
  }
  if (uz.length > 1) {
    return {
      vysledek: 'pravdepodobne',
      detail: { ...zaklad, shoda: 'cislo_vice', ucty: uz.slice(0, 5).map(strucne) },
      popis: `V pokladně je ${uz.length}× uzavřený účet se stejným číslem — nejde poznat, který to je. Prodej v pokladně nejspíš je.`,
    }
  }
  if (s.poCisle.otevrene.length > 0) {
    const o = s.poCisle.otevrene[0]
    return {
      vysledek: 'nelze_overit',
      detail: { ...zaklad, shoda: 'cislo_otevreny', otevreny: true, pos_prodej_id: o.externiId, ucet: strucne(o) },
      popis:
        `Účet ${popisUctu(o)} je v pokladně otevřený — po uzavření ho pokladna zapíše do tržeb. ` +
        'Novou tržbu teď nezapisujte (započítala by se dvakrát); zkontrolujte znovu po uzavření, nebo prodej jen propojte.',
    }
  }
  if (s.poCisle.nezname.length > 0) {
    return {
      vysledek: 'nelze_overit',
      detail: { ...zaklad, shoda: 'cislo_neznamy_stav', ucty: s.poCisle.nezname.slice(0, 5).map(strucne) },
      popis: 'Účet se stejným číslem v pokladně je, ale appka nepozná, jestli je uzavřený — ověřte ho v pokladně.',
    }
  }

  // 2. Bez shody čísla: částka.
  if (s.poCastce.uzavrene.length > 0) {
    return {
      vysledek: 'pravdepodobne',
      detail: { ...zaklad, shoda: 'castka', kandidatu: s.poCastce.uzavrene.length, ucty: s.poCastce.uzavrene.slice(0, 5).map(strucne) },
      popis:
        `V pokladně je ${s.poCastce.uzavrene.length === 1 ? 'uzavřený účet' : `${s.poCastce.uzavrene.length} uzavřených účtů`} se stejnou částkou ${castka(z.castkaHaleru)}. ` +
        'Samotná částka nestačí k jistotě, že jde o tentýž prodej.',
    }
  }
  if (s.poCastce.otevrene.length > 0) {
    return {
      vysledek: 'nelze_overit',
      detail: { ...zaklad, shoda: 'castka_otevreny', ucty: s.poCastce.otevrene.slice(0, 5).map(strucne) },
      popis: `V pokladně je otevřený účet se stejnou částkou ${castka(z.castkaHaleru)} — po uzavření by se dostal do tržeb. Ověřte, jestli to není tentýž prodej.`,
    }
  }

  // 3. Nic. „Nenalezeno“ jen nad úplným seznamem — a nikdy u fotky otevřeného účtu
  //    (sem se dojde jen bez shody čísla u účtu, který v pokladně platí).
  const zruseny = s.poCisle.zrusene.length > 0 ? ` Účet se stejným číslem je v pokladně zrušený (${popisUctu(s.poCisle.zrusene[0])}).` : ''
  if (z.typDokladu === 'otevreny_ucet') {
    return { vysledek: 'nelze_overit', detail: { ...zaklad, shoda: null, otevreny_doklad: true }, popis: POPIS_OTEVRENY_DOKLAD + zruseny }
  }
  if (s.uplne) {
    return {
      vysledek: 'nenalezeno',
      detail: { ...zaklad, shoda: null, zruseny: s.poCisle.zrusene.length > 0 },
      popis: `V pokladně v okně kolem dne prodeje žádný odpovídající účet není (prohledáno účtů: ${s.pocetUctu}).${zruseny}`,
    }
  }
  return {
    vysledek: 'nelze_overit',
    detail: { ...zaklad, shoda: null },
    popis: 'Pokladna nevrátila úplný seznam účtů — „nenalezeno“ by nic nedokazovalo.' + zruseny,
  }
}

export type DohledaniOdpisu = { klic: string; odpoved: { stav: 'ok'; ucet: UcetPos | null } | { stav: 'chyba'; duvod: string } }

/**
 * Odečetla už pokladna spotřebu z tohoto dokladu?
 *
 *   jiz_odecteno   v pokladně je výdej s klíčem NAŠÍ operace (odpis), nebo
 *                  je prodej z dokladu v pokladně uzavřený jako účet se
 *                  stejným číslem (pokladna při prodeji odečítá sklad
 *                  podle svého nastavení) → výdej nevytvářet, jen propojit;
 *   nelze_zjistit  účet otevřený, účet jen se stejnou částkou, neznámý stav,
 *                  dohledání klíče selhalo, nebo seznam účtů není úplný;
 *   neodecteno     nic z toho nad ÚPLNÝM seznamem a s úspěšným dohledáním
 *                  klíčů — a nikdy u fotky otevřeného účtu bez shody čísla
 *                  (stejně jako u tržby, pak `nelze_zjistit`).
 *
 * U skladu se nehraje na „pravděpodobně“: dvojí výdej odečte sklad dvakrát
 * a nikdo si toho nevšimne až do inventury.
 */
export function vyhodnotitKontroluSkladu(
  z: ZaznamProKontrolu,
  dotazy: readonly DotazUctu[],
  odpisy: readonly DohledaniOdpisu[],
  okno: OknaKontroly,
): VysledekKontroly<VysledekKontrolySkladu> {
  const s = najitShody(z, dotazy)
  const zaklad = { ...zakladDetailu(s, okno, dotazy), klice: odpisy.map((o) => o.klic) }

  for (const o of odpisy) {
    if (o.odpoved.stav === 'ok' && o.odpoved.ucet && o.odpoved.ucet.stav !== 'zruseny') {
      const u = o.odpoved.ucet
      return {
        vysledek: 'jiz_odecteno',
        detail: { ...zaklad, zdroj_shody: 'klic_operace', klic: o.klic, externi_id: u.externiId, doklad: u.cisloDokladu, ucet: strucne(u) },
        popis: `V pokladně už je výdej s klíčem této operace (${popisUctu(u)}) — výdej neopakujte, jen ho propojte.`,
      }
    }
  }
  const odpisNejasny = odpisy.some((o) => o.odpoved.stav === 'chyba')

  if (dotazy.length === 0) {
    return { vysledek: 'nelze_zjistit', detail: zaklad, popis: 'Provozovna pokladny k pobočce není přiřazená — není kde hledat.' }
  }

  const uz = s.poCisle.uzavrene
  if (uz.length > 0) {
    const u = uz.find((x) => shodaCastky(x, z)) ?? uz[0]
    return {
      vysledek: 'jiz_odecteno',
      detail: { ...zaklad, zdroj_shody: 'prodej', externi_id: u.externiId, doklad: u.cisloDokladu, ucet: strucne(u) },
      popis: `Prodej z dokladu je v pokladně uzavřený jako účet ${popisUctu(u)} — pokladna při prodeji odečítá sklad podle svého nastavení. Výdej nevytvářejte, jen ho propojte.`,
    }
  }
  if (s.poCisle.otevrene.length > 0) {
    return {
      vysledek: 'nelze_zjistit',
      detail: { ...zaklad, zdroj_shody: 'prodej_otevreny', ucet: strucne(s.poCisle.otevrene[0]) },
      popis: `Účet ${popisUctu(s.poCisle.otevrene[0])} je v pokladně otevřený — po uzavření pokladna sklad odečte sama. Výdej z appky by ho odečetl podruhé.`,
    }
  }
  if (s.poCisle.nezname.length > 0) {
    return { vysledek: 'nelze_zjistit', detail: { ...zaklad, zdroj_shody: 'prodej_neznamy_stav' }, popis: 'Účet se stejným číslem v pokladně je, ale appka nepozná jeho stav — ověřte ho v pokladně.' }
  }
  const castkou = [...s.poCastce.uzavrene, ...s.poCastce.otevrene]
  if (castkou.length > 0) {
    return {
      vysledek: 'nelze_zjistit',
      detail: { ...zaklad, zdroj_shody: 'castka', kandidatu: castkou.length, ucty: castkou.slice(0, 5).map(strucne) },
      popis: 'V pokladně je účet se stejnou částkou — nejde poznat, jestli je to tentýž prodej (pak by sklad už odečetla). Ověřte to v pokladně a doložte s důvodem.',
    }
  }
  if (odpisNejasny) {
    return { vysledek: 'nelze_zjistit', detail: { ...zaklad, zdroj_shody: null }, popis: 'Dohledání předchozího výdeje podle klíče selhalo — nejde vyloučit, že už proběhl.' }
  }
  if (!s.uplne) {
    return { vysledek: 'nelze_zjistit', detail: { ...zaklad, zdroj_shody: null }, popis: 'Pokladna nevrátila úplný seznam účtů — „neodečteno“ by nic nedokazovalo.' }
  }
  if (z.typDokladu === 'otevreny_ucet') {
    return { vysledek: 'nelze_zjistit', detail: { ...zaklad, zdroj_shody: null, otevreny_doklad: true }, popis: POPIS_OTEVRENY_DOKLAD }
  }
  return {
    vysledek: 'neodecteno',
    detail: { ...zaklad, zdroj_shody: null },
    popis: `V pokladně tenhle prodej ani výdej s klíčem appky není (prohledáno účtů: ${s.pocetUctu}).`,
  }
}

/* ------------------------------------------------------------------ */
/* Operace v pokladně                                                   */
/* ------------------------------------------------------------------ */

const jeStavOperace = (s: unknown): s is StavOperace => typeof s === 'string' && (STAVY_OPERACE as readonly string[]).includes(s)

function polozkyOperace(v: unknown): OperacePos['polozky'] | null {
  if (!Array.isArray(v)) return null
  const vystup: OperacePos['polozky'] = []
  for (const e of v) {
    const o = e as { produktId?: unknown; mnozstvi?: unknown } | null
    if (!o || typeof o.produktId !== 'string' || o.produktId === '') return null
    const m = typeof o.mnozstvi === 'number' ? String(o.mnozstvi) : o.mnozstvi
    if (typeof m !== 'string' || !/^\d+(\.\d{1,3})?$/.test(m)) return null
    vystup.push({ produktId: o.produktId, mnozstvi: m })
  }
  return vystup
}

/**
 * Řádek `pos_operace` (snake_case z PostgRESTu) → `OperacePos` pro
 * orchestrátor. `null` = řádek nejde bezpečně přečíst (pak se nic neodešle).
 */
export function operaceZDb(r: Record<string, unknown> | null | undefined): OperacePos | null {
  if (!r || typeof r.id !== 'string' || typeof r.idempotencni_klic !== 'string' || !jeStavOperace(r.stav)) return null
  const polozky = polozkyOperace(r.polozky)
  if (!polozky) return null
  return {
    id: r.id,
    klic: r.idempotencni_klic,
    stav: r.stav,
    pokusu: typeof r.pokusu === 'number' ? r.pokusu : 0,
    platnostDo: typeof r.platnost_do === 'string' ? r.platnost_do : null,
    externiProvozovna: typeof r.externi_provozovna === 'string' ? r.externi_provozovna : '',
    polozky,
    poznamka: typeof r.poznamka === 'string' ? r.poznamka : '',
  }
}

/** Odpověď `pos_operace_zahajit` → tvar `RepoOperaci.zahajit`. */
export function zahajeniZDb(
  v: unknown,
): { stav: 'ok'; op: OperacePos } | { stav: 'obsazeno' } | { stav: 'nelze'; duvod: string } {
  const o = v as { stav?: unknown; duvod?: unknown; operace?: Record<string, unknown> } | null
  if (o?.stav === 'obsazeno') return { stav: 'obsazeno' }
  if (o?.stav === 'ok' && o.operace) {
    const r = o.operace
    const op = operaceZDb({
      id: r.id,
      idempotencni_klic: r.klic,
      stav: r.stav,
      pokusu: r.pokusu,
      platnost_do: r.platnostDo,
      externi_provozovna: r.externiProvozovna,
      polozky: r.polozky,
      poznamka: r.poznamka,
    })
    if (op) return { stav: 'ok', op }
    return { stav: 'nelze', duvod: 'Databáze vrátila operaci, kterou appka neumí přečíst — nic se neodeslalo.' }
  }
  return { stav: 'nelze', duvod: typeof o?.duvod === 'string' && o.duvod !== '' ? o.duvod : 'Operaci nejde zahájit.' }
}

/**
 * `RelacePos.ucetPodleKlice` → `VysledekDohledani`. Zrušený účet není
 * úspěch (pokladna nic neodečetla) — vrací se jako chyba dohledání, takže
 * orchestrátor nic nezopakuje, jen se dohledává dál.
 */
export function dohledaniZUctu(
  odpoved: { stav: 'ok'; ucet: UcetPos | null } | { stav: 'chyba'; duvod: string },
): VysledekDohledani {
  if (odpoved.stav !== 'ok') return { stav: 'chyba', duvod: odpoved.duvod }
  const u = odpoved.ucet
  if (!u) return { stav: 'nenalezeno' }
  if (u.stav === 'zruseny') return { stav: 'chyba', duvod: 'Účet s klíčem operace je v pokladně zrušený — ověřte výdej ručně' }
  return { stav: 'nalezeno', externiId: u.externiId, doklad: u.cisloDokladu, detail: { stav: u.stav, odpis: u.odpis, typ_dokladu: u.typDokladu } }
}

/* ------------------------------------------------------------------ */
/* Popisky                                                              */
/* ------------------------------------------------------------------ */

export const POPIS_VYSLEDKU_TRZBY: Record<VysledekKontrolyTrzby, string> = {
  nalezeno: 'Prodej v pokladně je',
  nenalezeno: 'Prodej v pokladně není',
  pravdepodobne: 'Prodej v pokladně pravděpodobně je',
  nelze_overit: 'Nelze ověřit',
}

export const POPIS_VYSLEDKU_SKLADU: Record<VysledekKontrolySkladu, string> = {
  neodecteno: 'Pokladna spotřebu neodečetla',
  jiz_odecteno: 'Pokladna už spotřebu odečetla',
  nelze_zjistit: 'Nelze zjistit',
}

/** Zdroj kontroly — ruční prohlášení se NIKDY nevydává za ověření pokladnou. */
export function popisZdroje(z: ZdrojKontroly | string): string {
  if (z === 'pos_api') return 'ověřeno v pokladně (dotaz appky)'
  if (z === 'rucni_prohlaseni') return 'ruční prohlášení člověka — pokladnou neověřeno'
  return `neznámý zdroj (${z})`
}

export function popisPuvoduCastky(p: PuvodCastky | null): string {
  if (p === 'doklad') return 'z dokladu'
  if (p === 'vypocet') return 'vypočtený součet — návrh'
  if (p === 'rucne') return 'ručně'
  return 'neuvedeno'
}

const UDALOSTI: Record<string, string> = {
  zalozeno: 'Záznam založen',
  soubor_pripojen: 'Připojen doklad',
  rozpoznano: 'Rozpoznání přes AI',
  navrh_ulozen: 'Návrh uložen',
  zkontrolovano: 'Označeno jako zkontrolované',
  kontrola_pos_trzba: 'Kontrola tržby v pokladně',
  kontrola_pos_sklad: 'Kontrola výdeje v pokladně',
  rucne_dolozeno_trzba: 'Ruční prohlášení k tržbě',
  rucne_dolozeno_sklad: 'Ruční prohlášení ke skladu',
  trzba_zapsana: 'Tržba zapsána do Ostatních tržeb',
  trzba_propojena: 'Tržba jen propojena (prodej je v pokladně)',
  trzba_stornovana: 'Tržba stornována',
  trzba_opravena: 'Tržba opravena',
  sklad_nevyzaduje: 'Sklad se netýká',
  sklad_odeslan: 'Skladový návrh odeslán ke schválení',
  schvaleni_zneplatneno: 'Schválení zneplatněno změnou záznamu',
  vydej_schvalen: 'Výdej do POS potvrzen',
  vydej_zamitnut: 'Výdej zamítnut',
  schvaleni_zruseno: 'Schválení výdeje zrušeno (v pokladně nic neodepsáno)',
  vydej_znovu: 'Výdej připraven znovu',
  vydej_odesila_se: 'Výdej se odesílá do pokladny',
  vydej_uspech: 'Odečteno v POS (ověřeno)',
  vydej_nejasny_vysledek: 'Nejasný výsledek výdeje',
  vydej_chyba: 'Pokladna výdej neprovedla',
  vydej_nepodporovano: 'Pokladna výdej přes API neumí — ruční zpracování',
  vydej_propojen: 'Výdej propojen (pokladna už odečetla)',
  vydej_rucne_dolozen: 'Ručně doloženo',
  vydej_korigovan: 'Korekce výdeje',
  faktura_podklady: 'Podklady pro fakturu',
  faktura_propojena: 'Faktura propojena',
  faktura_odpojena: 'Faktura odpojena',
  uhrada_evidovana: 'Úhrada napárována na bankovní platbu',
  uhrada_odpojena: 'Úhrada odpojena',
  zruseno: 'Záznam zrušen',
}

export function popisUdalosti(u: string): string {
  return UDALOSTI[u] ?? u
}

/** Krátké shrnutí detailu události (jen bezpečné klíče). */
export function shrnutiUdalosti(detail: Record<string, unknown> | null | undefined, mena: string | null): string {
  if (!detail || typeof detail !== 'object') return ''
  const casti: string[] = []
  const t = (k: string) => (typeof detail[k] === 'string' && (detail[k] as string).trim() !== '' ? (detail[k] as string).trim() : null)
  const vysledek = t('vysledek')
  if (vysledek) casti.push(POPIS_VYSLEDKU_TRZBY[vysledek as VysledekKontrolyTrzby] ?? POPIS_VYSLEDKU_SKLADU[vysledek as VysledekKontrolySkladu] ?? vysledek)
  const stav = t('stav')
  if (stav) casti.push(stav === 'ok' ? 'rozpoznáno' : stav === 'bez_klice' ? 'AI nezapnutá' : stav === 'chyba' ? 'chyba' : stav)
  if (typeof detail.castka_haleru === 'number' && Number.isSafeInteger(detail.castka_haleru)) casti.push(formatHaleru(detail.castka_haleru, mena))
  if (typeof detail.polozek === 'number') casti.push(`položek: ${detail.polozek}`)
  const cislo = t('cislo')
  if (cislo) casti.push(`č. ${cislo}`)
  const doklad = t('doklad')
  if (doklad) casti.push(`doklad ${doklad}`)
  const duvod = t('duvod')
  if (duvod) casti.push(`důvod: ${duvod}`)
  return casti.join(' · ')
}

/**
 * Co se po „Potvrdit výdej do POS“ stane — podle schopnosti pokladny
 * (`SchopnostiPosProvidera.skladovyVydej`, chybí = 'rucne').
 */
export function textPlanovaneOperace(
  schopnost: 'api' | 'rucne' | 'nepodporovano' | null,
  nazevPokladny: string,
  provozovna: string,
): { nadpis: string; kroky: string[] } {
  if (schopnost === 'api') {
    return {
      nadpis: `Appka odešle výdej do pokladny ${nazevPokladny} a ověří ho dohledáním.`,
      kroky: [
        'Požadavek odejde jednou, s klíčem operace (idempotence).',
        '„Odečteno v POS“ se ukáže, až když pokladna výdej podle klíče opravdu vrátí — odpověď „přijato“ nestačí.',
        'Při nejasné odpovědi se výdej NEOPAKUJE, jen se dohledává.',
      ],
    }
  }
  if (schopnost === 'nepodporovano') {
    return {
      nadpis: `Pokladna ${nazevPokladny} sklad nevede — výdej v ní nejde zpracovat.`,
      kroky: ['Návrh zůstane jako podklad. Když výdej provedete jinde, doložte ho tlačítkem „Ručně doloženo“.'],
    }
  }
  return {
    nadpis: `Ruční zpracování — appka zápis do skladu pokladny ${nazevPokladny} zatím neprovádí.`,
    kroky: [
      `V pokladně na provozovně ${provozovna} ručně vydejte (odepište) položky z tohoto návrhu — v množství a jednotkách pokladny ze seznamu položek u návrhu.`,
      'Pokrm vydejte jako pokrm — suroviny odečte pokladna podle své receptury. Suroviny zvlášť nevydávejte.',
      'Číslo dokladu z pokladny (výdejka, odpis) zapište sem tlačítkem „Ručně doloženo“ s důvodem.',
    ],
  }
}

/** „2026-10-05“ → „5. 10. 2026“ (provozní den bez pásma — je to datum, ne okamžik). */
export function datumCesky(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : ''
}
