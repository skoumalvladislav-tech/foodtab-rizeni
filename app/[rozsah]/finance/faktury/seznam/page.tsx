import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele, inicialyDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import { STAV_ODMITNUTO, type Faktura } from '@/lib/faktury-types'
import { pouzitFiltry, type FakturyFiltry } from '@/lib/faktury-filtry'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { archivovatFakturu, obnovitFakturu, odmitnoutAZapamatovat, smazatFakturu } from '../akce'
import StavZnacka from '../stav-znacka'

export const dynamic = 'force-dynamic'

/**
 * Faktury — seznam.
 *
 * Přeneseno z faktury-app (src/app/faktury/page.tsx) — filtrování,
 * DB-side stránkování (100/stránka) a měsíční chipy beze změny logiky,
 * jen zdroj dat a rám. CSV export (`/api/export` v originále) zatím
 * chybí — viz `docs/hlaseni/faktury-slouceni-stav-2026-09-15.md`.
 */

const STAVY = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno', 'Uhrazeno', STAV_ODMITNUTO]
const NA_STRANU = 100

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '13.5px',
} as const

function pluralFaktur(n: number): string {
  if (n === 1) return 'faktura'
  if (n >= 2 && n <= 4) return 'faktury'
  return 'faktur'
}

export default async function FakturySeznam({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{
    stav?: string; mesic?: string; kontrola?: string; archiv?: string
    dodavatel?: string; hledat?: string; duplicity?: string; strana?: string; vyrazeno?: string
  }>
}) {
  const { rozsah } = await params
  const sp = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }
  const smiSpravovat = (await zkusPristup(tenantId, 'faktury.manage', rozsah)).stav === 'ok'

  const filtry: FakturyFiltry = {
    archiv: sp.archiv === '1',
    stav: sp.stav,
    kontrola: sp.kontrola === '1',
    mesic: sp.mesic,
    dodavatel: sp.dodavatel,
    hledat: (sp.hledat ?? '').trim(),
    duplicity: sp.duplicity === '1',
  }
  const pozadovanaStrana = Math.max(1, parseInt(sp.strana ?? '1', 10) || 1)

  const supabase = getFakturySupabase()
  const od = (pozadovanaStrana - 1) * NA_STRANU

  let dotazDat = supabase.from('invoices').select('*')
    .order('duzp', { ascending: false, nullsFirst: false }).order('id', { ascending: true })
  dotazDat = pouzitFiltry(dotazDat, filtry)

  let dotazPoctu = supabase.from('invoices').select('*', { count: 'exact', head: true })
  dotazPoctu = pouzitFiltry(dotazPoctu, filtry)

  const [{ data, error }, { count }, { count: archivovanychCelkem }] = await Promise.all([
    dotazDat.range(od, od + NA_STRANU - 1),
    dotazPoctu,
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('is_archived', true),
  ])

  if (error) console.error(error)
  const radky = (data ?? []) as Faktura[]
  const celkem = count ?? 0
  const celkemStran = Math.max(1, Math.ceil(celkem / NA_STRANU))
  const aktualniStrana = Math.min(pozadovanaStrana, celkemStran)

  // Měsíce DUZP pro chipy — nezávisle na ostatních filtrech, čte se jen sloupec duzp.
  const mesicniDotaz = supabase.from('invoices').select('duzp').eq('is_archived', filtry.archiv)
  const { data: mesicniData } = filtry.archiv || filtry.stav === STAV_ODMITNUTO
    ? await mesicniDotaz
    : await mesicniDotaz.neq('status', STAV_ODMITNUTO)
  const mesice = Array.from(new Set(
    ((mesicniData ?? []) as { duzp: string | null }[]).map((r) => r.duzp?.slice(0, 7)).filter((x): x is string => Boolean(x)),
  )).sort((a, b) => b.localeCompare(a))

  const zaklad = `/${rozsah}/finance/faktury/seznam`
  function stavPole(prepis: Partial<Record<'stav' | 'mesic' | 'kontrola' | 'archiv' | 'dodavatel' | 'hledat' | 'duplicity', string | undefined>>) {
    const p = new URLSearchParams()
    const hodnoty = {
      stav: 'stav' in prepis ? prepis.stav : filtry.stav,
      mesic: 'mesic' in prepis ? prepis.mesic : filtry.mesic,
      kontrola: 'kontrola' in prepis ? prepis.kontrola : (filtry.kontrola ? '1' : undefined),
      archiv: 'archiv' in prepis ? prepis.archiv : (filtry.archiv ? '1' : undefined),
      dodavatel: 'dodavatel' in prepis ? prepis.dodavatel : filtry.dodavatel,
      hledat: 'hledat' in prepis ? prepis.hledat : (filtry.hledat || undefined),
      duplicity: 'duplicity' in prepis ? prepis.duplicity : (filtry.duplicity ? '1' : undefined),
    }
    for (const [k, v] of Object.entries(hodnoty)) if (v) p.set(k, v)
    const qs = p.toString()
    return qs ? `${zaklad}?${qs}` : zaklad
  }
  function stranaOdkaz(cil: number) {
    const p = new URLSearchParams(stavPole({}).split('?')[1])
    if (cil > 1) p.set('strana', String(cil))
    const qs = p.toString()
    return qs ? `${zaklad}?${qs}` : zaklad
  }

  const nadpis = filtry.archiv ? 'Archivované faktury' : filtry.dodavatel || 'Všechny faktury'
  const popis = filtry.dodavatel
    ? `Faktury od dodavatele ${filtry.dodavatel}. ${celkem} ${pluralFaktur(celkem)}.`
    : `${celkem} ${pluralFaktur(celkem)}${filtry.archiv ? '' : ' od 1. 1. 2026'}.`

  return (
    <>
      <Nadpis oci="Faktury" popis={popis}>{nadpis}</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        {sp.vyrazeno ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--mosaz)' }}>
            Zároveň vyřazeno {sp.vyrazeno} dalších faktur od stejného dodavatele.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {filtry.dodavatel ? (
            <Link href={stavPole({ dodavatel: undefined })} className="ft-tl ft-tl-male">← Všichni dodavatelé</Link>
          ) : null}
          <Link
            href={stavPole({ archiv: filtry.archiv ? undefined : '1', stav: undefined, kontrola: undefined, mesic: undefined, dodavatel: undefined })}
            className="ft-tl ft-tl-male"
          >
            {filtry.archiv ? '← Zpět na faktury' : `Archivované (${archivovanychCelkem ?? 0})`}
          </Link>
        </div>

        {!filtry.archiv ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={stavPole({ stav: undefined, kontrola: undefined })} className="ft-tl ft-tl-male" style={!filtry.stav && !filtry.kontrola ? { borderColor: 'var(--mosaz)' } : undefined}>Vše</Link>
            {STAVY.map((s) => (
              <Link key={s} href={stavPole({ stav: s, kontrola: undefined })} className="ft-tl ft-tl-male" style={filtry.stav === s ? { borderColor: 'var(--mosaz)' } : undefined}>{s}</Link>
            ))}
            <Link href={stavPole({ stav: undefined, kontrola: '1' })} className="ft-tl ft-tl-male" style={filtry.kontrola ? { borderColor: 'var(--mosaz)' } : undefined}>Nutná ruční kontrola</Link>
            <Link href={stavPole({ duplicity: filtry.duplicity ? undefined : '1' })} className="ft-tl ft-tl-male" style={filtry.duplicity ? { borderColor: 'var(--mosaz)' } : undefined}>Duplicitní</Link>

            <form action={zaklad} method="get" style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
              {filtry.stav ? <input type="hidden" name="stav" value={filtry.stav} /> : null}
              {filtry.mesic ? <input type="hidden" name="mesic" value={filtry.mesic} /> : null}
              {filtry.kontrola ? <input type="hidden" name="kontrola" value="1" /> : null}
              {filtry.dodavatel ? <input type="hidden" name="dodavatel" value={filtry.dodavatel} /> : null}
              <input type="text" name="hledat" placeholder="Hledat…" defaultValue={filtry.hledat} style={pole} />
              <button type="submit" className="ft-tl ft-tl-male">Hledat</button>
            </form>
          </div>
        ) : null}

        {mesice.length > 0 ? (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--faint)' }}>Měsíc DUZP:</span>
            <Link href={stavPole({ mesic: undefined })} className="ft-tl ft-tl-male" style={!filtry.mesic ? { borderColor: 'var(--mosaz)' } : undefined}>všechny</Link>
            {mesice.map((m) => (
              <Link key={m} href={stavPole({ mesic: m })} className="ft-tl ft-tl-male" style={filtry.mesic === m ? { borderColor: 'var(--mosaz)' } : undefined}>{m}</Link>
            ))}
          </div>
        ) : null}

        {radky.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              {filtry.archiv ? 'Žádné archivované faktury.' : 'Žádné faktury neodpovídají filtru.'}
            </p>
          </div>
        ) : (
          <div style={{ ...karta, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Dodavatel</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Č. faktury</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500, textAlign: 'right' }}>Částka</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>DUZP</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Splatnost</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Stav</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Soubor</th>
                  {smiSpravovat ? <th style={{ padding: '10px 12px' }} /> : null}
                </tr>
              </thead>
              <tbody>
                {radky.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <Link href={stavPole({ dodavatel: f.supplier || undefined })} style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}>
                        <span style={{ width: '22px', height: '22px', borderRadius: 'var(--radius-full)', background: barvaDodavatele(f.supplier), color: '#fff', fontSize: '10px', display: 'grid', placeItems: 'center', flex: 'none' }}>
                          {inicialyDodavatele(f.supplier)}
                        </span>
                        {f.supplier || '–'}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{f.invoice_number || '–'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{formatCastku(f.amount, f.currency)}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{formatDatum(f.duzp)}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{formatDatum(f.due_date)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <StavZnacka stav={f.status} />
                      {f.is_duplicate ? (
                        <span title="Možná duplicita (stejný dodavatel a číslo faktury)" style={{ marginLeft: '4px', fontSize: '11px', padding: '2px 6px', borderRadius: 'var(--radius-full)', background: 'var(--bad-bg)', color: 'var(--bad)' }}>
                          Duplicitní
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {f.pdf_url ? <a href={f.pdf_url} target="_blank" rel="noreferrer">PDF</a> : null}
                      {f.pdf_url && f.onedrive_url ? ' · ' : null}
                      {f.onedrive_url ? <a href={f.onedrive_url} target="_blank" rel="noreferrer">OneDrive</a> : null}
                      {!f.pdf_url && !f.onedrive_url ? '–' : null}
                    </td>
                    {smiSpravovat ? (
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <form action={f.is_archived ? obnovitFakturu : archivovatFakturu}>
                            <input type="hidden" name="rozsah" value={rozsah} />
                            <input type="hidden" name="id" value={f.id} />
                            <button type="submit" className="ft-tl ft-tl-male">{f.is_archived ? 'Obnovit' : 'Archivovat'}</button>
                          </form>
                          <form action={smazatFakturu}>
                            <input type="hidden" name="rozsah" value={rozsah} />
                            <input type="hidden" name="id" value={f.id} />
                            <button type="submit" className="ft-tl ft-tl-male">Smazat</button>
                          </form>
                          {!f.is_archived && f.status !== STAV_ODMITNUTO ? (
                            <form action={odmitnoutAZapamatovat}>
                              <input type="hidden" name="rozsah" value={rozsah} />
                              <input type="hidden" name="id" value={f.id} />
                              <input type="hidden" name="druh" value="not_invoice" />
                              <button type="submit" className="ft-tl ft-tl-male" title="Odmítnout jako „není faktura“, zapamatovat pro AI a vyřadit i ostatní od stejného dodavatele">
                                Není faktura
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {celkemStran > 1 ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' }}>
            {aktualniStrana > 1 ? (
              <Link href={stranaOdkaz(aktualniStrana - 1)} className="ft-tl ft-tl-male">← Předchozí</Link>
            ) : <span style={{ opacity: 0.4 }}>← Předchozí</span>}
            <span style={{ fontSize: '12.5px', color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>
              Stránka {aktualniStrana} z {celkemStran}
            </span>
            {aktualniStrana < celkemStran ? (
              <Link href={stranaOdkaz(aktualniStrana + 1)} className="ft-tl ft-tl-male">Další →</Link>
            ) : <span style={{ opacity: 0.4 }}>Další →</span>}
          </div>
        ) : null}
      </div>
    </>
  )
}
