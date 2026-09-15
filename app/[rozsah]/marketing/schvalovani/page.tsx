import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { textProKanal } from '@/lib/marketing'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { schvalitVice } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Fronta ke schválení.
 *
 * Zadání: master prompt, oddíl 14 a obrazovka 10 z oddílu 22.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NESTAČILO ŘEŠIT V DETAILU PŘÍSPĚVKU
 *
 * Schvalovat šlo i dřív — ale jen tak, že si člověk otevřel příspěvek.
 * Kdo má odklepnout pět věcí, musel je nejdřív najít. Tady je na jednom
 * místě všechno, co čeká, a dá se to odklepnout naráz.
 *
 * ---------------------------------------------------------------------
 * SCHVALUJE SE ZNĚNÍ, NE NÁZEV
 *
 * U každé žádosti je vidět text, který půjde ven, a kolik má fotek.
 * Bez toho by se schvalovalo jméno v seznamu — a přesně to má celý
 * modul zakázané: schválení se váže na otisk konkrétní verze.
 *
 * ---------------------------------------------------------------------
 * VLASTNÍ ŽÁDOST SE NENABÍZÍ
 *
 * Pravidlo čtyř očí hlídá spoušť v databázi
 * (`app.marketing_strez_rozhodnuti`). Obrazovka ho jen respektuje:
 * u vlastní žádosti nekreslí zaškrtávátko a napíše proč. Kdyby se
 * spolehla jen na sebe, stačilo by poslat požadavek mimo ni — proto to
 * rozhoduje databáze a tohle je jen slušnost k uživateli.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

/*
  PŘIPOJENÉ TABULKY JSOU POLE, NE OBJEKT.

  PostgREST vrací vnořený vztah vždycky jako seznam, i když je to vazba
  jedna k jedné. Kdyby se to napsalo jako objekt, překlad projde
  (`any`), ale `p?.nazev` by v běhu bylo `undefined` a v seznamu by
  stálo „Příspěvek" u všeho.
*/
type Zadost = {
  id: string
  prispevek_id: string
  verze_id: string
  zadano_kdy: string
  shrnuti: string
  zadal: string | null
  marketing_prispevky: { nazev: string; branch_id: string; kanaly: string[] }[]
  marketing_verze: { cislo: number; texty: Record<string, unknown>; media_ids: string[] }[]
}

/*
  ČAS SE FORMÁTUJE PŘES `lib/cas.ts`, NE PŘES `getHours()`.

  Pravidlo 11 z CLAUDE.md. Server běží v UTC, takže `getHours()` by
  u žádosti podané ve 21:30 napsalo 19:30 — a v zimě jinak než v létě,
  což se nedá vysvětlit jako „o dvě hodiny vedle". Pásmo dodá pobočka,
  ke které příspěvek patří; když ho nemá, firma.
*/
function kdy(iso: string, zona: string): string {
  return datumACasVPasmu(iso, zona)
}

export default async function Schvalovani({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ schvaleno?: string; neproslo?: string; duvod?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { schvaleno, neproslo, duvod, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Frontu ke schválení vidí ten, kdo má právo „Vidět marketing“.
      </Sdeleni>
    )
  }

  // Rozhodovat smí jen `marketing.publish` — totéž právo, které dovoluje
  // publikovat. Kdo má jen `manage`, uvidí frontu bez tlačítek.
  const smiRozhodovat = (await zkusPristup(tenantId, 'marketing.publish', rozsah)).stav === 'ok'
  const supabase = await getServerSupabase()

  const zadosti = await seznam<Zadost>(
    'žádosti o schválení',
    supabase.from('marketing_schvaleni')
      .select(`
        id, prispevek_id, verze_id, zadano_kdy, shrnuti, zadal,
        marketing_prispevky ( nazev, branch_id, kanaly ),
        marketing_verze ( cislo, texty, media_ids )
      `)
      .eq('tenant_id', tenantId)
      .eq('stav', 'ceka')
      .order('zadano_kdy'),
  )

  /*
    Kdo jsem v téhle firmě. Podle toho se pozná vlastní žádost —
    `zadal` je `employees.id`, ne `user_id`.

    PTÁ SE NA `user_id`, JINAK TO VRACÍ CIZÍHO ČLOVĚKA. Politika
    `employees_select` pouští ke všem zaměstnancům každého, kdo má
    `shifts.read` nebo `people.manage`. Dotaz bez `user_id` by tedy
    vrátil prvního zaměstnance v seznamu — a obrazovka by podle něj
    rozhodovala, co je „vaše vlastní žádost". Někomu by schovala
    zaškrtávátko u cizí žádosti a u své vlastní by mu ho nabídla.
    (Ven by to nepustila spoušť `app.marketing_strez_rozhodnuti`,
    ale byla by to hláška z databáze místo slušného vysvětlení.)
  */
  const user = await getUser()
  const ja = user
    ? await seznam<{ id: string }>(
      'můj záznam zaměstnance',
      supabase.from('employees').select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .is('deleted_at', null),
    )
    : []
  const mojeId = ja[0]?.id ?? null

  const pobocky = await seznam<{ id: string; name: string; timezone: string | null }>(
    'pobočky',
    supabase.from('branches').select('id, name, timezone').eq('tenant_id', tenantId),
  )
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.name]))

  /*
    Pásmo pobočky, jinak firmy, jinak Praha — pořadí z pravidla 11.
    Firma se čte zvlášť, protože `branches.timezone` smí být prázdné
    a tehdy platí to firemní.
  */
  const firma = await seznam<{ timezone: string | null }>(
    'pásmo firmy',
    supabase.from('tenants').select('timezone').eq('id', tenantId),
  )
  const zonaFirmy = firma[0]?.timezone ?? ZONA_VYCHOZI
  const zonaPobocky = new Map(pobocky.map((p) => [p.id, p.timezone ?? zonaFirmy]))
  const zona = (branchId: string | undefined) =>
    (branchId ? zonaPobocky.get(branchId) : null) ?? zonaFirmy

  const kRozhodnuti = zadosti.filter((z) => z.zadal === null || z.zadal !== mojeId)
  const moje = zadosti.filter((z) => z.zadal !== null && z.zadal === mojeId)

  return (
    <>
      <Nadpis
        oci="Marketing"
        popis={zadosti.length === 0 ? 'Nic nečeká' : `${zadosti.length} čeká`}
      >
        Ke schválení
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '860px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {schvaleno ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--mosaz)' }}>
            Schváleno {schvaleno}.
            {neproslo ? ` ${neproslo} neprošlo — ${duvod ?? 'bez udaného důvodu'}` : ''}
          </p>
        ) : null}

        {zadosti.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              Nic nečeká na schválení. Až někdo požádá o odklepnutí příspěvku, objeví se tady.
            </p>
          </div>
        ) : null}

        {kRozhodnuti.length > 0 ? (
          <form action={schvalitVice} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Čeká na vás</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Schvaluje se přesné znění. Když se text potom změní, schválení zanikne
                a bude se odklepávat znovu.
              </p>
            </div>

            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '12px' }}>
              {kRozhodnuti.map((z) => {
                const p = z.marketing_prispevky[0]
                const v = z.marketing_verze[0]
                const kanal = p?.kanaly?.[0] ?? 'instagram'
                const text = v ? textProKanal(v.texty, kanal) : ''
                const fotek = v?.media_ids?.length ?? 0

                return (
                  <li key={z.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      {smiRozhodovat ? (
                        <input type="checkbox" name="zadost" value={z.id} style={{ marginTop: '4px' }} />
                      ) : null}

                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '14.5px' }}>
                          <Link href={`/${rozsah}/marketing/${z.prispevek_id}`}>
                            {p?.nazev ?? 'Příspěvek'}
                          </Link>
                        </span>
                        <span style={{ display: 'block', fontSize: '12px', color: 'var(--muted)' }}>
                          {nazevPobocky.get(p?.branch_id ?? '') ?? 'Provozovna'}
                          {' · '}verze {v?.cislo ?? '?'}
                          {' · '}{fotek === 0 ? 'bez fotky' : fotek === 1 ? '1 fotka' : `${fotek} fotky`}
                          {' · '}{kdy(z.zadano_kdy, zona(p?.branch_id))}
                        </span>

                        {/*
                          Text se ukazuje ořezaný, ale ukazuje se. Schválení
                          bez toho, co se schvaluje, by bylo jen klikání.
                        */}
                        {text ? (
                          <span
                            style={{
                              display: 'block',
                              marginTop: '6px',
                              fontSize: '13px',
                              whiteSpace: 'pre-wrap',
                              color: 'var(--text)',
                            }}
                          >
                            {text.length > 320 ? `${text.slice(0, 320)}…` : text}
                          </span>
                        ) : (
                          <span style={{ display: 'block', marginTop: '6px', fontSize: '13px', color: 'var(--mosaz)' }}>
                            Verze nemá text pro {kanal}. Otevřete příspěvek a doplňte ho.
                          </span>
                        )}

                        {z.shrnuti ? (
                          <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: 'var(--muted)' }}>
                            Poznámka k žádosti: {z.shrnuti}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>

            {smiRozhodovat ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="submit" className="ft-tl ft-tl-hlavni">Schválit vybrané</button>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Vrátit s připomínkou jde v detailu příspěvku — je k tomu potřeba napsat, co změnit.
                </span>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Rozhodovat smí ten, kdo má právo publikovat.
              </p>
            )}
          </form>
        ) : null}

        {moje.length > 0 ? (
          <section style={{ ...karta, display: 'grid', gap: '8px' }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '16px' }}>Vaše vlastní žádosti</h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                O tyhle nerozhodujete — musí je odklepnout někdo jiný. Je to pojistka
                proti tomu, aby šlo ven něco, co nikdo druhý neviděl.
              </p>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '6px' }}>
              {moje.map((z) => (
                <li key={z.id} style={{ borderTop: '1px solid var(--line)', paddingTop: '6px', fontSize: '14px' }}>
                  <Link href={`/${rozsah}/marketing/${z.prispevek_id}`}>
                    {z.marketing_prispevky[0]?.nazev ?? 'Příspěvek'}
                  </Link>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}> · čeká od {kdy(z.zadano_kdy, zona(z.marketing_prispevky[0]?.branch_id))}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}
