import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { opravitPolozkuMenu, potvrditMenu } from '../../akce'

export const dynamic = 'force-dynamic'

/**
 * Menu — kontrola a potvrzení.
 *
 * Zadání: master prompt, oddíl 10: „Před uložením musí uživatel
 * rozpoznaná data potvrdit."
 *
 * ---------------------------------------------------------------------
 * OBRAZOVKA NEROZHODUJE, JESTLI SE SMÍ POTVRDIT
 *
 * Rozhoduje `public.marketing_menu_potvrdit` — odmítne to, dokud zbývá
 * položka ke kontrole. Kdyby to hlídalo jen tlačítko, stačilo by jedno
 * volání mimo obrazovku.
 *
 * Tady se jen NEUKAZUJE tlačítko, které by stejně skončilo chybou.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 8px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const KATEGORIE: Record<string, string> = {
  polevka: 'Polévka',
  predkrm: 'Předkrm',
  hlavni: 'Hlavní jídlo',
  dezert: 'Dezert',
  napoj: 'Nápoj',
  ostatni: 'Ostatní',
}

/** Haléře na korunu do políčka. Prázdná cena zůstane prázdná. */
function doPolicka(haleru: number | null): string {
  return haleru === null ? '' : (haleru / 100).toFixed(haleru % 100 === 0 ? 0 : 2)
}

export default async function DetailMenu({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; menu: string }>
  searchParams: Promise<{ nacteno?: string; ulozeno?: string; potvrzeno?: string; chyba?: string }>
}) {
  const { rozsah, menu: menuId } = await params
  const { nacteno, ulozeno, potvrzeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Menu vidí ten, kdo má právo „Vidět marketing“.</Sdeleni>
  }

  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  const m = await jeden<{
    id: string; nazev: string; druh: string; stav: string; zdroj: string
    plati_od: string | null; potvrzeno_kdy: string | null
  }>(
    'menu',
    supabase.from('marketing_menu')
      .select('id, nazev, druh, stav, zdroj, plati_od, potvrzeno_kdy')
      .eq('id', menuId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  )
  if (!m) notFound()

  const polozky = await seznam<{
    id: string; kategorie: string; nazev: string; popis: string
    cena_haleru: number | null; alergeny: string[]
    vyzaduje_kontrolu: boolean; duvod_kontroly: string | null; poradi: number
  }>(
    'položky menu',
    supabase.from('marketing_menu_polozky')
      .select('id, kategorie, nazev, popis, cena_haleru, alergeny, vyzaduje_kontrolu, duvod_kontroly, poradi')
      .eq('menu_id', menuId)
      .order('poradi'),
  )

  const keKontrole = polozky.filter((p) => p.vyzaduje_kontrolu)
  const potvrzene = m.stav === 'potvrzeno'

  return (
    <>
      <Nadpis oci="Marketing" popis={potvrzene ? 'Potvrzeno' : 'Koncept'}>{m.nazev}</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '820px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {nacteno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Načteno {nacteno} položek. Projděte je — co se nepřečetlo, je níž označené.
          </p>
        ) : null}
        {ulozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p> : null}
        {potvrzeno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Menu je potvrzené — dá se z něj udělat příspěvek.
          </p>
        ) : null}

        {/*
          KOLIK ZBÝVÁ KE KONTROLE.

          Je to první věc na obrazovce schválně: kdo menu nahrál, chce
          vědět, co po něm systém ještě chce, ne prohledávat seznam.
        */}
        {keKontrole.length > 0 ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>
              {keKontrole.length === 1 ? 'Jedna položka čeká na kontrolu' : `${keKontrole.length} položek čeká na kontrolu`}
            </strong>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              Import nic nedomýšlí. Co se nepodařilo přečíst, necháváme prázdné —
              doplňte to a teprve pak jde menu potvrdit.
            </p>
          </div>
        ) : null}

        <section style={{ ...karta, display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Položky</h2>

          {polozky.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              V menu nejsou žádné položky.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '10px' }}>
              {polozky.map((p) => (
                <li
                  key={p.id}
                  style={{
                    borderTop: '1px solid var(--line)',
                    paddingTop: '10px',
                    background: p.vyzaduje_kontrolu ? 'color-mix(in srgb, var(--mosaz) 8%, transparent)' : undefined,
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {KATEGORIE[p.kategorie] ?? p.kategorie}
                    {p.alergeny.length > 0 ? ` · alergeny ${p.alergeny.join(', ')}` : ''}
                  </div>

                  {smiMenit && !potvrzene ? (
                    <form
                      action={opravitPolozkuMenu}
                      style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}
                    >
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="menu" value={m.id} />
                      <input type="hidden" name="polozka" value={p.id} />
                      <input name="nazev" defaultValue={p.nazev} style={{ ...pole, flex: '1 1 240px' }} />
                      <input
                        name="cena"
                        defaultValue={doPolicka(p.cena_haleru)}
                        placeholder="Kč"
                        inputMode="decimal"
                        style={{ ...pole, width: '90px' }}
                      />
                      <button type="submit" className="ft-tl ft-tl-male">Uložit</button>
                    </form>
                  ) : (
                    <div style={{ fontSize: '14px', marginTop: '2px' }}>
                      {p.nazev}
                      {p.cena_haleru !== null ? ` — ${doPolicka(p.cena_haleru)} Kč` : ''}
                    </div>
                  )}

                  {p.vyzaduje_kontrolu ? (
                    <div style={{ fontSize: '12px', color: 'var(--mosaz)', marginTop: '2px' }}>
                      {p.duvod_kontroly ?? 'Vyžaduje kontrolu'}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {smiMenit && !potvrzene ? (
          <form action={potvrditMenu} style={{ ...karta, display: 'grid', gap: '8px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="menu" value={m.id} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Potvrdit menu</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {keKontrole.length > 0
                  ? 'Nejdřív projděte položky výš. Dokud některá čeká na kontrolu, potvrdit to nejde.'
                  : 'Potvrzené menu se dá použít jako podklad pro příspěvek.'}
              </p>
            </div>
            {keKontrole.length === 0 ? (
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit</button>
              </div>
            ) : null}
          </form>
        ) : null}

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing/menu`}>Zpět na menu</Link>
        </p>
      </div>
    </>
  )
}
