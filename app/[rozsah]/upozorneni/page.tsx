import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { sloupecNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import {
  denZkraceny,
  kartaZmenySmeny,
  nadpisUpozorneni,
  obdobiRozpisu,
  popisMarketingu,
  popisOpravneni,
  popisPinu,
  popisZapomenuteho,
  prioritaUpozorneni,
  vyzadujePotvrzeni,
  odkazNaSmenu,
  zmenaSmeny,
  type TeloUpozorneni,
} from '@/lib/upozorneni-text'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import { oznacitPrectene, potvrditZmenu } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Upozornění
 *
 * Kanál „v aplikaci“ podle docs/upozorneni-smeny-zadani.md, oddíl 4. Je
 * to jediný kanál, který nemůže selhat, a proto se nedá vypnout —
 * je to záznam, ne oznámení. E-mail a push přijdou později.
 *
 * Každý vidí jen svoje. Ani majitel cizí upozornění nevidí: dozvěděl by
 * se z nich, kdo kdy dělá.
 */

/**
 * Tělo upozornění. Holé údaje — věty se skládají v lib/upozorneni-text.
 *
 * Ty věty tu stály taky, jenže obrazovku nejde vykreslit mimo aplikaci
 * a nešly ověřit. Teď na ně sahá scripts/upozorneni.test.mjs.
 */
type Telo = TeloUpozorneni & {
  zmeny?: { den: string; zmena: string; od: string; do: string; drive_od: string | null; drive_do: string | null }[]
}

type Zprava = {
  id: string
  druh: string
  telo: Telo
  created_at: string
  read_at: string | null
  // Migrace 20260917010000 — chybí, dokud neproběhne (viz níž).
  acknowledged_at: string | null
  // Migrace 20260919120000 — odkaz na směnu; chybí do jejího nasazení.
  shift_id: string | null
  // Migrace 20260917040000; normal, když chybí.
  priorita?: string | null
}

const NAZVY: Record<string, string> = {
  nova: 'nová',
  cas: 'změna času',
  prevzata: 'nově přidělená',
  odebrana: 'odebraná',
  zrusena: 'zrušená',
}

export default async function Upozorneni({
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

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const supabase = await getServerSupabase()
  const dotazNaUpozorneni = (sloupce: string) =>
    supabase
      .from('notifications')
      .select(sloupce)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)

  /*
    Sloupce přidávají migrace, které se nasazují ručně, kód se nasazuje
    sám: dokud migrace neproběhne, dotaz na nový sloupec spadne. Stránka
    proto zkouší od nejnovějšího stavu k nejstaršímu a vždycky se
    vykreslí. Stejný vzor jako jinde v appce (viz smeny/page.tsx).

      1. + shift_id            (20260919120000)
      2. + acknowledged_at     (20260917010000)
      3. základ
  */
  let { data, error } = await dotazNaUpozorneni(
    'id, druh, telo, created_at, read_at, acknowledged_at, shift_id, priorita',
  )
  let maSmenu = true
  let maPotvrzeni = true
  if (error && sloupecNeexistuje(error)) {
    maSmenu = false
    ;({ data, error } = await dotazNaUpozorneni('id, druh, telo, created_at, read_at, acknowledged_at'))
  }
  if (error && sloupecNeexistuje(error)) {
    maPotvrzeni = false
    ;({ data, error } = await dotazNaUpozorneni('id, druh, telo, created_at, read_at'))
  }

  if (tabulkaNeexistuje(error)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Co se změnilo a týká se vás.">
          Upozornění
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Upozornění přibudou migrací <code>20260901130000_vydani_rozpisu</code>.
          </p>
        </div>
      </>
    )
  }

  const zpravy = ((data ?? []) as unknown as Record<string, unknown>[]).map((z) => ({
    ...z,
    acknowledged_at: maPotvrzeni ? ((z.acknowledged_at as string | null) ?? null) : null,
    shift_id: maSmenu ? ((z.shift_id as string | null) ?? null) : null,
  })) as unknown as Zprava[]
  const neprectene = zpravy.filter((z) => !z.read_at).length

  return (
    <>
      <Nadpis oci="Provoz" popis="Co se změnilo a týká se vás. Cizí směny se sem nedostanou.">
        Upozornění
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {neprectene > 0 ? (
            <form action={oznacitPrectene}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <button type="submit" className="ft-tl ft-tl-vedlejsi">
                Označit {neprectene === 1 ? 'jedno' : `všech ${neprectene}`} za přečtené
              </button>
            </form>
          ) : null}
          <Link href={`/${rozsah}/upozorneni/nastaveni`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            Nastavení upozornění
          </Link>
        </div>

        {zpravy.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Zatím tu nic není. Objeví se tu změna na vašich směnách,
            přidělené oprávnění nebo to, že někdo přijal pozvánku.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px' }}>
            {zpravy.map((z) => (
              <li
                key={z.id}
                style={{
                  ...karta,
                  borderColor: z.read_at ? 'var(--line)' : 'var(--mosaz)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '15px' }}>
                    {prioritaUpozorneni(z.priorita) === 'urgent' || prioritaUpozorneni(z.priorita) === 'important' ? (
                      <span className="pc-stitek" data-druh={prioritaUpozorneni(z.priorita)}>
                        {prioritaUpozorneni(z.priorita) === 'urgent' ? 'NALÉHAVÉ' : 'DŮLEŽITÉ'}
                      </span>
                    ) : null}
                    {nadpisUpozorneni(z.druh, z.telo, obdobiRozpisu)}
                  </strong>
                  <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                    {z.read_at ? 'přečteno' : 'nové'}
                  </span>
                </div>

                {/*
                  Přijatá pozvánka: dvě různé situace, dva různé texty.
                  Kdo čeká na oprávnění, je ÚKOL a má u sebe cestu ke
                  splnění; kdo je má, je informace. Nesmí vypadat stejně.
                */}
                {z.druh === 'pozvanka.prijata' ? (
                  z.telo.ceka ? (
                    <>
                      <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                        Dokud mu oprávnění nepřidělíte, v aplikaci neuvidí
                        nic než své údaje.
                      </p>
                      <p style={{ margin: '10px 0 0' }}>
                        <Link
                          href={`/${rozsah}/nastaveni/lide?clovek=${z.telo.kdo ?? ''}`}
                          className="ft-tl ft-tl-hlavni ft-tl-male"
                        >
                          Přidělit oprávnění
                        </Link>
                      </p>
                    </>
                  ) : (
                    <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>
                      {popisOpravneni(z.telo)}
                    </p>
                  )
                ) : null}

                {/*
                  Zapomenutý odchod. Tlačítko vede rovnou na
                  PŘEDVYPLNĚNÝ FORMULÁŘ té směny, ne na Docházku obecně
                  — cesta ke splnění úkolu má být jedno kliknutí
                  (zadání, oddíl 2).
                */}
                {z.druh === 'dochazka.zapomenuty_odchod' ? (
                  <>
                    <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                      {popisZapomenuteho(z.telo)}
                    </p>
                    {z.telo.pobocka_slug && z.telo.zamestnanec && z.telo.den ? (
                      <p style={{ margin: '10px 0 0' }}>
                        <Link
                          href={`/${z.telo.pobocka_slug}/dochazka?doplnit=${z.telo.zamestnanec}&den=${z.telo.den}`}
                          className="ft-tl ft-tl-hlavni ft-tl-male"
                        >
                          Doplnit odchod
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) : null}

                {z.druh === 'ukol.pridelen' ? (
                  <>
                    {z.telo.termin ? (
                      <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>
                        Termín: {z.telo.termin.slice(0, 10).split('-').reverse().map(Number).join('. ')}
                        {z.telo.termin.length >= 16 ? ` ${z.telo.termin.slice(11, 16)}` : ''}
                      </p>
                    ) : null}
                    {z.telo.ukol ? (
                      <p style={{ margin: '10px 0 0' }}>
                        <Link href={`/${rozsah}/ukoly/ukol/${z.telo.ukol}`} className="ft-tl ft-tl-hlavni ft-tl-male">
                          Otevřít úkol
                        </Link>
                      </p>
                    ) : null}
                  </>
                ) : null}

                {z.druh === 'pin.prenastaven' ? (
                  <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                    {popisPinu(z.telo)}
                  </p>
                ) : null}

                {/*
                  MARKETING. Tlačítko vede rovnou na to místo, kde se
                  s tím dá něco udělat — u žádosti do fronty ke
                  schválení, u vrácení a selhání do příspěvku. Cesta ke
                  splnění úkolu má být jedno kliknutí, stejně jako
                  u zapomenutého odchodu.
                */}
                {z.druh.startsWith('marketing.') ? (
                  <>
                    <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                      {popisMarketingu(z.druh, z.telo)}
                    </p>
                    <p style={{ margin: '10px 0 0' }}>
                      <Link
                        href={
                          z.druh === 'marketing.zadost'
                            ? `/${rozsah}/marketing/schvalovani`
                            : `/${rozsah}/marketing/${z.telo.prispevek ?? ''}`
                        }
                        className="ft-tl ft-tl-hlavni ft-tl-male"
                      >
                        {z.druh === 'marketing.zadost' ? 'Otevřít frontu ke schválení'
                          : z.druh === 'marketing.publikace_selhala' ? 'Otevřít příspěvek'
                            : 'Otevřít příspěvek'}
                      </Link>
                    </p>
                  </>
                ) : null}

                {(z.druh === 'oznameni.nova' || z.druh === 'vzkaz.novy') ? (
                  <p style={{ margin: '10px 0 0' }}>
                    <Link
                      href={`/${rozsah}/vzkazy${z.druh === 'oznameni.nova' ? '?zalozka=nastenka' : ''}`}
                      className="ft-tl ft-tl-hlavni ft-tl-male"
                    >
                      {z.druh === 'oznameni.nova' ? 'Otevřít nástěnku' : 'Otevřít vzkazy'}
                    </Link>
                  </p>
                ) : null}

                {z.druh === 'smena.zmenena' && kartaZmenySmeny(z.telo) ? (
                  <div className="pc-karta-zmeny" style={{ margin: '10px 0 0' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '.08em', color: 'var(--mosaz)' }}>
                      {kartaZmenySmeny(z.telo)?.nadpis}
                    </p>
                    <p className="ds-serif" style={{ margin: '4px 0 8px', fontSize: '19px', fontWeight: 600 }}>
                      {kartaZmenySmeny(z.telo)?.den}
                    </p>
                    <dl className="pc-udaje">
                      <dt>Původně</dt>
                      <dd style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>
                        {kartaZmenySmeny(z.telo)?.puvodne}
                      </dd>
                      <dt>Nově</dt>
                      <dd><strong>{kartaZmenySmeny(z.telo)?.nove}</strong></dd>
                      {kartaZmenySmeny(z.telo)?.zmenil ? (
                        <>
                          <dt>Změnil</dt>
                          <dd>{kartaZmenySmeny(z.telo)?.zmenil}</dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                ) : null}

                {(z.druh === 'smena.nova' || (z.druh === 'smena.zmenena' && !kartaZmenySmeny(z.telo)) ||
                  z.druh === 'smena.odebrana' || z.druh === 'smena.zrusena') &&
                  z.telo.od && z.telo.do ? (
                  <p
                    style={{
                      margin: '8px 0 0',
                      fontSize: '14px',
                      color: 'var(--muted)',
                      textDecoration:
                        z.druh === 'smena.odebrana' || z.druh === 'smena.zrusena'
                          ? 'line-through'
                          : undefined,
                    }}
                  >
                    {/*
                      U změny „původně → nově“, když upozornění nese původní
                      stav (od 19. 9.); starší ukážou jen nový čas.
                    */}
                    {z.druh === 'smena.zmenena' && zmenaSmeny(z.telo) ? (
                      <>
                        <span style={{ textDecoration: 'line-through' }}>
                          {zmenaSmeny(z.telo)?.puvodne}
                        </span>{' '}
                        → <strong style={{ color: 'var(--ink)' }}>{zmenaSmeny(z.telo)?.nove}</strong>
                      </>
                    ) : (
                      <>
                        {cas(z.telo.od)}–{cas(z.telo.do)}
                      </>
                    )}
                  </p>
                ) : null}

                {/*
                  Zobrazit směnu — rovnou detail, ne jen rozpis. Odebraná a
                  zrušená se neodkazují: směna už není jeho, není co otevřít.
                */}
                {(z.druh === 'smena.nova' || z.druh === 'smena.zmenena') && z.telo.den ? (
                  <p style={{ margin: '8px 0 0' }}>
                    <Link
                      href={odkazNaSmenu(rozsah, z.telo, z.shift_id)}
                      className="ft-tl ft-tl-vedlejsi ft-tl-male"
                    >
                      Detail směny
                    </Link>
                  </p>
                ) : null}

                {/*
                  Potvrzení — jen zmenena/zrusena (vyzadujePotvrzeni,
                  jediné místo s tímhle pravidlem). Nenasazená migrace
                  se promíjí stejně jako jinde: dokud sloupec není,
                  acknowledged_at je vždycky null a tlačítko prostě
                  zůstane nabídnuté — nezpůsobí to chybu, jen se
                  potvrzení neuloží, dokud Šéfík nenasadí.
                */}
                {vyzadujePotvrzeni(z.druh) ? (
                  z.acknowledged_at ? (
                    <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--dobre)' }}>
                      ✓ potvrzeno
                    </p>
                  ) : (
                    <form action={potvrditZmenu} style={{ margin: '10px 0 0' }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="id" value={z.id} />
                      <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                        Potvrdit
                      </button>
                    </form>
                  )
                ) : null}

                {z.druh === 'opravneni.prideleno' ? (
                  <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>
                    {[z.telo.role, z.telo.firma].filter(Boolean).join(' · ')}
                  </p>
                ) : null}

                <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: '4px' }}>
                  {(z.telo.zmeny ?? []).map((zm, i) => (
                    <li key={i} style={{ fontSize: '14px' }}>
                      <strong>{denZkraceny(zm.den)}</strong>{' '}
                      {zm.zmena === 'cas' && zm.drive_od ? (
                        <>
                          <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>
                            {cas(zm.drive_od)}–{cas(zm.drive_do)}
                          </span>{' '}
                          → {cas(zm.od)}–{cas(zm.do)}
                        </>
                      ) : (
                        <>
                          {cas(zm.od)}–{cas(zm.do)}
                        </>
                      )}{' '}
                      <span
                        style={{
                          color: zm.zmena === 'zrusena' || zm.zmena === 'odebrana'
                            ? 'var(--bad)'
                            : 'var(--muted)',
                        }}
                      >
                        — {NAZVY[zm.zmena] ?? zm.zmena}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}


/** Z „07:30:00“ udělá „7:30“. */
function cas(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  return `${Number(h)}:${m}`
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  padding: '14px 16px',
  boxShadow: 'var(--shadow)',
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const
