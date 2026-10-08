import 'server-only'

import { getServerSupabase } from '@/lib/supabase/server'
import { pristupKFakturam } from '@/lib/supabase/faktury'
import { jeNezaplacena, potrebujeKontrolu, type Faktura } from '@/lib/faktury-types'
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
 *   2. Faktury, které potřebují ruční kontrolu (`potrebujeKontrolu`).
 *
 * Když appka Fakturám nedosáhne (`pristupKFakturam()` není ok, nebo
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

/** PostgREST vrací nejvýš 1000 řádků na dotaz; aktivních faktur je víc (7.10.2026: 1872). */
const STRANKA = 1000
const MAX_STRANEK = 10

export async function nactiPolozkyKPozornosti(
  tenantId: string,
  rozsah: string,
  /** `faktury.read` — Finance stačí `finance.read`, data faktur ale ne. */
  vidiFaktury: boolean,
  limitTransakci = 60,
): Promise<PolozkaPozornosti[]> {
  if (!vidiFaktury) return []
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') return []

  const polozky: PolozkaPozornosti[] = []

  const faktury: Faktura[] = []
  try {
    for (let strana = 0; strana < MAX_STRANEK; strana++) {
      const { data, error } = await pristupFaktury.faktury.from('invoices')
        .select('id, supplier, invoice_number, variable_symbol, amount, due_date, issue_date, status, needs_review')
        .eq('is_archived', false)
        .order('id', { ascending: true })
        .range(strana * STRANKA, strana * STRANKA + STRANKA - 1)
      if (error) return []
      faktury.push(...((data ?? []) as Faktura[]))
      if (!data || data.length < STRANKA) break
    }
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

  // 2. Faktury, u kterých si zpracování nebylo jisté — jeden souhrnný řádek,
  // ne stovky stejných (v provozu jich čeká přes 500).
  const keKontrole = faktury.filter(potrebujeKontrolu)
  if (keKontrole.length > 0) {
    polozky.push({
      klic: 'faktury-ke-kontrole',
      typ: 'faktura_kontrola',
      popis: keKontrole.length === 1
        ? `Faktura ${keKontrole[0].supplier || '—'} (${keKontrole[0].invoice_number ?? 'bez čísla'}) vyžaduje ruční kontrolu`
        : `${keKontrole.length} faktur vyžaduje ruční kontrolu`,
      stredisko: '—',
      castkaHaleru: keKontrole.reduce((soucet, f) => soucet + Math.round((f.amount ?? 0) * 100), 0),
      stav: 'nutne',
      akceHref: `/${rozsah}/finance/faktury/seznam?kontrola=1`,
      akceText: 'Zkontrolovat',
    })
  }

  return polozky
}
