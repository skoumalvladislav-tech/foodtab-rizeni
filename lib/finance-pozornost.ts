import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import { naFaktury, type RadekFaktury } from '@/lib/faktury-sloupce'
import { jeNezaplacena, potrebujeKontrolu, type Faktura } from '@/lib/faktury-types'
import { jeVKorunach, kandidatiProNavrhy, navrhnoutParovani } from '@/lib/finance-parovani'
import { prazdnoPozornosti } from '@/lib/faktury-brana'
import { koruny } from '@/lib/mzdy'

/**
 * „Co vyžaduje pozornost" na Finance → Přehled — jen SKUTEČNÉ,
 * appkou už spočítané signály (žádná vymyšlená řádka jen aby seděl
 * počet se vzorem obrazovky):
 *
 *   1. Návrhy párování plateb s fakturami (stejný algoritmus jako
 *      app/[rozsah]/finance/platby/page.tsx, jen přes vlastní dotaz —
 *      viz komentář tam, proč se to nerozebírá do jedné sdílené
 *      funkce: `lib/finance-parovani.ts` je vědomě bez IO).
 *   2. Faktury, které potřebují ruční kontrolu (`potrebujeKontrolu`).
 *
 * Když appka Fakturám nedosáhne (`pristupKFakturam()` není ok, nebo
 * dotaz selže), vrátí prázdný seznam A VĚTU proč (`hlaska`) — ne
 * „Nic nevyžaduje pozornost", když se nic zjistit nedalo (kontrola
 * 19. 10.; Dnes a Platby to tak mají taky).
 *
 * Na pobočce (Finance po pobočkách, 13.–14. 10. 2026) prázdno: obě
 * položky stojí na fakturách, které pobočku nemají (oddělená databáze),
 * a spárování mění stav faktury celé firmy — patří do Plateb za celou
 * firmu. Dřív se tu na pobočce nabízelo párování s dodavatelem firemní
 * faktury (kontrola 14. 10.).
 */

export type PolozkaPozornosti = {
  klic: string
  typ: 'parovani' | 'faktura_kontrola'
  popis: string
  stredisko: string
  castkaHaleru: number
  stav: 'ceka' | 'nutne'
  akceHref: string
  akceText: string
}

/** PostgREST vrací nejvýš 1000 řádků na dotaz; aktivních faktur je víc (7.10.2026: 1872). */
const STRANKA = 1000
const MAX_STRANEK = 10

export async function nactiPolozkyKPozornosti(
  tenantId: string,
  rozsah: string,
  /** `faktury.read` — Finance stačí `finance.read`, data faktur ale ne. */
  vidiFaktury: boolean,
  /** Pobočka rozsahu (`pobockaFinanci`), `null` = celá firma. Na pobočce se nic nenačítá. */
  pobocka: string | null = null,
  limitTransakci = 60,
): Promise<{ polozky: PolozkaPozornosti[]; hlaska: string | null }> {
  if (!vidiFaktury || pobocka !== null) return { polozky: [], hlaska: null }
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') return { polozky: [], hlaska: prazdnoPozornosti(pristupFaktury) }
  const nenacteno = { polozky: [], hlaska: prazdnoPozornosti({ stav: 'chyba_dotazu' }) }

  const polozky: PolozkaPozornosti[] = []

  const faktury: Faktura[] = []
  try {
    for (let strana = 0; strana < MAX_STRANEK; strana++) {
      const { data, error } = await fakturyFirmy(pristupFaktury,
        'id, supplier:dodavatel, invoice_number:cislo_faktury, variable_symbol:variabilni_symbol, castka_haleru, currency:mena, due_date:splatnost, issue_date:datum_vystaveni, status:stav, needs_review:ke_kontrole')
        .eq('archivovano', false)
        .order('id', { ascending: true })
        .range(strana * STRANKA, strana * STRANKA + STRANKA - 1)
      if (error) return nenacteno
      faktury.push(...naFaktury(data as unknown as RadekFaktury[]))
      if (!data || data.length < STRANKA) break
    }
  } catch {
    return nenacteno
  }

  // 1. Návrhy párování — nezaplacené faktury v Kč proti nedávným výdajovým
  // transakcím (stejná sdílená funkce jako v Platbách).
  const kandidati = kandidatiProNavrhy(faktury.filter(jeNezaplacena))
  if (kandidati.length > 0) {

    const supabase = await getServerSupabase()
    const [transakceRes, sparovaneRes] = await Promise.all([
      supabase
        .from('transakce')
        .select('id, castka_haleru, datum, protistrana, vs, platebni_ucty(branch_id, nazev)')
        .eq('tenant_id', tenantId)
        .eq('smer', 'vydaj')
        .order('datum', { ascending: false })
        .limit(limitTransakci),
      supabase.from('platby_faktury').select('transakce_id').eq('tenant_id', tenantId),
    ])

    const jizSparovane = new Set(((sparovaneRes.data ?? []) as { transakce_id: string }[]).map((r) => r.transakce_id))

    type RadekTransakce = {
      id: string
      castka_haleru: number
      datum: string
      protistrana: string
      vs: string
      platebni_ucty: { branch_id: string | null; nazev: string } | { branch_id: string | null; nazev: string }[] | null
    }

    for (const t of (transakceRes.data ?? []) as RadekTransakce[]) {
      if (jizSparovane.has(t.id)) continue
      const navrh = navrhnoutParovani({ id: t.id, vs: t.vs, castkaHaleru: t.castka_haleru, protistrana: t.protistrana, datum: t.datum }, kandidati)
      if (!navrh) continue
      const faktura = kandidati.find((k) => k.id === navrh.fakturaId)
      if (!faktura) continue

      const ucet = Array.isArray(t.platebni_ucty) ? t.platebni_ucty[0] : t.platebni_ucty
      polozky.push({
        klic: `parovani-${t.id}`,
        typ: 'parovani',
        popis: `Platba ${koruny(t.castka_haleru)} ↔ faktura ${faktura.dodavatel ?? '—'}`,
        stredisko: ucet?.nazev ?? '—',
        castkaHaleru: t.castka_haleru,
        stav: 'ceka',
        akceHref: `/${rozsah}/finance/platby`,
        akceText: 'Spárovat',
      })
    }
  }

  // 2. Faktury, u kterých si zpracování nebylo jisté — jeden souhrnný řádek,
  // ne stovky stejných (v provozu jich čeká přes 500).
  const keKontrole = faktury.filter(potrebujeKontrolu)
  if (keKontrole.length > 0) {
    // Součet jen faktur v Kč (sloupec je v Kč) — cizí měnu jen vyjmenovat.
    const vCiziMene = keKontrole.filter((f) => !jeVKorunach(f.currency)).length
    polozky.push({
      klic: 'faktury-ke-kontrole',
      typ: 'faktura_kontrola',
      popis: (keKontrole.length === 1
        ? `Faktura ${keKontrole[0].supplier || '—'} (${keKontrole[0].invoice_number ?? 'bez čísla'}) vyžaduje ruční kontrolu`
        : `${keKontrole.length} faktur vyžaduje ruční kontrolu`)
        + (vCiziMene > 0 ? ` (${vCiziMene} v cizí měně, částka bez nich)` : ''),
      stredisko: '—',
      castkaHaleru: keKontrole.filter((f) => jeVKorunach(f.currency)).reduce((soucet, f) => soucet + (f.castka_haleru ?? 0), 0),
      stav: 'nutne',
      akceHref: `/${rozsah}/finance/faktury/seznam?kontrola=1`,
      akceText: 'Zkontrolovat',
    })
  }

  return { polozky, hlaska: null }
}
