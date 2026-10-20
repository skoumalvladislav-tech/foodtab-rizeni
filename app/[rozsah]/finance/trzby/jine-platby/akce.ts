'use server'

import { hasAccess } from '@/lib/authz'
import { prevestCastku } from '@/lib/jine-platby-castky'
import { doDbHlavicka, doDbPolozky, hlavickaZeZaznamu, SLOUPCE_POLOZKY, zDbPolozka } from '@/lib/jine-platby-db'
import { sestavitPodklady, type KontaktFaktury } from '@/lib/jine-platby-faktura'
import type { ProduktKatalogu } from '@/lib/jine-platby-mapovani'
import { prohlaseniProtiPokladne } from '@/lib/jine-platby-stav'

import { chyba, hotovo, katalogPripojeni, pripravit, vysledekChyby, type Pripraveno } from './[zaznam]/akce-zaklad'
import {
  coZkontrolovat,
  HLASKA_OBECNA,
  hlaskaPrepisuPokladny,
  jeHlaskaDuplicity,
  jeHlaskaDuvoduPropojeni,
  jeHlaskaUpozorneniAi,
  jeUuid,
  nacistNavrh,
  pole,
  POPIS_VYSLEDKU_SKLADU,
  POPIS_VYSLEDKU_TRZBY,
  propojeniChceDuvod,
  verzeZFormulare,
  type StavAkce,
} from './[zaznam]/logika'

/**
 * Jiné platby — serverové akce nad záznamem (návrh, kontrola, tržba,
 * skladový návrh a jeho doložení, faktura, úhrada, opravy, zrušení).
 *
 * Kontrola v pokladně, provedení výdeje a katalog jsou v ./akce-pos.ts,
 * rozpoznání přes AI v ./akce-ai.ts.
 *
 * KAŽDÁ akce začíná `pripravit(formData, '<právo>')` (./[zaznam]/akce-zaklad.ts):
 * firma z členství (nikdy z formuláře), záznam přes RLS s `.eq('tenant_id')`
 * a právo agendy NA POBOČCE ZÁZNAMU — teprve pak RPC. Databázová funkce
 * právo i stav ověří znovu (docs/jine-platby-navrh.md, oddíl 5); tady je
 * první linie, ať tlačítko neslibuje, co databáze odmítne.
 *
 * Oddělení práv (oddíl 4): akce tržby chtějí `jine_platby.trzba` a nikdy
 * nevolají skladovou funkci; akce skladu chtějí `jine_platby.vydej_pos`
 * (odeslání návrhu `jine_platby.sklad_odeslat`; zrušení schválení
 * `zrusitSchvaleni` taky `vydej_pos`) a nikdy nevolají tržní.
 * Proto jsou prohlášení rozdělená na `prohlasitTrzbu` a `prohlasitSklad`.
 * Hlídá scripts/jine-platby-detail.test.mjs.
 *
 * Formuláře: `useActionState` se stavem `{ stav: 'nic' | 'ok' | 'chyba', text }`.
 */

const HLASKA_ZASTARALY = 'Formulář je zastaralý — načtěte stránku znovu.'
const HLASKA_DUVOD = 'Napište důvod (aspoň pár slov).'
/** Otisk skladového návrhu (sha256 hex, `jine_platby_skladove_navrhy.otisk`). */
const OTISK_RE = /^[0-9a-f]{64}$/

/** Povinný důvod (databáze chce aspoň 5 znaků, `app.jp_duvod`). `null` = chybí. */
function duvodZ(p: Pripraveno, nazev = 'duvod'): string | null {
  const d = pole(p.f, nazev)
  return d.length >= 5 ? d.slice(0, 1000) : null
}

const chybaPole = (nazev: string, text: string): StavAkce => ({ stav: 'chyba', text, chyby: { [nazev]: text } })

/**
 * Chyba databáze → stav formuláře; „Možná duplicita…“ (23514) se navíc
 * přiřadí k poli s důvodem, ať ho formulář zaměří a napsaný text zůstane.
 */
function chybaSDuplicitou(error: { code?: string | null; message?: string | null }, coDelam: string, nazevPole: string): StavAkce {
  const stav = vysledekChyby(error, coDelam)
  return error.code === '23514' && jeHlaskaDuplicity(stav.text) ? { ...stav, chyby: { [nazevPole]: stav.text } } : stav
}

/** Uložené položky záznamu (uživatelský klient, RLS). `null` = nejde načíst. */
async function polozkyZaznamu(p: Pripraveno): Promise<Record<string, unknown>[] | null> {
  const { data, error } = await p.supabase
    .from('jine_platby_polozky')
    .select(SLOUPCE_POLOZKY)
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .order('poradi')
  return error ? null : ((data ?? []) as unknown as Record<string, unknown>[])
}

/* ------------------------------------------------------------------ */
/* Návrh a kontrola                                                     */
/* ------------------------------------------------------------------ */

/**
 * Uložit návrh (hlavička + všechny položky najednou). Převod formuláře
 * a přepočet příznaků dělá `nacistNavrh` (./[zaznam]/logika.ts); nejasná
 * hodnota vrátí chybu u pole a nic se neuloží. Zaškrtnuté „zapamatovat
 * přiřazení" se uloží jako ověřený alias až po úspěšném uložení návrhu.
 */
export async function ulozitNavrh(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const radky = await polozkyZaznamu(p)
  if (!radky) return chyba(HLASKA_OBECNA)
  const puvodni = radky.map((r) => ({ ...zDbPolozka(r), id: String(r.id) }))

  let katalog: ProduktKatalogu[]
  try {
    katalog = await katalogPripojeni(p.supabase, p.tenantId, p.z.pripojeniId)
  } catch {
    return chyba('Katalog pokladny se nepodařilo načíst. Zkuste to prosím znovu.')
  }

  const navrh = nacistNavrh(p.f, { zaznam: p.z, puvodni, katalog })
  if (navrh.stav === 'chyba') return { stav: 'chyba', text: navrh.text, chyby: navrh.chyby }

  const { data: novaVerze, error } = await p.supabase.rpc('jine_platby_ulozit_navrh', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_hlavicka: doDbHlavicka(navrh.hlavicka),
    p_polozky: doDbPolozky(navrh.polozky),
  })
  if (error) return vysledekChyby(error, 'uložení návrhu')

  // Alias patří pokladně ZÁZNAMU — databáze ji vezme ze záznamu a právo upravit ověří na jeho pobočce.
  const nezapamatovano: string[] = []
  if (p.z.pripojeniId) {
    for (const a of navrh.zapamatovat) {
      const { error: chybaAliasu } = await p.supabase.rpc('jine_platby_ulozit_mapovani', {
        p_zaznam: p.z.id,
        p_alias: a.alias,
        p_pos_produkt_id: a.posProduktId,
      })
      if (chybaAliasu) nezapamatovano.push(a.alias)
    }
  }

  const keKontrole = navrh.polozky.filter((x) => x.vyzadujeKontrolu).length
  const casti = [`Návrh uložen (verze ${String(novaVerze ?? '')}).`]
  if (keKontrole > 0 || navrh.duvody.length > 0) {
    casti.push(`Ke kontrole zbývá: ${[keKontrole > 0 ? `položek ${keKontrole}` : null, ...navrh.duvody].filter(Boolean).join('; ')}.`)
  } else {
    casti.push('Nic nečeká na kontrolu — záznam můžete označit jako zkontrolovaný.')
  }
  if (nezapamatovano.length > 0) casti.push(`Přiřazení se nepodařilo zapamatovat u: ${nezapamatovano.join(', ')}.`)
  return hotovo(p, casti.join(' '))
}

/**
 * Označit jako zkontrolované. Když součet položek nesedí s celkovou cenou
 * (`coZkontrolovat` nad ULOŽENÝMI položkami — totéž, co ukázala obrazovka),
 * chce databáze důvod, proč rozdíl nevadí (`p_duvod_rozdilu`, zaokrouhlení,
 * sleva mimo položky…). Bez nesouladu se posílá `null`, i kdyby formulář
 * pole poslal.
 *
 * Upozornění AI k celému dokladu (`z.upozorneniDokladu` — nízká jistota,
 * víc dokladů v jednom, pokyn v textu dokladu…) chtějí výslovné zaškrtnutí
 * „Upozornění AI jsem prověřil(a)“ (`p_upozorneni_provereno`). `true` se
 * posílá jen při zaškrtnutí a neprázdných upozorněních ULOŽENÉHO záznamu.
 */
export async function oznacitZkontrolovano(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const upozorneni = p.z.upozorneniDokladu
  const provereno = upozorneni.length > 0 && pole(p.f, 'upozorneni_provereno') === 'ano'
  if (upozorneni.length > 0 && !provereno) {
    return chybaPole('upozorneni_provereno', `AI k dokladu napsala upozornění (${upozorneni.length}). Prověřte je a zaškrtněte „Upozornění AI jsem prověřil(a)“.`)
  }

  const radky = await polozkyZaznamu(p)
  if (!radky) return chyba(HLASKA_OBECNA)
  const { nesoulad } = coZkontrolovat(radky.map(zDbPolozka), hlavickaZeZaznamu(p.z))
  let duvodRozdilu: string | null = null
  if (nesoulad) {
    duvodRozdilu = duvodZ(p, 'duvod_rozdilu')
    if (!duvodRozdilu) return chybaPole('duvod_rozdilu', `${nesoulad.popis}. Napište, proč rozdíl nevadí (zaokrouhlení, sleva mimo položky…).`)
  }

  const { error } = await p.supabase.rpc('jine_platby_oznacit_zkontrolovano', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_duvod_rozdilu: duvodRozdilu,
    p_upozorneni_provereno: provereno,
  })
  if (error) {
    const stav = vysledekChyby(error, 'označení zkontrolováno')
    if (error.code === '23514' && /^Součet položek/.test(stav.text)) return { ...stav, chyby: { duvod_rozdilu: stav.text } }
    if (error.code === '23514' && jeHlaskaUpozorneniAi(stav.text)) return { ...stav, chyby: { upozorneni_provereno: stav.text } }
    return stav
  }
  return hotovo(p, 'Záznam je zkontrolovaný. Tržba ani sklad se tím nemění — to jsou další kroky.')
}

/* ------------------------------------------------------------------ */
/* Ruční prohlášení (NENÍ automatické ověření)                          */
/* ------------------------------------------------------------------ */

const NEVIM =
  'Když to nevíte jistě, nic se nezapíše. Ověřte to v pokladně (nebo u toho, kdo účet uzavíral) a pak to doložte, nebo nechte appku zkontrolovat pokladnu.'

/**
 * Prohlášení „není“ proti poslednímu výsledku dotazu do pokladny
 * (`prohlaseniProtiPokladne` — bez ohledu na verzi záznamu; výsledek
 * pokladny nahradí jen novější kontrola v pokladně):
 *
 *   * „pravděpodobně“ (shoda jen částky) — přepsat smí, kdo prohlašuje, ale
 *     jen se zaškrtnutým „Prodej v pokladně je jiný, ověřil(a) jsem to“
 *     (`prepsat_pokladnu` → `p_prepsat_pokladnu = true`);
 *   * „nalezeno“ (konkrétní účet) a „už odečteno“ — totéž, a navíc jen
 *     s právem na opravy (`chceOpravu`).
 *
 * Jinak by ruční „není tam“ odemklo druhou tržbu nebo druhý odpis.
 * Databáze to hlídá taky (`jine_platby_prohlasit`); tohle je první linie.
 * Vrací `{ prepsat }` (co poslat jako `p_prepsat_pokladnu`), nebo chybu u pole.
 */
async function prepsaniPokladny(p: Pripraveno, druh: 'trzba' | 'sklad', volba: string): Promise<{ prepsat: boolean } | { chyba: StavAkce }> {
  const proti = volba === 'neni' ? prohlaseniProtiPokladne(p.z, druh) : null
  if (proti === null) return { prepsat: false }
  const popis = (druh === 'trzba' ? (POPIS_VYSLEDKU_TRZBY as Record<string, string>) : (POPIS_VYSLEDKU_SKLADU as Record<string, string>))[proti.vysledek] ?? proti.vysledek
  if (proti.chceOpravu && !(await hasAccess(p.tenantId, 'jine_platby.oprava', p.z.branchId))) {
    return {
      chyba: chybaPole(
        'vysledek',
        `Pokladna při kontrole tohle našla (${popis}) — konkrétní ${druh === 'trzba' ? 'prodej' : 'prodej nebo odpis'} přepsat ručním prohlášením smí jen člověk s právem na opravy. Když si myslíte, že se pokladna mýlí, zopakujte kontrolu v pokladně.`,
      ),
    }
  }
  if (pole(p.f, 'prepsat_pokladnu') !== 'ano') {
    return {
      chyba: chybaPole(
        'prepsat_pokladnu',
        `Pokladna při kontrole tohle našla (${popis}). Prohlášení opačného znění ji přepíše jen s výslovným potvrzením, že ${druh === 'trzba' ? 'prodej' : 'prodej nebo výdej'} v pokladně je jiný — zaškrtněte to, nebo zopakujte kontrolu v pokladně.`,
      ),
    }
  }
  return { prepsat: true }
}

/** Chyba `jine_platby_prohlasit` → stav formuláře; hláška o přepisu výsledku pokladny jde k poli, kterého se týká. */
function chybaProhlaseni(error: { code?: string | null; message?: string | null }, coDelam: string): StavAkce {
  const stav = vysledekChyby(error, coDelam)
  const druh = error.code === '23514' ? hlaskaPrepisuPokladny(stav.text) : null
  return druh === null ? stav : { ...stav, chyby: { [druh === 'pravo' ? 'vysledek' : 'prepsat_pokladnu']: stav.text } }
}

/** Ruční prohlášení k TRŽBĚ: prodej v pokladně je / není. Právo `jine_platby.trzba`. */
export async function prohlasitTrzbu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.trzba')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const volba = pole(p.f, 'vysledek')
  if (volba === 'nevim') return chyba(NEVIM)
  if (volba !== 'je' && volba !== 'neni') return chybaPole('vysledek', 'Vyberte, jestli prodej v pokladně je, nebo není.')
  const prepis = await prepsaniPokladny(p, 'trzba', volba)
  if ('chyba' in prepis) return prepis.chyba
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)
  const posId = pole(p.f, 'pos_prodej_id').slice(0, 100)
  if (volba === 'je' && posId === '') return chybaPole('pos_prodej_id', 'Napište ID účtu nebo číslo dokladu v pokladně.')

  const { error } = await p.supabase.rpc('jine_platby_prohlasit', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_druh: 'trzba',
    p_vysledek: volba === 'je' ? 'nalezeno' : 'nenalezeno',
    p_duvod: duvod,
    p_pos_prodej_id: volba === 'je' ? posId : null,
    p_prepsat_pokladnu: prepis.prepsat,
  })
  if (error) return chybaProhlaseni(error, 'ruční prohlášení k tržbě')
  return hotovo(p, 'Prohlášení zapsáno jako RUČNÍ (pokladnou neověřené). Platí 30 minut a jen pro tuhle verzi záznamu.')
}

/** Ruční prohlášení ke SKLADU: pokladna spotřebu odečetla / neodečetla. Právo `jine_platby.vydej_pos`. */
export async function prohlasitSklad(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const volba = pole(p.f, 'vysledek')
  if (volba === 'nevim') return chyba(NEVIM)
  if (volba !== 'je' && volba !== 'neni') return chybaPole('vysledek', 'Vyberte, jestli pokladna spotřebu odečetla, nebo ne.')
  const prepis = await prepsaniPokladny(p, 'sklad', volba)
  if ('chyba' in prepis) return prepis.chyba
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_prohlasit', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_druh: 'sklad',
    p_vysledek: volba === 'je' ? 'jiz_odecteno' : 'neodecteno',
    p_duvod: duvod,
    p_pos_prodej_id: null,
    p_prepsat_pokladnu: prepis.prepsat,
  })
  if (error) return chybaProhlaseni(error, 'ruční prohlášení ke skladu')
  return hotovo(p, 'Prohlášení zapsáno jako RUČNÍ (pokladnou neověřené). Platí 15 minut a jen pro tuhle verzi záznamu.')
}

/* ------------------------------------------------------------------ */
/* Tržba                                                                */
/* ------------------------------------------------------------------ */

/**
 * Zapsat do Ostatních tržeb (`nova`, započítá se) nebo jen propojit
 * (`propojit`, prodej je v tržbách pokladny — do součtu se NEPŘIČTE).
 * Který režim smí, rozhoduje databáze podle kontroly (nová jen po
 * „nenalezeno“). Možná duplicita chce důvod.
 *
 * Propojení bez konkrétního prodeje v pokladně (kontrola nemá
 * `pos_prodej_id` — shoda jen částky, nejde ověřit…) chce důvod „Proč je
 * prodej v pokladně“ (`p_duvod_propojeni`, `propojeniChceDuvod` nad
 * ULOŽENOU kontrolou); jinak by tržba mimo pokladnu tiše vypadla ze všech
 * součtů. Kde důvod potřeba není, posílá se `null`.
 */
export async function potvrditTrzbu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.trzba')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const rezim = pole(p.f, 'rezim')
  if (rezim !== 'nova' && rezim !== 'propojit') return chyba('Vyberte, jestli tržbu zapsat, nebo jen propojit.')
  const duplicita = pole(p.f, 'duplicita_duvod')
  if (duplicita !== '' && duplicita.length < 5) return chybaPole('duplicita_duvod', HLASKA_DUVOD)
  let duvodPropojeni: string | null = null
  if (rezim === 'propojit' && propojeniChceDuvod(p.z.kontrolaTrzby, p.z.pripojeniId !== null)) {
    duvodPropojeni = duvodZ(p, 'duvod_propojeni')
    if (!duvodPropojeni) {
      return chybaPole('duvod_propojeni', 'Kontrola nenašla konkrétní prodej v pokladně. Napište, proč je prodej v pokladně (aspoň pár slov) — jinak se tržba nezapočítá nikde.')
    }
  }

  const { error } = await p.supabase.rpc('jine_platby_potvrdit_trzbu', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_rezim: rezim,
    p_duplicita_duvod: duplicita === '' ? null : duplicita.slice(0, 1000),
    p_duvod_propojeni: duvodPropojeni,
  })
  if (error) {
    const stav = chybaSDuplicitou(error, 'potvrzení tržby', 'duplicita_duvod')
    return error.code === '23514' && jeHlaskaDuvoduPropojeni(stav.text) ? { ...stav, chyby: { duvod_propojeni: stav.text } } : stav
  }
  return hotovo(
    p,
    rezim === 'nova'
      ? 'Tržba zapsána do Ostatních tržeb. Úhradu tím appka neověřila — tu ověří jen bankovní platba.'
      : 'Prodej propojen — je v tržbách pokladny, do součtu se podruhé nepřičetl.',
  )
}

/** Oprava nebo storno zapsané tržby (storno + nový řádek, historie zůstává). Právo `jine_platby.oprava`. */
export async function opravitTrzbu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.oprava')
  if (!p.ok) return p.stav
  // Verze z formuláře: oprava podle zastaralé obrazovky (mezitím jiná oprava) databáze odmítne (40001).
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const castkaText = pole(p.f, 'castka')
  let nova: number | null = null
  if (castkaText !== '') {
    const c = prevestCastku(castkaText)
    if (c.stav !== 'ok') return chybaPole('castka', c.stav === 'nejasne' ? c.duvod : 'Napište částku.')
    if (c.haleru <= 0) return chybaPole('castka', 'Opravená částka musí být kladná (pro zrušení tržby nechte pole prázdné — storno).')
    nova = c.haleru
  }
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)
  const doklad = pole(p.f, 'doklad_opravy').slice(0, 100)
  if (p.z.stavFaktury === 'propojena' && doklad === '') {
    return chybaPole('doklad_opravy', 'K záznamu je propojená faktura — opravte ji opravným dokladem tam, kde byla vystavena, a jeho číslo napište sem.')
  }

  const { error } = await p.supabase.rpc('jine_platby_opravit_trzbu', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_nova_castka_haleru: nova,
    p_duvod: duvod,
    p_doklad_opravy: doklad === '' ? null : doklad,
  })
  if (error) return vysledekChyby(error, 'oprava tržby')
  return hotovo(p, nova === null ? 'Tržba stornována. Původní řádek zůstává v historii.' : 'Tržba opravena: původní řádek je stornovaný, platí nový.')
}

/* ------------------------------------------------------------------ */
/* Sklad (bez pokladny — provedení výdeje je v ./akce-pos.ts)           */
/* ------------------------------------------------------------------ */

/** Odeslat skladový návrh ke schválení. Sklad se tím NEMĚNÍ. Právo `jine_platby.sklad_odeslat`. */
export async function odeslatSklad(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.sklad_odeslat')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const { data, error } = await p.supabase.rpc('jine_platby_odeslat_sklad', { p_zaznam: p.z.id, p_verze: verze })
  if (error) return vysledekChyby(error, 'odeslání skladového návrhu')
  return hotovo(
    p,
    data === null
      ? 'Žádná položka v pokladně sklad neodečítá — sklad se tohoto záznamu netýká.'
      : 'Návrh odeslán ke schválení. Sklad se tím nemění — v pokladně se odečte až po „Potvrdit výdej do POS“.',
  )
}

/** Pokladna už spotřebu odečetla (sama, nebo dřív) — jen propojit. Právo `jine_platby.vydej_pos`. */
export async function propojitVydej(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_propojit_vydej', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_externi_id: pole(p.f, 'externi_id').slice(0, 100) || null,
    p_doklad: pole(p.f, 'doklad').slice(0, 100) || null,
    p_duvod: duvod,
  })
  if (error) return vysledekChyby(error, 'propojení výdeje')
  return hotovo(p, 'Výdej propojen — pokladna spotřebu odečetla sama, appka nic neodečítala.')
}

/**
 * „Ručně doloženo“: výdej provedl člověk v pokladně. Číslo dokladu
 * z pokladny a důvod jsou povinné. NENÍ to „Odečteno v POS“ — stav
 * `rucne_dolozeno`. Právo `jine_platby.vydej_pos`.
 *
 * U záznamu s pokladnou nese formulář otisk ŽIVÉHO schváleného návrhu
 * (skryté pole) — databáze ho porovná, ať se nedoloží jiný obsah, než
 * jaký člověk na obrazovce viděl. Bez pokladny návrh není, posílá se `null`.
 *
 * Požadavek do pokladny s nejasným výsledkem databáze doložit pustí až po
 * vypršení jeho platnosti (+ 2 min) — člověk to předtím ověří v pokladně
 * (C5). Doložení blokuje jen nevyřešená položka, ne změna katalogu po
 * schválení.
 */
export async function rucneDolozit(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  let otisk: string | null = null
  if (p.z.pripojeniId) {
    otisk = pole(p.f, 'otisk')
    if (!OTISK_RE.test(otisk)) return chyba(HLASKA_ZASTARALY)
  }
  const doklad = pole(p.f, 'doklad').slice(0, 100)
  if (doklad === '') return chybaPole('doklad', 'Napište číslo dokladu z pokladny (výdejka, odpis).')
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_rucne_dolozit_vydej', { p_zaznam: p.z.id, p_otisk: otisk, p_doklad: doklad, p_duvod: duvod })
  if (error) return vysledekChyby(error, 'ruční doložení výdeje')
  return hotovo(p, 'Ručně doloženo. Stav skladu je „Ručně doloženo (neověřeno pokladnou)“ — není to automatické ověření.')
}

/**
 * Zrušit schválení výdeje, když v pokladně NIC odepsáno nebylo (schváleno,
 * předáno k ručnímu odpisu, nebo prokázaná chyba). Sklad se vrátí na „bez
 * návrhu“, návrh se nahradí a operace zruší; povinný důvod. Když už
 * v pokladně odepsáno je, patří sem „Ručně doloženo“, ne tohle. Kdy to jde
 * (stav skladu, poslední operace není hotová a nejasná je až po vypršení
 * platnosti), rozhoduje databáze. Právo `jine_platby.vydej_pos`.
 */
export async function zrusitSchvaleni(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_zrusit_schvaleni', { p_zaznam: p.z.id, p_duvod: duvod })
  if (error) return vysledekChyby(error, 'zrušení schválení výdeje')
  return hotovo(p, 'Schválení zrušeno — v pokladně se nic neodepisovalo. Sklad je zpět „bez návrhu“; po úpravě položek pošlete návrh znovu ke schválení.')
}

/** Korekce provedeného výdeje (ručně doložená). Práva `jine_platby.oprava` A `jine_platby.vydej_pos`. */
export async function korekceVydeje(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, ['jine_platby.oprava', 'jine_platby.vydej_pos'])
  if (!p.ok) return p.stav
  const doklad = pole(p.f, 'doklad').slice(0, 100)
  if (doklad === '') return chybaPole('doklad', 'Napište číslo opravného dokladu z pokladny.')
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_korekce_vydeje', { p_zaznam: p.z.id, p_doklad: doklad, p_duvod: duvod })
  if (error) return vysledekChyby(error, 'korekce výdeje')
  return hotovo(p, 'Korekce zapsaná. Původní výdej zůstává v historii.')
}

/* ------------------------------------------------------------------ */
/* Faktura a úhrada                                                     */
/* ------------------------------------------------------------------ */

/**
 * Faktura: `podklady` (sestaví server z ověřených údajů záznamu, ne
 * z prohlížeče), `propojit` existující fakturu (číslo, zdroj, částka),
 * `odpojit` s důvodem. Appka fakturu nevystavuje (otázka 51).
 */
export async function faktura(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.faktura')
  if (!p.ok) return p.stav
  const akce = pole(p.f, 'akce')

  if (akce === 'podklady') {
    const kontaktText = pole(p.f, 'kontakt')
    const kontaktId = kontaktText === '' ? p.z.kontaktId : kontaktText
    if (kontaktId !== null && !jeUuid(kontaktId)) return chybaPole('kontakt', 'Vybraný odběratel není platný.')

    // Kontakty patří celé firmě (RLS finance.read). Kdo je nevidí, dostane podklady bez odběratele.
    let kontakt: KontaktFaktury | null = null
    if (kontaktId) {
      const { data } = await p.supabase
        .from('kontakty')
        .select('id, nazev, ico, dic')
        .eq('id', kontaktId)
        .eq('tenant_id', p.tenantId)
        .is('deleted_at', null)
        .maybeSingle()
      kontakt = (data as KontaktFaktury | null) ?? null
    }
    const radky = await polozkyZaznamu(p)
    if (!radky) return chyba(HLASKA_OBECNA)
    const polozky = radky.map(zDbPolozka)
    const { podklady, chybi } = sestavitPodklady(p.z, polozky, kontakt)

    const { error } = await p.supabase.rpc('jine_platby_faktura', {
      p_zaznam: p.z.id,
      p_akce: 'podklady',
      p_data: { podklady: { ...podklady, chybi }, kontakt_id: kontakt?.id ?? null },
    })
    if (error) return vysledekChyby(error, 'podklady faktury')
    return hotovo(p, chybi.length === 0 ? 'Podklady pro fakturu uloženy — nic nechybí.' : `Podklady uloženy. Chybí: ${chybi.join('; ')}.`)
  }

  if (akce === 'propojit') {
    const cislo = pole(p.f, 'cislo')
    if (cislo === '' || cislo.length > 100) return chybaPole('cislo', 'Napište číslo faktury (nejvýš 100 znaků).')
    const zdroj = pole(p.f, 'zdroj')
    if (zdroj !== 'pos' && zdroj !== 'externi') return chybaPole('zdroj', 'Vyberte, kde byla faktura vystavena.')
    let castka: number | null = null
    const castkaText = pole(p.f, 'castka')
    if (castkaText !== '') {
      const c = prevestCastku(castkaText)
      if (c.stav !== 'ok' || c.haleru < 0) return chybaPole('castka', c.stav === 'nejasne' ? c.duvod : 'Částka faktury nesmí být záporná.')
      castka = c.haleru
    }
    const { error } = await p.supabase.rpc('jine_platby_faktura', {
      p_zaznam: p.z.id,
      p_akce: 'propojit',
      p_data: { cislo, zdroj, castka_haleru: castka },
    })
    if (error) return vysledekChyby(error, 'propojení faktury')
    return hotovo(p, `Faktura ${cislo} propojena. Faktura není tržba ani úhrada — úhradu ověří jen bankovní platba.`)
  }

  if (akce === 'odpojit') {
    const duvod = duvodZ(p)
    if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)
    const { error } = await p.supabase.rpc('jine_platby_faktura', { p_zaznam: p.z.id, p_akce: 'odpojit', p_data: { duvod } })
    if (error) return vysledekChyby(error, 'odpojení faktury')
    return hotovo(p, 'Faktura odpojena.')
  }

  return chyba('Neznámá akce s fakturou.')
}

/**
 * Úhrada = vazba na EXISTUJÍCÍ příchozí bankovní platbu (appka tím nepřidá
 * peníze do cashflow). Prázdná platba = odpojit. Právo `jine_platby.faktura`;
 * bankovní data navíc pustí databáze jen s finance.read k tomu účtu.
 */
export async function evidovatUhradu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.faktura')
  if (!p.ok) return p.stav

  const transakce = pole(p.f, 'transakce')
  let castka: number | null = null
  // Zrušený záznam úhradu nedostane (jeho částka se do rozdělení platby nepočítá,
  // takže by tatáž platba „zaplatila“ i jiný záznam). Odpojit jde vždy.
  if (transakce !== '' && p.z.stavKontroly === 'zruseno') return chyba('Záznam je zrušený — úhradu k němu napárovat nejde.')
  if (transakce !== '') {
    if (!jeUuid(transakce)) return chybaPole('transakce', 'Vyberte bankovní platbu.')
    const c = prevestCastku(pole(p.f, 'castka'))
    if (c.stav !== 'ok') return chybaPole('castka', c.stav === 'nejasne' ? c.duvod : 'Napište, kolik z platby patří k tomuto záznamu.')
    if (c.haleru <= 0) return chybaPole('castka', 'Částka úhrady musí být kladná.')
    castka = c.haleru
  }

  const { error } = await p.supabase.rpc('jine_platby_evidovat_uhradu', {
    p_zaznam: p.z.id,
    p_transakce: transakce === '' ? null : transakce,
    p_castka_haleru: castka,
  })
  if (error) return vysledekChyby(error, 'evidence úhrady')
  return hotovo(p, transakce === '' ? 'Úhrada odpojena — stav „Úhrada neověřena“.' : 'Úhrada napárována na bankovní platbu.')
}

/* ------------------------------------------------------------------ */
/* Mapování a zrušení                                                   */
/* ------------------------------------------------------------------ */

/** Zapamatovat ověřené přiřazení „název z dokladu → produkt v pokladně“. Právo `jine_platby.upravit`. */
export async function ulozitMapovani(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  if (!p.z.pripojeniId) return chyba('Záznam nemá pokladnu — není k čemu přiřazovat.')
  const alias = pole(p.f, 'alias').slice(0, 300)
  const produkt = pole(p.f, 'produkt').slice(0, 100)
  if (alias === '' || produkt === '') return chyba('Chybí název nebo produkt.')

  // Pokladnu bere databáze ze záznamu (ne z formuláře) a právo upravit ověří na jeho pobočce.
  const { error } = await p.supabase.rpc('jine_platby_ulozit_mapovani', { p_zaznam: p.z.id, p_alias: alias, p_pos_produkt_id: produkt })
  if (error) return vysledekChyby(error, 'uložení přiřazení')
  return hotovo(p, 'Přiřazení zapamatováno — příště se nabídne jako ověřené.')
}

/**
 * Zrušit záznam — jen dokud nic neproběhlo. Smí ten, kdo má právo na
 * opravy, nebo autor svého rozpracovaného záznamu (s právem zadat).
 */
export async function zrusit(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.oprava', { neboAutor: 'jine_platby.zadat' })
  if (!p.ok) return p.stav
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_zrusit', { p_zaznam: p.z.id, p_duvod: duvod })
  if (error) return vysledekChyby(error, 'zrušení záznamu')
  return hotovo(p, 'Záznam je zrušený. Zůstává v historii, nic se z něj nezapočítá.')
}
