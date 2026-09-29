import { randomUUID } from 'node:crypto'

import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { OCI_VZKAZU } from '@/lib/komunikace/zalozky'
import { DotazSelhal, funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Ikona from '../ikona'
import Nadpis from '../nadpis'
import { nactiZalozky } from '../provozni-centrum/pocty'
import PcZalozky from '../provozni-centrum/zalozky'
import Nastenka from './nastenka'
import SeznamRozhovoru, { NAZVY_DRUHU, type Rozhovor } from './seznam-rozhovoru'
import { otevritKanalPobocky, otevritKanalUseku } from './akce'
import FormularVedeni from './formular-vedeni'
import { nactiNazvyOsobnich, nactiPosledniTexty } from './nazvy'

type FiltrKlic = 'vse' | 'neprectene' | 'pobocka' | 'usek' | 'prime'

const FILTRY: { klic: FiltrKlic; nazev: string }[] = [
  { klic: 'vse', nazev: 'Vše' },
  { klic: 'neprectene', nazev: 'Nepřečtené' },
  { klic: 'pobocka', nazev: 'Pobočka' },
  { klic: 'usek', nazev: 'Úsek' },
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
  searchParams: Promise<{ chyba?: string; zalozka?: string; filtr?: string; hledat?: string; vedeni?: string }>
}) {
  const { rozsah } = await params
  // Sem chodí hlášky z akcí — mimo jiné „Vyberte pobočku, ke které
  // vzkaz patří.“ Bez tohohle by se odpověď databáze ztratila
  // v adrese a formulář by jen mlčky nic neudělal. `vedeni=1` = hláška
  // patří formuláři „Napsat vedení“, ten se proto ukáže rozbalený.
  const { chyba, zalozka: zalozkaZAdresy, filtr: filtrZAdresy, hledat, vedeni } = await searchParams

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

  // Rámeček „čeká na nasazení databáze“ tu byl do 27. 9.; migrace jsou
  // dávno nasazené a mrtvý rámeček jen mátl. Chyba je chyba.
  if (chybaSeznam) throw new DotazSelhal('seznam rozhovorů', chybaSeznam)

  const rozhovory = (seznamData ?? []) as Rozhovor[]
  // Čísla a skryté záložky — jedna funkce pro všechny stránky „Vzkazy a úkoly“.
  const zalozky = await nactiZalozky(supabase, {
    tenantId,
    userId: user.id,
    branchId: scope.branchId,
    rozhovory,
  })

  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))
  // Osobní rozhovor bez názvu = jména ostatních účastníků (každý vidí toho druhého).
  const nazvyOsobnich = await nactiNazvyOsobnich(supabase, tenantId)

  /*
    Kanál MÉHO úseku — stejná úvaha jako u kanálu pobočky výš (řádek
    o "KANÁL POBOČKY SE NEZAKLÁDÁ"): tlačítko ho jen otevře, databáze
    ho při prvním použití vyrobí. Úsek je vlastnost ČLOVĚKA
    (employees.usek_id — Nastavení → Lidé), ne pobočky, takže se
    nebere z rozsahu v adrese, ale z vlastního zaměstnaneckého
    záznamu. Kdo úsek nemá přiřazený, tlačítko vůbec neuvidí — nemá
    co otevřít.
  */
  const { data: mujZaznam } = await supabase
    .from('employees')
    .select('usek_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  const mujUsekId = (mujZaznam?.usek_id as string | null) ?? null

  let nazevMehoUseku: string | null = null
  if (mujUsekId) {
    const { data: usekData } = await supabase
      .from('useky')
      .select('nazev')
      .eq('id', mujUsekId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    nazevMehoUseku = (usekData?.nazev as string | undefined) ?? null
  }

  /*
    Náhled poslední zprávy do seznamu vlevo — UX redesign, druhé kolo
    (oddíl 8: "last message preview"). `moje_rozhovory` dává jen počty,
    ne text, takže se sáhne na `konverzace_zpravy` zvlášť — RLS
    (`je_ucastnik`) beztak omezí na to, co appka už jednou pustila přes
    `moje_rozhovory`. Nejnovější zprávy napříč rozhovory se seřadí
    a v JS se z nich vezme první výskyt na konverzaci — bez zvláštního
    pohledu "poslední zpráva na konverzaci" v databázi.
  */
  const posledniText = await nactiPosledniTexty(supabase, rozhovory.map((r) => r.konverzace_id))

  function projdeFiltrem(r: Rozhovor): boolean {
    if (filtrAktivni === 'neprectene') return r.neprectenych > 0
    if (filtrAktivni === 'pobocka') return r.druh === 'pobocka' || r.druh === 'mezi_pobockami'
    if (filtrAktivni === 'usek') return r.druh === 'usek'
    if (filtrAktivni === 'prime') return r.druh === 'osobni' || r.druh === 'vedeni'
    return true
  }

  const hledatOriznute = (hledat ?? '').trim().toLowerCase()
  function projdeHledanim(r: Rozhovor): boolean {
    if (!hledatOriznute) return true
    const nazev = (
      r.nazev ??
      nazvyOsobnich.get(r.konverzace_id) ??
      (r.branch_id ? nazvyPobocek.get(r.branch_id) : NAZVY_DRUHU[r.druh]) ??
      ''
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

  /*
    Čísla u záložek (i u Nástěnky, když je člověk na Komunikaci) dává
    `nactiZalozky` výš — stejná funkce jako na ostatních stránkách pod
    „Vzkazy a úkoly“. Nástěnka se počítá TÝMŽ dotazem jako její seznam.
  */

  /*
    JEDNA HLAVIČKA PRO VŠECHNY ZÁLOŽKY (27. 9.): nadpisek „Vzkazy
    a úkoly“, velký nadpis = záložka. Do té doby měla každá záložka jiný
    nadpisek i nadpis („Provoz · Vzkazy a úkoly“ tady, „Vzkazy a úkoly ·
    Úkoly“ na Úkolech).
  */
  return (
    <>
      <Nadpis
        oci={OCI_VZKAZU}
        popis={
          naNastence
            ? 'Oznámení pro všechny. Co čeká na „Beru na vědomí“, je nahoře.'
            : 'Rozhovory s kolegy, pobočkou, úsekem a vedením. Nepřečtené nahoře.'
        }
      >
        {naNastence ? 'Nástěnka' : 'Komunikace'}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: naNastence ? '760px' : '1080px' }}>
        {/*
          ZÁLOŽKY „VZKAZY A ÚKOLY“. Slučuje se vchod, ne obsah (rozhodnutí
          Šéfíka 6. 9. 2026): Vzkazy jsou rozhovor, Nástěnka je sdělení, obojí
          se dál kreslí zvlášť — mění se jen to, že se do všeho chodí jednou
          lištou. Přepíná se adresou, ne skriptem.
        */}
        <PcZalozky rozsah={rozsah} aktivni={naNastence ? 'nastenka' : 'komunikace'} {...zalozky} />

        {naNastence ? (
          <Nastenka
            tenantId={tenantId}
            ctx={ctx}
            scope={scope}
            rozsah={rozsah}
          />
        ) : (
          <>
        {chyba && vedeni !== '1' ? <p className="hlaska-chyba" role="alert">{chyba}</p> : null}

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
            <form method="get" action={`/${rozsah}/vzkazy`} role="search" style={{ marginBottom: '10px' }}>
              <input type="hidden" name="filtr" value={filtrAktivni} />
              {/* Popisek pro čtečku (27. 9.) — samotný placeholder se nečte spolehlivě. */}
              <label htmlFor="pc-hledat-rozhovor" className="sr-only">
                Hledat rozhovor podle názvu
              </label>
              <input
                id="pc-hledat-rozhovor"
                type="search"
                name="hledat"
                defaultValue={hledat ?? ''}
                placeholder="Hledat rozhovor…"
                style={poleHledani}
              />
            </form>
            {/*
              Filtry jsou ODKAZY, takže vybraný nese aria-current, ne
              aria-pressed (to patří přepínacím tlačítkům a u odkazu ho
              čtečka neohlásí).
            */}
            <nav aria-label="Filtr rozhovorů" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {FILTRY.map((f) => (
                <Link
                  key={f.klic}
                  href={f.klic === 'vse' ? `/${rozsah}/vzkazy` : `/${rozsah}/vzkazy?filtr=${f.klic}`}
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                  aria-current={filtrAktivni === f.klic ? 'true' : undefined}
                >
                  {f.nazev}
                </Link>
              ))}
            </nav>

            {/*
              „+ Nový rozhovor“ (do 27. 9. „+ Nová zpráva“ — rozhovor je
              vlákno, zpráva je to, co se do něj píše; slovník v plánu
              z 27. 9., oddíl 9). Vedle „Napsat vedení“: formulář je
              sbalený, na telefonu nezabírá půl seznamu.
            */}
            <div className="pc-akce-seznamu">
              <Link href={`/${rozsah}/vzkazy/nova`} className="ft-tl ft-tl-hlavni ft-tl-male">
                <Ikona klic="plus" /> Nový rozhovor
              </Link>
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
              Kanál úseku, stejná úvaha jako kanál pobočky výš — jen
              dosah je "mám ten usek_id sám u sebe", ne pobočka
              z adresy. Kdo úsek nemá přiřazený (Nastavení → Lidé),
              tlačítko vůbec neuvidí.
            */}
            {mujUsekId ? (
              <form action={otevritKanalUseku} style={{ marginBottom: '10px' }}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="usek" value={mujUsekId} />
                <button type="submit" className="ft-tl ft-tl-male">
                  + Otevřít kanál úseku {nazevMehoUseku ?? ''}
                </button>
              </form>
            ) : null}

            {/*
              VZKAZ VEDENÍ — sbalený formulář (`formular-vedeni.tsx`).
              Kdo to uvidí, se vypisuje jmenovitě z `kdo_uvidi_vzkaz`.
            */}
            <FormularVedeni
              rozsah={rozsah}
              otevreno={vedeni === '1'}
              chyba={chyba && vedeni === '1' ? chyba : null}
              vedouciJmena={vedouciJmena}
              majitelJmena={majitelJmena}
              pobocky={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
              vychoziPobocka={scope.branchId}
              klientId={randomUUID()}
            />

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
                nazvyOsobnich={nazvyOsobnich}
                tlacitkoKanaluPobocky={scope.level === 'branch' && Boolean(scope.branchId)}
                tlacitkoKanaluUseku={Boolean(mujUsekId)}
              />
            )}

            {/* Bez jediného rozhovoru není co mít přečtené (28. 9.). */}
            {rozhovory.length === 0 || doruceno > 0 || cekaCelkem > 0 ? null : (
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
