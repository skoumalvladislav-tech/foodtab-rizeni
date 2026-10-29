'use server'

import {
  obnovitOperaci,
  provestOperaci,
  provozovnaProVydej,
  schopnostVydeje,
  type OperacePos,
  type PosProOperaci,
  type RepoOperaci,
  type ZaverOperace,
} from '@/lib/jine-platby-pos-operace'
import { otevritRelaciPokladny, type RelacePokladny } from '@/lib/pokladna-relace'
import type { RelacePos } from '@/lib/pos-provider-contract'
import { pocet } from '@/lib/sklonovani'
import { klientUlohy } from '@/lib/supabase/uloha'

import { chyba, hotovo, kalendarPobocky, obnovit, pripravit, vysledekChyby, type Pripraveno } from './[zaznam]/akce-zaklad'
import {
  dohledaniZUctu,
  HLASKA_BEZ_DOHLEDANI,
  HLASKA_PROVOZOVNA_JINDE,
  HLASKA_VERZE,
  jeHlaskaBezSurovin,
  jeHlaskaDuplicity,
  jeUuid,
  oknaKontroly,
  operaceZDb,
  pole,
  POPIS_VYSLEDKU_SKLADU,
  POPIS_VYSLEDKU_TRZBY,
  sloucitUcty,
  textChybyDb,
  verzeZFormulare,
  vyhodnotitKontroluSkladu,
  vyhodnotitKontroluTrzby,
  vysledekBezHledaniPodleUzavreni,
  zahajeniZDb,
  type DohledaniOdpisu,
  type DotazUctu,
  type StavAkce,
} from './[zaznam]/logika'

/**
 * Jiné platby — akce, které mluví s pokladnou: kontrola tržby a výdeje
 * v pokladně, „Potvrdit výdej do POS“ a provedení / dohledání operace,
 * nový pokus po prokázané chybě, načtení katalogu.
 *
 * Pokladnu zná jen přes kontrakt (`RelacePos`, `SchopnostiPosProvidera`,
 * lib/pokladna-relace.ts) — Dotykačku tu nikdo nezná.
 *
 * ---------------------------------------------------------------------
 * SERVICE_ROLE (`klientUlohy()`) — kde a proč
 *
 * Tři zápisy smí jen server, ne prohlížeč: výsledek dohledání v pokladně
 * (`jine_platby_zapsat_kontrolu`, zdroj „pos_api“ nesmí jít podvrhnout),
 * zabrání a ukončení operace (`pos_operace_zahajit` / `_dokoncit`)
 * a katalog (`pos_katalog_nahradit`). Ty funkce mají grant jen pro
 * service_role a práva si NEOVĚŘUJÍ. Proto se `klientUlohy()` volá vždy
 * až po `pripravit(…)` — firma z členství, záznam přes RLS a právo agendy
 * na pobočce záznamu ověřené UŽIVATELSKÝM klientem — a jen s id záznamu
 * a připojení z toho ověřeného záznamu, nikdy s id z formuláře. Funkce,
 * které ho volají, berou `p: Pripraveno` (bez prošlé kontroly se k nim
 * nejde dostat). Hlídá scripts/jine-platby-detail.test.mjs.
 *
 * ---------------------------------------------------------------------
 * ZÁPIS DO POKLADNY JEN PŘES ORCHESTRÁTOR
 *
 * Výdej se nikdy neposílá přímo. Jediná cesta je `provestOperaci`
 * (lib/jine-platby-pos-operace.ts): zabrat v databázi → odeslat jednou →
 * ověřit dohledáním podle klíče → teprve pak „úspěch“. Nejasný výsledek
 * se NEOPAKUJE, jen dohledává (`obnovitOperaci`). Metoda zápisu z relace
 * se předává jen uvnitř `posProOperaci`.
 */

type RelaceOk = Extract<RelacePokladny, { stav: 'ok' }>
type Uloha = NonNullable<ReturnType<typeof klientUlohy>>

const BEZ_SLUZBY = 'Spojení s pokladnou není na serveru nastavené (chybí SUPABASE_SERVICE_ROLE_KEY). Použijte ruční prohlášení s důvodem.'
const SLOUPCE_OPERACE = 'id, idempotencni_klic, stav, pokusu, platnost_do, externi_provozovna, polozky, poznamka, zahajeno'

/* ------------------------------------------------------------------ */
/* Kontrola v pokladně                                                  */
/* ------------------------------------------------------------------ */

/** Je prodej z dokladu už v tržbách pokladny? Právo `jine_platby.trzba`. */
export async function zkontrolovatTrzbu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.trzba')
  if (!p.ok) return p.stav
  if (verzeZFormulare(p.f) !== p.z.verze) return chyba(HLASKA_VERZE)
  return kontrolaVPokladne(p, 'trzba')
}

/** Odečetla už pokladna spotřebu? Těsně před schválením výdeje. Právo `jine_platby.vydej_pos`. */
export async function zkontrolovatSklad(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  if (verzeZFormulare(p.f) !== p.z.verze) return chyba(HLASKA_VERZE)
  return kontrolaVPokladne(p, 'sklad')
}

async function kontrolaVPokladne(p: Pripraveno, druh: 'trzba' | 'sklad'): Promise<StavAkce> {
  if (!p.z.pripojeniId) return chyba('Záznam nemá připojenou pokladnu — použijte ruční prohlášení s důvodem.')
  // Otevření relace čte zašifrovaný přístup přes service_role (lib/pokladna-relace.ts) —
  // až teď, po pripravit(), a jen s připojením z ověřeného záznamu.
  const rel = await otevritRelaciPokladny(p.z.pripojeniId, p.tenantId)
  if (rel.stav !== 'ok') return chyba(`Pokladnu se nepodařilo otevřít: ${rel.duvod}`)

  const v = await zjistitVPokladne(p, rel, druh)
  if ('chyba' in v) return chyba(v.chyba)

  const zapis = await zapsatKontrolu(p, druh, v)
  if (zapis) return zapis
  const nazev = druh === 'trzba' ? POPIS_VYSLEDKU_TRZBY[v.vysledek as keyof typeof POPIS_VYSLEDKU_TRZBY] : POPIS_VYSLEDKU_SKLADU[v.vysledek as keyof typeof POPIS_VYSLEDKU_SKLADU]
  return hotovo(p, `${nazev} (ověřeno dotazem do pokladny). ${v.popis}`)
}

type Zjisteno = { vysledek: string; detail: Record<string, unknown>; popis: string }

/**
 * Dotaz do pokladny a vyhodnocení (./[zaznam]/logika.ts). Nic nezapisuje.
 * „Nenalezeno“ / „neodečteno“ vyjde jen u uzavřeného prodeje a ručního
 * seznamu spotřeby (`TYP_PROKAZE_NEPRITOMNOST`) — jinak by ho
 * `jine_platby_zapsat_kontrolu` odmítl (C4).
 */
async function zjistitVPokladne(p: Pripraveno, rel: RelaceOk, druh: 'trzba' | 'sklad'): Promise<Zjisteno | { chyba: string }> {
  const relace = rel.relace
  const ucty = relace.ucty?.bind(relace)
  const podleKlice = relace.ucetPodleKlice?.bind(relace)
  // Pokladna, která účty dohledat neumí: nic se nevolá ani nezapisuje.
  if (!rel.schopnosti.dohledaniUctu || !ucty || (druh === 'sklad' && !podleKlice)) return { chyba: HLASKA_BEZ_DOHLEDANI }
  if (!p.z.datumProdeje) return { chyba: 'Doplňte datum prodeje — bez něj není kde v pokladně hledat.' }

  // Provozovna pokladny: u připojení celé firmy ji nese záznam, u připojení
  // pobočky přiřazení provozoven (`externi_ucet.provozovny[]`).
  // Uložená provozovna platí, jen když ji AKTUÁLNÍ přiřazení pořád dává pobočce
  // záznamu: po přeřazení v Integracích by se hledalo v pokladně cizí pobočky
  // a „nenalezeno“ by odemklo druhou tržbu (výdej hlídá databáze, jp_pokladna_obsluhuje).
  if (p.z.posProvozovna && !rel.provozovny.some((o) => o.id === p.z.posProvozovna && o.branch_id === p.z.branchId)) {
    return { chyba: HLASKA_PROVOZOVNA_JINDE }
  }
  const provozovny = p.z.posProvozovna ? [p.z.posProvozovna] : rel.provozovny.filter((o) => o.branch_id === p.z.branchId).map((o) => o.id)
  if (provozovny.length === 0) return { chyba: 'Provozovna pokladny není přiřazená k pobočce (Integrace → Pokladní systémy) — není kde hledat.' }

  // Dva dotazy na provozovnu (oknaKontroly, ./[zaznam]/logika.ts):
  //   * uzavřené účty podle data UZAVŘENÍ, provozní den −1 až +2 — účet otevřený
  //     den předem a uzavřený den prodeje (nebo po něm) okno podle vytvoření mine;
  //   * otevřené účty podle vytvoření, od dne −60 — otevřený účet může běžet týdny.
  // Výsledky se sloučí bez opakování; úplné jsou jen tehdy, když jsou úplné oba.
  const kal = await kalendarPobocky(p.supabase, p.tenantId, p.z.branchId)
  const okna = oknaKontroly(p.z.datumProdeje, kal.denZacina, kal.pasmo)
  const okno = { ...okna.uzavrene, otevrene: okna.otevrene }

  const dotazy: DotazUctu[] = []
  for (const provozovna of provozovny) {
    const uzavrene = await ucty(provozovna, okna.uzavrene.odMs, okna.uzavrene.doMs, { podle: 'uzavreni' })
    if (uzavrene.stav !== 'ok') {
      // Trvalá chyba (pokladna hledání podle uzavření neumí): výsledek „nelze ověřit“ s vysvětlením —
      // okno podle vytvoření by bylo jen odhadem. Dočasná chyba NENÍ výsledek: nic se nezapíše.
      if (uzavrene.druh === 'jina') return vysledekBezHledaniPodleUzavreni(druh, uzavrene.duvod, okna, provozovny)
      return { chyba: `Pokladna teď neodpověděla: ${uzavrene.duvod}` }
    }
    const otevrene = await ucty(provozovna, okna.otevrene.odMs, okna.otevrene.doMs, { jenOtevrene: true })
    // Chyba pokladny NENÍ výsledek kontroly — nic se nezapíše, starší kontrola zůstane.
    if (otevrene.stav !== 'ok') return { chyba: `Pokladna teď neodpověděla: ${otevrene.duvod}` }
    dotazy.push(sloucitUcty(provozovna, uzavrene, otevrene))
  }

  if (druh === 'trzba') return vyhodnotitKontroluTrzby(p.z, dotazy, okno)

  // Sklad: navíc výdeje, které appka k záznamu už kdy připravila (podle klíče).
  const { data: operace, error } = await p.supabase
    .from('pos_operace')
    .select('idempotencni_klic')
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .limit(50)
  if (error) return { chyba: 'Předchozí výdeje se nepodařilo načíst — nejde vyloučit, že už proběhly.' }
  const odpisy: DohledaniOdpisu[] = []
  for (const klic of [...new Set(((operace ?? []) as { idempotencni_klic: string }[]).map((o) => o.idempotencni_klic))]) {
    const r = await podleKlice!(klic)
    odpisy.push({ klic, odpoved: r.stav === 'ok' ? r : { stav: 'chyba', duvod: r.duvod } })
  }
  return vyhodnotitKontroluSkladu(p.z, dotazy, odpisy, okno)
}

/** Zapíše výsledek dohledání. `null` = zapsáno; jinak stav s chybou. */
async function zapsatKontrolu(p: Pripraveno, druh: 'trzba' | 'sklad', v: Zjisteno): Promise<StavAkce | null> {
  // SERVICE_ROLE: `jine_platby_zapsat_kontrolu` (zdroj „pos_api“) smí jen server — po pripravit()
  // (právo trzba/vydej_pos na pobočce záznamu ověřené uživatelským klientem), s id ověřeného záznamu.
  const uloha = klientUlohy()
  if (!uloha) return chyba(BEZ_SLUZBY)
  const { error } = await uloha.rpc('jine_platby_zapsat_kontrolu', {
    p_zaznam: p.z.id,
    p_verze: p.z.verze,
    p_druh: druh,
    p_vysledek: v.vysledek,
    p_detail: { ...v.detail, popis: v.popis },
    p_kdo: p.uzivatelId,
  })
  if (error) return vysledekChyby(error, 'zápis kontroly v pokladně')
  return null
}

/* ------------------------------------------------------------------ */
/* Výdej do POS                                                         */
/* ------------------------------------------------------------------ */

/**
 * „Potvrdit výdej do POS“ nebo „Zamítnout“ (s povinným důvodem).
 * Schválení drží otisk návrhu (skryté pole) — databáze ho porovná
 * s obsahem, který sama znovu sestaví, a chce čerstvou kontrolu
 * „neodečteno“. Po schválení se operace rovnou provede (u pokladny
 * bez zápisu přes API ji orchestrátor sám uzavře jako „nepodporováno“).
 *
 * `p_duvod` znamená u každého rozhodnutí něco jiného, proto dvě pole:
 * zamítnutí → `duvod` (důvod zamítnutí, povinný); schválení →
 * `duplicita_duvod` (proč to není duplicita výdeje, nepovinné — databáze
 * ho chce, jen když najde podobný výdej téže pobočky).
 *
 * Výdej s pokrmem i kusovým zbožím (varování náhledu `jine_platby_sestavit_vydej`)
 * databáze schválí jen s `p_bez_surovin = true` — zaškrtnutím „Zboží není
 * surovina toho pokrmu“ (`bez_surovin`). Akce ho pošle jen se zaškrtnutím
 * a jen když aktuální náhled varování opravdu má (C6).
 */
export async function rozhodnoutVydej(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav

  const navrhId = pole(p.f, 'navrh')
  const otisk = pole(p.f, 'otisk')
  const rozhodnuti = pole(p.f, 'rozhodnuti')
  if (!jeUuid(navrhId) || !/^[0-9a-f]{64}$/.test(otisk)) return chyba('Formulář je zastaralý — načtěte stránku znovu.')
  if (rozhodnuti !== 'schvalit' && rozhodnuti !== 'zamitnout') return chyba('Vyberte, jestli výdej potvrdit, nebo zamítnout.')
  const duvod = pole(p.f, 'duvod')
  if (rozhodnuti === 'zamitnout' && duvod.length < 5) return { stav: 'chyba', text: 'Napište důvod zamítnutí.', chyby: { duvod: 'Napište důvod zamítnutí.' } }
  const duplicita = pole(p.f, 'duplicita_duvod')
  if (rozhodnuti === 'schvalit' && duplicita !== '' && duplicita.length < 5) {
    return { stav: 'chyba', text: 'Napište, proč to není duplicita (aspoň pár slov).', chyby: { duplicita_duvod: 'Napište, proč to není duplicita (aspoň pár slov).' } }
  }

  // Návrh musí patřit TOMUHLE (ověřenému) záznamu — id z formuláře je jen návrh.
  const { data: navrh, error: chybaNavrhu } = await p.supabase
    .from('jine_platby_skladove_navrhy')
    .select('id')
    .eq('id', navrhId)
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .maybeSingle()
  if (chybaNavrhu || !navrh) return chyba('Návrh výdeje se k tomuto záznamu nenašel.')

  // Pokrm i kusové zboží ve výdeji (varování náhledu): schválení chce výslovné „zboží není surovina
  // toho pokrmu“ (`p_bez_surovin`). Posílá se jen se zaškrtnutím A při varování v AKTUÁLNÍM náhledu
  // z databáze — ne podle formuláře, který mohl vzniknout nad jiným obsahem.
  let bezSurovin = false
  if (rozhodnuti === 'schvalit' && pole(p.f, 'bez_surovin') === 'ano') {
    const { data: nahled, error: chybaNahledu } = await p.supabase.rpc('jine_platby_sestavit_vydej', { p_zaznam: p.z.id })
    if (chybaNahledu) return vysledekChyby(chybaNahledu, 'náhled výdeje')
    const varovani = (nahled as { varovani?: unknown } | null)?.varovani
    bezSurovin = Array.isArray(varovani) && varovani.length > 0
  }

  const { error } = await p.supabase.rpc('jine_platby_rozhodnout_vydej', {
    p_navrh: navrhId,
    p_otisk: otisk,
    p_schvalit: rozhodnuti === 'schvalit',
    p_duvod: rozhodnuti === 'zamitnout' ? duvod.slice(0, 1000) : duplicita === '' ? null : duplicita.slice(0, 1000),
    p_bez_surovin: bezSurovin,
  })
  if (error) {
    const stav = vysledekChyby(error, 'rozhodnutí o výdeji')
    if (rozhodnuti !== 'schvalit' || error.code !== '23514') return stav
    // „Možná duplicita výdeje…“ → k poli s důvodem, „pokrm i kusové zboží“ → k zaškrtnutí (formulář ho zaměří, napsaný text zůstane).
    if (jeHlaskaDuplicity(stav.text)) return { ...stav, chyby: { duplicita_duvod: stav.text } }
    if (jeHlaskaBezSurovin(stav.text)) return { ...stav, chyby: { bez_surovin: stav.text } }
    return stav
  }
  if (rozhodnuti === 'zamitnout') return hotovo(p, 'Výdej zamítnut s důvodem. Sklad se nemění.')

  const provedeni = await provestPripravenou(p)
  return { ...provedeni, text: `Výdej do POS potvrzen. ${provedeni.text}` }
}

/** Provést připravenou operaci (třeba když po schválení provedení selhalo). Právo `jine_platby.vydej_pos`. */
export async function provestVydej(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  return provestPripravenou(p)
}

/** Nový pokus po PROKÁZANÉ chybě (databáze to hlídá) a rovnou provedení. Právo `jine_platby.vydej_pos`. */
export async function vydejZnovu(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const { error } = await p.supabase.rpc('jine_platby_vydej_znovu', { p_zaznam: p.z.id })
  if (error) return vysledekChyby(error, 'nový pokus o výdej')
  const provedeni = await provestPripravenou(p)
  return { ...provedeni, text: `Nový pokus připraven. ${provedeni.text}` }
}

/**
 * Dohledat nejasný nebo zaseknutý výdej podle klíče. NIKDY neodesílá
 * znovu. Právo `jine_platby.vydej_pos`.
 */
export async function obnovitVydej(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.vydej_pos')
  if (!p.ok) return p.stav
  const op = await posledniOperace(p)
  if (!op) return chyba('Výdej k dohledání se nenašel.')
  if (op.stav !== 'nejasny_vysledek' && op.stav !== 'odesila_se') return chyba(`Výdej není ve stavu k dohledání (stav ${op.stav}).`)
  if (!p.z.pripojeniId) return chyba('Záznam nemá připojenou pokladnu.')

  // Otevření relace (service_role uvnitř lib/pokladna-relace.ts) až po pripravit().
  const rel = await otevritRelaciPokladny(p.z.pripojeniId, p.tenantId)
  if (rel.stav !== 'ok') return chyba(`Pokladnu se nepodařilo otevřít: ${rel.duvod}`)
  // SERVICE_ROLE: `pos_operace_dokoncit` smí jen server — po pripravit() (vydej_pos na pobočce záznamu),
  // s operací načtenou uživatelským klientem k ověřenému záznamu.
  const uloha = klientUlohy()
  if (!uloha) return chyba(BEZ_SLUZBY)

  try {
    const zaver = await obnovitOperaci(op, repoOperaci(uloha), posProOperaci(rel.relace, rel.schopnosti.skladovyVydej ?? 'nepodporovano'), Date.now())
    if (zaver.stav === 'beze_zmeny') {
      obnovit(p)
      return { stav: 'ok', text: `Zatím beze změny: ${zaver.duvod}` }
    }
    return zaverNaStav(p, zaver)
  } catch (e) {
    obnovit(p)
    console.error('Jiné platby: dohledání výdeje selhalo:', e instanceof Error ? e.message : e)
    return chyba('Výsledek dohledání se nepodařilo uložit — výdej zůstává k dohledání. Nic neopakujte, zkuste dohledat znovu.')
  }
}

/** Poslední operace výdeje k záznamu (uživatelský klient, RLS). */
async function posledniOperace(p: Pripraveno): Promise<OperacePos | null> {
  const { data, error } = await p.supabase
    .from('pos_operace')
    .select(SLOUPCE_OPERACE)
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .eq('druh', 'vydej')
    .order('zahajeno', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return operaceZDb(data as Record<string, unknown> | null)
}

/**
 * Provede poslední připravenou operaci přes orchestrátor. U pokladny,
 * která zápis přes API umí, se těsně předtím znovu zkontroluje sklad
 * (pokladna mohla mezitím odečíst sama) — a databáze při zabrání chce
 * čerstvou kontrolu „neodečteno“ taky.
 */
async function provestPripravenou(p: Pripraveno): Promise<StavAkce> {
  const op = await posledniOperace(p)
  if (!op) {
    obnovit(p)
    return chyba('Připravený výdej se nenašel.')
  }
  if (op.stav !== 'pripraveno') {
    obnovit(p)
    return chyba(`Výdej není připravený k provedení (stav ${op.stav}).`)
  }
  if (!p.z.pripojeniId) return chyba('Záznam nemá připojenou pokladnu.')

  // Otevření relace (service_role uvnitř lib/pokladna-relace.ts) až po pripravit().
  const rel = await otevritRelaciPokladny(p.z.pripojeniId, p.tenantId)
  if (rel.stav !== 'ok') {
    obnovit(p)
    return chyba(`Pokladnu se nepodařilo otevřít: ${rel.duvod} Výdej zůstává připravený.`)
  }
  // 'api' jen pro provozovnu, do které relace zápis povoluje (ZAPIS_VYDEJE_DOTYKACKA,
  // dnes žádná); jinak ručně. Kam požadavek opravdu půjde, rozhodne databáze při zabrání.
  const schopnost = schopnostVydeje(rel.schopnosti.skladovyVydej, rel.relace, provozovnaProVydej(p.z.posProvozovna, p.z.branchId, rel.provozovny))

  if (schopnost === 'api') {
    const v = await zjistitVPokladne(p, rel, 'sklad')
    if ('chyba' in v) {
      obnovit(p)
      return chyba(`Těsně před výdejem se pokladnu nepodařilo zkontrolovat: ${v.chyba} Nic se neodeslalo.`)
    }
    const zapis = await zapsatKontrolu(p, 'sklad', v)
    if (zapis) return zapis
    if (v.vysledek !== 'neodecteno') {
      obnovit(p)
      return chyba(`Nic se neodeslalo: ${v.popis}`)
    }
  }

  // SERVICE_ROLE: `pos_operace_zahajit` / `pos_operace_dokoncit` smí jen server — po pripravit()
  // (vydej_pos na pobočce záznamu), s operací načtenou uživatelským klientem k ověřenému záznamu.
  const uloha = klientUlohy()
  if (!uloha) return chyba(BEZ_SLUZBY)

  try {
    const zaver = await provestOperaci(op, repoOperaci(uloha), posProOperaci(rel.relace, schopnost), Date.now())
    return zaverNaStav(p, zaver)
  } catch (e) {
    obnovit(p)
    console.error('Jiné platby: provedení výdeje selhalo:', e instanceof Error ? e.message : e)
    return chyba('Výsledek výdeje se nepodařilo uložit — zůstává „odesílá se“ a dohledá se tlačítkem „Dohledat v pokladně“. Nic neopakujte.')
  }
}

function zaverNaStav(p: Pripraveno, zaver: ZaverOperace | { stav: 'obsazeno' } | { stav: 'nelze'; duvod: string }): StavAkce {
  switch (zaver.stav) {
    case 'uspech':
      return hotovo(p, `Odečteno v POS — pokladna výdej vrátila podle klíče${zaver.doklad ? ` (doklad ${zaver.doklad})` : ''}.`)
    case 'nepodporovano':
      return hotovo(p, `${zaver.duvod}. Postup je u výdeje; po provedení v pokladně použijte „Ručně doloženo“.`)
    case 'nejasny_vysledek':
      obnovit(p)
      return chyba(`Nejasný výsledek: ${zaver.duvod}. Výdej se NEOPAKUJE — použijte „Dohledat v pokladně“.`)
    case 'chyba':
      obnovit(p)
      return chyba(`${zaver.duvod}. Pokladna výdej neprovedla.`)
    case 'obsazeno':
      obnovit(p)
      return chyba('Výdej právě zpracovává někdo jiný — počkejte a obnovte stránku.')
    case 'nelze':
      obnovit(p)
      return chyba(zaver.duvod)
  }
}

/** Repo orchestrátoru nad funkcemi pro service_role. Výjimka = výsledek se neuložil (orchestrátor ji pustí ven). */
function repoOperaci(uloha: Uloha): RepoOperaci {
  return {
    async zahajit(opId, platnostDoIso) {
      const { data, error } = await uloha.rpc('pos_operace_zahajit', { p_operace: opId, p_platnost_do: platnostDoIso })
      if (error) throw new Error(textChybyDb(error))
      return zahajeniZDb(data)
    },
    async dokoncit(opId, zaver) {
      const uspech = zaver.stav === 'uspech' ? zaver : null
      const { error } = await uloha.rpc('pos_operace_dokoncit', {
        p_operace: opId,
        p_stav: zaver.stav,
        p_externi_id: uspech ? uspech.externiId : null,
        p_doklad: uspech ? uspech.doklad : null,
        p_vysledek: uspech ? uspech.vysledek : null,
        p_chyba: zaver.stav === 'uspech' ? null : zaver.duvod,
      })
      if (error) throw new Error(textChybyDb(error))
    },
  }
}

/**
 * Pokladna pro orchestrátor. JEDINÉ místo, kde se sahá na zápis do
 * pokladny — a i tady se jen předá orchestrátoru, nevolá se.
 *
 * Metodu zápisu (`RelacePos.skladovyVydej`) má relace jen pro cloud
 * s provozovnou v `ZAPIS_VYDEJE_DOTYKACKA` (lib/pokladna-dotykacka-zapis.ts)
 * — dnes žádný. Bez ní `odeslat` chybí a orchestrátor sám uzavře operaci
 * jako „nepodporováno“ — nic neodejde. `odeslat` se předá jen se
 * schopností 'api' (`schopnostVydeje` — provozovna záznamu povolená).
 */
function posProOperaci(relace: RelacePos, schopnost: 'api' | 'rucne' | 'nepodporovano'): PosProOperaci {
  const zapis = relace.skladovyVydej?.bind(relace)
  const podleKlice = relace.ucetPodleKlice?.bind(relace)
  return {
    schopnost,
    odeslat: schopnost === 'api' && zapis ? (op: OperacePos) => zapis(op) : undefined,
    dohledat: podleKlice ? async (klic) => dohledaniZUctu(await podleKlice(klic)) : undefined,
  }
}

/* ------------------------------------------------------------------ */
/* Katalog                                                              */
/* ------------------------------------------------------------------ */

/** Načíst katalog produktů z pokladny (pro přiřazení položek). Právo `jine_platby.upravit`. */
export async function nacistKatalog(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  if (!p.z.pripojeniId) return chyba('Záznam nemá pokladnu — katalog není odkud načíst.')

  // Otevření relace (service_role uvnitř lib/pokladna-relace.ts) až po pripravit().
  const rel = await otevritRelaciPokladny(p.z.pripojeniId, p.tenantId)
  if (rel.stav !== 'ok') return chyba(`Pokladnu se nepodařilo otevřít: ${rel.duvod}`)
  const katalog = rel.relace.katalog?.bind(rel.relace)
  if (!rel.schopnosti.katalog || !katalog) return chyba('Pokladna katalog neposílá — položky přiřazujte podle názvů z prodeje.')

  const r = await katalog()
  if (r.stav !== 'ok') return chyba(`Katalog se nepodařilo načíst: ${r.duvod}`)

  // SERVICE_ROLE: `pos_katalog_nahradit` smí jen server — po pripravit() (upravit na pobočce záznamu),
  // s připojením z ověřeného záznamu; obsah je jen to, co vrátila pokladna.
  const uloha = klientUlohy()
  if (!uloha) return chyba(BEZ_SLUZBY)
  const { data, error } = await uloha.rpc('pos_katalog_nahradit', {
    p_pripojeni: p.z.pripojeniId,
    p_produkty: r.produkty.map((x) => ({
      externi_id: x.externiId,
      nazev: x.nazev,
      jednotka: x.jednotka,
      mira: x.mira,
      odecita_sklad: x.odecitaSklad,
      ma_recepturu: x.maRecepturu,
      // Receptura (pole surovin, nebo null = neví se); databáze z ní odvodí ma_recepturu.
      suroviny: x.suroviny ?? null,
      plu: x.plu,
      ean: x.ean,
      smazano: x.smazano,
    })),
  })
  if (error) return vysledekChyby(error, 'uložení katalogu')
  const nacteno = Number(data ?? r.produkty.length)
  // Bez receptur (403, nebo jim appka nerozuměla) se katalog načetl bez nich a uložené receptury se vymazaly — člověk to má vědět.
  // U „tvar" se připojí i popis (jen struktura odpovědi) — podle něj jde čtení receptur opravit.
  const bezReceptur = !r.bezReceptur
    ? ''
    : r.bezRecepturProc === 'tvar'
      ? ` Odpovědi s recepturami pokrmů appka nerozuměla${r.bezRecepturPopis ? ` (${r.bezRecepturPopis})` : ''}, proto se katalog načetl bez receptur — upozornění na suroviny pokrmu ve výdeji budou jen obecná.`
      : ' Receptury pokrmů pokladna appce nevydala (chybí právo na jejich čtení) — upozornění na suroviny pokrmu ve výdeji budou jen obecná.'
  // Položky bez čitelného id nejde přiřadit ani odepsat — katalog bez nich nesmí vypadat jako celý,
  // a kdyby dřív id měly, uložený záznam se tím označí jako smazaný.
  const vynechano = r.vynechanoBezId ?? 0
  const ji = vynechano === 1 ? 'ji' : 'je'
  const bezId =
    vynechano > 0
      ? ` Bez čitelného id pokladna poslala ${pocet(vynechano, 'položku', 'položky', 'položek')}${r.vynechanoPopis ? ` (${vynechano === 1 ? '' : 'první: '}${r.vynechanoPopis})` : ''} — appka ${ji} vynechala, přiřadit ani odepsat ${ji} nejde.`
      : ''
  return hotovo(p, `Z pokladny načteno: ${pocet(nacteno, 'položka', 'položky', 'položek')} katalogu (produkty i suroviny). Co v pokladně už není, je označené jako smazané.${bezReceptur}${bezId}`)
}
