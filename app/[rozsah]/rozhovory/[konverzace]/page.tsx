import { redirect } from 'next/navigation'
import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { oznacitPrecteno, poslatZpravu, stornovatZpravu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Jeden rozhovor.
 *
 * OBSAH SE TU NESCHOVÁVÁ, ANI MIMO SMĚNU. Pravidlo o doručení chrání
 * před vyrušením, ne před informací — kdo si sám otevře aplikaci, čte.
 * Co se mění, je jen to, jestli se o zprávě smělo dát vědět; proto je
 * u zadržených zpráv štítek, ne zámek.
 *
 * Že sem člověk vůbec smí, nerozhoduje tahle stránka. Rozhoduje RLS na
 * `konverzace_zpravy`: kdo není účastník, dostane prázdno — a dostal by
 * ho i při přímém volání rozhraní, ne jen tady. Prázdný seznam proto
 * NEZNAMENÁ „rozhovor je prázdný“, ale „není váš“, a tak se to i píše.
 */

const ZONA = ZONA_VYCHOZI
const POCET = 200

type Zprava = {
  id: string
  autor: string | null
  text: string
  nalehava: boolean
  vytvoreno_kdy: string
  stornovano_kdy: string | null
}

export default async function Rozhovor({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; konverzace: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah, konverzace } = await params
  const { chyba } = await searchParams

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    )
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená.
      </Sdeleni>
    )
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase()

  const { data: hlavicka, error: chybaHlavicka } = await supabase
    .from('konverzace')
    .select('id, druh, branch_id, nazev, adresat, uzavreno_kdy')
    .eq('id', konverzace)
    .maybeSingle()

  if (tabulkaNeexistuje(chybaHlavicka)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Rozhovor.">
          Rozhovor
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Rozhovory přibudou migrací{' '}
            <code>20260903100000_komunikace_zaklad</code> a dvěma dalšími.
          </p>
        </div>
      </>
    )
  }
  if (chybaHlavicka) throw new DotazSelhal('hlavička rozhovoru', chybaHlavicka)

  /*
    Prázdno tady znamená „nejste účastník“, ne „neexistuje“.

    Rozlišovat ty dva stavy by byl únik sám o sobě: kdo zkouší cizí id,
    by se z různých hlášek dozvěděl, které konverzace ve firmě existují.
    Proto je odpověď stejná pro obojí.
  */
  if (!hlavicka) {
    return (
      <Sdeleni nadpis="Tenhle rozhovor vám nepatří">
        Otevřít jde jen rozhovor, kterého jste účastníkem. Ani vedení
        nečte cizí vlákna — je to tak schválně.
      </Sdeleni>
    )
  }

  const { data: zpravyData, error: chybaZpravy } = await supabase
    .from('konverzace_zpravy')
    .select('id, autor, text, nalehava, vytvoreno_kdy, stornovano_kdy')
    .eq('konverzace_id', konverzace)
    .order('vytvoreno_kdy', { ascending: true })
    .limit(POCET)
  if (chybaZpravy) throw new DotazSelhal('zprávy rozhovoru', chybaZpravy)
  const zpravy = (zpravyData ?? []) as Zprava[]

  // Jména autorů. `full_name` je ve sloupcovém grantu, telefon a e-mail
  // schválně ne — ty se čtou jen průzorem v Lidech.
  const jmena = new Map<string, string>()
  const idAutoru = [
    ...new Set(zpravy.map((z) => z.autor).filter((i): i is string => Boolean(i))),
  ]
  if (idAutoru.length > 0) {
    const { data: lide, error: chybaLide } = await supabase
      .from('employees')
      .select('id, full_name')
      .in('id', idAutoru)
    if (chybaLide) throw new DotazSelhal('jména autorů', chybaLide)
    for (const l of lide ?? []) {
      jmena.set(l.id as string, String(l.full_name ?? '').trim())
    }
  }

  // Kdo je tady „já“ — kvůli zarovnání a kvůli tomu, co jde stornovat.
  const { data: ja, error: chybaJa } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (chybaJa) throw new DotazSelhal('můj zaměstnanecký záznam', chybaJa)
  const mojeId = (ja?.id as string | undefined) ?? null

  const smiNalehavou = await hasAccess(tenantId, 'communication.urgent', null)

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))
  const nazev =
    hlavicka.nazev ??
    (hlavicka.branch_id
      ? (nazvyPobocek.get(hlavicka.branch_id as string) ?? 'jiná pobočka')
      : 'Rozhovor')

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={
          hlavicka.adresat === 'majitel'
            ? 'Tenhle vzkaz čtou jen majitelé. Vedoucí pobočky se k němu nedostane.'
            : 'Nejstarší nahoře.'
        }
        vpravo={
          <Link href={`/${rozsah}/rozhovory`} className="ft-tl">
            Zpět na rozhovory
          </Link>
        }
      >
        {nazev}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        {zpravy.length === 0 ? (
          <Sdeleni nadpis="Zatím tu nikdo nic nenapsal">
            Napište první zprávu.
          </Sdeleni>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: '0 0 16px',
              padding: 0,
              display: 'grid',
              gap: '10px',
            }}
          >
            {zpravy.map((z) => {
              const moje = mojeId !== null && z.autor === mojeId
              const stornovana = z.stornovano_kdy !== null

              return (
                <li
                  key={z.id}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    // Naléhavá je vidět na první pohled. Je to jediná
                    // věc, která brání tomu, aby se naléhavé stalo
                    // výchozím — když je naléhavé všechno, není
                    // naléhavé nic.
                    borderLeft: z.nalehava
                      ? '4px solid var(--warn)'
                      : '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    marginLeft: moje ? '32px' : 0,
                    marginRight: moje ? 0 : '32px',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                    {[
                      z.nalehava ? 'NALÉHAVÉ' : null,
                      z.autor ? (jmena.get(z.autor) ?? 'kdosi') : 'systém',
                      /*
                        Pásmo se dodává vždycky. Bez něj bere JavaScript
                        pásmo serveru — na Vercelu UTC — a čas je v létě
                        o dvě hodiny vedle. Viz lib/cas.ts.
                      */
                      datumACasVPasmu(z.vytvoreno_kdy, ZONA),
                      stornovana ? 'staženo' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '15px',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      // Stažená zpráva nemizí — jen je vidět, že ji
                      // někdo stáhl (pravidlo 9).
                      textDecoration: stornovana ? 'line-through' : 'none',
                      opacity: stornovana ? 0.55 : 1,
                    }}
                  >
                    {z.text}
                  </p>

                  {moje && !stornovana ? (
                    <form action={stornovatZpravu} style={{ marginTop: '8px' }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="konverzace" value={konverzace} />
                      <input type="hidden" name="zprava" value={z.id} />
                      <button
                        type="submit"
                        className="ft-tl"
                        style={{ fontSize: '12px' }}
                      >
                        Stáhnout
                      </button>
                    </form>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        <form action={oznacitPrecteno} style={{ marginBottom: '16px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="konverzace" value={konverzace} />
          <button type="submit" className="ft-tl">
            Označit za přečtené
          </button>
        </form>

        {hlavicka.uzavreno_kdy ? (
          <p style={ramecek}>Tenhle rozhovor je uzavřený. Psát do něj už nejde.</p>
        ) : (
          <form
            action={poslatZpravu}
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '14px',
              padding: '14px',
            }}
          >
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="konverzace" value={konverzace} />
            <textarea
              id="text"
              name="text"
              required
              rows={3}
              placeholder="Napište zprávu…"
              style={{
                width: '100%',
                padding: '10px 12px',
                // 16 px schválně: iOS jinak při zaostření pole zoomuje.
                fontSize: '16px',
                borderRadius: '10px',
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                resize: 'vertical',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '10px',
                gap: '12px',
              }}
            >
              {/*
                Zaškrtávátko se ukazuje jen tomu, kdo na naléhavou má
                právo. Není to zámek — ten je v databázi — ale nabízet
                někomu tlačítko, které mu vždycky vrátí chybu, je jen
                zdroj otrávení.
              */}
              {smiNalehavou ? (
                <label
                  style={{
                    fontSize: '14px',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <input type="checkbox" name="nalehava" value="ano" />
                  Naléhavé — dorazí i mimo směnu
                </label>
              ) : (
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  Doručí se, až bude příjemce na směně.
                </span>
              )}
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odeslat
              </button>
            </div>
          </form>
        )}

        {/*
          Push do mobilu zatím nechodí a NEPÍŠE SE, že chodí. Věta
          o telefonu, která není pravda, je horší než žádná: člověk by
          na ni spoléhal a zprávu by si nepřišel přečíst.
        */}
        <p style={{ marginTop: '16px', fontSize: '12px', color: 'var(--muted)' }}>
          Zprávy se ukazují v aplikaci. Upozornění do telefonu zatím
          nechodí.
        </p>
      </div>
    </>
  )
}

const ramecek: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '14px',
  margin: '0 0 16px',
  fontSize: '14px',
  lineHeight: 1.5,
}
