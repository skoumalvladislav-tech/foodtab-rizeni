import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import {
  nadpisUpozorneni,
  popisOpravneni,
  popisZapomenuteho,
  type TeloUpozorneni,
} from '@/lib/upozorneni-text'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import { oznacitPrectene } from './akce'

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
  const { data, error } = await supabase
    .from('notifications')
    .select('id, druh, telo, created_at, read_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50)

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

  const zpravy = (data ?? []) as Zprava[]
  const neprectene = zpravy.filter((z) => !z.read_at).length

  return (
    <>
      <Nadpis oci="Provoz" popis="Co se změnilo a týká se vás. Cizí směny se sem nedostanou.">
        Upozornění
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        {neprectene > 0 ? (
          <form action={oznacitPrectene} style={{ marginBottom: '16px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <button type="submit" className="ft-tl ft-tl-vedlejsi">
              Označit {neprectene === 1 ? 'jedno' : `všech ${neprectene}`} za přečtené
            </button>
          </form>
        ) : null}

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
                    {nadpisUpozorneni(z.druh, z.telo, obdobi)}
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

                {z.druh === 'opravneni.prideleno' ? (
                  <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--muted)' }}>
                    {[z.telo.role, z.telo.firma].filter(Boolean).join(' · ')}
                  </p>
                ) : null}

                <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: '4px' }}>
                  {(z.telo.zmeny ?? []).map((zm, i) => (
                    <li key={i} style={{ fontSize: '14px' }}>
                      <strong>{den(zm.den)}</strong>{' '}
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

function obdobi(od?: string, doKdy?: string): string {
  if (!od || !doKdy) return ''
  return `${den(od)} – ${den(doKdy)}`
}

/** „st 10. 9.“ — den v týdnu pomáhá víc než datum samotné. */
function den(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const dny = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']
  return `${dny[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`
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
  borderRadius: '12px',
  padding: '14px 16px',
  boxShadow: 'var(--shadow)',
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const
