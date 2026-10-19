import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import { BEZ_UCTU_POBOCKY, hodnotaPohleduRozpoctu, pohledRozpoctu, ROZPOCTY_FIRMY } from '@/lib/finance-evidence-pobocka'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import Sdeleni from '@/app/sdeleni'
import SdeleniPobockyBezFirmy from '../pobocka-bez-firmy'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitRozpocet } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Rozpočty a controlling.
 *
 * Plán vs. skutečnost po kategorii (app.rozpocet_prehled) + prime cost
 * odhad. Prime cost je APROXIMACE z peněžních výdajů za suroviny
 * (transakce.kategorie='suroviny'), NE teoretický foodcost z receptur —
 * ten vyžaduje prodejní data z POS, která appka dnes nemá (Dotykačka
 * adaptér, samostatný kus práce). Vždy popsáno jako odhad.
 *
 * ---------------------------------------------------------------------
 * POBOČKY (Finance po pobočkách, 13. 10. 2026)
 *
 * Na pobočce je pobočka daná rozsahem adresy — výběr pobočky nahoře ani
 * „Celá firma" ve formuláři tu nejsou a akce pobočku bere z rozsahu.
 * Za celou firmu výběr zůstává a přibyla v něm volba „Celá firma —
 * firemní rozpočty" (`?pobocka=firma`): rozpočty bez pobočky se do té
 * doby daly uložit, ale nikde ukázat. `rozpocet_prehled` s `p_branch`
 * null vrací právě je (a skutečnost z účtů bez pobočky) — NE součet
 * všech poboček.
 *
 * Skutečnost pobočky se počítá z plateb jejích platebních účtů. Dnes je
 * každý účet založený v appce firemní, takže pobočka bez účtu dostane
 * větu (`BEZ_UCTU_POBOCKY`), ne „0 Kč" tržeb.
 */

type Branch = { id: string; name: string }
type RadekPrehledu = { kategorie: string; smer: string; plan_haleru: number; skutecnost_haleru: number; odchylka_haleru: number }

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

const popisek = { display: 'block', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '4px' } as const

const vetaVKarte = { fontSize: '13px', color: 'var(--muted)', maxWidth: '220px' } as const

const NAZVY_KATEGORII: Record<string, string> = {
  trzby: 'Tržby',
  suroviny: 'Suroviny',
  mzdy: 'Mzdy',
  najem: 'Nájem',
  energie: 'Energie',
  marketing: 'Marketing',
  ostatni: 'Ostatní',
  nezarazeno: 'Nezařazeno',
}

export default async function FinanceRozpocty({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; rok?: string; mesic?: string; pobocka?: string }>
}) {
  const { rozsah } = await params
  const { chyba, rok: rokParam, mesic: mesicParam, pobocka: pobockaParam } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'pobocka_bez_firmy') return <SdeleniPobockyBezFirmy rozsah={rozsah} />
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rozpočty vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const dnes = new Date()
  const rok = Number(rokParam) || dnes.getFullYear()
  const mesic = Number(mesicParam) || dnes.getMonth() + 1

  // Pobočka z rozsahu adresy (lib/finance-rozsah.ts), `null` = celá firma.
  const pobocka = pobockaFinanci(pristup.scope)

  const supabase = await getServerSupabase()
  const branchesRes = await supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
  const branches = (branchesRes.data ?? []) as Branch[]
  // Čí rozpočty: na pobočce ta z rozsahu, za celou firmu výběr (`null` =
  // firemní rozpočty bez pobočky).
  const branchId = pohledRozpoctu(pobocka, pobockaParam, branches)
  const firemni = branchId === null
  const nazevPohledu = firemni
    ? 'firemní rozpočty (bez pobočky)'
    : pobocka
      ? (pristup.scope.branchName ?? 'pobočka')
      : (branches.find((b) => b.id === branchId)?.name ?? 'pobočka')

  // Má zobrazená pobočka aspoň jeden platební účet (i vypnutý — jeho
  // platby do skutečnosti počítá app.vysledovka taky)? Bez něj je
  // skutečnost z čeho spočítat nemá.
  let bezUctu = false
  if (branchId) {
    const uctyRes = await supabase
      .from('platebni_ucty')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
    // Na pobočce věta „pobočka nemá účet" nesmí být spadlý dotaz
    // (lib/supabase/dotaz.ts). Za celou firmu se při chybě jen neukáže
    // poznámka — čísla zůstávají jako dosud.
    if (uctyRes.error) {
      if (pobocka) throw new DotazSelhal('platební účty pobočky', uctyRes.error)
    } else {
      bezUctu = (uctyRes.count ?? 0) === 0
    }
  }
  // Na pobočce bez účtu se skutečnost neukazuje vůbec (věta místo
  // „0 Kč"); za celou firmu se čísla ukazují jako dosud a věta je navíc.
  const skrytSkutecnost = pobocka !== null && bezUctu

  let prehled: RadekPrehledu[] = []
  let mzdyHaleru = 0
  try {
    const [prehledRes, mzdyRes] = await Promise.all([
      supabase.rpc('rozpocet_prehled', { p_tenant: tenantId, p_branch: branchId, p_rok: rok, p_mesic: mesic }),
      branchId
        ? supabase.rpc('vydelky_prehled', { p_tenant: tenantId, p_branch: branchId, p_mesic: `${rok}-${String(mesic).padStart(2, '0')}-01` })
        : Promise.resolve({ data: [] as { vydelano_haleru: number }[] }),
    ])
    prehled = (prehledRes.data ?? []) as RadekPrehledu[]
    mzdyHaleru = ((mzdyRes.data ?? []) as { vydelano_haleru: number }[]).reduce((s, r) => s + (r.vydelano_haleru ?? 0), 0)
  } catch {
    prehled = []
  }

  const trzby = prehled.find((p) => p.kategorie === 'trzby' && p.smer === 'prijem')?.skutecnost_haleru ?? 0
  const suroviny = prehled.find((p) => p.kategorie === 'suroviny' && p.smer === 'vydaj')?.skutecnost_haleru ?? 0
  const primeCostHaleru = suroviny + mzdyHaleru
  const primeCostProcento = trzby > 0 ? Math.round((primeCostHaleru / trzby) * 1000) / 10 : null

  const zaklad = `/${rozsah}/finance/rozpocty`
  const qs = `rok=${rok}&mesic=${mesic}${pobocka ? '' : `&pobocka=${hodnotaPohleduRozpoctu(branchId)}`}`

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={pobocka
          ? `Plán vs. skutečnost pobočky ${nazevPohledu} po kategorii. Prime cost je odhad z výdajů za suroviny, ne teoretický foodcost z receptur.`
          : 'Plán vs. skutečnost po kategorii. Prime cost je odhad z výdajů za suroviny, ne teoretický foodcost z receptur.'}
        vpravo={
          <form action={zaklad} method="get" style={{ display: 'flex', gap: '8px' }}>
            {pobocka ? null : (
              <select name="pobocka" defaultValue={hodnotaPohleduRozpoctu(branchId)} style={pole}>
                <option value={ROZPOCTY_FIRMY}>Celá firma — firemní rozpočty</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <select name="rok" defaultValue={String(rok)} style={pole}>
              {[rok - 1, rok, rok + 1].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select name="mesic" defaultValue={String(mesic)} style={pole}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="submit" className="ft-tl">Zobrazit</button>
          </form>
        }
      >
        Rozpočty a controlling
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '20px', maxWidth: '960px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        {bezUctu ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
            {pobocka ? BEZ_UCTU_POBOCKY : `${nazevPohledu}: ${BEZ_UCTU_POBOCKY}`}
          </p>
        ) : null}

        <section style={{ ...karta, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Tržby (skutečnost)</div>
            {skrytSkutecnost ? (
              <div style={vetaVKarte}>bez platebního účtu pobočky</div>
            ) : (
              <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px' }}>{koruny(trzby)}</strong>
            )}
          </div>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Suroviny (odhad spotřeby z plateb)</div>
            {skrytSkutecnost ? (
              <div style={vetaVKarte}>bez platebního účtu pobočky</div>
            ) : (
              <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px' }}>{koruny(suroviny)}</strong>
            )}
          </div>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Mzdy (schválená docházka)</div>
            {firemni ? (
              // Mzdy se počítají po pobočkách (domovská pobočka zaměstnance);
              // firemní rozpočty nemají čí docházku sečíst — „0 Kč" by lhalo.
              <div style={vetaVKarte}>počítají se po pobočkách</div>
            ) : (
              <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px' }}>{koruny(mzdyHaleru)}</strong>
            )}
          </div>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Prime cost — ODHAD</div>
            {firemni ? (
              <div style={vetaVKarte}>počítá se po pobočkách</div>
            ) : skrytSkutecnost ? (
              <div style={vetaVKarte}>bez tržeb pobočky ho nejde spočítat</div>
            ) : (
              <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px' }}>
                {primeCostProcento !== null ? `${primeCostProcento} %` : 'chybí tržby'}
              </strong>
            )}
          </div>
        </section>

        <section style={{ display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>Plán vs. skutečnost{pobocka ? '' : ` — ${nazevPohledu}`}</h2>
          {prehled.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Žádná data za zvolené období.</p>
          ) : (
            <div style={{ ...karta, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '6px 8px' }}>Kategorie</th>
                    <th style={{ padding: '6px 8px' }}>Směr</th>
                    <th style={{ padding: '6px 8px' }}>Plán</th>
                    <th style={{ padding: '6px 8px' }}>Skutečnost</th>
                    <th style={{ padding: '6px 8px' }}>Odchylka</th>
                  </tr>
                </thead>
                <tbody>
                  {prehled.map((p) => (
                    <tr key={`${p.kategorie}-${p.smer}`} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '6px 8px' }}>{NAZVY_KATEGORII[p.kategorie] ?? p.kategorie}</td>
                      <td style={{ padding: '6px 8px' }}>{p.smer === 'prijem' ? 'Příjem' : 'Výdaj'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(p.plan_haleru)}</td>
                      {skrytSkutecnost ? (
                        // Bez účtu pobočky není skutečnost nula, ale neznámá.
                        <>
                          <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>—</td>
                          <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>—</td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(p.skutecnost_haleru)}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', color: p.odchylka_haleru > 0 && p.smer === 'vydaj' ? 'var(--bad)' : undefined }}>
                            {p.odchylka_haleru > 0 ? '+' : ''}{koruny(p.odchylka_haleru)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {pobocka ? <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>{POZNAMKA_FIREMNI}</p> : null}

        {smiPsat ? (
          <form action={zalozitRozpocet} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Zadat rozpočet</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))', gap: '12px' }}>
              {pobocka ? (
                // Na pobočce bere akce pobočku z rozsahu adresy — skryté
                // pole nečte (kdokoli si ho přepíše); „Celá firma" tu není.
                <div>
                  <span style={popisek}>Pobočka</span>
                  <input type="hidden" name="branch_id" value={pobocka} />
                  <p style={{ margin: 0, fontSize: '13.5px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>
                    {nazevPohledu}
                  </p>
                </div>
              ) : (
                <label>
                  <span style={popisek}>Pobočka</span>
                  <select name="branch_id" style={pole} defaultValue={branchId ?? ''}>
                    <option value="">Celá firma</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span style={popisek}>Kategorie *</span>
                <select name="kategorie" required style={pole}>
                  {Object.entries(NAZVY_KATEGORII).filter(([k]) => k !== 'nezarazeno').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              </label>
              <label>
                <span style={popisek}>Směr *</span>
                <select name="smer" required style={pole}>
                  <option value="vydaj">Výdaj</option>
                  <option value="prijem">Příjem</option>
                </select>
              </label>
              <label>
                <span style={popisek}>Rok *</span>
                <input type="number" name="rok" required defaultValue={rok} style={pole} />
              </label>
              <label>
                <span style={popisek}>Měsíc *</span>
                <input type="number" name="mesic" required min={1} max={12} defaultValue={mesic} style={pole} />
              </label>
              <label>
                <span style={popisek}>Částka (Kč) *</span>
                <input type="text" name="castka" required placeholder="180000" style={pole} />
              </label>
            </div>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' }}>
              <input type="checkbox" name="je_fixni" /> Fixní náklad (pro budoucí bod zvratu)
            </label>
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit rozpočet</button>
            </div>
          </form>
        ) : null}

        <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
          <Link href={`${zaklad}?${qs}`} className="ft-tl">Obnovit s aktuálním výběrem</Link>
        </p>
      </div>
    </Navigace>
  )
}
