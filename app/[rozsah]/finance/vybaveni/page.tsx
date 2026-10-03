import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitVybaveni, smazatVybaveni } from './akce'

export const dynamic = 'force-dynamic'

type Vybaveni = {
  id: string
  nazev: string
  kategorie: string
  datum_porizeni: string | null
  cena_haleru: number | null
  zaruka_do: string | null
  servis_dalsi_kdy: string | null
}
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

function brzkySevis(datum: string | null): boolean {
  if (!datum) return false
  const za30dni = new Date()
  za30dni.setDate(za30dni.getDate() + 30)
  return new Date(datum) <= za30dni
}

export default async function FinanceVybaveni({
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

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Vybavení vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  const [vybaveniRes, branchesRes] = await Promise.all([
    supabase
      .from('vybaveni')
      .select('id, nazev, kategorie, datum_porizeni, cena_haleru, zaruka_do, servis_dalsi_kdy')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('nazev'),
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
  ])

  const vybaveniSeznam = (vybaveniRes.data ?? []) as Vybaveni[]
  const branches = (branchesRes.data ?? []) as Branch[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis={`${vybaveniSeznam.length} ${vybaveniSeznam.length === 1 ? 'položka' : 'položek'}. Bez odpisů — jen evidence.`}>
        Vybavení
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        {vybaveniSeznam.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné vybavení.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {vybaveniSeznam.map((v) => (
              <div key={v.id} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <strong>{v.nazev}</strong>
                    {brzkySevis(v.servis_dalsi_kdy) ? (
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--pozor-bg)', color: 'var(--pozor)' }}>
                        servis do 30 dní
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '4px' }}>
                    {v.kategorie || '—'}
                    {v.datum_porizeni ? ` · pořízeno ${v.datum_porizeni}` : ''}
                    {v.cena_haleru !== null ? ` · ${koruny(v.cena_haleru)}` : ''}
                    {v.zaruka_do ? ` · záruka do ${v.zaruka_do}` : ''}
                    {v.servis_dalsi_kdy ? ` · servis ${v.servis_dalsi_kdy}` : ''}
                  </div>
                </div>
                {smiPsat ? (
                  <form action={smazatVybaveni}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className="ft-tl">Vyřadit</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {smiPsat ? (
          <form action={zalozitVybaveni} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nové vybavení</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>Název *</span>
                <input type="text" name="nazev" required placeholder="např. Konvektomat" style={pole} />
              </label>
              <label>
                <span style={popisek}>Kategorie</span>
                <input type="text" name="kategorie" placeholder="kuchyňské zařízení" style={pole} />
              </label>
              <label>
                <span style={popisek}>Pobočka</span>
                <select name="branch_id" style={pole} defaultValue="">
                  <option value="">Celá firma</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label>
                <span style={popisek}>Datum pořízení</span>
                <input type="date" name="datum_porizeni" style={pole} />
              </label>
              <label>
                <span style={popisek}>Cena (Kč)</span>
                <input type="text" name="cena" placeholder="150000" style={pole} />
              </label>
              <label>
                <span style={popisek}>Záruka do</span>
                <input type="date" name="zaruka_do" style={pole} />
              </label>
              <label>
                <span style={popisek}>Další servis</span>
                <input type="date" name="servis_dalsi_kdy" style={pole} />
              </label>
            </div>
            <label>
              <span style={popisek}>Poznámka</span>
              <input type="text" name="poznamka" style={pole} />
            </label>
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
