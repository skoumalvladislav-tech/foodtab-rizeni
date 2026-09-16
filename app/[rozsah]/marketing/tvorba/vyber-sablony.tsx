'use client'

import { useState } from 'react'

import { sablona, type Kategorie, type SablonaVstup } from '@/lib/marketing-sablony'
import { vyzadujeMenu } from '@/lib/marketing-tvorba'

const KATEGORIE: { klic: Kategorie; nazev: string }[] = [
  { klic: 'menu', nazev: 'Menu' },
  { klic: 'akce', nazev: 'Akce' },
  { klic: 'prubezne', nazev: 'Průběžné' },
]

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '14px',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

export type SablonaVolba = { klic: string; nazev: string; kategorie: Kategorie }
export type MenuVolba = { id: string; nazev: string; druh: string }

/**
 * Krok 2 průvodce: výběr šablony a její pole.
 *
 * Definice polí (`SablonaVstup[]`) žijí v `lib/marketing-sablony.ts` —
 * tenhle formulář je jen vykresluje, nevymýšlí. Menu šablony berou
 * položky z POTVRZENÉHO menu (výběr níž), ne z ručně psaného textu —
 * proto typ `items` v definici nemá vlastní pole tady.
 *
 * Vzor: `marketing-ai/app/[provozovna]/tvorba/vyber-sablony.tsx`
 * (git show 6cb7d72), přepsáno na katalog `lib/marketing-sablony.ts`.
 */
export default function VyberSablony({
  sablony,
  menu,
}: {
  sablony: SablonaVolba[]
  menu: MenuVolba[]
}) {
  const [klic, setKlic] = useState(sablony[0]?.klic ?? '')
  const def = sablona(klic)

  const podleKategorie = KATEGORIE.map((k) => ({
    ...k,
    polozky: sablony.filter((s) => s.kategorie === k.klic),
  })).filter((k) => k.polozky.length > 0)

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <label>
        <span style={popisek}>Šablona</span>
        <select name="sablona" style={pole} value={klic} onChange={(e) => setKlic(e.target.value)}>
          {podleKategorie.map((k) => (
            <optgroup key={k.klic} label={k.nazev}>
              {k.polozky.map((s) => (
                <option key={s.klic} value={s.klic}>{s.nazev}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {def ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{def.description}</p> : null}

      {def && vyzadujeMenu(def) ? (
        <label>
          <span style={popisek}>Menu</span>
          {menu.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--mosaz)' }}>
              Žádné potvrzené menu. Založte a potvrďte ho nejdřív na obrazovce Menu.
            </p>
          ) : (
            <select name="menuId" style={pole} defaultValue={menu[0]?.id ?? ''}>
              {menu.map((m) => (
                <option key={m.id} value={m.id}>{m.nazev}</option>
              ))}
            </select>
          )}
        </label>
      ) : null}

      {def
        ? def.inputs
            .filter((v) => v.type !== 'media' && v.type !== 'items')
            .map((v) => <Pole key={v.key} vstup={v} />)
        : null}
    </div>
  )
}

function Pole({ vstup }: { vstup: SablonaVstup }) {
  const nazev = `in_${vstup.key}`
  const label = (
    <span style={popisek}>
      {vstup.label}{vstup.required ? ' *' : ''}
    </span>
  )

  if (vstup.type === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
        <input type="checkbox" name={nazev} defaultChecked={Boolean(vstup.default)} />
        {vstup.label}
      </label>
    )
  }

  if (vstup.type === 'select') {
    return (
      <label>
        {label}
        <select name={nazev} style={pole} defaultValue={String(vstup.default ?? '')}>
          {(vstup.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {vstup.help ? <Napoveda text={vstup.help} /> : null}
      </label>
    )
  }

  if (vstup.type === 'date_range') {
    return (
      <div>
        {label}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input name={`${nazev}_od`} type="date" style={pole} required={vstup.required} />
          <input name={`${nazev}_do`} type="date" style={pole} />
        </div>
        {vstup.help ? <Napoveda text={vstup.help} /> : null}
      </div>
    )
  }

  if (vstup.type === 'text') {
    return (
      <label>
        {label}
        <textarea name={nazev} rows={3} style={{ ...pole, resize: 'vertical' }} required={vstup.required} />
        {vstup.help ? <Napoveda text={vstup.help} /> : null}
      </label>
    )
  }

  const typHtml = vstup.type === 'date' ? 'date'
    : vstup.type === 'time' ? 'time'
    : vstup.type === 'number' || vstup.type === 'price' ? 'number'
    : vstup.type === 'url' ? 'url'
    : 'text'

  return (
    <label>
      {label}
      <input
        name={nazev}
        type={typHtml}
        inputMode={typHtml === 'number' ? 'decimal' : undefined}
        defaultValue={typeof vstup.default === 'string' || typeof vstup.default === 'number' ? String(vstup.default) : undefined}
        style={pole}
        required={vstup.required}
      />
      {vstup.help ? <Napoveda text={vstup.help} /> : null}
    </label>
  )
}

function Napoveda({ text }: { text: string }) {
  return (
    <small style={{ display: 'block', marginTop: '3px', fontSize: '12px', color: 'var(--muted)' }}>{text}</small>
  )
}
