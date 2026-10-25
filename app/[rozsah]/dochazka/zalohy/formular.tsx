'use client'

import { useActionState, useState } from 'react'

import { vyplatitZalohu, type StavVyplaceni } from './akce'

/**
 * Když se odpověď ze serveru ztratí, nevíme, jestli se záloha zapsala.
 * Číslo odeslání zůstává stejné, takže opakování ji podruhé nezapíše —
 * a přesně to se obsluze říká.
 */
const SPOJENI_VYPADLO =
  'Spojení vypadlo a nevíme, jestli se záloha zapsala. Stiskněte Vyplatit znovu — když už zapsaná je, podruhé se nezapíše.'

/** Nové číslo pro další vyplnění. Bez crypto.randomUUID (starý prohlížeč) prázdné = bez ochrany, jako dřív. */
function noveCislo(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : ''
}

/**
 * Jeden pokus o výplatu. Vrací stav formuláře a jestli se má pro další
 * vyplnění vylosovat NOVÉ číslo odeslání — jen po úspěchu. Po chybě
 * i po výpadku spojení zůstává staré, aby opakování zálohu podruhé
 * nezapsalo. Zvlášť od komponenty, aby se to dalo vyzkoušet
 * (scripts/zalohy.test.mjs).
 */
export async function odeslatZalohu(
  akce: (predchozi: StavVyplaceni, formData: FormData) => Promise<StavVyplaceni>,
  predchozi: StavVyplaceni,
  formData: FormData,
): Promise<{ stav: StavVyplaceni; noveCislo: boolean }> {
  try {
    const stav = await akce(predchozi, formData)
    return { stav, noveCislo: stav.stav === 'hotovo' }
  } catch {
    // Odpověď se nevrátila (výpadek sítě). Číslo se NEMĚNÍ.
    return {
      stav: {
        stav: 'chyba',
        text: SPOJENI_VYPADLO,
        hodnoty: {
          zamestnanec: String(formData.get('zamestnanec') ?? ''),
          castka: String(formData.get('castka') ?? ''),
          poznamka: String(formData.get('poznamka') ?? ''),
        },
      },
      noveCislo: false,
    }
  }
}

/**
 * Vyplacení zálohy.
 *
 * Klientský kvůli varování: „odpracováno zatím 8 400 Kč, vyplácíte
 * 10 000 Kč“ se musí ukázat PO zápisu, u toho řádku, ne jako parametr
 * v adrese. Rozhodnutí ze 1. 9. (oddíl 11 bod 3): aplikace vyšší zálohu
 * nikdy neodmítne, jen ji ohlásí — o penězích rozhoduje majitel.
 *
 * JEDNA ZÁLOHA = JEDNO ZAPSÁNÍ (25. 10. 2026). „Odečítání záloh se
 * zdvojovalo": na provozovně nešel internet, záloha se zapsala, odpověď
 * nedošla a obsluha vyplatila znovu. Proto každé vyplnění nese číslo
 * odeslání (`klic`, první vylosuje server). Mění se AŽ po úspěchu — po
 * chybě nebo výpadku se opakuje se stejným číslem a databáze druhou
 * zálohu nezapíše. Totéž dvojí ťuknutí: React druhé odeslání zařadí do
 * fronty, ale s číslem z chvíle ťuknutí, tedy stejným.
 */
export default function FormularZalohy({
  rozsah,
  lide,
  klic: prvniKlic,
}: {
  rozsah: string
  lide: { id: string; jmeno: string }[]
  /** Číslo prvního vyplnění, vylosované serverem (bez rozdílu při hydrataci). */
  klic: string
}) {
  const [klic, setKlic] = useState(prvniKlic)

  const [stav, akce, ceka] = useActionState<StavVyplaceni, FormData>(
    async (predchozi, formData) => {
      const { stav, noveCislo: nove } = await odeslatZalohu(vyplatitZalohu, predchozi, formData)
      if (nove) setKlic(noveCislo())
      return stav
    },
    { stav: 'nic' },
  )

  // Po chybě se pole vyplní tím, co v nich bylo — ať se opakuje TOTÉŽ
  // odeslání a nepíše se znovu (a s překlepem jinak).
  const hodnoty = stav.stav === 'chyba' ? stav.hodnoty : undefined

  return (
    <section style={karta}>
      <h2 style={nadpis}>Vyplatit zálohu</h2>
      <p style={popis}>
        Záznam o hotovosti, která přešla z ruky do ruky — peníze aplikace
        nikam neposílá. Zaměstnanec zálohu potvrdí ve svém telefonu (přijde
        mu upozornění), nebo PINem na tabletu — tím se z ní stane doklad,
        ne tvrzení jednoho člověka. Až ji potvrdí, uvidíte to
        v upozorněních.
      </p>

      <form action={akce} style={mrizka}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="klic" value={klic} />

        <label style={poleLabel}>
          <span>Komu</span>
          <select name="zamestnanec" required style={pole} defaultValue={hodnoty?.zamestnanec ?? ''}>
            <option value="">— Vyberte —</option>
            {lide.map((l) => (
              <option key={l.id} value={l.id}>
                {l.jmeno}
              </option>
            ))}
          </select>
        </label>

        <label style={poleLabel}>
          <span>Částka v Kč</span>
          <input
            name="castka"
            defaultValue={hodnoty?.castka ?? ''}
            required
            inputMode="decimal"
            placeholder="2000"
            style={pole}
          />
        </label>

        <label style={{ ...poleLabel, gridColumn: '1 / -1' }}>
          <span>Poznámka (nepovinná)</span>
          <input
            name="poznamka"
            defaultValue={hodnoty?.poznamka ?? ''}
            maxLength={200}
            placeholder="hotově u baru"
            style={pole}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
            {ceka ? 'Zapisuji…' : 'Vyplatit'}
          </button>
        </div>
      </form>

      {stav.stav === 'chyba' ? <p className="hlaska-chyba">{stav.text}</p> : null}

      {stav.stav === 'hotovo' ? (
        <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
          {stav.opakovane ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
              Tahle záloha už zapsaná byla: <strong>{stav.castka} Kč</strong> pro{' '}
              {stav.komu}. Podruhé se nezapsala — vyplacená je jednou.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
              Zapsáno: <strong>{stav.castka} Kč</strong> pro {stav.komu}. Čeká,
              až ji potvrdí — v telefonu, nebo PINem na tabletu.
            </p>
          )}

          {/*
            Varování, ne odmítnutí. Záloha už je zapsaná — tohle je
            informace pro obsluhu, ne otázka.
          */}
          {stav.varovani ? (
            <p style={ramecek}>
              <strong>Pozor:</strong> {stav.varovani} Vyplaceno to je;
              tohle je jen upozornění.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  marginBottom: '16px',
  maxWidth: '640px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.5,
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '12px',
  alignItems: 'end',
} as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const
