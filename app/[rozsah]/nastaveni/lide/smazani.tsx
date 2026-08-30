'use client'

import { useState } from 'react'

/**
 * Tlačítko Smazat u řádku zaměstnance. Dva kroky.
 *
 * V řádku je tiché (.ft-tl-vedlejsi). Jedenáct červených tlačítek pod
 * sebou dělá z výstrahy tapetu — a mazání je jediná akce, u které má
 * červená ještě něco znamenat. Plný nebezpečný vzhled proto přijde až
 * na druhý krok, kdy se opravdu ptáme.
 *
 * Ptáme se v ploše, ne přes window.confirm: systémové okno se nedá
 * obarvit a hlavně se do něj nevejde vysvětlení, na kterém tady záleží
 * víc než na barvě — že se člověk neodstraní.
 *
 * Tlačítko je pořád type="submit" a první kliknutí se ruší až
 * v obsluze. Bez JavaScriptu tak formulář odejde rovnou, jako dřív;
 * u soft-delete je to přijatelné, řádek zůstává v databázi.
 *
 * Klientská je jen ta otázka. Vlastní mazání dělá serverová akce, která
 * si oprávnění ověří znovu — kdo obejde otázku, nic tím neotevře.
 */
export default function SmazatZamestnance({
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
        {/*
          Je to pořád tentýž prvek, jen jinak vypadá a jinak se jmenuje.
          React ho proto nevyhodí a nenahradí novým — kdo se sem dostal
          klávesnicí, o zaměření nepřijde.
        */}
        <button
          type="submit"
          className={`ft-tl ft-tl-male ${ptameSe ? 'ft-tl-nebezpecne' : 'ft-tl-vedlejsi'}`}
          onClick={(e) => {
            if (ptameSe) return
            e.preventDefault()
            setPtameSe(true)
          }}
        >
          {ptameSe ? `Opravdu smazat ${jmeno}` : 'Smazat'}
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

      {/*
        Pravidlo 9: mazání je označení, ne výmaz. Kdo tohle neví, bojí se
        kliknout — nebo klikne a čeká, že tím zmizí i docházka. Proto to
        stojí přímo v otázce, ne v nápovědě někde jinde.
      */}
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
          Ze seznamu zmizí, ale nesmaže se — zůstane označený jako
          odešlý. Odpracované směny a docházka na něm drží dál.
        </p>
      ) : null}
    </form>
  )
}
