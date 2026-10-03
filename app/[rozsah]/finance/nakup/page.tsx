import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee, isModuleActive } from '@/lib/authz'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitObjednavku } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Nákup.
 *
 * Objednávky dodavatelům — procure-to-pay BEZ fyzického skladu (mantinel).
 * `purchasing.read`/`purchasing.manage` patří v katalogu modulu
 * `objednavky`, ne `finance` — appka proto kontroluje OBA moduly.
 */

type Objednavka = {
  id: string
  cislo: string
  stav: string
  datum_objednani: string
  pozadovane_datum_dodani: string | null
  kontakty: { nazev: string } | { nazev: string }[] | null
}

type Kontakt = { id: string; nazev: string }
type Branch = { id: string; name: string }

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

const popisek = { display: 'block', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '4px' } as const

const NAZVY_STAVU: Record<string, string> = {
  koncept: 'Koncept',
  schvaleno: 'Schváleno',
  odeslano: 'Odesláno',
  castecne_prijato: 'Částečně přijato',
  prijato: 'Přijato',
  'zrušeno': 'Zrušeno',
}

function nazevDodavatele(k: Objednavka['kontakty']): string {
  if (!k) return '—'
  return Array.isArray(k) ? (k[0]?.nazev ?? '—') : k.nazev
}

export default async function FinanceNakup({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'purchasing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Nákup vidí ten, kdo má právo „Vidět objednávky a sklad“.</Sdeleni>
  }
  if (!isModuleActive(pristup.ctx, 'objednavky')) {
    return <Sdeleni nadpis="Modul Objednávky není zapnutý">Nákup potřebuje aktivní modul „Objednávky“, ne jen „Finance“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'purchasing.manage')
  const supabase = await getServerSupabase()

  const [objednavkyRes, kontaktyRes, branchesRes] = await Promise.all([
    supabase
      .from('objednavky_dodavatelum')
      .select('id, cislo, stav, datum_objednani, pozadovane_datum_dodani, kontakty(nazev)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('kontakty').select('id, nazev').eq('tenant_id', tenantId).eq('je_dodavatel', true).is('deleted_at', null).order('nazev'),
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
  ])

  const objednavky = (objednavkyRes.data ?? []) as Objednavka[]
  const dodavatele = (kontaktyRes.data ?? []) as Kontakt[]
  const branches = (branchesRes.data ?? []) as Branch[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis={`${objednavky.length} ${objednavky.length === 1 ? 'objednávka' : 'objednávek'}.`}>
        Nákup
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '960px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        {objednavky.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné objednávky.</p>
        ) : (
          <div style={{ ...karta, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '6px 8px' }}>Číslo</th>
                  <th style={{ padding: '6px 8px' }}>Dodavatel</th>
                  <th style={{ padding: '6px 8px' }}>Stav</th>
                  <th style={{ padding: '6px 8px' }}>Objednáno</th>
                  <th style={{ padding: '6px 8px' }}>Dodání</th>
                </tr>
              </thead>
              <tbody>
                {objednavky.map((o) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Link href={`/${rozsah}/finance/nakup/${o.id}`} className="ft-tl">{o.cislo}</Link>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{nazevDodavatele(o.kontakty)}</td>
                    <td style={{ padding: '6px 8px' }}>{NAZVY_STAVU[o.stav] ?? o.stav}</td>
                    <td style={{ padding: '6px 8px' }}>{o.datum_objednani}</td>
                    <td style={{ padding: '6px 8px' }}>{o.pozadovane_datum_dodani ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {smiPsat ? (
          <form action={zalozitObjednavku} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nová objednávka</h2>

            {dodavatele.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Nejdřív založte dodavatele v{' '}
                <Link href={`/${rozsah}/finance/kontakty`} className="ft-tl">Kontaktech</Link> (zaškrtněte „Dodavatel“).
              </p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <label>
                    <span style={popisek}>Dodavatel *</span>
                    <select name="kontakt_id" required style={pole}>
                      {dodavatele.map((d) => <option key={d.id} value={d.id}>{d.nazev}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={popisek}>Pobočka</span>
                    <select name="branch_id" style={pole} defaultValue="">
                      <option value="">Celá firma</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={popisek}>Požadované datum dodání</span>
                    <input type="date" name="pozadovane_datum_dodani" style={pole} />
                  </label>
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <span style={popisek}>Položky (vyplňte alespoň jednu)</span>
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '8px' }}>
                      <input type="text" name={`nazev_${i}`} placeholder="Surovina / položka" style={pole} />
                      <input type="text" name={`jednotka_${i}`} placeholder="kg, ks…" style={pole} />
                      <input type="text" name={`mnozstvi_${i}`} placeholder="Množství" style={pole} />
                      <input type="text" name={`cena_${i}`} placeholder="Cena/j. Kč" style={pole} />
                    </div>
                  ))}
                </div>

                <label>
                  <span style={popisek}>Poznámka</span>
                  <input type="text" name="poznamka" style={pole} />
                </label>

                <div>
                  <button type="submit" className="ft-tl ft-tl-hlavni">Založit objednávku</button>
                </div>
              </>
            )}
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
