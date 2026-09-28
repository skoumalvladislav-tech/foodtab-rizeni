'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import Ikona from '@/app/[rozsah]/ikona'
import { odhlasit } from '@/app/prihlaseni/akce'

/**
 * Cesta ven z obrazovky, na které aplikace nic neukáže.
 *
 * „Účet zatím nepatří k žádné firmě", „Firmu se nepodařilo načíst",
 * „Sem nemáte přístup", „Máte čekající pozvánku" — všechno se kreslí
 * MIMO rám aplikace, kde je odhlášení (menu „Více"). Kontrola #85
 * (25. 9. 2026): kdo se přihlásil špatným účtem — Kateřina přes druhou
 * adresu —, neměl odtud jak odejít. Zůstal viset na větě, která mu
 * radila čekat.
 *
 * Odhlášení s dotazem, nikdy jedním ťuknutím — totéž pravidlo jako
 * v menu „Více" (components/shell/MobileVice.tsx, `Odhlaseni`). Vlastní
 * kopie jen proto, že sdílená komponenta se teprve stěhuje do vlastního
 * souboru (větev #85, components/shell/Odhlaseni.tsx). Až bude na main,
 * patří sem ona — otázka 18 g v docs/hlaseni/otazky.md.
 *
 * „Moje údaje" jen tam, kam vedou: bez firmy (a bez načtené firmy)
 * ukážou Moje údaje zase jen „Účet zatím nepatří k žádné firmě"
 * a „Zpět do aplikace" — kruh. Rozhoduje volající (`mojeUdaje`).
 *
 * Fokus se při přepnutí přesouvá sám, jako v „Více": tlačítko, na které
 * člověk ťukl, zmizí. Na dotaz přistane na „Zpět" — bezpečná volba,
 * kdyby se Enter zmáčkl dvakrát.
 */
export default function CestaVen({
  mojeUdaje = false,
  jinaAdresa = false,
  ptaSeNaZacatku = false,
}: {
  /** Přidat odkaz na Moje údaje (jen kde člověk firmu má). */
  mojeUdaje?: boolean
  /**
   * Přidat radu „přihlásili jste se jinou adresou, než na kterou přišla
   * pozvánka?". Jen tam, kde to může být příčina: bez firmy, u čekající
   * pozvánky a u „Účet je hotový". U „Sem nemáte přístup" nebo „Firmu
   * se nepodařilo načíst" by mátla (kontrola 28. 9. 2026).
   */
  jinaAdresa?: boolean
  /**
   * Začít rovnou dotazem. Aplikace to nepoužívá — je to pro kontrolu
   * ve scripts/ceka-na-opravneni.test.mjs, která bez prohlížeče neumí
   * ťuknout a druhý stav by jinak nikdy neviděla.
   */
  ptaSeNaZacatku?: boolean
}) {
  const [ptaSe, setPtaSe] = useState(ptaSeNaZacatku)
  const presunoutFokus = useRef(false)
  const odhlasitRef = useRef<HTMLButtonElement>(null)
  const zpetRef = useRef<HTMLButtonElement>(null)
  const idDotazu = useId()

  useEffect(() => {
    if (!presunoutFokus.current) return
    presunoutFokus.current = false
    ;(ptaSe ? zpetRef : odhlasitRef).current?.focus()
  }, [ptaSe])

  function prepnout(novy: boolean) {
    presunoutFokus.current = true
    setPtaSe(novy)
  }

  return (
    <div data-cesta-ven="" style={obal}>
      {ptaSe ? (
        <>
          <p id={idDotazu} style={dotaz}>
            Odhlásit se?
          </p>
          <div role="group" aria-labelledby={idDotazu} style={radek}>
            <form action={odhlasit} style={{ margin: 0 }}>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odhlásit
              </button>
            </form>
            <button
              ref={zpetRef}
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => prepnout(false)}
            >
              Zpět
            </button>
          </div>
        </>
      ) : (
        <div style={radek}>
          {mojeUdaje ? (
            <Link href="/moje-udaje" className="ft-tl ft-tl-vedlejsi">
              Moje údaje
            </Link>
          ) : null}
          {/* Ikona A slovo — samotná ikona se dá splést s čímkoli. */}
          <button
            ref={odhlasitRef}
            type="button"
            className="ft-tl ft-tl-vedlejsi"
            onClick={() => prepnout(true)}
          >
            <Ikona klic="odhlasit" />
            Odhlásit se
          </button>
        </div>
      )}
      {jinaAdresa ? (
        <p style={poznamka}>
          Přihlásili jste se jinou adresou, než na kterou vám přišla
          pozvánka? Odhlaste se a přihlaste se tou správnou.
        </p>
      ) : null}
    </div>
  )
}

const obal = {
  marginTop: '20px',
  paddingTop: '16px',
  borderTop: '1px solid var(--line)',
} as const

const radek = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: '8px',
  alignItems: 'center',
}

const dotaz = {
  margin: '0 0 10px',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--ink)',
} as const

const poznamka = {
  margin: '10px 0 0',
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: 'var(--muted)',
} as const
