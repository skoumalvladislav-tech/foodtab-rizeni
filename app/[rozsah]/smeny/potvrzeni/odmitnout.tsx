'use client'

import { useState } from 'react'

/**
 * Odmítnutí SVÉ směny — dvoukrokové, stejná úvaha jako storno úseku
 * docházky (`dochazka/clovek/uprava-useku.tsx`, `StornoNaMiste`) a jako
 * storno zálohy (`dochazka/zalohy/storno.tsx`): první kliknutí otevře
 * povinný důvod, teprve druhé odmítne. Nic se nemaže — řádek zůstane
 * v tabulce se stavem „odmítnuto“ a jde ho zase vzít zpět (Potvrdit).
 */
export default function OdmitnoutSmenu({
  akce,
  smena,
  rozsah,
}: {
  akce: (formData: FormData) => Promise<void>
  smena: string
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
        Odmítnout…
      </button>
    )
  }

  return (
    <form action={akce} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="smena" value={smena} />
      <input
        name="duvod"
        required
        minLength={1}
        maxLength={300}
        autoFocus
        placeholder="důvod odmítnutí (povinné)"
        style={{
          padding: '6px 8px',
          fontSize: '13px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--line-2)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          minWidth: '180px',
        }}
      />
      <button type="submit" className="ft-tl ft-tl-nebezpecne ft-tl-male">
        Odmítnout
      </button>
      <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => setOtevreno(false)}>
        Zpět
      </button>
    </form>
  )
}
