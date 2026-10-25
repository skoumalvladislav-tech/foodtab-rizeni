'use server'

import { naparovatPolozky, parovaniJeNastavene, type VysledekParovani } from '@/lib/jine-platby-ai-parovani'
import { pouzitPrirazeni, sestavitPodklad, VERZE_ZADANI } from '@/lib/jine-platby-ai-parovani-jadro'
import { doDbHlavicka, doDbPolozky, hlavickaZeZaznamu, SLOUPCE_POLOZKY, zDbPolozka } from '@/lib/jine-platby-db'
import { navrhnoutMapovani, type AliasMapovani, type ProduktKatalogu } from '@/lib/jine-platby-mapovani'
import type { PolozkaNavrhu } from '@/lib/jine-platby-typy'
import { klientUlohy } from '@/lib/supabase/uloha'

import { aliasyPripojeni, chyba, hotovo, katalogPripojeni, obnovit, pripravit, vysledekChyby } from './[zaznam]/akce-zaklad'
import { HLASKA_VERZE, verzeZFormulare, type StavAkce } from './[zaznam]/logika'

/**
 * Jiné platby — „Najít produkty v pokladně (AI)“: přiřazení položek
 * dokladu k produktům katalogu pokladny (docs/jine-platby-vydej-dotykacka.md,
 * oddíl 3). Právo `jine_platby.upravit` — stejné jako ruční přiřazení
 * v editoru.
 *
 * Postup:
 *   1. pravidla nad položkami BEZ přiřazení (`navrhnoutMapovani`: ověřený
 *      alias, EAN, stejný nebo podobný název) — položku s návrhem nebo
 *      ověřeným přiřazením akce nemění, ať nepřepíše, co člověk vybral;
 *   2. co zbude, jde do AI s kandidáty z katalogu (`sestavitPodklad`);
 *   3. návrh se uloží UŽIVATELSKÝM klientem (`jine_platby_ulozit_navrh`,
 *      verze a právo ověří databáze) — přiřazení AI jako `navrh` s důvodem
 *      ke kontrole, který zmizí, až člověk řádek ověří.
 * Nic se nezapisuje do skladu ani tržeb; výdej dál schvaluje člověk.
 *
 * SERVICE_ROLE (`klientUlohy()`): jen `jine_platby_zahajit_parovani`
 * a `jine_platby_dokoncit_parovani` (záznam pokusu a denní strop — z
 * prohlížeče se zapsat nesmí). Až po `pripravit(…)`, s id ověřeného
 * záznamu a id přihlášeného.
 */

/** Akce běží ve funkci stránky detailu (`maxDuration` 120 s, page.tsx) — rezerva na uložení návrhu. */
const MAX_DELKA_AKCE_MS = 120_000
const REZERVA_NA_ULOZENI_MS = 15_000

// Soubor 'use server' smí exportovat jen asynchronní funkce — hláška zůstává uvnitř.
const HLASKA_BEZ_AI_PAROVANI = 'Přiřazení přes AI není zapnuté — přiřaďte položky ručně u položek.'

export async function najitVPokladne(_predchozi: StavAkce, formData: FormData): Promise<StavAkce> {
  const zacatek = Date.now()
  const p = await pripravit(formData, 'jine_platby.upravit')
  if (!p.ok) return p.stav
  const verze = verzeZFormulare(p.f)
  if (verze !== p.z.verze) return chyba(HLASKA_VERZE)
  if (!p.z.pripojeniId) return chyba('Záznam nemá pokladnu — není s čím položky párovat.')
  if (!parovaniJeNastavene()) return chyba(HLASKA_BEZ_AI_PAROVANI)

  const { data, error } = await p.supabase
    .from('jine_platby_polozky')
    .select(SLOUPCE_POLOZKY)
    .eq('zaznam_id', p.z.id)
    .eq('tenant_id', p.tenantId)
    .order('poradi')
  if (error) return chyba('Položky se nepodařilo načíst. Zkuste to prosím znovu.')
  const puvodni: PolozkaNavrhu[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => zDbPolozka(r))

  let katalog: ProduktKatalogu[]
  let aliasy: AliasMapovani[]
  try {
    ;[katalog, aliasy] = await Promise.all([
      katalogPripojeni(p.supabase, p.tenantId, p.z.pripojeniId),
      aliasyPripojeni(p.supabase, p.tenantId, p.z.pripojeniId),
    ])
  } catch {
    return chyba('Katalog pokladny se nepodařilo načíst. Zkuste to prosím znovu.')
  }
  if (!katalog.some((k) => !k.smazano)) return chyba('Katalog pokladny není načtený — nejdřív ho načtěte z pokladny, pak hledejte znovu.')

  // 1. Pravidla jen nad položkami bez přiřazení.
  const poPravidlech = puvodni.map((pol) => (pol.mapovani === 'nenamapovano' ? navrhnoutMapovani(pol, katalog, aliasy).polozka : pol))
  const pravidlaPrirazeni = poPravidlech.filter((pol, i) => puvodni[i].mapovani === 'nenamapovano' && pol.mapovani !== 'nenamapovano').length

  // 2. Zbytek do AI.
  const { podklad, mapa, bezKandidatu, vynechano } = sestavitPodklad(poPravidlech, katalog)
  let polozky = poPravidlech
  let navrzeno = 0
  let vysledek: VysledekParovani | null = null

  if (podklad.polozky.length > 0) {
    // SERVICE_ROLE: záznam pokusu a strop — po pripravit() (upravit na pobočce záznamu), s id ověřeného záznamu.
    const uloha = klientUlohy()
    if (!uloha) return chyba('Přiřazení přes AI není na serveru nastavené (chybí SUPABASE_SERVICE_ROLE_KEY).')
    const { data: pokus, error: chybaZahajeni } = await uloha.rpc('jine_platby_zahajit_parovani', {
      p_zaznam: p.z.id,
      p_spustil: p.uzivatelId,
      p_verze: verze,
      p_polozek: podklad.polozky.length,
    })
    if (chybaZahajeni) return vysledekChyby(chybaZahajeni, 'zahájení přiřazení přes AI')

    try {
      vysledek = await naparovatPolozky(podklad, mapa, { konec: zacatek + MAX_DELKA_AKCE_MS - REZERVA_NA_ULOZENI_MS })
    } catch (e) {
      console.error('Jiné platby: přiřazení přes AI spadlo:', e instanceof Error ? e.message : e)
      vysledek = { stav: 'chyba', duvod: 'Přiřazení skončilo neočekávanou chybou — zkuste to znovu, nebo přiřaďte položky ručně.', docasna: true }
    }
    if (vysledek.stav === 'ok') ({ polozky, navrzeno } = pouzitPrirazeni(poPravidlech, podklad, vysledek.prirazeni, katalog))

    // Výsledek pokusu se zapíše VŽDY (i chyba) — jinak by pokus zůstal „běží“ a blokoval další.
    const { error: chybaDokonceni } = await uloha.rpc('jine_platby_dokoncit_parovani', {
      p_pokus: String(pokus),
      p_stav: vysledek.stav,
      p_model: vysledek.stav === 'ok' ? vysledek.model : null,
      p_verze_zadani: VERZE_ZADANI,
      p_navrzeno: vysledek.stav === 'ok' ? navrzeno : null,
      p_duvod: vysledek.stav === 'chyba' ? vysledek.duvod : vysledek.stav === 'bez_klice' ? 'Chybí klíč k AI.' : null,
    })
    if (chybaDokonceni) console.error('Jiné platby: zápis výsledku přiřazení selhal:', chybaDokonceni.code, chybaDokonceni.message)

    // Bez výsledku AI se uloží aspoň to, co přiřadila pravidla.
    if (vysledek.stav !== 'ok' && pravidlaPrirazeni === 0) {
      obnovit(p)
      return chyba(vysledek.stav === 'bez_klice' ? HLASKA_BEZ_AI_PAROVANI : vysledek.duvod)
    }
  }

  if (pravidlaPrirazeni === 0 && navrzeno === 0 && (vysledek === null || vysledek.stav === 'ok')) {
    const casti = ['Nic nového k přiřazení.']
    if (bezKandidatu > 0) casti.push(`U ${bezKandidatu} položek v katalogu pokladny nic podobného není — přiřaďte je ručně (nebo načtěte katalog znovu).`)
    if (vysledek?.stav === 'ok') casti.push('AI u zbylých položek nenašla produkt, za který by ručila.')
    return hotovo(p, casti.join(' '))
  }

  // 3. Uložení UŽIVATELSKÝM klientem — právo upravit a verzi ověří databáze. Hlavička beze změny.
  const { error: chybaUlozeni } = await p.supabase.rpc('jine_platby_ulozit_navrh', {
    p_zaznam: p.z.id,
    p_verze: verze,
    p_hlavicka: doDbHlavicka(hlavickaZeZaznamu(p.z)),
    p_polozky: doDbPolozky(polozky),
  })
  if (chybaUlozeni) {
    obnovit(p)
    const stav = vysledekChyby(chybaUlozeni, 'uložení přiřazení')
    return { ...stav, text: `Přiřazení se neuložilo: ${stav.text}` }
  }

  const casti: string[] = []
  if (navrzeno > 0) casti.push(`AI navrhla produkt u ${navrzeno} z ${podklad.polozky.length} položek.`)
  if (pravidlaPrirazeni > 0) casti.push(`Podle názvu nebo dřív ověřeného přiřazení: ${pravidlaPrirazeni} položek.`)
  casti.push('Zkontrolujte je u položek a potvrďte — nic se neodečetlo.')
  if (vysledek && vysledek.stav !== 'ok') casti.push(`AI tentokrát nepomohla: ${vysledek.stav === 'bez_klice' ? HLASKA_BEZ_AI_PAROVANI : vysledek.duvod}`)
  if (vynechano > 0) casti.push(`Dalších ${vynechano} položek se do jednoho hledání nevešlo — klikněte znovu.`)
  if (bezKandidatu > 0) casti.push(`U ${bezKandidatu} položek v katalogu nic podobného není — přiřaďte je ručně.`)
  return hotovo(p, casti.join(' '))
}
