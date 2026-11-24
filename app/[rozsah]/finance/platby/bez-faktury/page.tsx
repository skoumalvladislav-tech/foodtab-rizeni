import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { koruny } from '@/lib/mzdy'
import { jeVKorunach } from '@/lib/finance-parovani'
import { nactiPlatbyBezFaktury, nactiUctyFronty } from '@/lib/finance-bez-faktury-nacteni'
import { filtrUctuFronty } from '@/lib/finance-bez-faktury'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import Sdeleni from '@/app/sdeleni'
import SdeleniPobockyBezFirmy from '../../pobocka-bez-firmy'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'

export const dynamic = 'force-dynamic'

/**
 * Finance → Platby → Platby bez faktury (Finance Fáze 0, krok 2: „to
 * hledá účetní").
 *
 * Odchozí platby, ke kterým appka fakturu nemá a nečeká na ně ani návrh
 * párování (lib/finance-bez-faktury.ts). Jen čtení — účetní dohledá
 * doklad u dodavatele; export CSV je na /api/ucetni/platby-bez-faktury.
 *
 * Stačí „Vidět finanční přehled“ (data faktur se tu neukazují; jestli
 * pohyb vyřídila ruční úhrada nebo na něj čeká návrh, řekne databáze
 * funkcí platby_bez_faktury_vyrizeni). Za celou firmu všechny účty, na
 * pobočce jen účty pobočky (stejně jako Platby), a jde vybrat jeden účet.
 */

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
  minHeight: '44px',
} as const

const DATUM = /^\d{4}-\d{2}-\d{2}$/

function castka(haleru: number, mena: string | null): string {
  return jeVKorunach(mena) ? koruny(haleru) : `${(haleru / 100).toFixed(2).replace('.', ',')} ${(mena ?? '').trim().toUpperCase()}`
}

export default async function PlatbyBezFaktury({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ od?: string; do?: string; ucet?: string }>
}) {
  const { rozsah } = await params
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>
  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'pobocka_bez_firmy') return <SdeleniPobockyBezFirmy rozsah={rozsah} />
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Platby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }
  // Pobočka z rozsahu adresy (lib/finance-rozsah.ts), `null` = celá firma.
  const pobocka = pobockaFinanci(pristup.scope)

  const hledani = await searchParams
  const dnes = new Date().toISOString().slice(0, 10)
  const predTremiMesici = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10)
  const od = hledani.od && DATUM.test(hledani.od) ? hledani.od : predTremiMesici
  const doData = hledani.do && DATUM.test(hledani.do) ? hledani.do : dnes

  const supabase = await getServerSupabase()
  const uctyRes = await nactiUctyFronty(supabase, tenantId)
  const { nabidka, vybrany, filtr } = filtrUctuFronty(uctyRes.stav === 'ok' ? uctyRes.ucty : [], pobocka, hledani.ucet)
  const vysledek = uctyRes.stav === 'ok'
    ? await nactiPlatbyBezFaktury(supabase, tenantId, od, doData, filtr)
    : uctyRes
  const exportOdkaz = `/api/ucetni/platby-bez-faktury?rozsah=${encodeURIComponent(rozsah)}&od=${od}&do=${doData}${vybrany ? `&ucet=${encodeURIComponent(vybrany)}` : ''}`
  const soucetKc = vysledek.stav === 'ok'
    ? vysledek.platby.filter((p) => jeVKorunach(p.mena)).reduce((s, p) => s + p.zbyvaHaleru, 0)
    : 0

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance · Platby" popis="Odchozí platby, ke kterým appka nemá fakturu ani návrh — doklad dohledá účetní.">
        Platby bez faktury
      </Nadpis>
      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`/${rozsah}/finance/platby`} className="ft-tl ft-tl-male">← Platby</Link>
          <Link href={`/${rozsah}/finance/platby/navrhy`} className="ft-tl ft-tl-male">Návrhy párování</Link>
        </div>

        <form method="get" style={{ ...karta, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>Od</span>
            <input type="date" name="od" defaultValue={od} style={pole} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>Do</span>
            <input type="date" name="do" defaultValue={doData} style={pole} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>Účet</span>
            <select name="ucet" defaultValue={vybrany ?? ''} style={pole}>
              <option value="">{pobocka ? 'Všechny účty pobočky' : 'Všechny účty'}</option>
              {nabidka.map((u) => <option key={u.id} value={u.id}>{u.nazev}</option>)}
            </select>
          </label>
          <button type="submit" className="ft-tl">Zobrazit</button>
          <a href={exportOdkaz} className="ft-tl">
            Stáhnout pro účetní (CSV)
          </a>
        </form>

        {pobocka ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
            {nabidka.length === 0 ? 'Pobočka nemá vlastní platební účet. ' : ''}{POZNAMKA_FIREMNI}
          </p>
        ) : null}

        {vysledek.stav !== 'ok' ? (
          <p role="status" style={{ margin: 0, fontSize: '13px', color: vysledek.stav === 'chyba' ? 'var(--bad)' : 'var(--pozor)' }}>{vysledek.text}</p>
        ) : vysledek.platby.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            V období {od} – {doData} nemá žádná odchozí platba chybějící fakturu.
          </p>
        ) : (
          <section style={{ display: 'grid', gap: '10px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              {vysledek.platby.length} {vysledek.platby.length === 1 ? 'platba' : vysledek.platby.length < 5 ? 'platby' : 'plateb'}, bez faktury celkem {koruny(soucetKc)}
              {vysledek.platby.some((p) => !jeVKorunach(p.mena)) ? ' (součet jen v Kč)' : ''}.
            </p>
            <div style={{ ...karta, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '6px 8px' }}>Datum</th>
                    <th style={{ padding: '6px 8px' }}>Bez faktury</th>
                    <th style={{ padding: '6px 8px' }}>Protistrana</th>
                    <th style={{ padding: '6px 8px' }}>VS</th>
                    <th style={{ padding: '6px 8px' }}>Účet</th>
                  </tr>
                </thead>
                <tbody>
                  {vysledek.platby.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{p.datum}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                        {castka(p.zbyvaHaleru, p.mena)}
                        {p.zbyvaHaleru !== p.castkaHaleru ? <span style={{ color: 'var(--muted)' }}> z {castka(p.castkaHaleru, p.mena)}</span> : null}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{p.protistrana || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{p.vs || '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{p.ucet || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Navigace>
  )
}
