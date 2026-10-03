'use client'

import { useActionState } from 'react'

import { koruny } from '@/lib/mzdy'
import { naparsovatSouborProdeje, type StavNahleduProdeje } from './akce-nahled'
import { potvrditImportProdeje } from './akce'

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

type Branch = { id: string; name: string }

/**
 * Formulář importu denních prodejů — dva kroky na jedné stránce, stejný
 * vzor jako platby/import/formular.tsx (náhled → potvrzení).
 */
export default function ImportFormular({ rozsah, branches }: { rozsah: string; branches: Branch[] }) {
  const [stav, spustitNahled, cekaNaNahled] = useActionState<StavNahleduProdeje, FormData>(naparsovatSouborProdeje, { stav: 'nic' })

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <form action={spustitNahled} encType="multipart/form-data" style={{ ...karta, display: 'grid', gap: '14px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <h2 style={{ margin: 0, fontSize: '15px' }}>1. Nahrát denní prodeje (CSV)</h2>
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
          Sloupce: Datum, Produkt, Množství, Tržba. Opakovaný import téhož dne a produktu hodnotu přepíše, ne zdvojí.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <label>
            <span style={popisek}>Pobočka *</span>
            <select name="branch_id" required style={pole}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            <span style={popisek}>Soubor (CSV) *</span>
            <input type="file" name="soubor" accept=".csv,text/csv" required style={pole} />
          </label>
        </div>

        <div>
          <button type="submit" className="ft-tl" disabled={cekaNaNahled || branches.length === 0}>
            {cekaNaNahled ? 'Čtu soubor…' : 'Zobrazit náhled'}
          </button>
        </div>
      </form>

      {stav.stav === 'chyba' ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{stav.text}</p>
      ) : null}

      {stav.stav === 'nahled' ? (
        <div style={{ ...karta, display: 'grid', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>2. Náhled — {stav.radky.length} řádků k zápisu</h2>

          {stav.chyby.length > 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--pozor)' }}>
              {stav.chyby.length} {stav.chyby.length === 1 ? 'řádek' : 'řádků'} souboru se nepodařilo přečíst a bude se přeskočit:{' '}
              {stav.chyby.slice(0, 5).map((c) => `řádek ${c.radek} (${c.zprava})`).join('; ')}
              {stav.chyby.length > 5 ? '…' : ''}
            </p>
          ) : null}

          <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '6px 8px' }}>Datum</th>
                  <th style={{ padding: '6px 8px' }}>Produkt</th>
                  <th style={{ padding: '6px 8px' }}>Množství</th>
                  <th style={{ padding: '6px 8px' }}>Tržba</th>
                </tr>
              </thead>
              <tbody>
                {stav.radky.slice(0, 200).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '6px 8px' }}>{r.datum}</td>
                    <td style={{ padding: '6px 8px' }}>{r.produktNazev}</td>
                    <td style={{ padding: '6px 8px' }}>{r.mnozstvi}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(r.trzbaHaleru)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stav.radky.length > 200 ? (
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                Zobrazeno prvních 200 z {stav.radky.length} — do importu se zapíšou všechny.
              </p>
            ) : null}
          </div>

          <form action={potvrditImportProdeje}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="branch_id" value={stav.branchId} />
            <input type="hidden" name="soubor_hash" value={stav.soubor.hash} />
            <input type="hidden" name="soubor_nazev" value={stav.soubor.nazev} />
            <input type="hidden" name="radky" value={JSON.stringify(stav.radky)} />
            <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit import ({stav.radky.length} řádků)</button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
