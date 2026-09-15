import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele } from '@/lib/faktury-color'
import { formatCastku } from '@/lib/faktury-format'
import { STAV_KE_SCHVALENI, STAV_ODMITNUTO, type Faktura } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import PoslatUcetnimu from '../poslat-ucetnimu'

export const dynamic = 'force-dynamic'

/**
 * Faktury — přehledy nákladů a export dat.
 *
 * Přeneseno z faktury-app (src/app/prehledy/page.tsx), beze změny logiky
 * (měsíční vývoj podle DUZP, žebříček dodavatelů, export pro účetního).
 * Odkazy na CSV export vedou na `/api/faktury/export`.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

async function nactiFaktury(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices').select('*').eq('is_archived', false)
      .order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse
}

function mesicZDuzp(duzp: string | null): string | null {
  return duzp ? duzp.slice(0, 7) : null
}

function nazevMesice(mesic: string): string {
  const d = new Date(`${mesic}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return mesic
  const popis = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(d)
  return popis.charAt(0).toUpperCase() + popis.slice(1)
}

function tentoMesic(): string {
  return new Date().toISOString().slice(0, 7)
}
function minulyMesic(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export default async function FakturyPrehledy({ params }: { params: Promise<{ rozsah: string }> }) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }

  const vsechny = await nactiFaktury()
  const cekaNaSchvaleni = vsechny.filter((f) => f.status === STAV_KE_SCHVALENI)
  // Dokumenty čekající na schválení a odmítnuté (AI vyhodnotila, že nejde
  // o fakturu) se do přehledu nákladů nepočítají.
  const faktury = vsechny.filter((f) => f.status !== STAV_KE_SCHVALENI && f.status !== STAV_ODMITNUTO)
  const mena = faktury[0]?.currency ?? 'CZK'

  const podleMesice = new Map<string, { celkem: number; pocet: number }>()
  for (const f of faktury) {
    const m = mesicZDuzp(f.duzp)
    if (!m) continue
    const aktualni = podleMesice.get(m) ?? { celkem: 0, pocet: 0 }
    aktualni.celkem += Number(f.amount || 0)
    aktualni.pocet += 1
    podleMesice.set(m, aktualni)
  }
  const mesice = Array.from(podleMesice.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
  const maxMesicniCelkem = Math.max(1, ...mesice.map(([, v]) => v.celkem))
  const celkemSledovano = mesice.reduce((s, [, v]) => s + v.celkem, 0)
  const prumerNaMesic = mesice.length ? celkemSledovano / mesice.length : 0

  const podleDodavatele = new Map<string, { celkem: number; pocet: number }>()
  for (const f of faktury) {
    if (!f.supplier) continue
    const aktualni = podleDodavatele.get(f.supplier) ?? { celkem: 0, pocet: 0 }
    aktualni.celkem += Number(f.amount || 0)
    aktualni.pocet += 1
    podleDodavatele.set(f.supplier, aktualni)
  }
  const nejvyssiOdber = Array.from(podleDodavatele.entries()).sort((a, b) => b[1].celkem - a[1].celkem).slice(0, 8)

  const duplicity = faktury.filter((f) => f.is_duplicate)

  const exportZaklad = `/api/faktury/export?rozsah=${encodeURIComponent(rozsah)}`

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis="Měsíční vývoj nákladů podle DUZP, žebříček dodavatelů a export pro účetního. Počítáno z nearchivovaných faktur."
      >
        Náklady a export dat
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Celkem sledováno</span>
            <div style={{ fontSize: '20px', marginTop: '4px' }}>{formatCastku(celkemSledovano, mena)}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{mesice.length} {mesice.length === 1 ? 'měsíc' : mesice.length < 5 ? 'měsíce' : 'měsíců'}</span>
          </div>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Průměr za měsíc</span>
            <div style={{ fontSize: '20px', marginTop: '4px' }}>{formatCastku(prumerNaMesic, mena)}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>za sledované měsíce</span>
          </div>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Aktivních dodavatelů</span>
            <div style={{ fontSize: '20px', marginTop: '4px' }}>{podleDodavatele.size}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>celkem</span>
          </div>
          <div style={{ ...karta, borderColor: duplicity.length > 0 ? 'var(--mosaz)' : undefined }}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Možné duplicity</span>
            <div style={{ fontSize: '20px', marginTop: '4px', color: duplicity.length > 0 ? 'var(--mosaz)' : undefined }}>{duplicity.length}</div>
            <span style={{ fontSize: '12px' }}>
              {duplicity.length > 0 ? <Link href={`/${rozsah}/finance/faktury/seznam?duplicity=1`}>Zkontrolovat →</Link> : <span style={{ color: 'var(--muted)' }}>nic k řešení</span>}
            </span>
          </div>
          <div style={{ ...karta, borderColor: cekaNaSchvaleni.length > 0 ? 'var(--mosaz)' : undefined }}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Čeká na schválení</span>
            <div style={{ fontSize: '20px', marginTop: '4px', color: cekaNaSchvaleni.length > 0 ? 'var(--mosaz)' : undefined }}>{cekaNaSchvaleni.length}</div>
            <span style={{ fontSize: '12px' }}>
              {cekaNaSchvaleni.length > 0 ? <Link href={`/${rozsah}/finance/faktury/schvaleni`}>Zkontrolovat →</Link> : <span style={{ color: 'var(--muted)' }}>nic k řešení</span>}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <section style={{ ...karta, display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Měsíční náklady (podle DUZP)</h2>
            {mesice.length === 0 ? (
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádná data s vyplněným DUZP.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
                {mesice.map(([mesic, stat]) => (
                  <li key={mesic}>
                    <Link
                      href={`/${rozsah}/finance/faktury/seznam?mesic=${mesic}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <span style={{ width: '110px', flex: 'none', fontSize: '13px' }}>{nazevMesice(mesic)}</span>
                      <span style={{ flex: 1, height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--bg)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', borderRadius: 'var(--radius-full)', background: 'var(--mosaz)', width: `${Math.max(3, (stat.celkem / maxMesicniCelkem) * 100)}%` }} />
                      </span>
                      <span style={{ width: '110px', flex: 'none', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '13px' }}>{formatCastku(stat.celkem, mena)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ ...karta, display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nejvyšší odběr celkem</h2>
            {nejvyssiOdber.length === 0 ? (
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádní dodavatelé.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
                {nejvyssiOdber.map(([dodavatel, stat]) => (
                  <li key={dodavatel}>
                    <Link
                      href={`/${rozsah}/finance/faktury/seznam?dodavatel=${encodeURIComponent(dodavatel)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: barvaDodavatele(dodavatel), flex: 'none' }} />
                      <strong style={{ flex: 1, fontSize: '14px' }}>{dodavatel}</strong>
                      <span style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontFamily: 'ui-monospace, monospace' }}>{formatCastku(stat.celkem, mena)}</span>
                        <small style={{ color: 'var(--muted)' }}>{stat.pocet} {stat.pocet === 1 ? 'faktura' : 'faktur'}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section style={karta}>
          <p style={{ margin: '0 0 6px', fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>Export pro účetního</p>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--muted)' }}>CSV se středníkem jako oddělovačem (Excel/Pohoda/Money S3 kompatibilní), v kódování UTF-8.</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a href={exportZaklad} className="ft-tl ft-tl-male">Export vše (nearchivované)</a>
            <a href={`${exportZaklad}&mesic=${tentoMesic()}`} className="ft-tl ft-tl-male">Jen tento měsíc</a>
            <a href={`${exportZaklad}&mesic=${minulyMesic()}`} className="ft-tl ft-tl-male">Jen minulý měsíc</a>
            <a href={`${exportZaklad}&kontrola=1`} className="ft-tl ft-tl-male">Jen nutná kontrola</a>
            <a href={`${exportZaklad}&archiv=1`} className="ft-tl ft-tl-male">Export archivu</a>
          </div>
        </section>

        <PoslatUcetnimu rozsah={rozsah} />
      </div>
    </>
  )
}
