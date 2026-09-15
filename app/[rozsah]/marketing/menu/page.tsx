import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { sestavRadky, type MenuRadek, type PolozkaPocet } from '@/lib/marketing-menu-tabulka'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Menu — přehled v tabulce.
 *
 * Zadání krok 2 (`docs/hlaseni/zadani-pro-ai-marketing-faktury.md`):
 * seznam v tabulce (druh, název, platnost, položek + „ke kontrole",
 * stav, zdroj) a samotné zakládání se stěhuje na `/menu/nove`.
 * Vzor: `marketing-ai/app/[provozovna]/menu/page.tsx` (git show 6cb7d72).
 *
 * Čtyři cesty založení (ruční, text, fotka, PDF) žijí na jedné
 * obrazovce dál — jen ne tady. Počty položek se počítají v
 * `lib/marketing-menu-tabulka.ts`, čistou funkcí, kterou testuje
 * `scripts/marketing-menu-tabulka.test.mjs` beze seed dat v databázi.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

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
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
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
    .select('id, druh, nazev, plati_od, plati_do, stav, zdroj, vytvoreno_kdy')
    .eq('tenant_id', tenantId)
    .neq('stav', 'archivovano')
    .order('plati_od', { ascending: false, nullsFirst: false })
    .order('vytvoreno_kdy', { ascending: false })
    .limit(100)

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

  const radkyDb = await seznam<{
    id: string; druh: string; nazev: string; plati_od: string | null; plati_do: string | null
    stav: string; zdroj: string; vytvoreno_kdy: string
  }>('menu', Promise.resolve(dotaz))

  const menu: MenuRadek[] = radkyDb.map((m) => ({
    id: m.id,
    druh: m.druh,
    nazev: m.nazev,
    platiOd: m.plati_od,
    platiDo: m.plati_do,
    stav: m.stav,
    zdroj: m.zdroj,
    vytvorenoKdy: m.vytvoreno_kdy,
  }))

  const menuIds = menu.map((m) => m.id)
  const polozky = menuIds.length === 0
    ? []
    : await seznam<{ menu_id: string; vyzaduje_kontrolu: boolean }>(
        'položky menu',
        supabase.from('marketing_menu_polozky')
          .select('menu_id, vyzaduje_kontrolu')
          .eq('tenant_id', tenantId)
          .in('menu_id', menuIds),
      )

  const radky = sestavRadky(
    menu,
    polozky.map((p): PolozkaPocet => ({ menuId: p.menu_id, vyzadujeKontrolu: p.vyzaduje_kontrolu })),
  )

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={`${radky.length} menu`}
        vpravo={smiMenit ? (
          <Link href={`/${rozsah}/marketing/menu/nove`} className="ft-tl ft-tl-hlavni">
            + Nové menu
          </Link>
        ) : undefined}
      >
        Menu
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        {radky.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádné menu.{' '}
              {smiMenit ? (
                <Link href={`/${rozsah}/marketing/menu/nove`}>Založte ho ručně, textem, fotkou nebo PDF.</Link>
              ) : null}
            </p>
          </div>
        ) : (
          <div style={{ ...karta, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Druh</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Název</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Platnost</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Položek</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Stav</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Zdroj</th>
                </tr>
              </thead>
              <tbody>
                {radky.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px' }}>{r.druh}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Link href={`/${rozsah}/marketing/menu/${r.id}`}>{r.nazev}</Link>
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.platnost}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {r.pocetPolozek}
                      {r.keKontrole > 0 ? (
                        <span
                          style={{
                            marginLeft: '6px',
                            fontSize: '11px',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--mosaz)',
                            color: 'var(--mosaz)',
                          }}
                        >
                          {r.keKontrole} ke kontrole
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          padding: '1px 8px',
                          borderRadius: 'var(--radius-full)',
                          background: r.stav === 'Potvrzeno' ? 'var(--dobre-bg)' : 'var(--sunken)',
                          color: r.stav === 'Potvrzeno' ? 'var(--dobre)' : 'var(--muted)',
                        }}
                      >
                        {r.stav}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{r.zdroj}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
