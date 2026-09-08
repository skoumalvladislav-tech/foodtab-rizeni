'use client'

import { useState, type CSSProperties } from 'react'

import { NOVA_POZICE } from './pozice-volba'

/**
 * Výběr pozice s možností rovnou založit novou.
 *
 * Klientské je to kvůli jediné věci: po volbě „+ Nová pozice…“ se musí
 * objevit pole na název. Zakládá to serverová akce spolu s uložením
 * zaměstnance — bez odchodu z formuláře a bez druhého kliknutí.
 *
 * Výběr je řízený (useState), ne neřízený. Kdyby byl neřízený, po
 * přepnutí na jiného člověka by v něm zůstala pozice toho předchozího;
 * přesně tak se u zaměstnankyně přepsal typ poměru, viz key na formuláři
 * v page.tsx.
 */
export default function PolePozice({
  pozice,
  vybrana,
  stylLabel,
  stylSelect,
  stylInput,
}: {
  pozice: { id: string; label: string }[]
  vybrana: string
  stylLabel: CSSProperties
  stylSelect: CSSProperties
  stylInput: CSSProperties
}) {
  const [hodnota, setHodnota] = useState(vybrana)

  return (
    <>
      <label style={stylLabel}>
        <span>Zařazení</span>
        <select
          name="pozice"
          value={hodnota}
          onChange={(e) => setHodnota(e.target.value)}
          style={stylSelect}
        >
          {/*
            Zařazení je nepovinné. Brigádník ho mít nemusí — jen pak
            nemá odkud vzít žádné oprávnění.
          */}
          <option value="">— Neurčeno —</option>
          {pozice.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={NOVA_POZICE}>+ Nové zařazení…</option>
        </select>
      </label>

      {hodnota === NOVA_POZICE ? (
        <label style={stylLabel}>
          <span>Název nového zařazení *</span>
          <input
            name="novaPozice"
            required
            maxLength={60}
            autoFocus
            placeholder="Číšník"
            style={stylInput}
          />
          <span style={{ fontSize: '12px', textTransform: 'none', letterSpacing: 0 }}>
            Uloží se při uložení zaměstnance a od té chvíle ho nabídneme
            i u ostatních. Oprávnění mu nastavíte v Nastavení →
            Oprávnění; nové zařazení zatím nedává nic.
          </span>
        </label>
      ) : null}
    </>
  )
}
