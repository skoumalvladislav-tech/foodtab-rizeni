import Link from 'next/link'
import { redirect } from 'next/navigation'

import { KANALY } from '@/lib/marketing'
import { KBELIK, PLATNOST_ODKAZU_S } from '@/lib/marketing-media'
import { sablona } from '@/lib/marketing-sablony'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { seznam, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { vytvoritZTvorby } from '../akce'
import VyberSablony, { type MenuVolba, type SablonaVolba } from './vyber-sablony'

export const dynamic = 'force-dynamic'

/**
 * Tvorba — tři režimy na jedné obrazovce.
 *
 * Zadání krok 3 (`docs/hlaseni/zadani-pro-ai-marketing-faktury.md`):
 * rychlý (fotka + věta), průvodce (podklady → šablona → návrh →
 * editor → schválení → termín), kampaň (cíl + termín → série).
 * „Kroky existují každý jinde v modulu — spojit je, ne psát znovu."
 *
 * ---------------------------------------------------------------------
 * KAMPAŇ SE JEN ODKAZUJE, NEPŘEPISUJE
 *
 * `/marketing/kampane` už dělá přesně „cíl + termín → série" — vlastní
 * formulář, seznam kampaní, výroba série, automatizace. Kreslit to
 * tady znovu by byla druhá kopie téhož, která se dřív nebo později
 * rozejde. Tenhle režim proto jen vysvětlí rozdíl a odkáže tam.
 *
 * ---------------------------------------------------------------------
 * KROKY 3–6 NEJSOU TADY
 *
 * Další návrh, editor, schválení a termín jsou hotové na `[prispevek]`
 * (`navrhnoutText`, `ulozitVerzi`, `pozadatOSchvaleni`, `naplanovat`).
 * Rychlý i průvodce jen založí příspěvek s podklady a prvním návrhem
 * (`vytvoritZTvorby` v `akce.ts`) a přesměrují tam.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const REZIMY = [
  { klic: 'rychly', nazev: 'Rychlý' },
  { klic: 'pruvodce', nazev: 'Průvodce' },
  { klic: 'kampan', nazev: 'Kampaň' },
] as const

type Fotka = { id: string; nazev_souboru: string; cesta: string; alt_text: string }

export default async function Tvorba({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ rezim?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams
  const rezimZadany = (await searchParams).rezim
  const rezim = REZIMY.some((r) => r.klic === rezimZadany) ? rezimZadany! : 'rychly'

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  }

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Nový obsah vytvoří ten, kdo má právo „Spravovat marketing“.
      </Sdeleni>
    )
  }
  if (!pristup.scope.branchId) {
    return (
      <Sdeleni nadpis="Vyberte provozovnu">
        Příspěvek vždycky patří pobočce — přepněte se na tu, pro kterou ho připravujete.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const knihovnaDotaz = await supabase
    .from('marketing_media')
    .select('id, nazev_souboru, cesta, alt_text')
    .eq('tenant_id', tenantId)
    .is('archivovano_kdy', null)
    .order('vytvoreno_kdy', { ascending: false })
    .limit(60)

  const knihovna: Fotka[] = tabulkaNeexistuje(knihovnaDotaz.error)
    ? []
    : await seznam<Fotka>('knihovna fotek', Promise.resolve(knihovnaDotaz))

  const nahledy = new Map<string, string>()
  if (knihovna.length > 0) {
    const podepsane = await supabase.storage
      .from(KBELIK)
      .createSignedUrls(knihovna.map((f) => f.cesta), PLATNOST_ODKAZU_S)
    for (const s of podepsane.data ?? []) {
      if (s.signedUrl && s.path) nahledy.set(s.path, s.signedUrl)
    }
  }

  const sablonyDotaz = await supabase
    .from('marketing_sablony')
    .select('klic, nazev, poradi')
    .eq('tenant_id', tenantId)
    .eq('aktivni', true)
    .order('poradi')

  const sablonyRadky = tabulkaNeexistuje(sablonyDotaz.error)
    ? []
    : await seznam<{ klic: string; nazev: string }>('šablony', Promise.resolve(sablonyDotaz))

  const sablony: SablonaVolba[] = sablonyRadky
    .map((s) => {
      const def = sablona(s.klic)
      return def ? { klic: s.klic, nazev: s.nazev || def.name, kategorie: def.category } : null
    })
    .filter((s): s is SablonaVolba => s !== null)

  const menuDotaz = await supabase
    .from('marketing_menu')
    .select('id, nazev, druh')
    .eq('tenant_id', tenantId)
    .eq('branch_id', pristup.scope.branchId)
    .eq('stav', 'potvrzeno')
    .order('plati_od', { ascending: false })
    .limit(30)

  const menu: MenuVolba[] = tabulkaNeexistuje(menuDotaz.error)
    ? []
    : await seznam<MenuVolba>('potvrzená menu', Promise.resolve(menuDotaz))

  const mediaGrid = (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend style={popisek}>
        {rezim === 'rychly' ? 'Fotka — bez ní rychlý příspěvek nejde založit.' : 'Podklady (nepovinné)'}
      </legend>
      {knihovna.length === 0 ? (
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
          V knihovně zatím nic není. <Link href={`/${rozsah}/marketing/media`}>Nahrát fotku</Link>
        </p>
      ) : (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
          {knihovna.map((f) => (
            <label key={f.id} style={{ display: 'grid', gap: '4px', width: '96px', fontSize: '12px', cursor: 'pointer' }}>
              {nahledy.get(f.cesta) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={nahledy.get(f.cesta)}
                  alt={f.alt_text || f.nazev_souboru}
                  width={96}
                  height={96}
                  style={{ objectFit: 'cover', borderRadius: '8px', background: 'var(--bg)' }}
                />
              ) : (
                <div style={{ width: '96px', height: '96px', borderRadius: '8px', background: 'var(--bg)' }} />
              )}
              <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="checkbox" name="media" value={f.id} />
                {f.nazev_souboru.slice(0, 12)}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )

  const kanalyPole = (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: '14px' }}>
      <legend style={{ ...popisek, width: '100%' }}>Kam se pošle</legend>
      {KANALY.map((k) => (
        <label key={k.klic} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
          <input type="checkbox" name="kanaly" value={k.klic} defaultChecked />
          {k.nazev}
        </label>
      ))}
    </fieldset>
  )

  return (
    <>
      <Nadpis oci="Marketing" popis="Vytvořit obsah — tři cesty, jeden výsledek: návrh čekající na úpravu a schválení.">
        Vytvořit obsah
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {REZIMY.map((r) => (
            <a
              key={r.klic}
              href={`/${rozsah}/marketing/tvorba?rezim=${r.klic}`}
              className="ft-tl ft-tl-male"
              style={r.klic === rezim ? { borderColor: 'var(--mosaz)' } : undefined}
              aria-current={r.klic === rezim ? 'page' : undefined}
            >
              {r.nazev}
            </a>
          ))}
        </div>

        {rezim === 'kampan' ? (
          <div style={karta}>
            <h2 style={{ margin: '0 0 6px', fontSize: '16px' }}>Kampaň — cíl a termín, série se vyrobí sama</h2>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
              Kampaně, jejich série (pozvánka → připomínka → poslední výzva → poděkování) a
              opakovaná automatizace mají vlastní obrazovku — je hotová, žije jinde v modulu.
            </p>
            <Link href={`/${rozsah}/marketing/kampane`} className="ft-tl ft-tl-hlavni">
              Otevřít Kampaně
            </Link>
          </div>
        ) : (
          <form action={vytvoritZTvorby} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="rezim" value={rezim} />

            <div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {rezim === 'rychly'
                  ? 'Vyberte fotku a napište jednu větu. AI z toho hned připraví návrh textu — upravíte a schválíte ho na dalším kroku.'
                  : 'Vyberte podklady a šablonu, vyplňte co šablona potřebuje. AI z toho připraví první návrh — zbytek (editor, schválení, termín) je na dalším kroku.'}
              </p>
            </div>

            <label>
              <span style={popisek}>Interní název (nepovinný, uvidí ho jen tým)</span>
              <input name="nazev" style={pole} placeholder="např. Páteční svíčková" />
            </label>

            {mediaGrid}

            {rezim === 'pruvodce' ? (
              sablony.length === 0 ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--mosaz)' }}>
                  Zatím nemáte žádnou zapnutou šablonu. <Link href={`/${rozsah}/marketing/sablony`}>Načíst doporučené</Link>.
                </p>
              ) : (
                <VyberSablony sablony={sablony} menu={menu} />
              )
            ) : null}

            <label>
              <span style={popisek}>
                {rezim === 'rychly' ? 'Co se má napsat' : 'Doplňte, co šablona nepokryje (nepovinné)'}
              </span>
              <textarea
                name="pokyn"
                rows={3}
                style={{ ...pole, resize: 'vertical' }}
                placeholder="Například: pozvánka na svíčkovou v pátek, vaříme ji podle babiččiny receptury"
              />
            </label>

            {kanalyPole}

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Vytvořit návrh</button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
