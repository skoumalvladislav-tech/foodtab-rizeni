import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { provozniDen } from '@/lib/provozni-den'
import {
  predmetPrehledu,
  textPrehledu,
  type PrehledPobocky,
} from '@/lib/ranni-prehled'
import { posunDatum } from '@/lib/provozni-den'
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { ulozitRanniEmail } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Firma
 *
 * Zatím jen ranní přehled (docs/kiosek-pin-zalohy-zadani.md, oddíl 8).
 * Ostatní nastavení firmy sem přibudou.
 *
 * VÝCHOZÍ HODNOTY JSOU PRÁZDNÉ. Žádnou adresu ani hodinu si aplikace
 * nevymýšlí — prázdný seznam znamená, že se neposílá, ne že se posílá
 * někam, kam si to nikdo nepřál.
 */

type Pobocka = {
  id: string
  name: string
  ranni_email_komu: string[] | null
}

export default async function NastaveniFirma({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; ulozeno?: string; nahled?: string }>
}) {
  const { rozsah } = await params
  const { chyba, ulozeno, nahled } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nastavení firmy spravuje ten, kdo má právo <code>settings.manage</code>.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  /*
    Dotaz se schválně nedělá přes `seznam()`: ten chybu zabalí do
    DotazSelhal a kód se dostane na `kod`, ne na `code`. Rozpoznávání
    nenasazené migrace by tím tiše přestalo fungovat a obrazovka by
    místo „čeká na nasazení“ padala na 500 — právě to se stalo.
  */
  const { data: pobockyData, error: chybaPobocek } = await supabase
    .from('branches')
    .select('id, name, ranni_email_komu')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .eq('active', true)
    .order('name')

  if (chybaPobocek && !sloupecNeexistuje(chybaPobocek)) {
    throw new DotazSelhal('pobočky firmy', chybaPobocek)
  }
  const pobocky = chybaPobocek ? null : ((pobockyData ?? []) as Pobocka[])

  const { data: nastaveni } = await supabase
    .from('tenant_settings')
    .select('ranni_email_kdy')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (pobocky === null) {
    return (
      <>
        <Nadpis oci="Nastavení" popis="Co platí pro celou firmu.">
          Firma
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Ranní přehled přibude migrací{' '}
            <code>20260901230000_ranni_prehled</code>.
          </p>
        </div>
      </>
    )
  }

  const cas = (nastaveni?.ranni_email_kdy as string | null) ?? ''

  /* --- náhled -------------------------------------------------------
     Ukazuje, co by ráno odešlo za VČEREJŠÍ provozní den. Neposílá nic.
     Bez náhledu se dá jediné: nastavit adresu a čekat do rána, jestli
     něco přijde a jestli to bude dávat smysl.
  */
  let nahledText: string | null = null
  if (nahled === 'ano' && pobocky.length > 0) {
    const dnes = await provozniDen(pobocky[0].id)
    const vcera = dnes ? posunDatum(dnes, -1) : null
    if (vcera) {
      const { data, error } = await supabase.rpc('ranni_prehled', {
        p_tenant: tenantId,
        p_den: vcera,
      })
      if (error && !funkceNeexistuje(error)) throw error
      if (!error) {
        const radky = (data ?? []) as PrehledPobocky[]
        nahledText =
          radky.length === 0
            ? 'Za včerejšek není co poslat.'
            : `Předmět: ${predmetPrehledu(vcera, radky)}\n\n${textPrehledu(vcera, radky)}`
      }
    }
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Co platí pro celou firmu. Zatím ranní přehled; ostatní přibude."
      >
        Firma
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '720px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {ulozeno === 'email' ? (
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--dobre)' }}>
            Uloženo.
          </p>
        ) : null}

        <h2 style={nadpis}>Ranní přehled</h2>
        <p style={popis}>
          Souhrn za <strong>minulý provozní den</strong> — kdo skončil ve
          2:15, patří do včerejška. Jsou v něm jen počty a částky za
          pobočku; jména, příchody a částky po lidech zůstávají
          v aplikaci. E-mail leží v cizí schránce a osobní údaje by tím
          z aplikace odešly nadobro.
        </p>
        <p style={popis}>
          Dokud není vyplněný čas a aspoň jedna adresa,{' '}
          <strong>neposílá se nic</strong>.
        </p>

        {pobocky.map((p) => (
          <form
            key={p.id}
            action={ulozitRanniEmail}
            style={{ ...karta, marginBottom: '12px' }}
          >
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="pobocka" value={p.id} />

            <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>{p.name}</h3>

            <div style={mrizka}>
              <label style={poleLabel}>
                <span>Komu</span>
                <input
                  name="komu"
                  defaultValue={(p.ranni_email_komu ?? []).join(', ')}
                  placeholder="zatím nikomu"
                  style={pole}
                />
                <span style={vysvetlivka}>
                  Víc adres oddělte čárkou. Prázdné = za tuhle pobočku se
                  neposílá.
                </span>
              </label>

              <label style={poleLabel}>
                <span>V kolik (platí pro celou firmu)</span>
                <input
                  name="cas"
                  type="time"
                  defaultValue={cas ? cas.slice(0, 5) : ''}
                  style={pole}
                />
              </label>
            </div>

            <button
              type="submit"
              className="ft-tl ft-tl-hlavni ft-tl-male"
              style={{ marginTop: '12px' }}
            >
              Uložit
            </button>
          </form>
        ))}

        <h2 style={{ ...nadpis, marginTop: '28px' }}>Jak to bude vypadat</h2>
        <p style={popis}>
          Náhled za včerejší provozní den. <strong>Nic neodesílá</strong> —
          jen ukáže text, který by ráno odešel.
        </p>
        <a
          href={`/${rozsah}/nastaveni/firma?nahled=ano`}
          className="ft-tl ft-tl-vedlejsi"
        >
          Ukázat náhled
        </a>

        {nahledText ? (
          <pre style={nahledStyl}>{nahledText}</pre>
        ) : null}

        <p style={{ ...popis, marginTop: '24px' }}>
          <strong>Odesílání zatím nikdo nespouští.</strong> Text i nastavení
          jsou hotové, ale úlohu, která přehled ráno pošle, je potřeba
          nastavit na serveru — spolu s klíčem k Resendu. Do té doby
          poslouží náhled.
        </p>
      </div>
    </>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px 18px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.55,
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '12px',
  alignItems: 'start',
} as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const vysvetlivka = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  textTransform: 'none' as const,
  letterSpacing: 'normal',
  lineHeight: 1.45,
} as const

const nahledStyl = {
  marginTop: '14px',
  padding: '14px 16px',
  background: 'var(--sunken)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  fontSize: '13.5px',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap' as const,
  color: 'var(--ink)',
  fontFamily: 'inherit',
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
