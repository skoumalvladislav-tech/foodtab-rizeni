import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import Nastenka from './nastenka'
import SeznamRozhovoru, { NAZVY_DRUHU, type Rozhovor } from './seznam-rozhovoru'
import { otevritKanalPobocky, zalozitVzkazVedeni } from './akce'

type FiltrKlic = 'vse' | 'neprectene' | 'pobocka' | 'prime'

const FILTRY: { klic: FiltrKlic; nazev: string }[] = [
  { klic: 'vse', nazev: 'Vše' },
  { klic: 'neprectene', nazev: 'Nepřečtené' },
  { klic: 'pobocka', nazev: 'Pobočka' },
  { klic: 'prime', nazev: 'Přímé' },
]

export const dynamic = 'force-dynamic'

/**
 * Vzkazy — jeden vchod, dvě záložky.
 *
 * SLUČUJE SE VCHOD, NE OBSAH (rozhodnutí Šéfíka 6. 9. 2026). Do
 * 6. 9. stály Nástěnka a Rozhovory jako dvě položky v nabídce a byly
 * to dvě různé věci — což pořád jsou:
 *
 *   * **Vzkazy** jsou rozhovor. Odpovídá se na ně; jde o ně mezi
 *     lidmi, pobočkami a úseky.
 *   * **Nástěnka** je sdělení. Neodpovídá se na ni a eviduje se, kdo
 *     ji vzal na vědomí.
 *
 * Dva tvary zůstávají oddělené, mění se jen to, že se do obou chodí
 * jedněmi dveřmi. Dvě položky v nabídce znamenaly dvě místa, kam se
 * chodit dívat, jestli něco nepřišlo.
 *
 * Nepřečtené z obou se sčítají do jednoho čísla u ikony; u záložek se
 * ukazují po částech, aby člověk věděl, KAM má jít.
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

export default async function Rozhovory({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; zalozka?: string; filtr?: string; hledat?: string }>
}) {
  const { rozsah } = await params
  // Sem chodí hlášky z akcí — mimo jiné „Vyberte pobočku, ke které
  // vzkaz patří.“ Bez tohohle by se odpověď databáze ztratila
  // v adrese a formulář by jen mlčky nic neudělal.
  const { chyba, zalozka: zalozkaZAdresy, filtr: filtrZAdresy, hledat } = await searchParams

  const filtrAktivni: FiltrKlic = FILTRY.some((f) => f.klic === filtrZAdresy)
    ? (filtrZAdresy as FiltrKlic)
    : 'vse'

  /*
    Která záložka. Neznámá hodnota spadne na Vzkazy — z adresy je to
    návrh, ne příkaz, a chybová stránka za překlep v odkazu nestojí.
  */
  const naNastence = zalozkaZAdresy === 'nastenka'

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

  /*
    Náhled poslední zprávy do seznamu vlevo — UX redesign, druhé kolo
    (oddíl 8: "last message preview"). `moje_rozhovory` dává jen počty,
    ne text, takže se sáhne na `konverzace_zpravy` zvlášť — RLS
    (`je_ucastnik`) beztak omezí na to, co appka už jednou pustila přes
    `moje_rozhovory`. Nejnovější zprávy napříč rozhovory se seřadí
    a v JS se z nich vezme první výskyt na konverzaci — bez zvláštního
    pohledu "poslední zpráva na konverzaci" v databázi.
  */
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

  function projdeFiltrem(r: Rozhovor): boolean {
    if (filtrAktivni === 'neprectene') return r.neprectenych > 0
    if (filtrAktivni === 'pobocka') return r.druh === 'pobocka' || r.druh === 'mezi_pobockami'
    if (filtrAktivni === 'prime') return r.druh === 'osobni' || r.druh === 'vedeni'
    return true
  }

  const hledatOriznute = (hledat ?? '').trim().toLowerCase()
  function projdeHledanim(r: Rozhovor): boolean {
    if (!hledatOriznute) return true
    const nazev = (
      r.nazev ?? (r.branch_id ? nazvyPobocek.get(r.branch_id) : NAZVY_DRUHU[r.druh]) ?? ''
    ).toLowerCase()
    return nazev.includes(hledatOriznute)
  }

  const rozhovoryZobrazene = rozhovory.filter((r) => projdeFiltrem(r) && projdeHledanim(r))

  /*
    KDO UVIDÍ VZKAZ VEDENÍ — jmenovitě, a ze stejné funkce, jakou se
    pak vybírají účastníci.

    Kdyby si to obrazovka počítala po svém, mohla by slíbit jeden okruh
    a konverzace by vznikla s jiným. U vzkazu vedení je to ten
    nejcitlivější rozdíl, jaký může nastat: člověk se rozhoduje podle
    toho, co si přečte tady.

    Pro „vedoucí pobočky" se ptáme na pobočku z rozsahu; kdo je na
    firemní úrovni, uvidí okruh té první ze svého seznamu a při odeslání
    si pobočku vybere.
  */
  const pobockaProVzkaz = scope.branchId ?? ctx.branches[0]?.id ?? null

  const { data: vedouciData, error: chybaVedouci } = await supabase.rpc(
    'kdo_uvidi_vzkaz',
    { p_tenant: tenantId, p_adresat: 'vedouci', p_branch: pobockaProVzkaz },
  )
  if (chybaVedouci && !funkceNeexistuje(chybaVedouci)) {
    throw new DotazSelhal('kdo uvidí vzkaz vedoucímu', chybaVedouci)
  }

  const { data: majitelData, error: chybaMajitel } = await supabase.rpc(
    'kdo_uvidi_vzkaz',
    { p_tenant: tenantId, p_adresat: 'majitel', p_branch: null },
  )
  if (chybaMajitel && !funkceNeexistuje(chybaMajitel)) {
    throw new DotazSelhal('kdo uvidí vzkaz majiteli', chybaMajitel)
  }

  const jmena = (d: unknown): string[] =>
    ((d ?? []) as { jmeno: string | null }[])
      .map((r) => String(r.jmeno ?? '').trim())
      .filter((j) => j !== '')

  const vedouciJmena = jmena(vedouciData)
  const majitelJmena = jmena(majitelData)

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const cekaCelkem = rozhovory.reduce((s, r) => s + r.ceka, 0)
  const doruceno = rozhovory.reduce((s, r) => s + (r.neprectenych - r.ceka), 0)
  const neprecteneVzkazy = rozhovory.reduce((s, r) => s + r.neprectenych, 0)

  /*
    NEPŘEČTENÉ NA NÁSTĚNCE — pro číslo u druhé záložky.

    Počítá se i tehdy, když je člověk na záložce Vzkazy: jinak by se
    o tom, že na Nástěnce něco leží, nedozvěděl, dokud tam nepřepne.
    Sčítá se to do jednoho čísla u ikony v nabídce (rozhodnutí Šéfíka
    6. 9.), ale u záložek se ukazuje po částech — člověk potřebuje
    vědět, KAM má jít.

    Chyba se schválně nevyhazuje: nepřečtené je pomocný údaj a kvůli
    číslu u záložky nemá padat celá obrazovka. Když se nepovede, ukáže
    se prostě bez čísla.
  */
  let neprecteneNastenka = 0
  const { data: nastenkaIds } = await supabase
    .from('announcements')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(200)

  if (nastenkaIds && nastenkaIds.length > 0) {
    const { data: prectene } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', user.id)
      .in(
        'announcement_id',
        nastenkaIds.map((z) => z.id as string),
      )
    const uz = new Set((prectene ?? []).map((c) => c.announcement_id as string))
    neprecteneNastenka = nastenkaIds.filter((z) => !uz.has(z.id as string)).length
  }

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={
          naNastence
            ? 'Co se má vědět. Nejnovější nahoře.'
            : 'Nepřečtené nahoře, od nejstaršího.'
        }
      >
        Vzkazy
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: naNastence ? '760px' : '1080px' }}>
        {/*
          ZÁLOŽKY — SLUČUJE SE VCHOD, NE OBSAH.

          Vzkazy jsou rozhovor: odpovídá se na ně a jde o ně mezi lidmi,
          pobočkami a úseky. Nástěnka je sdělení: neodpovídá se na ni
          a eviduje se, kdo ji vzal na vědomí. Jsou to dva různé tvary
          a zůstávají oddělené — mění se jen to, že se do obou chodí
          jedněmi dveřmi.

          Přepíná se adresou, ne javascriptem: obrazovka je stejně
          `force-dynamic`, odkaz jde poslat dál a funguje i bez skriptů.
          Neznámá hodnota spadne na Vzkazy, ne na chybu.
        */}
        <nav style={zalozky} aria-label="Vzkazy a nástěnka">
          <Link
            href={`/${rozsah}/vzkazy`}
            style={naNastence ? zalozka : zalozkaAktivni}
            aria-current={naNastence ? undefined : 'page'}
          >
            Vzkazy
            {neprecteneVzkazy > 0 ? ` (${neprecteneVzkazy})` : ''}
          </Link>
          <Link
            href={`/${rozsah}/vzkazy?zalozka=nastenka`}
            style={naNastence ? zalozkaAktivni : zalozka}
            aria-current={naNastence ? 'page' : undefined}
          >
            Nástěnka
            {neprecteneNastenka > 0 ? ` (${neprecteneNastenka})` : ''}
          </Link>
        </nav>

        {naNastence ? (
          <Nastenka
            tenantId={tenantId}
            ctx={ctx}
            scope={scope}
            rozsah={rozsah}
          />
        ) : (
          <>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

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
          CONVERSATIONLIST/CHATVIEW (master prompt, sekce 21).

          Seznam vlevo, vlákno vpravo od 900px — `.ds-vzkazy-split`
          (app/_komponenty.css). Na téhle stránce (`/vzkazy`) je
          `data-zobrazit="seznam"`: pod 900px se ukáže jen seznam,
          detail vpravo je tu jen jako výzva „vyberte rozhovor" pro
          širokou obrazovku. `/vzkazy/[konverzace]` má opačně
          `data-zobrazit="detail"` a vykresluje TÝŽ seznam (sdílená
          komponenta `SeznamRozhovoru`) se zvýrazněnou aktivní položkou.
        */}
        <div className="ds-vzkazy-split" data-zobrazit="seznam">
          <div className="ds-vzkazy-seznam">
            {/*
              Hledání + filtry — UX redesign, druhé kolo (oddíl 8: LEFT
              panel = Search, filtry, [+ Nový vzkaz], seznam). Hledání
              je normální GET formulář (funguje i bez JS, stejný vzor
              jako Finance → Faktury), filtry jsou odkazy s `?filtr=`.
            */}
            <form method="get" action={`/${rozsah}/vzkazy`} style={{ marginBottom: '10px' }}>
              <input type="hidden" name="filtr" value={filtrAktivni} />
              <input
                type="search"
                name="hledat"
                defaultValue={hledat ?? ''}
                placeholder="Hledat rozhovor…"
                style={poleHledani}
              />
            </form>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {FILTRY.map((f) => (
                <Link
                  key={f.klic}
                  href={f.klic === 'vse' ? `/${rozsah}/vzkazy` : `/${rozsah}/vzkazy?filtr=${f.klic}`}
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                  aria-pressed={filtrAktivni === f.klic}
                >
                  {f.nazev}
                </Link>
              ))}
            </div>

            {/*
              Kanál pobočky se neZAKLÁDÁ. Tohle tlačítko ho jen otevře;
              když ještě neexistuje, vyrobí ho databáze. Seznam členů se
              nikde nezadává — plyne z dosahu na pobočku.
            */}
            {scope.level === 'branch' && scope.branchId ? (
              <form action={otevritKanalPobocky} style={{ marginBottom: '10px' }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <button type="submit" className="ft-tl ft-tl-male">
                  + Otevřít kanál pobočky {scope.branchName}
                </button>
              </form>
            ) : null}

            {/*
          VZKAZ VEDENÍ.

          Odesílatel vybírá adresáta a — když dosáhne na víc poboček —
          i pobočku. Odvozovat ji z domovského záznamu nestačí: člověk,
          co dělá na dvou provozovnách, si stěžuje na to, co zažil tam,
          kde zrovna byl, a vzkaz by přistál u vedoucího té druhé.
          Rozhodnutí Šéfíka 6. 9. 2026.

          Kdo to uvidí, se na obrazovce vypisuje JMENOVITĚ a jména si
          bere z `kdo_uvidi_vzkaz` — tedy z téže funkce, kterou se pak
          vybírají účastníci. Kdyby si to obrazovka počítala po svém,
          slíbila by jeden okruh a konverzace by vznikla s jiným.
        */}
        <details style={ramecekFormulare}>
          <summary style={{ cursor: 'pointer', fontSize: '15px' }}>
            Napsat vedení
          </summary>

          <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
            Anonymní to není. Ve dvanáctičlenném provozu je anonymita
            stejně průhledná a zve to k útokům, na které se nedá
            odpovědět. Místo toho platí úzký okruh adresátů — a je
            vypsaný níž, ať víte, komu píšete, dřív než začnete.
          </p>

          <form action={zalozitVzkazVedeni} style={{ marginTop: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />

            <fieldset style={poleSkupina}>
              <legend style={popisek}>Komu</legend>

              <label style={volba}>
                <input type="radio" name="adresat" value="vedouci" defaultChecked />
                vedoucí pobočky
              </label>
              {vedouciJmena.length > 0 ? (
                <p style={kdoUvidi}>Uvidí: {vedouciJmena.join(', ')}</p>
              ) : (
                <p style={kdoUvidi}>
                  Na vybrané pobočce zatím nikdo s právem spravovat lidi není.
                </p>
              )}

              <label style={{ ...volba, marginTop: '10px' }}>
                <input type="radio" name="adresat" value="majitel" />
                majitel firmy
              </label>
              <p style={kdoUvidi}>
                Uvidí: {majitelJmena.length > 0 ? majitelJmena.join(', ') : '—'}.
                Vedoucí pobočky se k tomu nedostane, ani nikdo se správou
                lidí.
              </p>
            </fieldset>

            {/*
              Pobočku vybírá jen ten, kdo dosáhne na víc než jednu.
              Ostatním se otázka neklade — odvodí se.
            */}
            {ctx.branches.length > 1 ? (
              <fieldset style={poleSkupina}>
                <legend style={popisek}>Které pobočky se to týká</legend>
                <select name="pobocka" style={vyber} defaultValue={scope.branchId ?? ''}>
                  <option value="">— vyberte —</option>
                  {ctx.branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <p style={kdoUvidi}>
                  Platí pro volbu „vedoucí pobočky“. U majitele na
                  pobočce nezáleží.
                </p>
              </fieldset>
            ) : null}

            <fieldset style={poleSkupina}>
              <legend style={popisek}>Čeho se to týká</legend>
              <input
                type="text"
                name="nazev"
                required
                maxLength={120}
                placeholder="Krátce, o co jde"
                style={pole}
              />
            </fieldset>

            <button type="submit" className="ft-tl">
              Založit vzkaz
            </button>
          </form>
        </details>

            {rozhovoryZobrazene.length === 0 && rozhovory.length > 0 ? (
              <p style={{ fontSize: '13.5px', color: 'var(--muted)', padding: '4px 2px' }}>
                Žádný rozhovor neodpovídá filtru nebo hledání.
              </p>
            ) : (
              <SeznamRozhovoru
                rozsah={rozsah}
                rozhovory={rozhovoryZobrazene}
                nazvyPobocek={nazvyPobocek}
                posledniText={posledniText}
              />
            )}

            {doruceno > 0 || cekaCelkem > 0 ? null : (
              <p style={{ marginTop: '16px', fontSize: '13px', color: 'var(--muted)' }}>
                Všechno přečtené.
              </p>
            )}
          </div>

          {/*
            Detail vpravo — na týhle stránce žádný rozhovor vybraný
            není, takže tu je jen výzva. Pod 900px se celý sloupec
            schová (`data-zobrazit="seznam"` výš), takže tenhle text
            na mobilu vůbec neexistuje v DOM ani jako blikající obsah.
          */}
          <div className="ds-vzkazy-detail">
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                minHeight: '300px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: '14px',
                padding: '32px',
              }}
            >
              <p style={{ margin: 0 }}>Vyberte rozhovor vlevo.</p>
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </>
  )
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

/* --- Vzhled formuláře vzkazu vedení ----------------------------- */

const ramecekFormulare: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  marginBottom: '14px',
}

const poleHledani: React.CSSProperties = {
  width: '100%',
  height: '38px',
  padding: '0 12px',
  fontSize: '13.5px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--sunken)',
  color: 'var(--ink)',
}

const poleSkupina: React.CSSProperties = {
  border: 'none',
  padding: 0,
  margin: '14px 0 0',
}

const popisek: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--muted)',
  padding: 0,
  marginBottom: '6px',
}

const volba: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: 'var(--ink)',
}

/*
  Věta „kdo to uvidí“. Schválně blízko u té volby, ke které patří —
  odsazená, aby bylo vidět, že mluví o ní, a ne o té pod ní.
*/
const kdoUvidi: React.CSSProperties = {
  margin: '4px 0 0 26px',
  fontSize: '12px',
  color: 'var(--muted)',
  lineHeight: 1.45,
}

const pole: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  // 16 px schválně: iOS jinak při zaostření pole zoomuje celou stránku.
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
}

const vyber: React.CSSProperties = { ...pole, minHeight: '44px' }

/* --- Záložky ---------------------------------------------------- */

const zalozky: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
  borderBottom: '1px solid var(--line)',
}

const zalozka: React.CSSProperties = {
  padding: '10px 14px',
  // 44 px je nejmenší cíl, na který se dá na telefonu spolehlivě
  // trefit palcem. Záložky se přepínají ve spěchu jako všechno ostatní.
  minHeight: '44px',
  display: 'flex',
  alignItems: 'center',
  fontSize: '15px',
  color: 'var(--muted)',
  textDecoration: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: '-1px',
}

const zalozkaAktivni: React.CSSProperties = {
  ...zalozka,
  color: 'var(--ink)',
  fontWeight: 600,
  borderBottom: '2px solid var(--mosaz)',
}
