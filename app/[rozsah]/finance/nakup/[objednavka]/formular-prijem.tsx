'use client'

import { useState } from 'react'

import { zapsatPrijem } from '../akce'

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

export type RadekKZapis = {
  id: string
  nazev: string
  jednotka: string
  zbyva: number
  cenaKc: string
}

/**
 * Formulář zápisu příjmu — klientský kvůli dynamickému výběru položek
 * (checkbox + množství/cena per řádek). Sestavuje JSON pro
 * `public.zapsat_prijem_zbozi` v `onSubmit`, než se formData předá
 * server akci — čistší a bezpečnější než injektovat vanilla skript do
 * stránky (ten vzor v projektu jinde neexistuje).
 */
export default function FormularPrijem({
  rozsah,
  objednavkaId,
  branchId,
  radky,
}: {
  rozsah: string
  objednavkaId: string
  branchId: string | null
  radky: RadekKZapis[]
}) {
  const [stavy, setStavy] = useState(
    radky.map((r) => ({ zaskrtnuto: r.zbyva > 0, mnozstvi: r.zbyva > 0 ? String(r.zbyva) : '', cena: r.cenaKc })),
  )

  function nastav(i: number, zmena: Partial<(typeof stavy)[number]>) {
    setStavy((s) => s.map((radek, idx) => (idx === i ? { ...radek, ...zmena } : radek)))
  }

  async function odeslat(formData: FormData) {
    const polozky = radky
      .map((r, i) => ({ r, s: stavy[i] }))
      .filter(({ s }) => s.zaskrtnuto)
      .map(({ r, s }) => ({
        objednavky_polozka_id: r.id,
        nazev: r.nazev,
        jednotka: r.jednotka,
        mnozstvi_prijato: Number(s.mnozstvi.replace(',', '.')),
        cena_za_jednotku_haleru: Math.round(Number(s.cena.replace(',', '.')) * 100),
      }))
      .filter((p) => p.mnozstvi_prijato > 0 && !Number.isNaN(p.cena_za_jednotku_haleru))

    formData.set('polozky', JSON.stringify(polozky))
    await zapsatPrijem(formData)
  }

  return (
    <form action={odeslat} style={{ ...karta, display: 'grid', gap: '12px' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="objednavka_id" value={objednavkaId} />
      <input type="hidden" name="branch_id" value={branchId ?? ''} />
      <h2 style={{ margin: 0, fontSize: '15px' }}>Zapsat příjem</h2>
      <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
        Zaškrtněte přijaté položky a upravte množství/cenu — doplní se podle objednávky.
      </p>

      {radky.map((r, i) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={stavy[i].zaskrtnuto}
              onChange={(e) => nastav(i, { zaskrtnuto: e.target.checked })}
            />
            {r.nazev}
          </label>
          <input
            type="text"
            value={stavy[i].mnozstvi}
            onChange={(e) => nastav(i, { mnozstvi: e.target.value })}
            placeholder={`Množství (${r.jednotka})`}
            style={pole}
          />
          <input
            type="text"
            value={stavy[i].cena}
            onChange={(e) => nastav(i, { cena: e.target.value })}
            placeholder="Cena/j. Kč"
            style={pole}
          />
        </div>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <label>
          <span style={popisek}>Číslo/ID faktury (volitelné)</span>
          <input type="text" name="faktura_id" style={pole} />
        </label>
        <label>
          <span style={popisek}>Poznámka</span>
          <input type="text" name="poznamka" style={pole} />
        </label>
      </div>

      <div>
        <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat příjem</button>
      </div>
    </form>
  )
}
