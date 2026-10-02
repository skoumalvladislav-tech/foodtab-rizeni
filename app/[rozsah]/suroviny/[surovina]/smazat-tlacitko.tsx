'use client'

import { useState } from 'react'

/**
 * Smazání suroviny — dvoukrokové, stejný vzor jako Storno zálohy
 * (dochazka/zalohy/storno.tsx). Mazání je nevratné (pravidlo o
 * nebezpečných akcích), první kliknutí proto jen nabídne potvrzení.
 */
export default function SmazatTlacitko({
  akce,
  rozsah,
  surovina,
}: {
  akce: (formData: FormData) => Promise<void>
  rozsah: string
  surovina: string
}) {
  const [otevreno, setOtevreno] = useState(false)

  if (!otevreno) {
    return (
      <button type="button" className="ft-tl ft-tl-nebezpecne ft-tl-male" onClick={() => setOtevreno(true)}>
        Smazat surovinu
      </button>
    )
  }

  return (
    <form action={akce} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="surovina" value={surovina} />
      <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Opravdu smazat?</span>
      <button type="submit" className="ft-tl ft-tl-nebezpecne ft-tl-male">
        Ano, smazat
      </button>
      <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => setOtevreno(false)}>
        Zpět
      </button>
    </form>
  )
}
