import { redirect } from 'next/navigation'

import { getContext, getUser, hasAccess, isModuleActive } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Card from '@/components/ui/Card'
import Nadpis from '../../nadpis'
import { prejmenovatSurovinu, pridatCenu, smazatSurovinu } from '../akce'
import { cenaBaleni, cenaZaJednotku } from '../cena'
import { jednotkyBaleni, type ZakladniJednotka } from '../jednotky'
import SmazatTlacitko from './smazat-tlacitko'

export const dynamic = 'force-dynamic'

const JE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SurovinaDetail = {
  id: string
  name: string
  base_unit: ZakladniJednotka
  density_g_per_ml: number | null
  weight_g_per_ks: number | null
}

type CenaRadek = {
  id: string
  supplier_name: string
  package_description: string
  package_amount: number
  package_price_haleru: number
  unit_price_haleru: number
  valid_from: string
}

/**
 * Detail suroviny — základní údaje, historie nákupních cen (immutabilní,
 * jen přidávání) a formulář na novou cenu.
 *
 * `base_unit` se needituje: jakmile existuje jedna cena nebo vazba
 * z receptury, změna by rozbila dopočet nákladu (app.recipe_cost_per_portion)
 * i staré řádky historie — proto se v téhle obrazovce k editaci
 * nenabízí vůbec, ne jen podmíněně.
 */
export default async function SurovinaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; surovina: string }>
  searchParams: Promise<{ chyba?: string; stav?: string }>
}) {
  const { rozsah, surovina } = await params
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

  // `null` schválně — surovina je sdílená napříč pobočkami, ne pobočková
  // věc; viz komentář v akce.ts.
  const smiCist = await hasAccess(tenantId, 'purchasing.read', null)
  if (!smiCist) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Suroviny vidí ten, kdo má právo <code>purchasing.read</code>.
      </Sdeleni>
    )
  }
  const smiZapisovat = await hasAccess(tenantId, 'purchasing.manage', null)

  if (!JE_UUID.test(surovina)) {
    return (
      <Sdeleni nadpis="Surovina nenalezena">
        Zkontrolujte adresu, nebo se vraťte na seznam surovin.
      </Sdeleni>
    )
  }

  const supabase = await getServerSupabase()

  const { data: surovinaData, error: chybaSuroviny } = await supabase
    .from('ingredients')
    .select('id, name, base_unit, density_g_per_ml, weight_g_per_ks')
    .eq('id', surovina)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (chybaSuroviny) throw new DotazSelhal('surovina', chybaSuroviny)
  if (!surovinaData) {
    return (
      <Sdeleni nadpis="Surovina nenalezena">
        Buď neexistuje, nebo byla smazána.
      </Sdeleni>
    )
  }
  const data = surovinaData as SurovinaDetail

  const { data: cenyData, error: chybaCen } = await supabase
    .from('ingredient_purchase_prices')
    .select('id, supplier_name, package_description, package_amount, package_price_haleru, unit_price_haleru, valid_from')
    .eq('tenant_id', tenantId)
    .eq('ingredient_id', surovina)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })

  if (chybaCen) throw new DotazSelhal('historie cen suroviny', chybaCen)
  const ceny = (cenyData ?? []) as CenaRadek[]

  const jednotkyNabidky = jednotkyBaleni(data.base_unit)
  const dnesIso = new Date().toISOString().slice(0, 10)

  return (
    <>
      <Nadpis oci="Provoz" popis="Základní údaje, historie nákupních cen a nová cena.">
        {data.name}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '640px', display: 'grid', gap: '20px' }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}
        {stav ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>{popisStavu(stav)}</p>
        ) : null}

        <Card>
          <h2 style={nadpisSekce}>Základní údaje</h2>

          {smiZapisovat ? (
            <form action={prejmenovatSurovinu} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="surovina" value={data.id} />
              <label style={{ display: 'grid', gap: '4px', flex: '1 1 240px' }}>
                <span style={popisek}>Název</span>
                <input name="nazev" type="text" defaultValue={data.name} required maxLength={120} style={pole} />
              </label>
              <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                Uložit
              </button>
            </form>
          ) : null}

          <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
            Základní jednotka: <strong>{data.base_unit}</strong>. Nedá se
            změnit — jakmile má surovina cenu nebo je napojená na
            recepturu, změna jednotky by rozbila dopočet.
          </p>
          {data.density_g_per_ml ? (
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              Hustota: {data.density_g_per_ml} g/ml
            </p>
          ) : null}
          {data.weight_g_per_ks ? (
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
              Hmotnost kusu: {data.weight_g_per_ks} g
            </p>
          ) : null}

          {smiZapisovat ? (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
              <SmazatTlacitko akce={smazatSurovinu} rozsah={rozsah} surovina={data.id} />
              <p style={{ margin: '8px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                Nejde, pokud ji používá nějaká receptura.
              </p>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 style={nadpisSekce}>Historie nákupních cen</h2>

          {ceny.length === 0 ? (
            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>Zatím žádná cena.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
              {ceny.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: '6px',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--line)',
                    fontSize: '13.5px',
                  }}
                >
                  <span>
                    <strong>{platneOd(c.valid_from)}</strong>
                    {' · '}
                    {c.supplier_name || 'bez dodavatele'}
                    {c.package_description ? ` · ${c.package_description}` : ''}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>
                    {cenaBaleni(c.package_price_haleru)} · {cenaZaJednotku(c.unit_price_haleru, data.base_unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p style={{ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
            Historie se needituje ani nemaže — oprava jde novým řádkem.
          </p>
        </Card>

        {smiZapisovat ? (
          <Card>
            <h2 style={nadpisSekce}>+ Přidat cenu</h2>
            <form action={pridatCenu} style={{ display: 'grid', gap: '14px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="surovina" value={data.id} />

              <label style={poleLabel}>
                <span>Dodavatel</span>
                <input name="dodavatel" type="text" maxLength={120} style={pole} />
              </label>

              <label style={poleLabel}>
                <span>Popis balení</span>
                <input name="popis_baleni" type="text" maxLength={160} placeholder="např. pytel 25 kg" style={pole} />
              </label>

              <div style={mrizka}>
                <label style={poleLabel}>
                  <span>Množství balení</span>
                  <input name="mnozstvi" type="number" min="0" step="0.001" required style={pole} />
                </label>

                <label style={poleLabel}>
                  <span>Jednotka balení</span>
                  <select name="baleno_v" defaultValue={jednotkyNabidky[0]} style={pole}>
                    {jednotkyNabidky.map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={poleLabel}>
                  <span>Cena balení (Kč)</span>
                  <input name="cena_kc" type="number" min="0" step="0.01" required style={pole} />
                </label>

                <label style={poleLabel}>
                  <span>Platnost od</span>
                  <input name="platnost_od" type="date" defaultValue={dnesIso} style={pole} />
                </label>
              </div>

              <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male" style={{ justifySelf: 'start' }}>
                Přidat cenu
              </button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function platneOd(datum: string): string {
  const [r, m, d] = datum.split('-')
  return `${d}. ${m}. ${r}`
}

function popisChyby(kod: string): string {
  switch (kod) {
    case 'neuplne':
      return 'Vyplňte název.'
    case 'duplicitni':
      return 'Surovina s tímhle názvem už existuje.'
    case 'mnozstvi':
      return 'Množství balení musí být kladné číslo ve správné jednotce.'
    case 'cena':
      return 'Cena balení musí být kladné číslo v korunách (max. na haléře).'
    case 'pouzita-v-receptu':
      return 'Tuhle surovinu používá nějaká receptura, proto se nedá smazat.'
    case 'pravo':
      return 'Na tuhle změnu nemáte právo.'
    default:
      return 'Uložení se nepovedlo. Zkuste to prosím znovu.'
  }
}

function popisStavu(kod: string): string {
  switch (kod) {
    case 'prejmenovana':
      return 'Název uložen.'
    case 'cena-pridana':
      return 'Cena přidána.'
    default:
      return ''
  }
}

const nadpisSekce = { margin: '0 0 12px', fontSize: '16px', color: 'var(--ink)' } as const

const popisek = { fontSize: '13px', color: 'var(--muted)' } as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
}

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
}

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: '12px',
  alignItems: 'start',
} as const
