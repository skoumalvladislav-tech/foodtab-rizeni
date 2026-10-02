import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getContext, getUser, hasAccess, isModuleActive } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Card from '@/components/ui/Card'
import Nadpis from '../nadpis'
import { cenaZaJednotku } from './cena'

export const dynamic = 'force-dynamic'

/**
 * Suroviny — katalog firmy a poslední nákupní cena každé z nich.
 *
 * Zadání: supabase/migrations/20261002100000_sklad_suroviny_zaklad.sql.
 * Surovina nemá branch_id (sdílená napříč pobočkami, jako recipes) —
 * proto se oprávnění ověřuje vždycky s pobočkou `null`
 * (`hasAccess(tenantId, právo, null)`), ne s tou z adresy. Stejný důvod,
 * proč `app/[rozsah]/finance/faktury/layout.tsx` kreslí Faktury jen na
 * firemní úrovni — pobočkové členství by appka pustila dál, ale zápis
 * (a u ingredients i čtení skrz `can_read_scoped(..., null)`) by na
 * pobočkovém rozsahu v databázi neprošel.
 */

type Surovina = { id: string; name: string; base_unit: string }
type Cena = { ingredient_id: string; unit_price_haleru: number; valid_from: string }

export default async function Suroviny({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; stav?: string }>
}) {
  const { rozsah } = await params
  const { chyba, stav } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const uzivatel = await getUser()
  if (!uzivatel) redirect(await odkazNaPrihlaseni())

  const ctx = await getContext(tenantId)
  if (!ctx || !isModuleActive(ctx, 'objednavky')) {
    return (
      <Sdeleni nadpis="Modul Objednávky není zapnutý">
        Suroviny patří do modulu Objednávky — bez něj se obrazovka
        neotvírá.
      </Sdeleni>
    )
  }

  const smiCist = await hasAccess(tenantId, 'purchasing.read', null)
  if (!smiCist) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Suroviny vidí ten, kdo má právo <code>purchasing.read</code>.
      </Sdeleni>
    )
  }
  const smiZapisovat = await hasAccess(tenantId, 'purchasing.manage', null)

  const supabase = await getServerSupabase()

  const { data: surovinyData, error: chybaSurovin } = await supabase
    .from('ingredients')
    .select('id, name, base_unit')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')

  if (chybaSurovin && tabulkaNeexistuje(chybaSurovin)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Katalog surovin a jejich poslední nákupní ceny.">
          Suroviny
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Katalog surovin přibude migrací{' '}
            <code>20261002100000_sklad_suroviny_zaklad</code>.
          </p>
        </div>
      </>
    )
  }
  if (chybaSurovin) throw new DotazSelhal('suroviny', chybaSurovin)
  const suroviny = (surovinyData ?? []) as Surovina[]

  const posledniCeny = new Map<string, Cena>()
  if (suroviny.length > 0) {
    const { data: cenyData, error: chybaCen } = await supabase
      .from('ingredient_purchase_prices')
      .select('ingredient_id, unit_price_haleru, valid_from')
      .eq('tenant_id', tenantId)
      .in('ingredient_id', suroviny.map((s) => s.id))
      .order('valid_from', { ascending: false })

    if (chybaCen) throw new DotazSelhal('nákupní ceny surovin', chybaCen)

    // Řádky chodí od nejnovějšího `valid_from` — první výskyt pro
    // danou surovinu je tak ta poslední platná cena.
    for (const c of (cenyData ?? []) as Cena[]) {
      if (!posledniCeny.has(c.ingredient_id)) posledniCeny.set(c.ingredient_id, c)
    }
  }

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis="Katalog surovin a jejich poslední nákupní ceny."
        vpravo={
          smiZapisovat ? (
            <Link href={`/${rozsah}/suroviny/nova`} className="ft-tl ft-tl-hlavni ft-tl-male">
              + Nová surovina
            </Link>
          ) : undefined
        }
      >
        Suroviny
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
        {stav === 'smazana' ? (
          <p style={{ margin: '0 0 16px', fontSize: '14px', color: 'var(--dobre)' }}>
            Surovina smazána.
          </p>
        ) : null}

        {suroviny.length === 0 ? (
          <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
            Zatím žádná surovina v katalogu.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }}>
            {suroviny.map((s) => {
              const cena = posledniCeny.get(s.id)
              return (
                <Card as="li" key={s.id} padding="0">
                  <Link
                    href={`/${rozsah}/suroviny/${s.id}`}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '14px 16px',
                      color: 'inherit',
                      textDecoration: 'none',
                    }}
                  >
                    <span style={{ fontSize: '15px' }}>
                      {s.name} <span style={{ color: 'var(--muted)', fontSize: '13px' }}>({s.base_unit})</span>
                    </span>
                    <span style={{ fontSize: '14px', color: cena ? 'var(--ink)' : 'var(--muted)' }}>
                      {cena ? cenaZaJednotku(cena.unit_price_haleru, s.base_unit) : 'bez ceny'}
                    </span>
                  </Link>
                </Card>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function popisChyby(kod: string): string {
  switch (kod) {
    case 'nenalezena':
      return 'Tahle surovina už v katalogu není.'
    default:
      return 'Něco se nepovedlo. Zkuste to prosím znovu.'
  }
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
