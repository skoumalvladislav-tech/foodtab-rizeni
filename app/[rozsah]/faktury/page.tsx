import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import {
  dniPoSplatnosti,
  jeNezaplacena,
  STAV_KE_SCHVALENI,
  type Faktura,
} from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import StavZnacka from './stav-znacka'

export const dynamic = 'force-dynamic'

/**
 * Faktury — přehled (dashboard).
 *
 * Přeneseno z faktury-app (src/app/page.tsx), beze změny logiky KPI —
 * jen zdroj dat (`getFakturySupabase()` místo přímého klienta) a rám
 * (Foodtabova `Nadpis`/`Sdeleni` a vnořená navigace v layout.tsx místo
 * vlastního `Shell.tsx`).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

async function nactiFaktury(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  // Supabase/PostgREST má strop 1000 řádků na odpověď (db.max_rows) — stránkuje
  // se přes .range() přes stejný filtrovaný/seřazený dotaz, dokud stránka
  // nepřijde kratší, a spojí se do jednoho pole. Stejný postup jako
  // v původní appce (getInvoices, src/app/page.tsx).
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('is_archived', false)
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) {
      console.error(error)
      break
    }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse
}

function mesicKlic(datum: string): string {
  return datum.slice(0, 7)
}

export default async function FakturyPrehled({ params }: { params: Promise<{ rozsah: string }> }) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.
      </Sdeleni>
    )
  }

  const faktury = await nactiFaktury()
  const mena = faktury[0]?.currency ?? 'CZK'

  const cekaNaSchvaleni = faktury.filter((f) => f.status === STAV_KE_SCHVALENI)
  // Dokumenty čekající na schválení se nepočítají do žádného přehledu ani
  // seznamu, dokud je člověk ručně nepotvrdí jako fakturu.
  const viditelne = faktury.filter((f) => f.status !== STAV_KE_SCHVALENI)

  const nezaplacene = faktury.filter(jeNezaplacena)
  const poSplatnosti = nezaplacene.filter((f) => dniPoSplatnosti(f.due_date) > 0)
  const kKontrole = faktury.filter((f) => f.needs_review)

  const celkemNezaplaceno = nezaplacene.reduce((s, f) => s + Number(f.amount || 0), 0)
  const celkemPoSplatnosti = poSplatnosti.reduce((s, f) => s + Number(f.amount || 0), 0)

  const tentoMesic = mesicKlic(new Date().toISOString())
  const prijateTentoMesic = viditelne.filter((f) => mesicKlic(f.received_at) === tentoMesic)

  const pred90Dny = new Date()
  pred90Dny.setDate(pred90Dny.getDate() - 90)
  const aktivniDodavatele = new Set(
    viditelne
      .filter((f) => new Date(f.received_at) >= pred90Dny)
      .map((f) => f.supplier)
      .filter(Boolean),
  )

  const posledni = viditelne.slice(0, 6)

  const pred30Dny = new Date()
  pred30Dny.setDate(pred30Dny.getDate() - 30)
  const podleDodavatele30d = new Map<string, { celkem: number; pocet: number }>()
  for (const f of viditelne) {
    if (!f.supplier) continue
    if (new Date(f.received_at) < pred30Dny) continue
    const aktualni = podleDodavatele30d.get(f.supplier) ?? { celkem: 0, pocet: 0 }
    aktualni.celkem += Number(f.amount || 0)
    aktualni.pocet += 1
    podleDodavatele30d.set(f.supplier, aktualni)
  }
  const nejvyssiOdber = Array.from(podleDodavatele30d.entries())
    .sort((a, b) => b[1].celkem - a[1].celkem)
    .slice(0, 6)

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis="Stav faktur ve všech schránkách."
        vpravo={
          <Link href={`/${rozsah}/faktury/nova`} className="ft-tl ft-tl-hlavni">
            + Zadat fakturu ručně
          </Link>
        }
      >
        Přehled
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        {cekaNaSchvaleni.length > 0 ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>
              {cekaNaSchvaleni.length}{' '}
              {cekaNaSchvaleni.length === 1 ? 'dokument čeká' : 'dokumentů čeká'} na schválení
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              AI si není jistá, že jde o fakturu (může jít třeba o výplatní pásku). Nepočítají se
              do žádných přehledů, dokud je nepotvrdíte.{' '}
              <Link href={`/${rozsah}/faktury/schvaleni`}>Zobrazit →</Link>
            </p>
          </div>
        ) : null}

        {kKontrole.length > 0 ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>
              {kKontrole.length} {kKontrole.length === 1 ? 'faktura čeká' : 'faktur čeká'} na ruční
              kontrolu
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              AI se u nich nepodařilo bezpečně vytáhnout údaje nebo šlo o obrázek místo PDF.{' '}
              <Link href={`/${rozsah}/faktury/seznam?kontrola=1`}>Zobrazit →</Link>
            </p>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Otevřeno k úhradě</span>
            <div style={{ fontSize: '22px', marginTop: '4px' }}>{formatCastku(celkemNezaplaceno, mena)}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{nezaplacene.length} faktur</span>
          </div>
          <div style={{ ...karta, borderColor: poSplatnosti.length > 0 ? 'var(--mosaz)' : undefined }}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Po splatnosti</span>
            <div style={{ fontSize: '22px', marginTop: '4px', color: poSplatnosti.length > 0 ? 'var(--mosaz)' : undefined }}>
              {formatCastku(celkemPoSplatnosti, mena)}
            </div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{poSplatnosti.length} faktur</span>
          </div>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Přijato tento měsíc</span>
            <div style={{ fontSize: '22px', marginTop: '4px' }}>{prijateTentoMesic.length}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>faktur</span>
          </div>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Aktivních dodavatelů</span>
            <div style={{ fontSize: '22px', marginTop: '4px' }}>{aktivniDodavatele.size}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>za posledních 90 dní</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <section style={{ ...karta, display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Poslední přijaté</h2>
            {posledni.length === 0 ? (
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                Zatím žádné faktury — jakmile n8n workflow zapíše první záznam, objeví se tady.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
                {posledni.map((f) => (
                  <li key={f.id}>
                    <Link
                      href={`/${rozsah}/faktury/seznam`}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: barvaDodavatele(f.supplier), flex: 'none' }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: '14px' }}>{f.supplier || '–'}</strong>
                        <br />
                        <small style={{ color: 'var(--muted)' }}>
                          {f.invoice_number || 'bez čísla'} · {formatDatum(f.received_at)}
                        </small>
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace' }}>
                          {formatCastku(f.amount, f.currency)}
                        </span>
                        <StavZnacka stav={f.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ ...karta, display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nejvyšší odběr — 30 dní</h2>
            {nejvyssiOdber.length === 0 ? (
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                Za posledních 30 dní zatím žádné faktury.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
                {nejvyssiOdber.map(([dodavatel, stat]) => (
                  <li key={dodavatel}>
                    <Link
                      href={`/${rozsah}/faktury/seznam?dodavatel=${encodeURIComponent(dodavatel)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: barvaDodavatele(dodavatel), flex: 'none' }} />
                      <strong style={{ flex: 1, fontSize: '14px' }}>{dodavatel}</strong>
                      <span style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace' }}>
                          {formatCastku(stat.celkem, mena)}
                        </span>
                        <small style={{ color: 'var(--muted)' }}>{stat.pocet} {stat.pocet === 1 ? 'faktura' : 'faktur'}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
