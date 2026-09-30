'use client'

import { useState } from 'react'

/**
 * Tlačítko Obnovit u smazaného řádku zaměstnance. Dva kroky.
 *
 * Zrcadlo `./smazani.tsx` (SmazatZamestnance) — stejný tvar, stejné
 * dva kroky, jen naopak. Otázka 18 e (docs/hlaseni/otazky.md):
 * obnovení v aplikaci dosud nešlo vůbec, jen přímým zápisem přes API.
 *
 * Obnovení vrací i přístup (členství, případně majitelství) — proto
 * druhý krok, stejně jako u Smazat a u „Odebrat z firmy" v okně
 * čekajících na oprávnění. Kdo na vrácení těch práv sám nemá, dostane
 * chybu z databáze (strop `app.smi_pridelit_zamestnance`,
 * `obnovitZamestnance` v ./akce.ts) — tlačítko samo nic nehlídá.
 *
 * Klientská je jen ta otázka. Vlastní obnovení dělá serverová akce.
 */
export default function ObnovitZamestnance({
  akce,
  id,
  rozsah,
  jmeno,
}: {
  /** Serverová akce z ./akce.ts. Předává se jako vlastnost. */
  akce: (formData: FormData) => Promise<void>
  id: string
  rozsah: string
  /** Do otázky, ať je vidět, o koho jde. */
  jmeno: string
}) {
  const [ptameSe, setPtameSe] = useState(false)

  return (
    <form action={akce} style={{ display: 'inline-grid', gap: '6px', justifyItems: 'start' }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rozsah" value={rozsah} />

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          type="submit"
          className="ft-tl ft-tl-male ft-tl-vedlejsi"
          onClick={(e) => {
            if (ptameSe) return
            e.preventDefault()
            setPtameSe(true)
          }}
        >
          {ptameSe ? `Opravdu obnovit ${jmeno}` : 'Obnovit'}
        </button>

        {ptameSe ? (
          <button
            type="button"
            className="ft-tl ft-tl-vedlejsi ft-tl-male"
            onClick={() => setPtameSe(false)}
          >
            Zpět
          </button>
        ) : null}
      </div>

      {ptameSe ? (
        <p
          aria-live="polite"
          style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--muted)',
            maxWidth: '34ch',
            textAlign: 'left',
          }}
        >
          Vrátí se do Lidí i do firmy — se stejnými právy, jaké měl
          před smazáním. Kdo mu je smí vrátit, hlídá databáze; bez
          oprávnění se obnovení nepovede.
        </p>
      ) : null}
    </form>
  )
}
