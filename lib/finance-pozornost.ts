import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { getFakturySupabase, fakturyJsouNastavene } from '@/lib/supabase/faktury'
import { jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import { navrhnoutParovani, type KandidatFaktura } from '@/lib/finance-parovani'
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
 *   2. Faktury s `needs_review` (OCR si nebyl jistý).
 *
 * Když appka Fakturám nedosáhne (`fakturyJsouNastavene()` false, nebo
 * dotaz na jejich databázi selže), vrátí prázdno — ne chybu, ne
 * vymyšlenou řádku.
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

export async function nactiPolozkyKPozornosti(
  tenantId: string,
  rozsah: string,
  limitTransakci = 60,
): Promise<PolozkaPozornosti[]> {
  if (!fakturyJsouNastavene()) return []

  const polozky: PolozkaPozornosti[] = []

  let faktury: Faktura[] = []
  try {
    const supabaseFaktury = getFakturySupabase()
    const { data } = await supabaseFaktury.from('invoices').select('*').eq('tenant_id', tenantId).eq('is_archived', false)
    faktury = (data ?? []) as Faktura[]
  } catch {
    return []
  }

  // 1. Návrhy párování — nezaplacené faktury proti nedávným výdajovým transakcím.
  const nezaplacene = faktury.filter(jeNezaplacena)
  if (nezaplacene.length > 0) {
    const kandidati: KandidatFaktura[] = nezaplacene.map((f) => ({
      id: f.id,
      vs: f.variable_symbol,
      castkaHaleru: Math.round(f.amount * 100),
      dodavatel: f.supplier,
      datum: f.due_date ?? f.issue_date,
    }))

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

  // 2. Faktury, u kterých si zpracování nebylo jisté.
  for (const f of faktury) {
    if (!f.needs_review) continue
    polozky.push({
      klic: `faktura-${f.id}`,
      typ: 'faktura_kontrola',
      popis: `Faktura ${f.supplier ?? '—'} (${f.invoice_number ?? 'bez čísla'}) vyžaduje ruční kontrolu`,
      stredisko: '—',
      castkaHaleru: Math.round(f.amount * 100),
      stav: 'nutne',
      akceHref: `/${rozsah}/finance/faktury`,
      akceText: 'Zkontrolovat',
    })
  }

  return polozky
}
