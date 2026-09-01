'use client'

import { useActionState } from 'react'

import { prijmoutMojiPozvanku, type StavPrijeti } from './prijmout-akce'

/**
 * Tlačítko „Přijmout pozvánku“.
 *
 * Klientské kvůli chybě: kdyby se ukazovala přes adresu, zůstala by
 * v ní viset i po obnovení stránky. Tady zmizí, jakmile člověk zkusí
 * znovu.
 *
 * Hláška z databáze se PROPOUŠTÍ. Je česká, napsaná pro člověka a blíž
 * příčině než cokoli, co bychom vymysleli tady — přesně na tom dnes
 * pohořela obrazovka pozvánky (bod 5 zadání).
 */
export default function PrijmoutPozvanku({
  id,
  firma,
  jedina,
}: {
  id: string
  firma: string
  jedina: boolean
}) {
  const [stav, akce, ceka] = useActionState<StavPrijeti, FormData>(
    prijmoutMojiPozvanku,
    { stav: 'nic' },
  )

  return (
    <form action={akce}>
      <input type="hidden" name="pozvanka" value={id} />
      <button
        type="submit"
        className="ft-tl ft-tl-hlavni"
        style={{ width: '100%', minHeight: '48px' }}
        disabled={ceka}
      >
        {ceka
          ? 'Přijímám…'
          : jedina
            ? 'Přijmout pozvánku'
            : `Přijmout — ${firma}`}
      </button>

      {stav.stav === 'chyba' ? (
        <p className="hlaska-chyba">{stav.text}</p>
      ) : null}
    </form>
  )
}
