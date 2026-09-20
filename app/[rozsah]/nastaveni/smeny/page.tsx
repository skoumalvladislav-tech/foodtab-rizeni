import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { ulozitNastaveniSmen } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Směny.
 *
 * Nastavení celého modulu Směny na jednom místě (Šéfík 20. 9. 2026: „udělal
 * bych možnost nastavení celého modulu směny“). Tady je to, co se týká
 * ZADÁVÁNÍ směn; ostatní věci kolem směn mají vlastní obrazovky a odsud se na
 * ně jen odkazuje, ať se nehledají po celém Nastavení.
 *
 * ČTE SE TOLERANTNĚ. Sloupec `smeny_zarazeni_ve_formulari` přibývá migrací
 * 20260920130000, která se nasazuje ručně; kód se nasazuje sám. Bez migrace
 * obrazovka řekne, že čeká na nasazení, a nespadne.
 */

const ramecek = {
  margin: 0,
  padding: '14px 16px',
  background: 'var(--sunken)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md, 10px)',
  fontSize: '14px',
  lineHeight: 1.5,
} as const

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '16px 18px',
  display: 'grid',
  gap: '12px',
  maxWidth: '760px',
} as const

const vysvetlivka = { margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 } as const

/** Ostatní nastavení, která se týkají směn — odkazy, ne kopie. */
const SOUVISEJICI: { segment: string; nazev: string; popis: string }[] = [
  {
    segment: 'nastaveni/sablony',
    nazev: 'Šablony směn',
    popis: 'Pojmenované směny s časy (D, N, R), které se nabízejí ve formuláři.',
  },
  {
    segment: 'nastaveni/useky',
    nazev: 'Úseky',
    popis: 'Do jakého týmu člověk patří — Kuchyně, Bar, Vedení. Řadí lidi v rozpisu.',
  },
  {
    segment: 'nastaveni/role',
    nazev: 'Zařazení a oprávnění',
    popis: 'Čím člověk je (Číšník, Kuchař) a co smí. Zařazení se ve směnách bere od zaměstnance.',
  },
  {
    segment: 'nastaveni/firma',
    nazev: 'Firma',
    popis: 'Důležitá změna směny (do kolika hodin před začátkem je změna důležitá) a paušální přestávky.',
  },
  {
    segment: 'nastaveni/pobocky',
    nazev: 'Pobočky',
    popis: 'Časové pásmo a hodina, kdy začíná provozní den — podle nich se počítá „dnes“ v rozpisu.',
  },
]

export default async function NastaveniSmeny({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>
}) {
  const { rozsah } = await params
  const { chyba, ulozeno } = await searchParams

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
        Nastavení směn mění jen ten, kdo má právo <code>settings.manage</code>.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('tenant_settings')
    .select('smeny_zarazeni_ve_formulari')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // Chyba čtení = sloupec ještě není (migrace nenasazená). Řádek v nastavení firma nemusí mít — pak platí výchozí „nabízet“.
  const migraceChybi = Boolean(error)
  const zarazeni =
    (data as { smeny_zarazeni_ve_formulari?: boolean } | null)?.smeny_zarazeni_ve_formulari ?? true

  return (
    <>
      <Nadpis oci="Nastavení" popis="Jak se v Rozpisu směn zadává a co se při tom nabízí.">
        Směny
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '20px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {ulozeno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--good)' }}>Nastavení je uložené.</p>
        ) : null}

        {migraceChybi ? (
          <p style={ramecek}>
            <strong>Tahle volba čeká na nasazení databáze.</strong> Přibude migrací{' '}
            <code>20260920130000_nastaveni_smeny</code>. Do té doby se výběr zařazení ve formuláři
            nové směny nabízí jako dřív.
          </p>
        ) : (
          <form action={ulozitNastaveniSmen} style={karta}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '16px' }}>Přidání směny</h2>

            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                name="zarazeni"
                defaultChecked={zarazeni}
                style={{ marginTop: '3px', width: '18px', height: '18px' }}
              />
              <span style={{ display: 'grid', gap: '4px' }}>
                <strong style={{ fontSize: '14.5px' }}>
                  Nabízet výběr úseku / zařazení při přidávání směny
                </strong>
                <span style={vysvetlivka}>
                  Zaměstnanci jsou zařazeni od začátku, takže výběr je většinou zbytečné klikání
                  navíc. Když ho vypnete, pole se schová a směna si vezme zařazení zaměstnance;
                  kdyby se něco měnilo, napište to do poznámky. U neobsazené směny (bez člověka)
                  se výběr nabízí vždycky — pozice tam říká, koho je třeba.
                </span>
              </span>
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Uložit
              </button>
            </div>
          </form>
        )}

        <section style={{ display: 'grid', gap: '10px', maxWidth: '760px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Další nastavení směn</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
            {SOUVISEJICI.map((s) => (
              <li
                key={s.segment}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'grid',
                  gap: '2px',
                }}
              >
                <Link href={`/${rozsah}/${s.segment}`} style={{ fontWeight: 600 }}>
                  {s.nazev}
                </Link>
                <span style={vysvetlivka}>{s.popis}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
