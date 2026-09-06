import { redirect } from 'next/navigation'
import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import { otevritKanalPobocky } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Rozhovory.
 *
 * VEDLE Nástěnky, ne místo ní. Nástěnka je jednosměrné „tohle vědí
 * všichni“; tady se lidé baví. Slučovat je do jedné obrazovky by
 * znamenalo předělávat něco, co funguje — a všichni (7shifts, Deputy,
 * Slack) to mají oddělené taky.
 *
 * Pořadí NEURČUJE tahle obrazovka. Nepřečtené nahoře a od nejstaršího
 * si řadí `public.moje_rozhovory` v databázi (Deputy: *„Posts that have
 * not been confirmed will always be shown at the top of the News Feed,
 * sorted by oldest to newest“*). Číšník má na aplikaci třicet vteřin
 * před směnou; hledat nemá kdy. Kdyby se řadilo tady, druhá obrazovka
 * nad týmiž daty by to seřadila jinak.
 *
 * KANÁL POBOČKY SE NEZAKLÁDÁ, ODVOZUJE SE. Proto tu není žádný
 * formulář „nový kanál pobočky“ — je tu jedno tlačítko, které kanál té
 * pobočky otevře, a pokud ještě neexistuje, databáze ho vyrobí. Kdo do
 * něj patří, se nikde neuvádí: plyne to z dosahu na pobočku.
 */

const ZONA = ZONA_VYCHOZI

type Rozhovor = {
  konverzace_id: string
  druh: 'osobni' | 'pobocka' | 'mezi_pobockami' | 'vedeni'
  branch_id: string | null
  nazev: string | null
  adresat: string | null
  posledni_kdy: string | null
  neprectenych: number
  ceka: number
  uzavreno_kdy: string | null
}

const NAZVY_DRUHU: Record<Rozhovor['druh'], string> = {
  osobni: 'Osobní',
  pobocka: 'Pobočka',
  mezi_pobockami: 'Mezi pobočkami',
  vedeni: 'Vedení',
}

export default async function Rozhovory({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

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

  /*
    ÚČASTNICTVÍ JE AUTORIZACE, NE OPRÁVNĚNÍ — proto tady NENÍ
    `zkusPristup` s nějakým právem.

    `communication.read` je právo na Nástěnku a číšník ho v roli nemá.
    Kdyby na něm visely i rozhovory, nepřečetl by si vlastní vlákno —
    a brigádník, kvůli kterému se celé zadržené doručení dělá, taky ne.
    Napsané je to v 20260903100000, oddíl „MODUL ANO, PRÁVO NE“.

    Ptáme se tedy jen na členství, stejně jako Docházka (kterou má taky
    každý sám za sebe). Koho pustit do které konverzace, rozhoduje
    `app.je_ucastnik` v databázi — a rozhoduje to i pro přímé volání,
    ne jen pro tuhle obrazovku.
  */
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
        Tahle část Foodtabu vám není otevřená. Pokud si myslíte, že by
        měla být, řekněte si správci firmy o úpravu oprávnění.
      </Sdeleni>
    )
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase()

  const { data: seznamData, error: chybaSeznam } = await supabase.rpc(
    'moje_rozhovory',
    { p_tenant: tenantId },
  )

  // Nenasazená migrace obrazovku neshodí — rámeček místo pádu.
  if (funkceNeexistuje(chybaSeznam)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Rozhovory mezi lidmi a pobočkami.">
          Rozhovory
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Rozhovory přibudou migracemi{' '}
            <code>20260906010000_doruceni_po_pichnuti</code> a{' '}
            <code>20260906020000_odvozene_kanaly</code>.
          </p>
        </div>
      </>
    )
  }
  if (chybaSeznam) throw new DotazSelhal('seznam rozhovorů', chybaSeznam)

  const rozhovory = (seznamData ?? []) as Rozhovor[]

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const cekaCelkem = rozhovory.reduce((s, r) => s + r.ceka, 0)
  const doruceno = rozhovory.reduce((s, r) => s + (r.neprectenych - r.ceka), 0)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Nepřečtené nahoře, od nejstaršího. Nástěnka zůstává vedle."
      >
        Rozhovory
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        {/*
          ZADRŽENÉ ZPRÁVY SE PŘIZNÁVAJÍ, NESCHOVÁVAJÍ.

          Pravidlo chrání před vyrušením, ne před informací. Kdo si sám
          otevře aplikaci, má vědět, že na něj něco čeká, a smí si to
          otevřít. Kdybychom to schovali, napíše si kolegovi na WhatsApp
          a modul se obejde celý.
        */}
        {cekaCelkem > 0 ? (
          <p style={ramecek}>
            <strong>
              {cekaCelkem === 1
                ? 'Čeká na vás 1 zpráva.'
                : cekaCelkem < 5
                  ? `Čekají na vás ${cekaCelkem} zprávy.`
                  : `Čeká na vás ${cekaCelkem} zpráv.`}
            </strong>{' '}
            Doručí se, až píchnete příchod — přečíst si je můžete i teď.
          </p>
        ) : null}

        {/*
          Kanál pobočky se neZAKLÁDÁ. Tohle tlačítko ho jen otevře;
          když ještě neexistuje, vyrobí ho databáze. Seznam členů se
          nikde nezadává — plyne z dosahu na pobočku.
        */}
        {scope.level === 'branch' && scope.branchId ? (
          <form action={otevritKanalPobocky} style={{ marginBottom: '16px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <button type="submit" className="ft-tl">
              Otevřít kanál pobočky {scope.branchName}
            </button>
          </form>
        ) : null}

        {rozhovory.length === 0 ? (
          <Sdeleni nadpis="Zatím žádné rozhovory">
            Kanál své pobočky otevřete tlačítkem nahoře. Osobní rozhovor
            zatím zakládá vedoucí.
          </Sdeleni>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: '12px',
            }}
          >
            {rozhovory.map((r) => {
              const nazev =
                r.nazev ??
                (r.branch_id
                  ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka')
                  : NAZVY_DRUHU[r.druh])

              return (
                <li key={r.konverzace_id}>
                  <Link
                    href={`/${rozsah}/rozhovory/${r.konverzace_id}`}
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      color: 'inherit',
                      background: 'var(--card)',
                      border: '1px solid var(--line)',
                      borderLeft:
                        r.neprectenych > 0
                          ? '4px solid var(--mosaz)'
                          : '1px solid var(--line)',
                      borderRadius: '12px',
                      padding: '14px',
                      opacity: r.neprectenych > 0 ? 1 : 0.78,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
                      {[
                        NAZVY_DRUHU[r.druh],
                        r.branch_id
                          ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka')
                          : null,
                        r.adresat === 'majitel' ? 'jen majitelům' : null,
                        r.uzavreno_kdy ? 'uzavřeno' : null,
                        /*
                          Pásmo se dodává vždycky. Bez něj bere
                          JavaScript pásmo serveru — na Vercelu UTC — a
                          čas je v létě o dvě hodiny vedle. Viz lib/cas.ts.
                        */
                        r.posledni_kdy
                          ? datumACasVPasmu(r.posledni_kdy, ZONA)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: '16px',
                        fontWeight: r.neprectenych > 0 ? 600 : 400,
                      }}
                    >
                      {nazev}
                    </p>

                    {r.neprectenych > 0 ? (
                      <p
                        style={{
                          margin: '6px 0 0',
                          fontSize: '13px',
                          color: r.ceka > 0 ? 'var(--muted)' : 'var(--mosaz)',
                        }}
                      >
                        {r.ceka > 0
                          ? `${r.ceka} z ${r.neprectenych} čeká na píchnutí`
                          : `${r.neprectenych} nepřečtené`}
                      </p>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        {doruceno > 0 || cekaCelkem > 0 ? null : (
          <p style={{ marginTop: '16px', fontSize: '13px', color: 'var(--muted)' }}>
            Všechno přečtené.
          </p>
        )}
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
