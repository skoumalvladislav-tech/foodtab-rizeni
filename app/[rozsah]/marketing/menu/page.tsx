import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { zalozitMenuZTextu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Menu a jeho import.
 *
 * Zadání: master prompt, oddíl 10 — čtyři způsoby, jak menu založit.
 * Hotové jsou dva: ruční formulář a vložený text. Fotka a PDF přijdou
 * potom; dokud nejsou, radši tu nejsou ani tlačítka, která by nic
 * neudělala.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const DRUHY = [
  { klic: 'denni', nazev: 'Denní' },
  { klic: 'tydenni', nazev: 'Týdenní' },
  { klic: 'vikendove', nazev: 'Víkendové' },
  { klic: 'poledni', nazev: 'Polední' },
  { klic: 'sezonni', nazev: 'Sezonní' },
]

function popisStavu(stav: string): string {
  return stav === 'potvrzeno' ? 'Potvrzeno' : stav === 'archivovano' ? 'Archiv' : 'Koncept'
}

export default async function MenuPrehled({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Menu vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  const dotaz = await supabase
    .from('marketing_menu')
    .select('id, druh, nazev, plati_od, stav, zdroj, vytvoreno_kdy')
    .eq('tenant_id', tenantId)
    .order('vytvoreno_kdy', { ascending: false })
    .limit(50)

  if (tabulkaNeexistuje(dotaz.error)) {
    return (
      <>
        <Nadpis oci="Marketing">Menu</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Menu zatím není v databázi">
            Migrace <code>20260914060000_marketing_menu.sql</code> ještě neproběhla.
            Nasazuje je Šéfík z větve <code>main</code>.
          </Sdeleni>
        </div>
      </>
    )
  }

  const menu = await seznam<{
    id: string; druh: string; nazev: string; plati_od: string | null
    stav: string; zdroj: string; vytvoreno_kdy: string
  }>('menu', Promise.resolve(dotaz))

  const pobocky = await seznam<{ id: string; name: string }>(
    'pobočky',
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).order('name'),
  )

  return (
    <>
      <Nadpis oci="Marketing" popis={`${menu.length} menu`}>Menu</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        {smiMenit ? (
          <form action={zalozitMenuZTextu} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Vložit menu textem</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Zkopírujte menu, jak ho máte — z e-mailu, z Wordu, z tabule.
                Přečte se z toho, co jde: název, cena, alergeny a dny.
                {' '}<strong>Co se nepřečte, zůstane prázdné a označí se ke kontrole</strong> —
                cena se nikdy nedomýšlí.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 200px' }}>
                <span style={popisek}>Provozovna</span>
                <select name="pobocka" style={pole} defaultValue={pobocky[0]?.id ?? ''}>
                  {pobocky.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ flex: '1 1 160px' }}>
                <span style={popisek}>Druh</span>
                <select name="druh" style={pole} defaultValue="denni">
                  {DRUHY.map((d) => (
                    <option key={d.klic} value={d.klic}>{d.nazev}</option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span style={popisek}>Text menu</span>
              <textarea
                name="text"
                rows={8}
                style={{ ...pole, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
                placeholder={'Denní menu 12. 9. 2026\nPolévka\nHovězí vývar 45 Kč\nHlavní jídla\nSvíčková na smetaně 189 Kč'}
              />
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Načíst menu</button>
            </div>
          </form>
        ) : null}

        {menu.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádné menu. {smiMenit ? 'Vložte ho výš textem.' : null}
            </p>
          </div>
        ) : (
          <section style={{ ...karta, display: 'grid', gap: '8px' }}>
            <h2 style={{ margin: 0, fontSize: '16px' }}>Uložená menu</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
              {menu.map((m) => (
                <li key={m.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
                  <Link href={`/${rozsah}/marketing/menu/${m.id}`} style={{ fontSize: '14.5px' }}>
                    {m.nazev}
                  </Link>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {popisStavu(m.stav)} · {DRUHY.find((d) => d.klic === m.druh)?.nazev ?? m.druh}
                    {m.plati_od ? ` · od ${m.plati_od}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
