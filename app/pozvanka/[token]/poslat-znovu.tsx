'use client'

import { useSyncExternalStore } from 'react'

import { zbyvaDoZnovu } from '@/lib/prihlaseni'

/**
 * „Poslat kód znovu" s odpočtem — a JEN to.
 *
 * Odpočet tiká po vteřinách. Kdyby tikal v `PrvniPrihlaseni`, překresloval
 * by každou vteřinou i políčko na kód — a na telefonu pak mizí bublina
 * „Vložit" (stejná chyba jako 6. 9. na přihlašovací stránce, commit
 * 344094b, viz app/prihlaseni/poslat-znovu.tsx). Proto tady ŽÁDNÉ pole
 * není a nesmí přibýt.
 */
export default function PoslatZnovu({
  odeslanoKdy,
  zamceno,
  poslat,
}: {
  /** Kdy se kód odeslal (čas ze serveru); 0 = v tomhle okně ještě ne. */
  odeslanoKdy: number
  /** Běží zrovna něco jiného. */
  zamceno: boolean
  poslat: () => void
}) {
  const ted = useSyncExternalStore(odebiratTik, celeVteriny, nulaNaServeru)
  const zbyva = zbyvaDoZnovu(odeslanoKdy, ted)

  return (
    <>
      <button
        type="button"
        className="ft-tl ft-tl-vedlejsi ft-tl-male"
        disabled={zamceno || zbyva > 0}
        onClick={poslat}
      >
        {zbyva > 0 ? `Poslat kód znovu (za ${zbyva} s)` : 'Poslat kód znovu'}
      </button>
      <p style={poznamka}>Nový kód zneplatní ten předchozí.</p>
    </>
  )
}

/*
  `getSnapshot` musí mezi dvěma tiky vracet TOTÉŽ číslo — proto celé
  vteřiny, ne `Date.now()` (to by React překresloval donekonečna).
*/
function odebiratTik(zmena: () => void): () => void {
  const t = setInterval(zmena, 1000)
  return () => clearInterval(t)
}
function celeVteriny(): number {
  return Math.floor(Date.now() / 1000) * 1000
}
function nulaNaServeru(): number {
  return 0
}

const poznamka = {
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.55,
  color: 'var(--muted)',
} as const
