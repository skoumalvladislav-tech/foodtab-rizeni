import type { ReactNode } from 'react'

import { datumACasSRokemVPasmu } from '@/lib/cas'
import type { KontrolaPos } from '@/lib/jine-platby-typy'

import Ikona from '../../../../ikona'
import { popisZdroje } from './logika'

/**
 * Drobné kreslicí kousky detailu Jiných plateb. Čistě kreslicí: žádný
 * dotaz, žádné právo — co se smí ukázat, rozhodla stránka.
 */

/** Řádek „název — hodnota“ v mřížce, která se na telefonu skládá pod sebe. */
export function Udaje({ children }: { children: ReactNode }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gap: '10px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>{children}</dl>
  )
}

export function Udaj({ nazev, children }: { nazev: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{nazev}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: '14.5px', overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  )
}

/** Věta, která vysvětluje pravidlo (ne chyba). */
export function Vysvetleni({ children, dulezite = false }: { children: ReactNode; dulezite?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: '13.5px',
        lineHeight: 1.45,
        color: dulezite ? 'var(--ink)' : 'var(--muted)',
        fontWeight: dulezite ? 600 : 400,
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start',
      }}
    >
      {dulezite ? (
        <span aria-hidden="true" style={{ flex: 'none', paddingTop: '1px' }}>
          <Ikona klic="vykricnik" velikost={16} />
        </span>
      ) : null}
      <span style={{ minWidth: 0 }}>{children}</span>
    </p>
  )
}

/** Podnadpis uvnitř sekce (h3 — sekce mají h2 v PanelHlava). */
export function Podnadpis({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: '4px 0 0', fontSize: '16px', lineHeight: 1.25 }}>{children}</h3>
}

/** Oddíl sekce s jemnou linkou nahoře. */
export function Oddil({ children, nadpis }: { children: ReactNode; nadpis?: string }) {
  return (
    <section style={{ display: 'grid', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '12px', minWidth: 0 }}>
      {nadpis ? <Podnadpis>{nadpis}</Podnadpis> : null}
      {children}
    </section>
  )
}

export const VSTUP = { minHeight: '44px' } as const
export const MRIZKA_POLI = { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))' } as const

/** Textové pole důvodu (povinné, aspoň pár slov — databáze chce 5 znaků). */
export function PoleDuvodu({
  nazev = 'duvod',
  popisek = 'Důvod (povinný)',
  napoveda,
  povinne = true,
}: {
  nazev?: string
  popisek?: string
  napoveda?: string
  povinne?: boolean
}) {
  return (
    <label className="ds-field">
      <span className="ds-field-label">{popisek}</span>
      <textarea className="ds-input" name={nazev} required={povinne} minLength={5} maxLength={1000} rows={2} style={{ minHeight: '64px', padding: '10px 12px', resize: 'vertical' }} />
      {napoveda ? <span className="ds-field-hint">{napoveda}</span> : null}
    </label>
  )
}

/**
 * Výsledek poslední kontroly proti pokladně: co, odkud (ověřeno dotazem
 * do pokladny / ruční prohlášení — nikdy se to nezaměňuje), kdo, kdy
 * a jestli ještě platí (tatáž verze záznamu, čerstvost).
 */
export function VysledekKontroly({
  kontrola,
  popisVysledku,
  verze,
  platnostMin,
  tedMs,
  jmena,
  zona,
}: {
  kontrola: KontrolaPos<string> | null
  popisVysledku: Record<string, string>
  verze: number
  platnostMin: number
  tedMs: number
  jmena: Record<string, string>
  zona: string
}) {
  if (!kontrola) return <Vysvetleni>Kontrola proti pokladně zatím neproběhla.</Vysvetleni>
  const kdy = Date.parse(kontrola.kdy)
  const stariMin = Number.isFinite(kdy) ? Math.floor((tedMs - kdy) / 60_000) : null
  const jinaVerze = kontrola.verze !== verze
  const zbyva = stariMin === null ? null : platnostMin - stariMin
  const plati = !jinaVerze && zbyva !== null && zbyva > 0 && stariMin !== null && stariMin >= -1
  const detail = (kontrola.detail ?? {}) as Record<string, unknown>
  const duvod = typeof detail.duvod === 'string' ? detail.duvod : null
  const popis = typeof detail.popis === 'string' ? detail.popis : null
  const posId = typeof detail.pos_prodej_id === 'string' ? detail.pos_prodej_id : null
  const rucni = kontrola.zdroj === 'rucni_prohlaseni'
  return (
    <div style={{ display: 'grid', gap: '6px', fontSize: '14px' }}>
      <p style={{ margin: 0 }}>
        <strong>{popisVysledku[kontrola.vysledek] ?? kontrola.vysledek}</strong>
        {' — '}
        <span style={{ fontWeight: rucni ? 600 : 400 }}>{popisZdroje(kontrola.zdroj)}</span>
      </p>
      {popis ? <p style={{ margin: 0, color: 'var(--muted)' }}>{popis}</p> : null}
      {rucni && duvod ? <p style={{ margin: 0 }}>Důvod: {duvod}</p> : null}
      {posId ? <p style={{ margin: 0, color: 'var(--muted)' }}>Účet v pokladně: {posId}</p> : null}
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>
        {Number.isFinite(kdy) ? datumACasSRokemVPasmu(kontrola.kdy, zona) : 'čas neznámý'}
        {kontrola.kdo ? ` · ${jmena[kontrola.kdo] ?? 'kolega'}` : ''}
        {' · '}
        {jinaVerze ? (
          <strong style={{ color: 'var(--pozor)' }}>patří ke starší verzi záznamu — zkontrolujte znovu</strong>
        ) : plati ? (
          `platí ještě ${zbyva} min`
        ) : (
          <strong style={{ color: 'var(--pozor)' }}>propadla (platí {platnostMin} min) — zkontrolujte znovu</strong>
        )}
      </p>
    </div>
  )
}
