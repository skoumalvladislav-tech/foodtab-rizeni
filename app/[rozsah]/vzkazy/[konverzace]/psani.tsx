'use client'

import { useState, type ReactNode } from 'react'

import Ikona from '@/app/[rozsah]/ikona'
import SkladaniZpravy from './skladani-zpravy'

/**
 * Psaní zprávy s hlasovkou a přílohou jako dvěma ikonami (T7, 27. 9.).
 *
 * Do té doby byly pod polem na psaní tři samostatné bloky za sebou —
 * text, velké tlačítko „🎤 Nahrát hlasovku“ a „Přidat přílohu“ s větou
 * o limitech. Na telefonu to zabíralo víc místa než samotné vlákno.
 * Teď jsou hlasovka a příloha dvě ikony v řádku psaní a rozbalí se až
 * po klepnutí.
 *
 * Rozbalené části se jen SKRÝVAJÍ (`hidden`), neodmontovávají: kdo
 * nahrává a omylem klepne vedle, nepřijde o nahrávku.
 *
 * Panely stojí MIMO formulář psaní — hlasovka i příloha se odesílají
 * svými akcemi a vnořený formulář by HTML nedovolilo.
 */
export default function Psani({
  rozsah,
  konverzace,
  uzivatel,
  smiNalehavou,
  vetaODoruceni,
  hlasovka,
  priloha,
}: {
  rozsah: string
  konverzace: string
  uzivatel: string
  smiNalehavou: boolean
  /** Věta pod psaním o tom, kdy zpráva vyruší (podle čtenáře). */
  vetaODoruceni: string
  hlasovka: ReactNode
  /** Null, když přílohy nejsou (migrace 20260921130000 chybí). */
  priloha: ReactNode | null
}) {
  const [otevreno, setOtevreno] = useState<'hlasovka' | 'priloha' | null>(null)
  const prepnout = (co: 'hlasovka' | 'priloha') => setOtevreno((o) => (o === co ? null : co))

  const tlacitka = (
    <div className="pc-doplnky">
      <button
        type="button"
        className="pc-doplnek"
        aria-expanded={otevreno === 'hlasovka'}
        aria-controls="pc-doplnek-hlasovka"
        title="Hlasová zpráva"
        onClick={() => prepnout('hlasovka')}
      >
        <Ikona klic="mikrofon" />
        <span className="sr-only">Hlasová zpráva</span>
      </button>
      {priloha ? (
        <button
          type="button"
          className="pc-doplnek"
          aria-expanded={otevreno === 'priloha'}
          aria-controls="pc-doplnek-priloha"
          title="Příloha (fotka nebo PDF)"
          onClick={() => prepnout('priloha')}
        >
          <Ikona klic="sponka" />
          <span className="sr-only">Příloha</span>
        </button>
      ) : null}
    </div>
  )

  return (
    <>
      <SkladaniZpravy
        rozsah={rozsah}
        konverzace={konverzace}
        uzivatel={uzivatel}
        smiNalehavou={smiNalehavou}
        vetaODoruceni={vetaODoruceni}
        tlacitka={tlacitka}
      />
      <div id="pc-doplnek-hlasovka" className="pc-doplnek-panel" hidden={otevreno !== 'hlasovka'}>
        {hlasovka}
      </div>
      {priloha ? (
        <div id="pc-doplnek-priloha" className="pc-doplnek-panel" hidden={otevreno !== 'priloha'}>
          {priloha}
        </div>
      ) : null}
    </>
  )
}
