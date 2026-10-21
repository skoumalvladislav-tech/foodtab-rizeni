'use client'

import { useActionState, useState } from 'react'

import Ikona from '../../../../ikona'
import { zalozitZaznam, type StavZalozeni } from '../akce-zalozit'

export type PokladnaVolba = { id: string; nazev: string }
export type PobockaVolba = { id: string; nazev: string; pokladny: PokladnaVolba[] }

const pole = {
  padding: '8px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '15px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } as const
const napoveda = { margin: '6px 0 0', fontSize: '12.5px', color: 'var(--muted)' } as const

/**
 * Krok 1 průvodce: provozovna, pokladna a označení.
 *
 * Na pobočce je provozovna pevná (`pevnaPobocka`) — výběr se nekreslí
 * a server ji z formuláře ani nečte. Za celou firmu se nabízejí jen
 * pobočky, kde má člověk `jine_platby.zadat` (spočítala stránka).
 *
 * Pokladna: jen připojené pokladny, které vybranou provozovnu obsluhují,
 * a vždycky výslovná volba „Bez pokladny". Když je pokladna jediná, je
 * předvybraná; jinak musí člověk zvolit sám (nic se nehádá).
 *
 * `klientId` vygenerovala stránka při vykreslení — opakované odeslání
 * (dvojklik, obnovení po chybě spojení) vrátí tentýž záznam.
 */
export default function FormularNovehoZaznamu({
  rozsah,
  pobocky,
  pevnaPobocka,
  klientId,
  vidiPokladny,
}: {
  rozsah: string
  pobocky: PobockaVolba[]
  /** Id pobočky z rozsahu adresy; `null` = celá firma, kreslí se výběr. */
  pevnaPobocka: string | null
  klientId: string
  /** Smí číst připojené pokladny (`finance.read`)? Bez něj je seznam prázdný kvůli RLS, ne proto, že pokladna není. */
  vidiPokladny: boolean
}) {
  const [stav, odeslat, odesila] = useActionState<StavZalozeni, FormData>(zalozitZaznam, { stav: 'klid' })
  const [branchId, setBranchId] = useState<string>(pevnaPobocka ?? (pobocky.length === 1 ? pobocky[0].id : ''))
  const vybrana = pobocky.find((b) => b.id === branchId) ?? null
  const pokladny = vybrana?.pokladny ?? []

  return (
    <form action={odeslat} className="ds-plocha" style={{ display: 'grid', gap: '18px' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="klient_id" value={klientId} />

      {pevnaPobocka ? (
        <p style={{ margin: 0, fontSize: '14px' }}>
          Provozovna: <strong>{vybrana?.nazev ?? 'tahle pobočka'}</strong>
        </p>
      ) : (
        <label>
          <span style={popisek}>Provozovna</span>
          <select
            name="branch_id"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            style={pole}
          >
            <option value="" disabled>
              Vyberte provozovnu…
            </option>
            {pobocky.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nazev}
              </option>
            ))}
          </select>
        </label>
      )}

      {vybrana ? (
        // Klíč podle pobočky: po změně provozovny se volba pokladny vynuluje
        // (pokladna jiné provozovny by v databázi neprošla).
        <fieldset key={vybrana.id} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'grid', gap: '8px' }}>
          <legend style={{ ...popisek, padding: 0 }}>Pokladna provozovny</legend>
          {pokladny.map((p) => (
            <label key={p.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '44px' }}>
              <input type="radio" name="pripojeni" value={p.id} required defaultChecked={pokladny.length === 1} />
              <span>{p.nazev}</span>
            </label>
          ))}
          <label style={{ display: 'flex', gap: '10px', alignItems: 'center', minHeight: '44px' }}>
            <input type="radio" name="pripojeni" value="" required defaultChecked={pokladny.length === 0} />
            <span>Bez pokladny</span>
          </label>
          <p style={napoveda}>
            {pokladny.length > 0
              ? 'Podle pokladny se později ověří, jestli prodej už v pokladně není, a připraví se výdej ze skladu.'
              : vidiPokladny
                ? 'K provozovně není připojená žádná pokladna. Záznam se založí bez ní — výdej ze skladu přes pokladnu pak u něj připravit nepůjde.'
                : 'Pokladny provozovny tu vidí jen ten, kdo má právo „Vidět finanční přehled“. Záznam se založí bez pokladny — výdej ze skladu přes pokladnu pak u něj připravit nepůjde.'}
          </p>
        </fieldset>
      ) : null}

      <label>
        <span style={popisek}>Zákazník nebo označení účtu</span>
        <input
          type="text"
          name="oznaceni"
          maxLength={200}
          autoComplete="off"
          placeholder="např. Svatba Novákovi, stůl 12"
          style={pole}
        />
        <p style={napoveda}>Nepovinné. Podle toho záznam najdete v přehledu.</p>
      </label>

      {stav.stav === 'chyba' ? (
        <p role="alert" className="hlaska-chyba" style={{ margin: 0 }}>
          {stav.text}
        </p>
      ) : null}

      <div>
        <button type="submit" className="ft-tl ft-tl-hlavni" disabled={odesila || !vybrana}>
          <Ikona klic="plus" />
          {odesila ? 'Zakládám…' : 'Založit záznam'}
        </button>
      </div>
    </form>
  )
}
