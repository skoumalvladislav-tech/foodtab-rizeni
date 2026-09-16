import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { prepnoutUsek, upravitUsek, zalozitUsek } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Úseky.
 *
 * Šéfík 16.9.2026: "nefungují úseky u jednotlivých poboček — kuchyně,
 * restaurace/bar, vedení". Tabulka `useky` a její RLS existovaly už
 * dřív (jiná relace, jiné zadání), ale žádná obrazovka je nespravovala
 * a žádná nedovolila přiřadit úsek zaměstnanci — v datech proto stál
 * jediný řádek ("Kuchyně") a u nikoho nebyl nastavený. Viz i komentář
 * v akce.ts pro rozdíl mezi Úsekem a Zařazením.
 */

type Usek = {
  id: string
  nazev: string
  branch_id: string | null
  poradi: number
  active: boolean
}

export default async function NastaveniUseky({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; stav?: string }>
}) {
  const { rozsah } = await params
  const { chyba, stav } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Úseky spravuje jen ten, kdo má právo <code>settings.manage</code>.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const { data: usekyData, error: chybaUseky } = await supabase
    .from('useky')
    .select('id, nazev, branch_id, poradi, active')
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false })
    .order('poradi')
    .order('nazev')
  if (chybaUseky) throw new DotazSelhal('úseky', chybaUseky)
  const useky = (usekyData ?? []) as Usek[]

  const { data: pobockyData, error: chybaPobocek } = await supabase
    .from('branches')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name')
  if (chybaPobocek) throw new DotazSelhal('pobočky', chybaPobocek)
  const pobocky = (pobockyData ?? []).map((b) => ({ id: b.id as string, nazev: b.name as string }))
  const nazvyPobocek = new Map(pobocky.map((b) => [b.id, b.nazev]))

  const { data: lideData, error: chybaLide } = await supabase
    .from('employees')
    .select('usek_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  if (chybaLide) throw new DotazSelhal('lidé podle úseku', chybaLide)
  const pocetLidi = new Map<string, number>()
  for (const l of lideData ?? []) {
    const id = l.usek_id as string | null
    if (!id) continue
    pocetLidi.set(id, (pocetLidi.get(id) ?? 0) + 1)
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Do jakého týmu člověk patří — Kuchyně, Bar, Vedení. Jiná věc než Zařazení (čím je a co smí)."
      >
        Úseky
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
        {stav ? (
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--good)' }}>
            {popisStavu(stav)}
          </p>
        ) : null}

        <form action={zalozitUsek} style={zalozeni}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <label style={{ display: 'grid', gap: '4px', flex: '1 1 220px' }}>
            <span style={popisek}>Nový úsek</span>
            <input
              type="text"
              name="nazev"
              required
              maxLength={60}
              placeholder="např. Bar"
              style={poleText}
            />
          </label>
          <label style={{ display: 'grid', gap: '4px', flex: '1 1 200px' }}>
            <span style={popisek}>Pobočka</span>
            <select name="pobocka" defaultValue="" style={poleText}>
              <option value="">celá firma</option>
              {pobocky.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nazev}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="ft-tl ft-tl-vedlejsi">
            Založit
          </button>
        </form>

        {useky.length === 0 ? (
          <p style={{ fontSize: '14px', color: 'var(--muted)' }}>Zatím žádný úsek.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {useky.map((u) => {
              const lidi = pocetLidi.get(u.id) ?? 0
              return (
                <li
                  key={u.id}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow)',
                    padding: '16px',
                    opacity: u.active ? 1 : 0.6,
                  }}
                >
                  <form action={upravitUsek} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="usek" value={u.id} />
                    <label style={{ display: 'grid', gap: '4px', flex: '1 1 200px' }}>
                      <span style={popisek}>Název</span>
                      <input
                        type="text"
                        name="nazev"
                        defaultValue={u.nazev}
                        required
                        maxLength={60}
                        aria-label={`Název úseku ${u.nazev}`}
                        style={poleText}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: '4px', flex: '1 1 180px' }}>
                      <span style={popisek}>Pobočka</span>
                      <select name="pobocka" defaultValue={u.branch_id ?? ''} style={poleText} aria-label={`Pobočka úseku ${u.nazev}`}>
                        <option value="">celá firma</option>
                        {pobocky.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nazev}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Uložit
                    </button>
                  </form>

                  <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
                    {u.branch_id ? nazvyPobocek.get(u.branch_id) ?? 'neznámá pobočka' : 'celá firma'} ·{' '}
                    {lidi === 0 ? 'zatím ho nemá nikdo' : lidi === 1 ? 'má ho jeden člověk' : `má ho ${lidi} lidí`}
                    {u.active ? '' : ' · vyřazený'}
                  </p>

                  <form action={prepnoutUsek} style={{ marginTop: '10px' }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="usek" value={u.id} />
                    <input type="hidden" name="zapnout" value={u.active ? 'ne' : 'ano'} />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      {u.active ? 'Vyřadit' : 'Vrátit'}
                    </button>
                  </form>
                </li>
              )
            })}
          </ul>
        )}

        <p style={{ margin: '20px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
          Úsek se nemaže, jen vyřazuje z nabídky — lidem, kteří ho mají,
          zůstane. Komu úsek přiřadit, se nastaví u člověka v Nastavení
          → Lidé.
        </p>
      </div>
    </>
  )
}

function popisChyby(kod: string): string {
  switch (kod) {
    case 'prazdny':
      return 'Vyplňte název.'
    case 'pravo':
      return 'Na tuhle změnu nemáte právo.'
    default:
      return 'Uložení se nepovedlo. Zkuste to prosím znovu.'
  }
}

function popisStavu(kod: string): string {
  switch (kod) {
    case 'zalozen':
      return 'Úsek přidán.'
    case 'upraven':
      return 'Uloženo.'
    case 'vyrazen':
      return 'Vyřazeno z nabídky. Lidem, kteří ho mají, zůstává.'
    case 'vracen':
      return 'Vráceno do nabídky.'
    default:
      return ''
  }
}

const zalozeni = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'flex-end',
  gap: '8px',
  margin: '0 0 20px',
  padding: '14px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
}

const popisek = {
  fontSize: '13px',
  color: 'var(--muted)',
}

const poleText = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
}
