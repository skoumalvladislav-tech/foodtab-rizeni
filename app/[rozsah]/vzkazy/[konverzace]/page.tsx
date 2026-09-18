import { redirect } from 'next/navigation'
import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { KBELIK, PLATNOST_ODKAZU_S, mmss } from '@/lib/hlasove-zpravy'
import { DotazSelhal, sloupecNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import SeznamRozhovoru, { type Rozhovor } from '../seznam-rozhovoru'
import { oznacitPrecteno, poslatZpravu, stornovatZpravu } from '../akce'
import HlasovkaNahravac from './hlasovka-nahravac'

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

type Priorita = 'normal' | 'important' | 'urgent'

type Zprava = {
  id: string
  autor: string | null
  text: string
  priorita: Priorita
  vytvoreno_kdy: string
  stornovano_kdy: string | null
  zvuk_cesta: string | null
  zvuk_delka_s: number | null
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

  /*
    Seznam pro levý sloupec ConversationList/ChatView (master prompt,
    sekce 21) — TÁŽ RPC a TÝŽ typ jako na /vzkazy (`SeznamRozhovoru`),
    jen se tu navíc zvýrazní `konverzace` jako aktivní. Chyba se
    nevyhazuje: bez seznamu se ukáže aspoň vlákno, ne prázdná stránka.
  */
  const { data: seznamData } = await supabase.rpc('moje_rozhovory', { p_tenant: tenantId })
  const rozhovory = (seznamData ?? []) as Rozhovor[]
  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))

  // Náhled poslední zprávy do seznamu vlevo — stejný postup jako na /vzkazy.
  const posledniText = new Map<string, string>()
  if (rozhovory.length > 0) {
    const { data: zpravyPreview } = await supabase
      .from('konverzace_zpravy')
      .select('konverzace_id, text, vytvoreno_kdy')
      .in('konverzace_id', rozhovory.map((r) => r.konverzace_id))
      .is('stornovano_kdy', null)
      .order('vytvoreno_kdy', { ascending: false })
      .limit(300)
    for (const z of zpravyPreview ?? []) {
      const kid = z.konverzace_id as string
      if (posledniText.has(kid)) continue
      const t = String(z.text ?? '').trim()
      posledniText.set(kid, t.length > 72 ? `${t.slice(0, 72)}…` : t)
    }
  }

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

  const dotazNaZpravy = (sloupce: string) =>
    supabase
      .from('konverzace_zpravy')
      .select(sloupce)
      .eq('konverzace_id', konverzace)
      .order('vytvoreno_kdy', { ascending: true })
      .limit(POCET)

  let { data: zpravyData, error: chybaZpravy } = await dotazNaZpravy(
    'id, autor, text, priorita, vytvoreno_kdy, stornovano_kdy, zvuk_cesta, zvuk_delka_s',
  )

  /*
    Sloupce zvuk_cesta/zvuk_delka_s jsou z 20260917060000, priorita
    z 20260917040000 — dokud migrace neproběhnou, dotaz se postupně
    zjednodušuje až na nejstarší tvar (jen `nalehava boolean`, žádný
    zvuk). Bez tohohle by tahle stránka spadla hned po mergi do main,
    protože kód a databáze se nasazují nezávisle — Vercel nasadí kód
    okamžitě, migrace čeká na ruční `db push`. Stejný vzor jako
    upozorneni/page.tsx.
  */
  let maPrioritu = true
  let maZvuk = true
  if (chybaZpravy && sloupecNeexistuje(chybaZpravy)) {
    maZvuk = false
    ;({ data: zpravyData, error: chybaZpravy } = await dotazNaZpravy(
      'id, autor, text, priorita, vytvoreno_kdy, stornovano_kdy',
    ))
  }
  if (chybaZpravy && sloupecNeexistuje(chybaZpravy)) {
    maPrioritu = false
    ;({ data: zpravyData, error: chybaZpravy } = await dotazNaZpravy(
      'id, autor, text, nalehava, vytvoreno_kdy, stornovano_kdy',
    ))
  }
  if (chybaZpravy) throw new DotazSelhal('zprávy rozhovoru', chybaZpravy)

  const zpravy = ((zpravyData ?? []) as unknown as Record<string, unknown>[]).map((z) => ({
    id: z.id as string,
    autor: z.autor as string | null,
    text: z.text as string,
    priorita: maPrioritu
      ? (z.priorita as Priorita)
      : ((z.nalehava as boolean) ? 'urgent' : 'normal'),
    vytvoreno_kdy: z.vytvoreno_kdy as string,
    stornovano_kdy: z.stornovano_kdy as string | null,
    zvuk_cesta: maZvuk ? (z.zvuk_cesta as string | null) : null,
    zvuk_delka_s: maZvuk ? (z.zvuk_delka_s as number | null) : null,
  })) satisfies Zprava[]

  // Podepsané odkazy na hlasovky — kbelík je soukromý, přehrává se jen
  // přes krátkodobý odkaz vydaný až po kontrole app.je_ucastnik
  // (politika úložiště). Jeden dávkový dotaz pro celé vlákno.
  const cestyHlasovek = zpravy
    .map((z) => z.zvuk_cesta)
    .filter((c): c is string => c !== null)
  const odkazyHlasovek = new Map<string, string>()
  if (cestyHlasovek.length > 0) {
    const { data: podepsane } = await supabase.storage
      .from(KBELIK)
      .createSignedUrls(cestyHlasovek, PLATNOST_ODKAZU_S)
    for (const p of podepsane ?? []) {
      if (p.signedUrl && p.path) odkazyHlasovek.set(p.path, p.signedUrl)
    }
  }

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
          <Link href={`/${rozsah}/vzkazy`} className="ft-tl">
            Zpět na rozhovory
          </Link>
        }
      >
        {nazev}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '1080px' }}>
        {/*
          CONVERSATIONLIST/CHATVIEW — stejný `.ds-vzkazy-split` jako na
          /vzkazy, tady s `data-zobrazit="detail"`: pod 900px je vidět
          jen vlákno (seznam si zavře „Zpět na rozhovory" výš). Nad
          900px stojí seznam se zvýrazněnou touhle konverzací vlevo.
        */}
        <div className="ds-vzkazy-split" data-zobrazit="detail">
          <div className="ds-vzkazy-seznam">
            <SeznamRozhovoru
              rozsah={rozsah}
              rozhovory={rozhovory}
              nazvyPobocek={nazvyPobocek}
              aktivniId={konverzace}
              posledniText={posledniText}
            />
          </div>
          <div className="ds-vzkazy-detail">
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
                    background: moje ? 'color-mix(in srgb, var(--mosaz-sv) 10%, var(--card))' : 'var(--card)',
                    border: '1px solid var(--line)',
                    // Priorita je vidět na první pohled a jen na téhle
                    // hraně — je to jediná věc, která brání tomu, aby
                    // se naléhavé stalo výchozím: když je naléhavé
                    // všechno, není naléhavé nic. Important dostává
                    // jinou barvu (--info), ne jen slabší naléhavou —
                    // dvě různé věci nemají vypadat jako dvě síly
                    // téhož.
                    borderLeft:
                      z.priorita === 'urgent'
                        ? '4px solid var(--warn)'
                        : z.priorita === 'important'
                          ? '4px solid var(--info)'
                          : '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    marginLeft: moje ? '32px' : 0,
                    marginRight: moje ? 0 : '32px',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                    {[
                      z.priorita === 'urgent' ? 'NALÉHAVÉ' : null,
                      z.priorita === 'important' ? 'DŮLEŽITÉ' : null,
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

                  {z.text ? (
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
                  ) : null}

                  {/*
                    Hlasovka — BEZ přepisu (rozhodnutí Šéfíka, viz
                    hlavička 20260917060000_hlasove_zpravy.sql). Odkaz
                    je krátkodobý a podepsaný, vydaný výš dávkově pro
                    celé vlákno — kbelík je soukromý.
                  */}
                  {z.zvuk_cesta && odkazyHlasovek.get(z.zvuk_cesta) ? (
                    <div style={{ margin: '6px 0 0', opacity: stornovana ? 0.55 : 1 }}>
                      <audio controls src={odkazyHlasovek.get(z.zvuk_cesta)} style={{ height: '32px', maxWidth: '260px' }} />
                      {z.zvuk_delka_s ? (
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                          {mmss(z.zvuk_delka_s)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

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
              borderRadius: 'var(--radius-lg)',
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
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                resize: 'vertical',
              }}
            />
            {/*
              Diktování je dnes jediná hlasová cesta, která funguje
              i na iPhonu — `SpeechRecognition` v prohlížeči tam ne,
              takže tlačítko s mikrofonem by půlce lidí nefungovalo
              a vypadalo by to jako rozbitá aplikace.

              Pole diktování unese: `textarea`, neřízené, bez měnícího
              se `key`, nic v okolí netiká po vteřinách. Přesně na tomhle
              se lámalo vkládání přihlašovacího kódu.
            */}
            <p
              style={{
                margin: '6px 0 0',
                fontSize: '12px',
                color: 'var(--muted)',
              }}
            >
              Můžete i diktovat — mikrofon na klávesnici telefonu.
            </p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '10px',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {/*
                  Volba „Naléhavé" se nabízí jen tomu, kdo na ni má
                  právo. Není to zámek — ten je v databázi — ale
                  nabízet někomu možnost, která mu vždycky vrátí
                  chybu, je jen zdroj otrávení. „Důležité" právo
                  nevyžaduje: nemění DOKDY zpráva dorazí, jen jak
                  vypadá a kde se řadí.
                */}
                <label
                  style={{
                    fontSize: '14px',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  Priorita
                  <select name="priorita" defaultValue="normal" style={vyberPriority}>
                    <option value="normal">Normální</option>
                    <option value="important">Důležité</option>
                    {smiNalehavou ? (
                      <option value="urgent">Naléhavé — dorazí i mimo směnu</option>
                    ) : null}
                  </select>
                </label>
                {!smiNalehavou ? (
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Doručí se, až bude příjemce na směně.
                  </span>
                ) : null}
              </div>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odeslat
              </button>
            </div>
          </form>
        )}

        {!hlavicka.uzavreno_kdy ? (
          <div style={{ marginTop: '10px' }}>
            <HlasovkaNahravac rozsah={rozsah} konverzace={konverzace} />
          </div>
        ) : null}

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
        </div>
      </div>
    </>
  )
}

const vyberPriority: React.CSSProperties = {
  fontSize: '14px',
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)',
  background: 'var(--card)',
  color: 'var(--ink)',
}

const ramecek: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  padding: '14px',
  margin: '0 0 16px',
  fontSize: '14px',
  lineHeight: 1.5,
}
