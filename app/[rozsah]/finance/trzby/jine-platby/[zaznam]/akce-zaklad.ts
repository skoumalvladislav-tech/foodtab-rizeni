import 'server-only'

import { revalidatePath } from 'next/cache'

import { getUser, hasAccess, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { ZONA_VYCHOZI } from '@/lib/cas'
import { zaznamPatriRozsahu } from '@/lib/finance-evidence-pobocka'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { getCurrentTenantId } from '@/lib/firma'
import { SLOUPCE_ZAZNAMU, zDbZaznam } from '@/lib/jine-platby-db'
import type { AliasMapovani, ProduktKatalogu } from '@/lib/jine-platby-mapovani'
import { zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import type { PravoJinychPlateb, ZaznamJinePlatby } from '@/lib/jine-platby-typy'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import { HLASKA_NENALEZENO, HLASKA_OBECNA, HLASKA_PRAVO, jeUuid, pole, textChybyDb, zFormData, type StavAkce, type VstupFormulare } from './logika'

/**
 * Společný vstup serverových akcí detailu Jiných plateb
 * (../akce.ts, ../akce-pos.ts, ../akce-ai.ts).
 *
 * Tenhle soubor NENÍ 'use server' — jeho exporty se z prohlížeče volat
 * nedají (v souboru s 'use server' by se každá exportovaná funkce stala
 * veřejnou akcí). Akce ho jen volají.
 *
 * ---------------------------------------------------------------------
 * POŘADÍ V `pripravit` (hlídá scripts/jine-platby-detail.test.mjs)
 *
 *   1. firma z členství (`getCurrentTenantId`) — NIKDY z formuláře;
 *   2. vstup do agendy v rozsahu adresy (`zkusPristupJinymPlatbam`;
 *      rozsah z formuláře je jen návrh, ověří ho členství);
 *   3. záznam uživatelským klientem s `.eq('tenant_id', tenantId)` —
 *      RLS rozhodne o pobočce; na pobočce navíc jen záznam TÉ pobočky;
 *   4. právo agendy NA POBOČCE ZÁZNAMU (`hasAccess(…, z.branchId)`) —
 *      stejná otázka, jakou si položí databázová funkce. Teprve pak smí
 *      akce volat RPC (databáze právo ověří znovu — druhá linie).
 *
 * Proč pobočka záznamu, ne rozsah adresy: v rozsahu celé firmy jsou
 * práva „za firmu“ (`has_access(…, null)`), ale zapisovací funkce se ptá
 * na pobočku záznamu. Ptáme se na totéž, ať tlačítko neslibuje, co
 * databáze odmítne.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

export type Pripraveno = {
  ok: true
  supabase: Supabase
  tenantId: string
  z: ZaznamJinePlatby
  f: VstupFormulare
  uzivatelId: string | null
  /** Detail záznamu v OVĚŘENÉM rozsahu (slug z členství). */
  adresa: string
}

export type Odmitnuto = { ok: false; stav: StavAkce }

export const chyba = (text: string): StavAkce => ({ stav: 'chyba', text })
const ne = (text: string): Odmitnuto => ({ ok: false, stav: chyba(text) })

/**
 * `prava` = jedno právo, nebo seznam práv, která musí platit VŠECHNA
 * (korekce výdeje chce opravu i výdej do POS). `neboAutor` = autor
 * záznamu smí i s tímhle právem (zrušení vlastního rozpracovaného
 * záznamu, `jine_platby_zrusit`).
 */
export async function pripravit(
  formData: FormData,
  prava: PravoJinychPlateb | readonly PravoJinychPlateb[],
  moznosti: { neboAutor?: PravoJinychPlateb } = {},
): Promise<Pripraveno | Odmitnuto> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return ne('Účet zatím nepatří k žádné firmě.')

  const f = zFormData(formData)
  const zaznamId = pole(f, 'zaznam')
  if (!jeUuid(zaznamId)) return ne(HLASKA_NENALEZENO)

  const pristup = await zkusPristupJinymPlatbam(tenantId, pole(f, 'rozsah'))
  if (pristup.stav !== 'ok') return ne('Nejste přihlášen(a), nebo k Jiným platbám nemáte přístup.')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('jine_platby')
    .select(SLOUPCE_ZAZNAMU)
    .eq('id', zaznamId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('Jiné platby: záznam se nepodařilo načíst:', error.code, error.message)
    return ne(HLASKA_OBECNA)
  }
  const radek = data as Record<string, unknown> | null
  if (!radek || !zaznamPatriRozsahu(pobockaFinanci(pristup.scope), radek as { branch_id: string | null })) return ne(HLASKA_NENALEZENO)
  const z = zDbZaznam(radek)

  const seznam: readonly PravoJinychPlateb[] = typeof prava === 'string' ? [prava] : prava
  const odpovedi = await Promise.all(seznam.map((pravo) => hasAccess(tenantId, pravo, z.branchId)))
  let smi = seznam.length > 0 && odpovedi.every(Boolean)
  const uzivatel = await getUser()
  if (!smi && moznosti.neboAutor && uzivatel && z.vytvoril === uzivatel.id) {
    smi = await hasAccess(tenantId, moznosti.neboAutor, z.branchId)
  }
  if (!smi) return ne(HLASKA_PRAVO)

  return {
    ok: true,
    supabase,
    tenantId,
    z,
    f,
    uzivatelId: uzivatel?.id ?? null,
    adresa: `/${pristup.scope.branchSlug ?? TENANT_SCOPE_SEGMENT}/finance/trzby/jine-platby/${z.id}`,
  }
}

/** Chyba z RPC → stav formuláře. Neznámé chyby do logu (kód a text), člověku obecná věta. */
export function vysledekChyby(error: { code?: string | null; message?: string | null }, coDelam: string): StavAkce {
  if (funkceNeexistuje(error as { code?: string; message: string })) {
    return chyba('Jiné platby čekají na aktualizaci databáze. Zkuste to později.')
  }
  if (!['40001', '23514', '42501', 'P0002', '23505'].includes(error.code ?? '')) {
    console.error(`Jiné platby: ${coDelam} selhalo:`, error.code, error.message)
  }
  return chyba(textChybyDb(error))
}

/** Úspěch: obnoví detail i přehled (v ověřeném rozsahu) a vrátí větu. */
export function hotovo(p: Pripraveno, text: string): StavAkce {
  revalidatePath(p.adresa)
  revalidatePath(p.adresa.slice(0, p.adresa.lastIndexOf('/')))
  return { stav: 'ok', text }
}

/** Jen obnoví obrazovku (stav se změnil, i když akce skončila chybou — třeba nejasný výsledek). */
export function obnovit(p: Pripraveno): void {
  revalidatePath(p.adresa)
}

/* ------------------------------------------------------------------ */
/* Čtení, které potřebuje víc akcí i stránka                            */
/* ------------------------------------------------------------------ */

/**
 * Kalendář pobočky: kdy začíná provozní den a v jakém pásmu. Chybí-li
 * (nejde přečíst), výchozí 05:00 a pásmo firmy, jinak Praha — stejně jako
 * synchronizace pokladny (lib/pokladna-sync.ts).
 */
export async function kalendarPobocky(supabase: Supabase, tenantId: string, branchId: string): Promise<{ denZacina: string; pasmo: string }> {
  const [{ data: pobocka }, { data: firma }] = await Promise.all([
    supabase.from('branches').select('timezone, day_starts_at').eq('id', branchId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('timezone').eq('id', tenantId).maybeSingle(),
  ])
  const p = pobocka as { timezone: string | null; day_starts_at: string | null } | null
  const f = firma as { timezone: string | null } | null
  return { denZacina: p?.day_starts_at || '05:00', pasmo: p?.timezone || f?.timezone || ZONA_VYCHOZI }
}

type RadekKatalogu = {
  externi_id: string
  nazev: string
  jednotka: string | null
  mira: number | string | null
  odecita_sklad: boolean | null
  ma_recepturu: boolean | null
  plu: string[] | null
  ean: string[] | null
  smazano: boolean
}

/** Katalog pokladny pro připojení záznamu (RLS: kdo má nějaké právo agendy). Prázdný = pokladna katalog nedodala. */
export async function katalogPripojeni(supabase: Supabase, tenantId: string, pripojeniId: string | null): Promise<ProduktKatalogu[]> {
  if (!pripojeniId) return []
  const { data, error } = await supabase
    .from('pos_katalog')
    .select('externi_id, nazev, jednotka, mira, odecita_sklad, ma_recepturu, plu, ean, smazano')
    .eq('tenant_id', tenantId)
    .eq('pripojeni_id', pripojeniId)
    .order('nazev')
    .limit(5000)
  if (error) throw new Error(`Katalog pokladny se nepodařilo načíst (${error.code ?? 'bez kódu'}).`)
  return ((data ?? []) as RadekKatalogu[]).map((r) => ({
    externiId: r.externi_id,
    nazev: r.nazev,
    jednotka: r.jednotka,
    mira: r.mira === null ? null : Number(r.mira),
    odecitaSklad: r.odecita_sklad,
    maRecepturu: r.ma_recepturu,
    plu: r.plu ?? [],
    ean: r.ean ?? [],
    smazano: r.smazano,
  }))
}

/** Ověřené aliasy „název z dokladu → produkt“ pro připojení. */
export async function aliasyPripojeni(supabase: Supabase, tenantId: string, pripojeniId: string | null): Promise<AliasMapovani[]> {
  if (!pripojeniId) return []
  const { data, error } = await supabase
    .from('pos_mapovani')
    .select('alias, pos_produkt_id')
    .eq('tenant_id', tenantId)
    .eq('pripojeni_id', pripojeniId)
    .limit(5000)
  if (error) throw new Error(`Ověřená přiřazení se nepodařilo načíst (${error.code ?? 'bez kódu'}).`)
  return ((data ?? []) as { alias: string; pos_produkt_id: string }[]).map((r) => ({ alias: r.alias, posProduktId: r.pos_produkt_id }))
}
