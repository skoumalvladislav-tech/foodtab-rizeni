'use client'

import { useState } from 'react'

/**
 * Storno zálohy.
 *
 * Dvoukrokové schválně: první kliknutí otevře políčko na důvod, teprve
 * druhé stornuje. Bez důvodu se za měsíc nedá zjistit, co se stalo —
 * a databáze ho stejně vyžaduje, tak ať se na to nepřijde až po
 * odeslání formuláře.
 *
 * Nemaže. Záznam zůstává i po stornu; smazaný pohyb peněz je díra
 * v evidenci.
 */
export default function Storno({
  akce,
  id,
  rozsah,
}: {
  akce: (formData: FormData) => Promise<void>
  id: string
  rozsah: string
}) {
  const [otevreno, setOtevreno] = useState(false)

  if (!otevreno) {
    return (
      <button
        type="button"
        className="ft-tl ft-tl-vedlejsi ft-tl-male"
        onClick={() => setOtevreno(true)}
      >
        Stornovat
      </button>
    )
  }

  return (
    <form action={akce} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="zaloha" value={id} />
      <input
        name="duvod"
        required
        maxLength={200}
        autoFocus
        placeholder="důvod storna"
        style={{
          padding: '6px 8px',
          fontSize: '13px',
          borderRadius: '8px',
          border: '1px solid var(--line-2)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          minWidth: '160px',
        }}
      />
      <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
        Potvrdit
      </button>
      <button
        type="button"
        className="ft-tl ft-tl-vedlejsi ft-tl-male"
        onClick={() => setOtevreno(false)}
      >
        Zpět
      </button>
    </form>
  )
}
