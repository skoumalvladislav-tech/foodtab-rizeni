'use server'

import { prevestCastku } from '@/lib/jine-platby-castky'
import { doDbHlavicka, doDbPolozky, SLOUPCE_POLOZKY, zDbPolozka } from '@/lib/jine-platby-db'
import { sestavitPodklady, type KontaktFaktury } from '@/lib/jine-platby-faktura'
import type { ProduktKatalogu } from '@/lib/jine-platby-mapovani'

import { chyba, hotovo, katalogPripojeni, pripravit, vysledekChyby, type Pripraveno } from './[zaznam]/akce-zaklad'
import { HLASKA_OBECNA, jeUuid, nacistNavrh, pole, verzeZFormulare, type StavAkce } from './[zaznam]/logika'

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
 * (odeslání návrhu `jine_platby.sklad_odeslat`) a nikdy nevolají tržní.
 * Proto jsou prohlášení rozdělená na `prohlasitTrzbu` a `prohlasitSklad`.
 * Hlídá scripts/jine-platby-detail.test.mjs.
 *
 * Formuláře: `useActionState` se stavem `{ stav: 'nic' | 'ok' | 'chyba', text }`.
 */

const HLASKA_ZASTARALY = 'Formulář je zastaralý — načtěte stránku znovu.'
const HLASKA_DUVOD = 'Napište důvod (aspoň pár slov).'

/** Povinný důvod (databáze chce aspoň 5 znaků, `app.jp_duvod`). `null` = chybí. */
function duvodZ(p: Pripraveno, nazev = 'duvod'): string | null {
  const d = pole(p.f, nazev)
  return d.length >= 5 ? d.slice(0, 1000) : null
}

const chybaPole = (nazev: string, text: string): StavAkce => ({ stav: 'chyba', text, chyby: { [nazev]: text } })

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

  const { data: radky, error: chybaPolozek } = await p.supabase
    .from('jine_platby_polozky')
    .select(SLOUPCE_POLOZKY)
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .order('poradi')
  if (chybaPolozek) return chyba(HLASKA_OBECNA)
  const puvodni = ((radky ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ ...zDbPolozka(r), id: String(r.id) }))

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

  const nezapamatovano: string[] = []
  if (p.z.pripojeniId) {
    for (const a of navrh.zapamatovat) {
      const { error: chybaAliasu } = await p.supabase.rpc('jine_platby_ulozit_mapovani', {
        p_pripojeni: p.z.pripojeniId,
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

export async function oznacitZkontrolovano(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const { error } = await p.supabase.rpc('jine_platby_oznacit_zkontrolovano', { p_zaznam: p.z.id, p_verze: verze })
  if (error) return vysledekChyby(error, 'označení zkontrolováno')
  return hotovo(p, 'Záznam je zkontrolovaný. Tržba ani sklad se tím nemění — to jsou další kroky.')
}

/* ------------------------------------------------------------------ */
/* Ruční prohlášení (NENÍ automatické ověření)                          */
/* ------------------------------------------------------------------ */

const NEVIM =
  'Když to nevíte jistě, nic se nezapíše. Ověřte to v pokladně (nebo u toho, kdo účet uzavíral) a pak to doložte, nebo nechte appku zkontrolovat pokladnu.'

/** Ruční prohlášení k TRŽBĚ: prodej v pokladně je / není. Právo `jine_platby.trzba`. */
export async function prohlasitTrzbu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.trzba')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze === null) return chyba(HLASKA_ZASTARALY)

  const volba = pole(p.f, 'vysledek')
  if (volba === 'nevim') return chyba(NEVIM)
  if (volba !== 'je' && volba !== 'neni') return chybaPole('vysledek', 'Vyberte, jestli prodej v pokladně je, nebo není.')
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
  })
  if (error) return vysledekChyby(error, 'ruční prohlášení k tržbě')
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
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_prohlasit', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_druh: 'sklad',
    p_vysledek: volba === 'je' ? 'jiz_odecteno' : 'neodecteno',
    p_duvod: duvod,
    p_pos_prodej_id: null,
  })
  if (error) return vysledekChyby(error, 'ruční prohlášení ke skladu')
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

  const { error } = await p.supabase.rpc('jine_platby_potvrdit_trzbu', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_rezim: rezim,
    p_duplicita_duvod: duplicita === '' ? null : duplicita.slice(0, 1000),
  })
  if (error) return vysledekChyby(error, 'potvrzení tržby')
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
 */
export async function rucneDolozit(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const doklad = pole(p.f, 'doklad').slice(0, 100)
  if (doklad === '') return chybaPole('doklad', 'Napište číslo dokladu z pokladny (výdejka, odpis).')
  const duvod = duvodZ(p)
  if (!duvod) return chybaPole('duvod', HLASKA_DUVOD)

  const { error } = await p.supabase.rpc('jine_platby_rucne_dolozit_vydej', { p_zaznam: p.z.id, p_doklad: doklad, p_duvod: duvod })
  if (error) return vysledekChyby(error, 'ruční doložení výdeje')
  return hotovo(p, 'Ručně doloženo. Stav skladu je „Ručně doloženo (neověřeno pokladnou)“ — není to automatické ověření.')
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
    const { data: radky, error: chybaPolozek } = await p.supabase
      .from('jine_platby_polozky')
      .select(SLOUPCE_POLOZKY)
      .eq('zaznam_id', p.z.id)
      .eq('tenant_id', p.tenantId)
      .order('poradi')
    if (chybaPolozek) return chyba(HLASKA_OBECNA)
    const polozky = ((radky ?? []) as unknown as Record<string, unknown>[]).map(zDbPolozka)
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

  const { error } = await p.supabase.rpc('jine_platby_ulozit_mapovani', { p_pripojeni: p.z.pripojeniId, p_alias: alias, p_pos_produkt_id: produkt })
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
