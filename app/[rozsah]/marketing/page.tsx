import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { STAVY_CHYBOVE, popisStavu } from '@/lib/marketing-text'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Marketing — rozcestí modulu.
 *
 * Zadání: docs/marketing-je-modul.md.
 *
 * Ukazuje, co čeká na člověka: co je ke schválení, co je naplánované
 * a co selhalo. Nic se odsud nezveřejňuje — publikuje se až ze
 * schválení, a to je jiná obrazovka.
 *
 * ---------------------------------------------------------------------
 * PROČ TU ZATÍM NENÍ TLAČÍTKO „VYTVOŘIT PŘÍSPĚVEK"
 *
 * Protože navrhování ještě není hotové. Kdyby tu tlačítko bylo a vedlo
 * na prázdno, vypadalo by to jako porucha. Až bude, přibude sem —
 * a do té doby to obrazovka říká nahlas, místo aby to schovala za
 * prázdný seznam.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

type Prispevek = {
  id: string
  nazev: string
  stav: string
  planovano_na: string | null
  zmeneno_kdy: string
}

export default async function Marketing({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Marketing není zapnutý">
        Modul si firma zapíná zvlášť. Pokud ho chcete používat, řekněte
        si o něj správci firmy — a pokud ho firma má, chybí vám k němu
        oprávnění.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  /*
    Migrace se nasazují zvlášť od aplikace. Dokud neproběhnou, tabulky
    tu nejsou — a obrazovka to má říct, ne spadnout na hlášce, ze které
    to nikdo nepozná.
  */
  const dotaz = await supabase
    .from('marketing_prispevky')
    .select('id, nazev, stav, planovano_na, zmeneno_kdy')
    .order('zmeneno_kdy', { ascending: false })
    .limit(20)

  if (tabulkaNeexistuje(dotaz.error)) {
    return (
      <>
        <Nadpis oci="Marketing" popis="Dílna na příspěvky ze schváleného jídelníčku.">
          Marketing
        </Nadpis>
        <div style={{ padding: '16px', paddingBottom: '32px' }}>
          <Sdeleni nadpis="Čeká se na nasazení databáze">
            Modul je v aplikaci, ale jeho tabulky zatím nejsou nasazené.
            Až proběhnou migrace, obrazovka se rozjede sama.
          </Sdeleni>
        </div>
      </>
    )
  }

  const prispevky = (await seznam<Prispevek>('marketingové příspěvky', Promise.resolve(dotaz))) ?? []

  const znacka = await supabase
    .from('marketing_nastaveni')
    .select('id, podpis, branch_id')
    .limit(1)
  const maZnacku = !znacka.error && (znacka.data?.length ?? 0) > 0

  const keSchvaleni = prispevky.filter((p) => p.stav === 'ceka_na_schvaleni')
  const naplanovane = prispevky.filter((p) => p.stav === 'naplanovano')
  const chybove = prispevky.filter((p) => STAVY_CHYBOVE.includes(p.stav))

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis="Dílna na příspěvky ze schváleného jídelníčku. Nic se nezveřejní bez schválení přesné verze."
      >
        Marketing
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '860px', display: 'grid', gap: '16px' }}>
        {!maZnacku ? (
          <div style={{ ...karta, borderColor: 'var(--mosaz)' }}>
            <strong style={{ fontSize: '15px' }}>Nejdřív značka</strong>
            <p style={{ margin: '8px 0 12px', fontSize: '14px', color: 'var(--muted)' }}>
              Barvy, písmo, podpis a tón hlasu. Bez nich by se návrhy
              musely domýšlet — a to se u marketingu dělat nemá.
            </p>
            <Link href={`/${rozsah}/marketing/znacka`} className="ft-tl ft-tl-hlavni ft-tl-male">
              Nastavit značku
            </Link>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Ke schválení</p>
            <p style={{ margin: '4px 0 0', fontSize: '26px' }}>{keSchvaleni.length}</p>
          </div>
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Naplánováno</p>
            <p style={{ margin: '4px 0 0', fontSize: '26px' }}>{naplanovane.length}</p>
          </div>
          <div style={{ ...karta, borderColor: chybove.length ? 'var(--mosaz)' : 'var(--line)' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>Něco selhalo</p>
            <p style={{ margin: '4px 0 0', fontSize: '26px' }}>{chybove.length}</p>
          </div>
        </div>

        <div style={karta}>
          <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>Poslední příspěvky</h2>

          {prispevky.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Zatím žádný. Navrhování příspěvků se dodělává — až bude
              hotové, přibude sem tlačítko, kterým se z potvrzeného
              jídelníčku udělá návrh. Do té doby jde nastavit značku,
              aby na to bylo připraveno.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }}>
              {prispevky.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                    paddingBottom: '10px',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  <span style={{ fontSize: '14.5px' }}>{p.nazev}</span>
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    {popisStavu(p.stav)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
