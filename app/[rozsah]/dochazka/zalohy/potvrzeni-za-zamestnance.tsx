'use client'

import { useState } from 'react'

/**
 * Majitel potvrdí zálohu za zaměstnance (25. 9. 2026).
 *
 * Dvoukrokové schválně, stejně jako storno: první kliknutí jen ukáže,
 * CO se tím tvrdí — že konkrétní člověk dostal konkrétní částku do ruky.
 * Vrátit to nejde a zaměstnanec o tom dostane zprávu.
 *
 * Tlačítko se kreslí jen majiteli (stránka), ale zámek je v databázi
 * (`potvrdit_zalohu_za_zamestnance` → `app.is_owner`).
 */
export default function PotvrzeniZaZamestnance({
  akce,
  id,
  rozsah,
  jmeno,
  castka,
}: {
  akce: (formData: FormData) => Promise<void>
  id: string
  rozsah: string
  jmeno: string
  castka: string
}) {
  const [otevreno, setOtevreno] = useState(false)

  if (!otevreno) {
    return (
      <button
        type="button"
        className="ft-tl ft-tl-vedlejsi ft-tl-male"
        onClick={() => setOtevreno(true)}
      >
        Potvrdit za zaměstnance
      </button>
    )
  }

  return (
    <form action={akce} style={{ display: 'grid', gap: '6px', maxWidth: '280px' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="zaloha" value={id} />
      <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.45, color: 'var(--ink)' }}>
        Potvrzujete za <strong>{jmeno}</strong>, že {castka} dostal(a) do
        ruky. Vrátit to nejde; zaměstnanec o tom dostane zprávu.
      </p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
          Ano, potvrdit
        </button>
        <button
          type="button"
          className="ft-tl ft-tl-vedlejsi ft-tl-male"
          onClick={() => setOtevreno(false)}
        >
          Zpět
        </button>
      </div>
    </form>
  )
}
