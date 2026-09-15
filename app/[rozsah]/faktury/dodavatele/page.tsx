import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele, inicialyDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import { dniPoSplatnosti, jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/** Přeneseno z faktury-app (src/app/dodavatele/page.tsx), beze změny logiky. */

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '13.5px',
} as const

type StatDodavatele = {
  jmeno: string
  ico: string | null
  celkem: number
  mena: string
  pocet: number
  keKontrole: number
  poSplatnosti: number
  nezaplaceno: number
  posledniPrijata: string
}

async function nactiFaktury(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices').select('*').eq('is_archived', false)
      .order('received_at', { ascending: false }).order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse
}

export default async function FakturyDodavatele({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ hledat?: string }>
}) {
  const { rozsah } = await params
  const { hledat } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }

  const faktury = await nactiFaktury()
  const dotaz = (hledat ?? '').trim()

  const podleDodavatele = new Map<string, StatDodavatele>()
  for (const f of faktury) {
    if (!f.supplier) continue
    const aktualni = podleDodavatele.get(f.supplier) ?? {
      jmeno: f.supplier, ico: f.supplier_ico, celkem: 0, mena: f.currency || 'CZK',
      pocet: 0, keKontrole: 0, poSplatnosti: 0, nezaplaceno: 0, posledniPrijata: f.received_at,
    }
    aktualni.celkem += Number(f.amount || 0)
    aktualni.pocet += 1
    if (!aktualni.ico && f.supplier_ico) aktualni.ico = f.supplier_ico
    if (f.needs_review) aktualni.keKontrole += 1
    if (jeNezaplacena(f)) {
      aktualni.nezaplaceno += 1
      if (dniPoSplatnosti(f.due_date) > 0) aktualni.poSplatnosti += 1
    }
    if (f.received_at > aktualni.posledniPrijata) aktualni.posledniPrijata = f.received_at
    podleDodavatele.set(f.supplier, aktualni)
  }

  let dodavatele = Array.from(podleDodavatele.values()).sort((a, b) => b.celkem - a.celkem)
  if (dotaz) {
    const q = dotaz.toLowerCase()
    dodavatele = dodavatele.filter((d) => d.jmeno.toLowerCase().includes(q))
  }

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis={`${dodavatele.length} ${dodavatele.length === 1 ? 'dodavatel' : 'dodavatelů'}. Klikněte na kartu pro historii faktur a celkový odběr.`}
      >
        Podle dodavatele
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        <form action={`/${rozsah}/faktury/dodavatele`} method="get" style={{ maxWidth: '320px' }}>
          <input type="text" name="hledat" placeholder="Hledat dodavatele…" defaultValue={dotaz} style={{ ...pole, width: '100%' }} />
        </form>

        {dodavatele.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            {dotaz ? 'Žádný dodavatel neodpovídá hledání.' : 'Zatím žádné faktury s vyplněným dodavatelem.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {dodavatele.map((d) => {
              const barva = barvaDodavatele(d.jmeno)
              let stitek = { bg: 'var(--dobre-bg)', barva: 'var(--dobre)', text: 'V pořádku' }
              if (d.keKontrole > 0) stitek = { bg: 'var(--pozor-bg)', barva: 'var(--pozor)', text: `${d.keKontrole} ke kontrole` }
              else if (d.poSplatnosti > 0) stitek = { bg: 'var(--bad-bg)', barva: 'var(--bad)', text: d.poSplatnosti === 1 ? 'Po splatnosti' : `${d.poSplatnosti} po splatnosti` }
              else if (d.nezaplaceno > 0) stitek = { bg: 'var(--sunken)', barva: 'var(--muted)', text: `${d.nezaplaceno} neuhrazené` }

              return (
                <Link
                  key={d.jmeno}
                  href={`/${rozsah}/faktury/seznam?dodavatel=${encodeURIComponent(d.jmeno)}`}
                  style={{
                    display: 'block', textDecoration: 'none', color: 'inherit',
                    background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '14px', overflow: 'hidden',
                  }}
                >
                  <div style={{ height: '4px', background: barva }} />
                  <div style={{ padding: '14px', display: 'grid', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ width: '32px', height: '32px', borderRadius: '999px', background: barva, color: '#fff', fontSize: '12px', display: 'grid', placeItems: 'center', flex: 'none' }}>
                        {inicialyDodavatele(d.jmeno)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: '14.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.jmeno}</h3>
                        {d.ico ? <div style={{ fontSize: '12px', color: 'var(--muted)' }}>IČO {d.ico}</div> : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--muted)' }}>Od 1. 1. 2026</span>
                        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{formatCastku(d.celkem, d.mena)}</strong>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--muted)' }}>Faktur</span>
                        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{d.pocet}</strong>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: stitek.bg, color: stitek.barva }}>{stitek.text}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>poslední {formatDatum(d.posledniPrijata)}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
