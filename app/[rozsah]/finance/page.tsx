import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { nactiCashflowPrehled, type CashflowPrehled } from '@/lib/finance-prehled'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../nadpis'
import Navigace from './navigace'

export const dynamic = 'force-dynamic'

/**
 * Finance — Přehled.
 *
 * Cashflow po pobočkách za jeden kalendářní měsíc. Skutečnost (ze
 * zapsaných transakcí) a plán (z předpisů opakovaných plateb) stojí
 * VEDLE SEBE, nikdy sloučené do jednoho čísla (zadání, oddíl 4).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

function tentoMesic(): string {
  return new Date().toISOString().slice(0, 7)
}

function hraniceMesice(mesic: string): { od: string; doData: string } {
  const [y, m] = mesic.split('-').map(Number)
  const od = `${mesic}-01`
  const posledni = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { od, doData: `${mesic}-${String(posledni).padStart(2, '0')}` }
}

function sousedniMesic(mesic: string, posun: 1 | -1): string {
  const [y, m] = mesic.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + posun, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function nazevMesice(mesic: string): string {
  const d = new Date(`${mesic}-01T00:00:00Z`)
  const popis = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  return popis.charAt(0).toUpperCase() + popis.slice(1)
}

function Cislo({ haleru, barva }: { haleru: number; barva?: string }) {
  return (
    <strong style={{ fontFamily: 'ui-monospace, monospace', color: barva }}>{koruny(haleru)}</strong>
  )
}

function TabulkaCashflow({ data }: { data: CashflowPrehled }) {
  return (
    <div style={{ ...karta, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
            <th style={{ padding: '8px 10px' }}>Pobočka</th>
            <th style={{ padding: '8px 10px' }}>Příjmy (skutečnost)</th>
            <th style={{ padding: '8px 10px' }}>Výdaje (skutečnost)</th>
            <th style={{ padding: '8px 10px' }}>Příjmy (plán)</th>
            <th style={{ padding: '8px 10px' }}>Výdaje (plán)</th>
          </tr>
        </thead>
        <tbody>
          {data.pobocky.map((p) => (
            <tr key={p.branchId} style={{ borderBottom: '1px solid var(--line-2)' }}>
              <td style={{ padding: '8px 10px' }}>{p.pobocka}</td>
              <td style={{ padding: '8px 10px' }}><Cislo haleru={p.skutecnostPrijmyHaleru} barva="var(--dobre)" /></td>
              <td style={{ padding: '8px 10px' }}><Cislo haleru={p.skutecnostVydajeHaleru} barva="var(--bad)" /></td>
              <td style={{ padding: '8px 10px', color: 'var(--muted)' }}><Cislo haleru={p.planPrijmyHaleru} /></td>
              <td style={{ padding: '8px 10px', color: 'var(--muted)' }}><Cislo haleru={p.planVydajeHaleru} /></td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 600 }}>
            <td style={{ padding: '8px 10px' }}>Celá firma (účty bez pobočky)</td>
            <td style={{ padding: '8px 10px' }}><Cislo haleru={data.firma.skutecnostPrijmyHaleru} barva="var(--dobre)" /></td>
            <td style={{ padding: '8px 10px' }}><Cislo haleru={data.firma.skutecnostVydajeHaleru} barva="var(--bad)" /></td>
            <td style={{ padding: '8px 10px', color: 'var(--muted)' }}><Cislo haleru={data.firma.planPrijmyHaleru} /></td>
            <td style={{ padding: '8px 10px', color: 'var(--muted)' }}><Cislo haleru={data.firma.planVydajeHaleru} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default async function FinancePrehled({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ mesic?: string }>
}) {
  const { rozsah } = await params
  const { mesic: mesicParam } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Finance vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const mesic = mesicParam && /^\d{4}-\d{2}$/.test(mesicParam) ? mesicParam : tentoMesic()
  const { od, doData } = hraniceMesice(mesic)

  let data: CashflowPrehled
  try {
    data = await nactiCashflowPrehled(tenantId, od, doData)
  } catch {
    data = { pobocky: [], firma: { skutecnostPrijmyHaleru: 0, skutecnostVydajeHaleru: 0, planPrijmyHaleru: 0, planVydajeHaleru: 0 } }
  }

  const zaklad = `/${rozsah}/finance`

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Skutečnost ze zapsaných plateb, plán z opakovaných předpisů — vždy vedle sebe, nikdy sloučené."
        vpravo={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, -1)}`} className="ft-tl">← Dřívější</Link>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{nazevMesice(mesic)}</span>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, 1)}`} className="ft-tl">Pozdější →</Link>
          </div>
        }
      >
        Přehled
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        {data.pobocky.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Zatím žádné pobočky s platebním účtem, nebo se přehled nepodařilo načíst.
          </p>
        ) : (
          <TabulkaCashflow data={data} />
        )}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`${zaklad}/platby`} className="ft-tl">Zapsat platbu</Link>
          <Link href={`${zaklad}/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link>
          <Link href={`${zaklad}/kontakty`} className="ft-tl">Kontakty</Link>
          <Link href={`${zaklad}/faktury`} className="ft-tl">Faktury</Link>
        </div>
      </div>
    </Navigace>
  )
}
