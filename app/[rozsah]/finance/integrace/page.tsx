import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { sifrovaniJeNastavene } from '@/lib/integrace-klice'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitPripojeni, odpojitPripojeni } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Integrace.
 *
 * Registr připojení k poskytovatelům (pokladna/banka/účetnictví/
 * e-mail dokladů) — stejný vzor jako marketing/nastroje, viditelný
 * všem s finance.read, správa jen finance.manage. Appka ŽÁDNÉHO
 * poskytovatele nepřipojuje živě: stav se ukazuje přesně tak, jak je
 * ("čeká na připojení", nikdy "připojeno" bez ověřeného přístupu).
 */

type Pripojeni = {
  id: string
  oblast: string
  poskytovatel: string
  rezim: string
  stav: string
  nazev: string
  odpojeno_kdy: string | null
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const NAZVY_OBLASTI: Record<string, string> = {
  pokladna: 'Pokladna (POS)',
  banka: 'Banka',
  ucetnictvi: 'Účetnictví',
  email_dokladu: 'E-mail dokladů',
}

const NAZVY_STAVU: Record<string, { text: string; barva: string; bg: string }> = {
  nepripojeno: { text: 'Čeká na připojení', barva: 'var(--muted)', bg: 'var(--sunken)' },
  pripojuje_se: { text: 'Připojuje se…', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
  pripojeno: { text: 'Připojeno', barva: 'var(--dobre)', bg: 'var(--dobre-bg)' },
  vyzaduje_pozornost: { text: 'Vyžaduje pozornost', barva: 'var(--pozor)', bg: 'var(--pozor-bg)' },
  chyba: { text: 'Chyba', barva: 'var(--bad)', bg: 'var(--bad-bg)' },
  odpojeno: { text: 'Odpojeno', barva: 'var(--muted)', bg: 'var(--sunken)' },
}

function Stitek({ stav }: { stav: string }) {
  const s = NAZVY_STAVU[stav] ?? NAZVY_STAVU.nepripojeno
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: s.bg, color: s.barva }}>
      {s.text}
    </span>
  )
}

export default async function FinanceIntegrace({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Integrace vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')

  const supabase = await getServerSupabase()
  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, oblast, poskytovatel, rezim, stav, nazev, odpojeno_kdy')
    .eq('tenant_id', tenantId)
    .is('odpojeno_kdy', null)
    .order('oblast')

  const pripojeni = (data ?? []) as Pripojeni[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Registr připojení k poskytovatelům. Žádné se nepřipojuje živě bez ověřeného přístupu."
        vpravo={<Link href={`/${rozsah}/finance/integrace/prodeje`} className="ft-tl">Import prodejů (pokladna) →</Link>}
      >
        Integrace
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        {pripojeni.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádná připojení.</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {pripojeni.map((p) => (
              <div key={p.id} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{p.nazev || p.poskytovatel}</strong>
                    <Stitek stav={p.stav} />
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '4px' }}>
                    {NAZVY_OBLASTI[p.oblast] ?? p.oblast} · {p.poskytovatel} · {p.rezim === 'zakaznicky' ? 'vlastní přístup' : p.rezim === 'csv' ? 'CSV import' : 'ukázková data'}
                  </div>
                </div>
                {smiPsat ? (
                  <form action={odpojitPripojeni}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="ft-tl">Odpojit</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {smiPsat ? (
          <form action={zalozitPripojeni} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nové připojení</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>Oblast *</span>
                <select name="oblast" required style={pole}>
                  <option value="pokladna">Pokladna (POS)</option>
                  <option value="banka">Banka</option>
                  <option value="ucetnictvi">Účetnictví</option>
                  <option value="email_dokladu">E-mail dokladů</option>
                </select>
              </label>
              <label>
                <span style={popisek}>Poskytovatel *</span>
                <input type="text" name="poskytovatel" required placeholder="např. dotykacka, csv_import" style={pole} />
              </label>
              <label>
                <span style={popisek}>Režim *</span>
                <select name="rezim" required style={pole}>
                  <option value="csv">CSV import (bez živého přístupu)</option>
                  <option value="zakaznicky">Vlastní přístup (API klíč)</option>
                  <option value="demo">Ukázková data</option>
                </select>
              </label>
              <label>
                <span style={popisek}>Název</span>
                <input type="text" name="nazev" placeholder="volitelné, jinak poskytovatel" style={pole} />
              </label>
            </div>

            <label>
              <span style={popisek}>API klíč / token (jen u „Vlastní přístup“)</span>
              <input type="password" name="klic" autoComplete="off" style={pole} disabled={!sifrovaniJeNastavene()} />
              {!sifrovaniJeNastavene() ? (
                <small style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--pozor)' }}>
                  Šifrování není v tomhle prostředí nastavené (chybí INTEGRACE_KLIC_SIFRY) — klíč se nedá uložit, připojení půjde založit jen bez něj.
                </small>
              ) : null}
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Založit připojení</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
