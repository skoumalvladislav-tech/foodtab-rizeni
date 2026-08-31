'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { precistCsv, zTabulky, type Tabulka } from '@/lib/tabulka'
import { precistXlsx, SouborNecitelny } from '@/lib/xlsx'
import {
  NEJVIC_RADKU,
  odhadnoutMapovani,
  POLE,
  type Mapovani,
  type Plan,
} from '@/lib/nahrani-lidi'
import { nahratLidi, pripravitNahled, type Vysledek } from './akce'

/**
 * Průvodce nahráním lidí z tabulky.
 *
 * Pořadí kroků je ze zadání (docs/nahravani-dat-zadani.md, oddíl B)
 * a nesmí se zkrátit: soubor → přiřazení sloupců → NÁHLED → potvrzení.
 * Náhled se nepřeskakuje ani „když je to jasné“ — nahrání bez náhledu
 * je způsob, jak si někdo přepíše celý seznam lidí a zjistí to za týden.
 *
 * Soubor se čte tady, v prohlížeči, a na server se posílají jen buňky
 * a přiřazení sloupců. Nikam se neukládá.
 */

type Krok = 'soubor' | 'sloupce' | 'nahled' | 'hotovo'

export default function Pruvodce({ rozsah }: { rozsah: string }) {
  const [krok, setKrok] = useState<Krok>('soubor')
  const [nazevSouboru, setNazevSouboru] = useState('')
  const [tabulka, setTabulka] = useState<Tabulka | null>(null)
  const [mapovani, setMapovani] = useState<Mapovani>({})
  const [plan, setPlan] = useState<Plan | null>(null)
  const [hotovo, setHotovo] = useState<Extract<Vysledek, { stav: 'hotovo' }> | null>(null)
  const [chyba, setChyba] = useState('')
  const [ceka, spust] = useTransition()

  async function vybranSoubor(e: React.ChangeEvent<HTMLInputElement>) {
    const soubor = e.target.files?.[0]
    if (!soubor) return
    setChyba('')
    try {
      const t = await precistSoubor(soubor)
      if (t.hlavicka.length === 0) {
        setChyba('V souboru se nenašla žádná tabulka.')
        return
      }
      if (t.radky.length === 0) {
        setChyba('Soubor má jen záhlaví, žádné řádky s lidmi.')
        return
      }
      setNazevSouboru(soubor.name)
      setTabulka(t)
      setMapovani(odhadnoutMapovani(t.hlavicka))
      setKrok('sloupce')
    } catch (e) {
      setChyba(
        e instanceof SouborNecitelny
          ? `${e.message} Zkuste soubor uložit jako CSV.`
          : 'Soubor se nepodařilo přečíst. Podporujeme CSV a .xlsx.',
      )
    }
  }

  function naNahled() {
    if (!tabulka) return
    setChyba('')
    spust(async () => {
      const v = await pripravitNahled({
        rozsah,
        radky: tabulka.radky,
        mapovani,
        soubor: nazevSouboru,
      })
      if (v.stav === 'chyba') setChyba(v.text)
      else if (v.stav === 'plan') {
        setPlan(v.plan)
        setKrok('nahled')
      }
    })
  }

  function potvrdit() {
    if (!tabulka) return
    setChyba('')
    spust(async () => {
      const v = await nahratLidi({
        rozsah,
        radky: tabulka.radky,
        mapovani,
        soubor: nazevSouboru,
      })
      if (v.stav === 'chyba') setChyba(v.text)
      else if (v.stav === 'hotovo') {
        setHotovo(v)
        setKrok('hotovo')
      }
    })
  }

  function znovu() {
    setKrok('soubor')
    setTabulka(null)
    setPlan(null)
    setHotovo(null)
    setChyba('')
    setNazevSouboru('')
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '32px' }}>
      <Kroky krok={krok} />

      {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

      {krok === 'soubor' ? (
        <div style={karta}>
          <h2 style={nadpisKarty}>Vyberte soubor</h2>
          <p style={popis}>
            Tabulka lidí z Excelu (.xlsx) nebo CSV. Nezáleží na pořadí sloupců
            ani na tom, jak se jmenují — v dalším kroku je přiřadíte. Soubor
            zůstane u vás v počítači; posílají se jen přečtené buňky.
          </p>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={vybranSoubor}
            style={{ fontSize: '15px' }}
          />
          <p style={{ ...popis, marginBottom: 0 }}>
            Najednou jde nahrát nejvýš {NEJVIC_RADKU} řádků. Nahrání jde
            pustit i vícekrát — člověk, který už ve firmě je, se podle
            jména pozná a nezaloží se podruhé.
          </p>
        </div>
      ) : null}

      {krok === 'sloupce' && tabulka ? (
        <>
          <div style={karta}>
            <h2 style={nadpisKarty}>Co je ve kterém sloupci</h2>
            <p style={popis}>
              Soubor <strong>{nazevSouboru}</strong> — {tabulka.radky.length}{' '}
              {tabulka.radky.length === 1 ? 'řádek' : tabulka.radky.length < 5 ? 'řádky' : 'řádků'}.
              Co aplikace odhadla, opravte.
            </p>

            <div style={{ display: 'grid', gap: '12px', maxWidth: '640px' }}>
              {POLE.map((pole) => (
                <label key={pole.klic} style={radekPole}>
                  <span style={{ fontWeight: 600 }}>
                    {pole.nazev}
                    {pole.povinne ? ' *' : ''}
                    <span style={{ display: 'block', fontWeight: 400, fontSize: '12.5px', color: 'var(--muted)' }}>
                      {pole.napoveda}
                    </span>
                  </span>
                  <select
                    value={mapovani[pole.klic] ?? ''}
                    onChange={(e) =>
                      setMapovani((m) => {
                        const n = { ...m }
                        if (e.target.value === '') delete n[pole.klic]
                        else n[pole.klic] = Number(e.target.value)
                        return n
                      })
                    }
                    style={vyber}
                  >
                    <option value="">— nepřiřazeno —</option>
                    {tabulka.hlavicka.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `sloupec ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div style={karta}>
            <h2 style={nadpisKarty}>Prvních pár řádků ze souboru</h2>
            <Nahlizecka tabulka={tabulka} />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ft-tl ft-tl-hlavni"
              onClick={naNahled}
              disabled={ceka || mapovani.jmeno === undefined}
            >
              {ceka ? 'Počítám…' : 'Ukázat, co se stane'}
            </button>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={znovu}>
              Jiný soubor
            </button>
          </div>
          {mapovani.jmeno === undefined ? (
            <p style={{ ...popis, marginTop: '10px' }}>
              Bez sloupce se jménem to dál nejde — podle jména se člověk pozná.
            </p>
          ) : null}
        </>
      ) : null}

      {krok === 'nahled' && plan ? (
        <>
          <div style={karta}>
            <h2 style={nadpisKarty}>Co se stane</h2>
            <p style={{ fontSize: '17px', margin: '0 0 4px' }}>
              Založí se <strong>{plan.zalozit}</strong>, aktualizuje{' '}
              <strong>{plan.aktualizovat}</strong>, přeskočí{' '}
              <strong>{plan.preskocit}</strong>
              {plan.bezeZmeny > 0 ? (
                <>
                  {' '}
                  a <strong>{plan.bezeZmeny}</strong> zůstane beze změny
                </>
              ) : null}
              .
            </p>
            {/*
              Nová pozice nesmí vzniknout potichu. Je to jediná věc,
              kterou import zakládá mimo lidi, a v tlumeném odstavci by
              se dala přehlédnout — tady stojí v rámečku a jmenovitě.
            */}
            {plan.novePozice.length > 0 ? (
              <p
                style={{
                  margin: '12px 0',
                  padding: '10px 12px',
                  border: '1px solid var(--pozor)',
                  borderRadius: '10px',
                  background: 'var(--pozor-bg)',
                  color: 'var(--pozor)',
                  fontSize: '14px',
                  maxWidth: '68ch',
                }}
              >
                Kromě lidí se založí{' '}
                {plan.novePozice.length === 1 ? 'nová pozice' : 'nové pozice'}:{' '}
                <strong>{plan.novePozice.join(', ')}</strong>. Pokud jde
                o překlep, opravte ho v tabulce — pozice se pak už nemažou,
                jen vyřazují z nabídky.
              </p>
            ) : null}
            <p style={{ ...popis, marginBottom: 0 }}>
              Zatím se nic nezměnilo. Zapisuje se až po potvrzení.
            </p>
          </div>

          <div style={karta}>
            <h2 style={nadpisKarty}>Řádek po řádku</h2>
            <Vypis plan={plan} />
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ft-tl ft-tl-hlavni"
              onClick={potvrdit}
              disabled={ceka || plan.zalozit + plan.aktualizovat === 0}
            >
              {ceka ? 'Nahrávám…' : 'Potvrdit a nahrát'}
            </button>
            <button
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => setKrok('sloupce')}
              disabled={ceka}
            >
              Zpět k sloupcům
            </button>
          </div>
          {plan.zalozit + plan.aktualizovat === 0 ? (
            <p style={{ ...popis, marginTop: '10px' }}>
              Není co nahrát — všechno už je ve firmě stejně, nebo se
              nedá přečíst.
            </p>
          ) : null}
        </>
      ) : null}

      {krok === 'hotovo' && hotovo ? (
        <div style={karta}>
          <h2 style={nadpisKarty}>Hotovo</h2>
          <p style={{ fontSize: '17px', margin: '0 0 8px' }}>
            Založeno <strong>{hotovo.zalozeno}</strong>, aktualizováno{' '}
            <strong>{hotovo.aktualizovano}</strong>, přeskočeno{' '}
            <strong>{hotovo.preskoceno}</strong>.
          </p>
          {hotovo.novePozice.length > 0 ? (
            <p style={popis}>Nové pozice: {hotovo.novePozice.join(', ')}.</p>
          ) : null}

          {hotovo.chyby.length > 0 ? (
            <>
              <p className="hlaska-chyba">
                {hotovo.chyby.length} {hotovo.chyby.length === 1 ? 'řádek' : 'řádků'} se
                nenahrálo. Pusťte nahrání znovu — co je uvnitř, se nezdvojí.
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: '18px', fontSize: '13px' }}>
                {hotovo.chyby.slice(0, 10).map((c, i) => (
                  <li key={i}>
                    {c.cislo > 0 ? `Řádek ${c.cislo} (${c.jmeno}): ` : ''}
                    {c.text}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link href={`/${rozsah}/nastaveni/lide`} className="ft-tl ft-tl-hlavni">
              Na seznam lidí
            </Link>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={znovu}>
              Nahrát další soubor
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* --- části obrazovky ---------------------------------------------- */

const NAZVY_KROKU: { klic: Krok; nazev: string }[] = [
  { klic: 'soubor', nazev: 'Soubor' },
  { klic: 'sloupce', nazev: 'Sloupce' },
  { klic: 'nahled', nazev: 'Náhled' },
  { klic: 'hotovo', nazev: 'Potvrzení' },
]

function Kroky({ krok }: { krok: Krok }) {
  const kde = NAZVY_KROKU.findIndex((k) => k.klic === krok)
  return (
    <ol
      style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        listStyle: 'none',
        margin: '0 0 16px',
        padding: 0,
        fontSize: '13px',
      }}
    >
      {NAZVY_KROKU.map((k, i) => (
        <li
          key={k.klic}
          aria-current={i === kde ? 'step' : undefined}
          style={{
            padding: '4px 10px',
            borderRadius: '999px',
            border: '1px solid var(--line)',
            background: i === kde ? 'var(--mosaz-sv)' : 'transparent',
            color: i === kde ? '#17251e' : i < kde ? 'var(--ink)' : 'var(--muted)',
            fontWeight: i === kde ? 700 : 400,
          }}
        >
          {i + 1}. {k.nazev}
        </li>
      ))}
    </ol>
  )
}

/** Prvních pár řádků tak, jak přišly ze souboru. */
function Nahlizecka({ tabulka }: { tabulka: Tabulka }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '13px', minWidth: '100%' }}>
        <thead>
          <tr>
            {tabulka.hlavicka.map((h, i) => (
              <th key={i} style={{ ...bunka, fontWeight: 700, textAlign: 'left', whiteSpace: 'nowrap' }}>
                {h || `sloupec ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabulka.radky.slice(0, 5).map((r, i) => (
            <tr key={i}>
              {r.map((b, j) => (
                <td key={j} style={bunka}>
                  {b}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {tabulka.radky.length > 5 ? (
        <p style={{ ...popis, marginBottom: 0 }}>…a dalších {tabulka.radky.length - 5}.</p>
      ) : null}
    </div>
  )
}

const STITKY: Record<string, { text: string; barva: string; pozadi: string }> = {
  // --dobre/--pozor/--bad jsou kanonické názvy stavových barev.
  // Alias --good existuje, --good-bg ne — proto se tady používají
  // původní názvy, ať k sobě popředí a pozadí patří.
  zalozit: { text: 'založí se', barva: 'var(--dobre)', pozadi: 'var(--dobre-bg)' },
  aktualizovat: { text: 'aktualizuje', barva: 'var(--pozor)', pozadi: 'var(--pozor-bg)' },
  beze_zmeny: { text: 'beze změny', barva: 'var(--muted)', pozadi: 'transparent' },
  preskocit: { text: 'přeskočí', barva: 'var(--bad)', pozadi: 'var(--bad-bg)' },
}

function Vypis({ plan }: { plan: Plan }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
      {plan.zaznamy.map((z) => {
        const s = STITKY[z.co]
        return (
          <li key={z.cislo} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)', fontSize: '12px', minWidth: '3.2em' }}>
              ř. {z.cislo}
            </span>
            <span
              style={{
                padding: '1px 8px',
                borderRadius: '999px',
                background: s.pozadi,
                color: s.barva,
                fontSize: '11.5px',
                whiteSpace: 'nowrap',
                border: s.pozadi === 'transparent' ? '1px solid var(--line)' : 'none',
              }}
            >
              {s.text}
            </span>
            <span style={{ fontSize: '14px' }}>
              {z.jmeno || <em style={{ color: 'var(--muted)' }}>bez jména</em>}
              {z.duvod ? <span style={{ color: 'var(--muted)' }}> — {z.duvod}</span> : null}
              {z.zmeny.map((zm, i) => (
                <span key={i} style={{ color: 'var(--muted)' }}>
                  {' '}
                  · {zm.pole}: {zm.z} → {zm.na}
                </span>
              ))}
              {z.poznamky.map((p, i) => (
                <span key={i} style={{ color: 'var(--muted)' }}> · {p}</span>
              ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* --- čtení souboru -------------------------------------------------- */

/**
 * Sešit se pozná podle prvních dvou bajtů („PK“), ne podle přípony —
 * ta se dá přejmenovat a Excel ji občas napíše jinak, než co je uvnitř.
 *
 * CSV se zkusí přečíst jako UTF-8 „na tvrdo“: když v něm je bajt, který
 * do UTF-8 nepatří, jde o starší uložení z českého Excelu (windows-1250)
 * a přečte se tak. Bez toho by z „Novák“ bylo „Nov?k“.
 */
async function precistSoubor(soubor: File): Promise<Tabulka> {
  const bajty = new Uint8Array(await soubor.arrayBuffer())

  if (bajty[0] === 0x50 && bajty[1] === 0x4b) {
    return zTabulky(await precistXlsx(bajty))
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bajty)
  } catch {
    text = new TextDecoder('windows-1250').decode(bajty)
  }
  return precistCsv(text)
}

/* --- styly ---------------------------------------------------------- */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  marginBottom: '16px',
} as const

const nadpisKarty = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '8px 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '68ch',
} as const

const radekPole = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 220px)',
  gap: '12px',
  alignItems: 'center',
  fontSize: '14px',
} as const

const vyber = {
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
  width: '100%',
} as const

const bunka = {
  border: '1px solid var(--line)',
  padding: '5px 8px',
  maxWidth: '22ch',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
