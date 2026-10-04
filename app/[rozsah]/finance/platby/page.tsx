import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyJsouNastavene, getFakturySupabase } from '@/lib/supabase/faktury'
import { jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import { navrhnoutParovani, type KandidatFaktura, type KandidatTransakce, type Navrh } from '@/lib/finance-parovani'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitPlatebniUcet, zapsatTransakci, potvrditParovani, zrusitAlokaci } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Platby.
 *
 * Ruční zápis pohybu, přehled posledních transakcí a fronta návrhů
 * párování s fakturami. Návrhy se POČÍTAJÍ při každém načtení (nic se
 * neukládá jako „navrženo“) — uložený řádek v `platby_faktury` vzniká
 * teprve potvrzením, vždy lidským kliknutím (zadání, oddíl 5).
 */

type PlatebniUcet = { id: string; nazev: string; typ: string; branch_id: string | null }
type Transakce = {
  id: string
  smer: 'prijem' | 'vydaj' | 'prevod_dovnitr' | 'prevod_ven'
  castka_haleru: number
  datum: string
  protistrana: string
  vs: string
  zdroj: string
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type PotvrzenaAlokace = {
  id: string
  transakceId: string
  fakturaId: string
  castkaHaleru: number
  potvrzenoKdy: string | null
  transakce: { datum: string; protistrana: string } | null
  dodavatel: string | null
}

async function nactiPotvrzeneAlokace(
  tenantId: string,
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
): Promise<PotvrzenaAlokace[]> {
  const { data } = await supabase
    .from('platby_faktury')
    .select('id, transakce_id, faktura_id, castka_haleru, potvrzeno_kdy')
    .eq('tenant_id', tenantId)
    .eq('stav', 'potvrzeno')
    .order('potvrzeno_kdy', { ascending: false })
    .limit(20)

  const alokace = (data ?? []) as {
    id: string
    transakce_id: string
    faktura_id: string
    castka_haleru: number
    potvrzeno_kdy: string | null
  }[]
  if (alokace.length === 0) return []

  const transakceIds = [...new Set(alokace.map((a) => a.transakce_id))]
  const { data: transakceData } = await supabase
    .from('transakce')
    .select('id, datum, protistrana')
    .in('id', transakceIds)
  const transakceMapa = new Map(
    ((transakceData ?? []) as { id: string; datum: string; protistrana: string }[]).map((t) => [t.id, t]),
  )

  // Jméno dodavatele je jen pro zobrazení — appka tu znovu NEČTE
  // `invoices.status` jako zdroj pravdy (ten zůstal v Fakturách jen
  // jako best-effort kopie), pouze dodavatele k číslu faktury.
  let dodavateleMapa = new Map<string, string>()
  if (fakturyJsouNastavene()) {
    try {
      const fakturyIds = [...new Set(alokace.map((a) => a.faktura_id))]
      const supabaseFaktury = getFakturySupabase()
      const { data: fakturyData } = await supabaseFaktury
        .from('invoices')
        .select('id, supplier')
        .eq('tenant_id', tenantId)
        .in('id', fakturyIds)
      dodavateleMapa = new Map(
        ((fakturyData ?? []) as { id: string; supplier: string | null }[]).map((f) => [f.id, f.supplier ?? '']),
      )
    } catch {
      // Best-effort — bez dodavatele appka ukáže jen číslo faktury.
    }
  }

  return alokace.map((a) => ({
    id: a.id,
    transakceId: a.transakce_id,
    fakturaId: a.faktura_id,
    castkaHaleru: a.castka_haleru,
    potvrzenoKdy: a.potvrzeno_kdy,
    transakce: transakceMapa.get(a.transakce_id) ?? null,
    dodavatel: dodavateleMapa.get(a.faktura_id) ?? null,
  }))
}

async function nactiNavrhyParovani(
  tenantId: string,
  transakce: readonly Transakce[],
  jizSparovane: ReadonlySet<string>,
): Promise<{ navrh: Navrh; faktura: KandidatFaktura }[]> {
  if (!fakturyJsouNastavene()) return []

  let faktury: Faktura[] = []
  try {
    const supabaseFaktury = getFakturySupabase()
    const { data } = await supabaseFaktury
      .from('invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
    faktury = ((data ?? []) as Faktura[]).filter(jeNezaplacena)
  } catch {
    return []
  }

  if (faktury.length === 0) return []

  const kandidati: KandidatFaktura[] = faktury.map((f) => ({
    id: f.id,
    vs: f.variable_symbol,
    castkaHaleru: Math.round(f.amount * 100),
    dodavatel: f.supplier,
    datum: f.due_date ?? f.issue_date,
  }))

  const vysledky: { navrh: Navrh; faktura: KandidatFaktura }[] = []
  for (const t of transakce) {
    if (t.smer !== 'vydaj' || jizSparovane.has(t.id)) continue
    const kandidatTransakce: KandidatTransakce = {
      id: t.id,
      vs: t.vs,
      castkaHaleru: t.castka_haleru,
      protistrana: t.protistrana,
      datum: t.datum,
    }
    const navrh = navrhnoutParovani(kandidatTransakce, kandidati)
    if (!navrh) continue
    const faktura = kandidati.find((k) => k.id === navrh.fakturaId)
    if (faktura) vysledky.push({ navrh, faktura })
  }
  return vysledky
}

export default async function FinancePlatby({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; importovano?: string }>
}) {
  const { rozsah } = await params
  const { chyba, importovano } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Platby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  const [ucty, transakceRes, sparovaneRes] = await Promise.all([
    supabase.from('platebni_ucty').select('id, nazev, typ, branch_id').eq('tenant_id', tenantId).eq('aktivni', true).order('nazev'),
    supabase
      .from('transakce')
      .select('id, smer, castka_haleru, datum, protistrana, vs, zdroj')
      .eq('tenant_id', tenantId)
      .order('datum', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('platby_faktury').select('transakce_id').eq('tenant_id', tenantId),
  ])

  const platebniUcty = (ucty.data ?? []) as PlatebniUcet[]
  const transakce = (transakceRes.data ?? []) as Transakce[]
  const jizSparovane = new Set(((sparovaneRes.data ?? []) as { transakce_id: string }[]).map((r) => r.transakce_id))

  const navrhy = await nactiNavrhyParovani(tenantId, transakce, jizSparovane)
  const potvrzeneAlokace = await nactiPotvrzeneAlokace(tenantId, supabase)

  const dnes = new Date()
  const prvniDenMesice = `${dnes.getFullYear()}-${String(dnes.getMonth() + 1).padStart(2, '0')}-01`
  const posledniDenMesice = new Date(dnes.getFullYear(), dnes.getMonth() + 1, 0).toISOString().slice(0, 10)

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis="Ruční zápis pohybu a fronta návrhů párování s fakturami.">
        Platby
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {importovano ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            Import hotový — zapsáno {importovano} {importovano === '1' ? 'nová platba' : 'nových plateb'}.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`/${rozsah}/finance/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link>
          <a href={`/api/ucetni/export?rozsah=${encodeURIComponent(rozsah)}&od=${prvniDenMesice}&do=${posledniDenMesice}`} className="ft-tl">
            Export pro účetního (tento měsíc)
          </a>
        </div>

        {navrhy.length > 0 ? (
          <section style={{ display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Návrhy párování ({navrhy.length})</h2>
            {navrhy.map(({ navrh, faktura }) => {
              const castkaPlatbyHaleru = transakce.find((t) => t.id === navrh.transakceId)?.castka_haleru ?? 0
              // Alokovat NEJVÝŠ tolik, kolik platba skutečně nese — dřív
              // se sem natvrdo dávala celá částka faktury, takže platba
              // nižší než faktura (částečná úhrada) by appku nahlásila
              // jako plně uhrazenou. `app.potvrdit_alokaci_platby` tohle
              // i tak ověří (nikdy nedůvěřuje jen klientovi), tohle je
              // jen rozumná výchozí hodnota pro tlačítko.
              const castkaKAlokaciHaleru = Math.min(castkaPlatbyHaleru, faktura.castkaHaleru)
              return (
                <div key={`${navrh.transakceId}-${navrh.fakturaId}`} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '13.5px' }}>
                      Platba {koruny(castkaPlatbyHaleru)} ↔ faktura {faktura.dodavatel ?? '—'} ({koruny(faktura.castkaHaleru)})
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Jistota {Math.round(navrh.jistota * 100)} %</div>
                  </div>
                  {smiPsat ? (
                    <form action={potvrditParovani}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="transakce_id" value={navrh.transakceId} />
                      <input type="hidden" name="faktura_id" value={navrh.fakturaId} />
                      <input type="hidden" name="castka_haleru" value={castkaKAlokaciHaleru} />
                      <input type="hidden" name="castka_faktury_celkem_haleru" value={faktura.castkaHaleru} />
                      <input type="hidden" name="jistota" value={navrh.jistota} />
                      <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit párování</button>
                    </form>
                  ) : null}
                </div>
              )
            })}
          </section>
        ) : null}

        {potvrzeneAlokace.length > 0 ? (
          <section style={{ display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Potvrzená párování ({potvrzeneAlokace.length})</h2>
            {potvrzeneAlokace.map((a) => (
              <div key={a.id} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '13.5px' }}>
                    {koruny(a.castkaHaleru)} ↔ faktura {a.dodavatel || a.fakturaId}
                    {a.transakce ? ` · ${a.transakce.protistrana || '—'} (${a.transakce.datum})` : ''}
                  </div>
                </div>
                {smiPsat ? (
                  <form action={zrusitAlokaci}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="alokace_id" value={a.id} />
                    <button type="submit" className="ft-tl">Zrušit párování</button>
                  </form>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        <section style={{ display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>Poslední pohyby</h2>
          {transakce.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné zapsané pohyby.</p>
          ) : (
            <div style={{ ...karta, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '6px 8px' }}>Datum</th>
                    <th style={{ padding: '6px 8px' }}>Směr</th>
                    <th style={{ padding: '6px 8px' }}>Částka</th>
                    <th style={{ padding: '6px 8px' }}>Protistrana</th>
                    <th style={{ padding: '6px 8px' }}>Zdroj</th>
                  </tr>
                </thead>
                <tbody>
                  {transakce.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '6px 8px' }}>{t.datum}</td>
                      <td style={{ padding: '6px 8px' }}>{t.smer === 'prijem' ? 'Příjem' : t.smer === 'vydaj' ? 'Výdaj' : t.smer}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(t.castka_haleru)}</td>
                      <td style={{ padding: '6px 8px' }}>{t.protistrana || '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{t.zdroj}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {smiPsat ? (
          <form action={zapsatTransakci} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Zapsat platbu</h2>

            {platebniUcty.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Nejdřív založte platební účet níže.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <label>
                  <span style={popisek}>Účet *</span>
                  <select name="ucet_id" required style={pole}>
                    {platebniUcty.map((u) => <option key={u.id} value={u.id}>{u.nazev}</option>)}
                  </select>
                </label>
                <label>
                  <span style={popisek}>Směr *</span>
                  <select name="smer" required style={pole}>
                    <option value="prijem">Příjem</option>
                    <option value="vydaj">Výdaj</option>
                  </select>
                </label>
                <label>
                  <span style={popisek}>Částka (Kč) *</span>
                  <input type="text" name="castka" required placeholder="1234,50" style={pole} />
                </label>
                <label>
                  <span style={popisek}>Datum *</span>
                  <input type="date" name="datum" required defaultValue={new Date().toISOString().slice(0, 10)} style={pole} />
                </label>
                <label>
                  <span style={popisek}>Protistrana</span>
                  <input type="text" name="protistrana" style={pole} />
                </label>
                <label>
                  <span style={popisek}>Variabilní symbol</span>
                  <input type="text" name="vs" style={pole} />
                </label>
              </div>
            )}

            <label>
              <span style={popisek}>Poznámka</span>
              <input type="text" name="poznamka" style={pole} />
            </label>

            {platebniUcty.length > 0 ? (
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat platbu</button>
              </div>
            ) : null}
          </form>
        ) : null}

        {smiPsat ? (
          <form action={zalozitPlatebniUcet} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nový platební účet</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>Název *</span>
                <input type="text" name="nazev" required placeholder="např. Hlavní bankovní účet" style={pole} />
              </label>
              <label>
                <span style={popisek}>Typ *</span>
                <select name="typ" required style={pole}>
                  <option value="banka">Banka</option>
                  <option value="pokladna">Pokladna</option>
                  <option value="karta">Karta</option>
                </select>
              </label>
            </div>
            <div>
              <button type="submit" className="ft-tl">Založit účet</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
