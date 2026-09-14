import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { nacistDoporuceneSablony, prepnoutSablonu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Knihovna šablon.
 *
 * Zadání: master prompt, oddíl 9.
 *
 * ---------------------------------------------------------------------
 * ŠABLONA NENÍ OBRÁZEK
 *
 * Je to popis: jaké údaje potřebuje, jak se skládá, které výstupy umí
 * a co se stane s dlouhým názvem jídla. Vykreslení z ní dělá aplikace,
 * takže změna barvy značky se projeví ve všech naráz a nikdo
 * nepřekresluje grafiku.
 *
 * ---------------------------------------------------------------------
 * PRÁZDNÁ KNIHOVNA NENÍ CHYBA
 *
 * Firma, která si doporučené šablony nenačte, žádné nemá — a to je
 * v pořádku. Obrazovka to proto říká větou a nabídne tlačítko, místo
 * aby ukazovala prázdnou tabulku, u které si člověk myslí, že se něco
 * pokazilo.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const KATEGORIE: { klic: string; nazev: string; popis: string }[] = [
  { klic: 'menu', nazev: 'Menu', popis: 'Denní, týdenní a víkendová nabídka, jídlo dne, nápoje.' },
  { klic: 'akce', nazev: 'Akce a kampaně', popis: 'Burger víkend, degustace, svátky, sportovní přenosy, nábor.' },
  { klic: 'prubezne', nazev: 'Průběžný obsah', popis: 'Zákulisí, lidé, atmosféra, reference, rezervace.' },
]

/**
 * Do které kategorie šablona patří.
 *
 * Odvozuje se z pořadí, které jí dal katalog (menu 0+, akce 1000+,
 * průběžné 2000+). Zvláštní sloupec na to v databázi není schválně —
 * byl by to druhý údaj o téže věci, který se dřív nebo později rozejde
 * s pořadím.
 */
function kategorie(poradi: number): string {
  return poradi >= 2000 ? 'prubezne' : poradi >= 1000 ? 'akce' : 'menu'
}

export default async function Sablony({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ nacteno?: string; nic?: string; ulozeno?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { nacteno, nic, ulozeno, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Knihovnu šablon vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  // Načítat a vypínat smí jen `marketing.manage`. Kdo má jen čtení,
  // uvidí knihovnu bez ovládání — a databáze mu to nedovolí ani tak.
  const smiMenit = (await zkusPristup(tenantId, 'marketing.manage', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  const sablony = await seznam<{
    id: string; klic: string; nazev: string; popis: string
    pilir: string; poradi: number; aktivni: boolean; formaty: string[]
  }>(
    'šablony',
    supabase.from('marketing_sablony')
      .select('id, klic, nazev, popis, pilir, poradi, aktivni, formaty')
      .eq('tenant_id', tenantId)
      .order('poradi'),
  )

  return (
    <>
      <Nadpis oci="Marketing" popis={`${sablony.length} šablon`}>Šablony</Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '900px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {nacteno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Načteno {nacteno} šablon. Můžete je upravit nebo vypnout — od teď jsou vaše.
          </p>
        ) : null}
        {nic ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Všechny doporučené šablony už máte. Nic se nepřepsalo.
          </p>
        ) : null}
        {ulozeno ? <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>Uloženo.</p> : null}

        {sablony.length === 0 ? (
          <div style={{ ...karta, display: 'grid', gap: '12px' }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Knihovna je zatím prázdná</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Můžeme vám načíst doporučenou sadu — denní a víkendové menu, jídlo dne,
                gastroakce od burger víkendu po svatomartinskou husu a průběžný obsah.
                Jsou to pak vaše šablony: přejmenujete je, upravíte nebo vypnete.
              </p>
            </div>
            {smiMenit ? (
              <form action={nacistDoporuceneSablony}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <button type="submit" className="ft-tl ft-tl-hlavni">Načíst doporučené šablony</button>
              </form>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Načíst je může jen ten, kdo smí marketing spravovat.
              </p>
            )}
          </div>
        ) : null}

        {KATEGORIE.map((k) => {
          const vKategorii = sablony.filter((s) => kategorie(s.poradi) === k.klic)
          if (vKategorii.length === 0) return null

          return (
            <section key={k.klic} style={{ ...karta, display: 'grid', gap: '10px' }}>
              <div>
                <h2 style={{ margin: '0 0 2px', fontSize: '16px' }}>{k.nazev}</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{k.popis}</p>
              </div>

              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
                {vKategorii.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderTop: '1px solid var(--line)',
                      opacity: s.aktivni ? 1 : 0.55,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px' }}>
                        {s.nazev}
                        {s.aktivni ? null : (
                          <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--muted)' }}>vypnutá</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{s.popis}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                        {(s.formaty ?? []).length} výstupních formátů
                      </div>
                    </div>

                    {smiMenit ? (
                      <form action={prepnoutSablonu}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="sablona" value={s.id} />
                        <input type="hidden" name="zapnout" value={s.aktivni ? '0' : '1'} />
                        <button type="submit" className="ft-tl ft-tl-male" style={{ whiteSpace: 'nowrap' }}>
                          {s.aktivni ? 'Vypnout' : 'Zapnout'}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        {sablony.length > 0 && smiMenit ? (
          <form action={nacistDoporuceneSablony}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <button type="submit" className="ft-tl ft-tl-male">Doplnit chybějící doporučené</button>
          </form>
        ) : null}
      </div>
    </>
  )
}
