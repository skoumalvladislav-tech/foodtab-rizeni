'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Majitel potvrdí zálohu za zaměstnance (25. 9. 2026).
 *
 * Dvoukrokové schválně, stejně jako storno: první kliknutí jen ukáže,
 * CO se tím tvrdí — že konkrétní člověk dostal konkrétní částku do ruky.
 * Vrátit to nejde a zaměstnanec s účtem to uvidí v upozorněních.
 *
 * Tlačítko se kreslí jen majiteli (stránka), ale zámek je v databázi
 * (`potvrdit_zalohu_za_zamestnance` → `app.is_owner`).
 *
 * Tlačítka jsou plné výšky (44 px), ne `ft-tl-male`: ťuká se na ně na
 * telefonu a jde o peníze.
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
  const varovani = useRef<HTMLParagraphElement>(null)
  const tlacitko = useRef<HTMLButtonElement>(null)
  const byloOtevreno = useRef(false)

  /*
    Fokus. Po prvním kliknutí tlačítko zmizí a fokus by spadl na začátek
    stránky — čtečka ani klávesnice by varování „vrátit to nejde"
    nedostaly. Proto se přesune NA VAROVÁNÍ (ne rovnou na „Ano, potvrdit":
    druhý Enter by potvrdil, aniž by ho kdo přečetl) a po „Zpět" zase
    na tlačítko.
  */
  useEffect(() => {
    if (otevreno) varovani.current?.focus()
    else if (byloOtevreno.current) tlacitko.current?.focus()
    byloOtevreno.current = otevreno
  }, [otevreno])

  if (!otevreno) {
    return (
      <button
        ref={tlacitko}
        type="button"
        className="ft-tl ft-tl-vedlejsi"
        aria-label={`Potvrdit za zaměstnance: ${jmeno}, ${castka}`}
        onClick={() => setOtevreno(true)}
      >
        Potvrdit za zaměstnance
      </button>
    )
  }

  return (
    <form action={akce} style={{ display: 'grid', gap: '8px', maxWidth: '340px' }}>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="zaloha" value={id} />
      <p
        ref={varovani}
        tabIndex={-1}
        className="ds-zal-varovani"
        style={{ margin: 0, fontSize: '14px', lineHeight: 1.45, color: 'var(--ink)' }}
      >
        Potvrzujete, že <strong>{jmeno}</strong> dostal(a) do ruky {castka}.
        Vrátit to nejde. Zaměstnanec s účtem to uvidí v upozorněních.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="submit" className="ft-tl ft-tl-hlavni">
          Ano, potvrdit
        </button>
        <button
          type="button"
          className="ft-tl ft-tl-vedlejsi"
          onClick={() => setOtevreno(false)}
        >
          Zpět
        </button>
      </div>
    </form>
  )
}
