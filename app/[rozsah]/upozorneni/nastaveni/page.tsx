import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { ulozitNastaveni } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení upozornění.
 *
 * Jen dvě kategorie: vzkazy a nástěnka — obě informativní, kdo je
 * vypne, nic operačního nezmešká. Změny směn (smena.*) se tu VŮBEC
 * NENABÍZEJÍ, natož jako vypnutelné — noční zadání to výslovně
 * zakazuje. Není to jen "checkbox chybí v UI": app.upozorneni_povoleno
 * se z app.upozornit_smenu() nevolá vůbec, takže vypnutí nejde
 * obejít ani přímým zápisem do tabulky.
 */

type Kategorie = 'vzkazy' | 'nastenka'

const POPIS: Record<Kategorie, { nazev: string; vysvetleni: string }> = {
  vzkazy: {
    nazev: 'Zprávy a rozhovory',
    vysvetleni: 'Upozornění na novou zprávu v přímém rozhovoru nebo kanálu.',
  },
  nastenka: {
    nazev: 'Nástěnka',
    vysvetleni: 'Upozornění na nové oznámení na nástěnce.',
  },
}

export default async function NastaveniUpozorneni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ ulozeno?: string; chyba?: string }>
}) {
  const { rozsah } = await params
  const { ulozeno, chyba } = await searchParams

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
    .from('notification_preferences')
    .select('kategorie, povoleno')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)

  if (tabulkaNeexistuje(error)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Které kategorie upozornění chcete dostávat.">
          Nastavení upozornění
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Nastavení přibude migrací <code>20260917050000_nastaveni_upozorneni</code>.
          </p>
        </div>
      </>
    )
  }

  // Chybějící řádek = zapnuto (stejná výchozí hodnota jako v databázi,
  // app.upozorneni_povoleno) — obrazovka nesmí ukázat jiný stav, než
  // jaký doopravdy platí.
  const povoleno = new Map<Kategorie, boolean>([
    ['vzkazy', true],
    ['nastenka', true],
  ])
  for (const radek of (data ?? []) as { kategorie: string; povoleno: boolean }[]) {
    if (radek.kategorie === 'vzkazy' || radek.kategorie === 'nastenka') {
      povoleno.set(radek.kategorie, radek.povoleno)
    }
  }

  return (
    <>
      <Nadpis oci="Provoz" popis="Které kategorie upozornění chcete dostávat.">
        Nastavení upozornění
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '560px' }}>
        <p style={{ margin: '0 0 16px', fontSize: '13px' }}>
          <Link href={`/${rozsah}/upozorneni`} className="ft-tl ft-tl-vedlejsi ft-tl-male">
            ← Zpět na upozornění
          </Link>
        </p>

        {chyba ? (
          <p
            style={{
              margin: '0 0 16px',
              padding: '10px 12px',
              border: '1px solid var(--bad)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bad-bg)',
              color: 'var(--bad)',
              fontSize: '14px',
            }}
          >
            {chyba}
          </p>
        ) : ulozeno ? (
          <p
            style={{
              margin: '0 0 16px',
              padding: '10px 12px',
              border: '1px solid var(--dobre)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--dobre-bg)',
              color: 'var(--dobre)',
              fontSize: '14px',
            }}
          >
            Uloženo.
          </p>
        ) : null}

        <form action={ulozitNastaveni} style={{ display: 'grid', gap: '14px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />

          {(Object.keys(POPIS) as Kategorie[]).map((kat) => (
            <label
              key={kat}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                boxShadow: 'var(--shadow)',
              }}
            >
              <input
                type="checkbox"
                name={kat}
                value="ano"
                defaultChecked={povoleno.get(kat)}
                style={{ marginTop: '3px' }}
              />
              <span>
                <strong style={{ display: 'block', fontSize: '14px' }}>{POPIS[kat].nazev}</strong>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  {POPIS[kat].vysvetleni}
                </span>
              </span>
            </label>
          ))}

          {/*
            Informace, ne přepínač. Zadání výslovně zakazuje, aby šlo
            tohle vypnout — nabízet zaškrtávátko, které by beztak nic
            neudělalo, by bylo jen klamavé.
          */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              background: 'var(--sunken)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
            }}
          >
            <span aria-hidden style={{ marginTop: '1px' }}>🔒</span>
            <span>
              <strong style={{ display: 'block', fontSize: '14px' }}>Změny mých směn</strong>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                Vždycky zapnuto. Nová, změněná, odebraná nebo zrušená směna se
                nedá ztišit.
              </span>
            </span>
          </div>

          <div>
            <button type="submit" className="ft-tl ft-tl-hlavni">
              Uložit
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '14px',
} as const
