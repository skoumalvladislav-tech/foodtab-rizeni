'use client'

import { useState } from 'react'

import { prepnoutPozastaveni } from './akce'

/**
 * Pozastavení výplaty záloh.
 *
 * Zadání: docs/pozastaveni-zaloh-zadani.md.
 *
 * Dvě úrovně a obě ODMÍTAJÍ, nevarují. Platí přísnější z nich: když je
 * vypnuto za firmu, neprojde nikomu nic, i kdyby jednotlivec pozastavené
 * neměl.
 *
 * Přepínat smí jen `payroll.manage` — schválně ne ten, kdo zálohy
 * u okénka vyplácí. Kdo vykonává, nerozhoduje; jinak by stačilo dvakrát
 * kliknout a celé opatření je k ničemu.
 */
export default function Pozastaveni({
  rozsah,
  firmaPozastavena,
  lide,
}: {
  rozsah: string
  firmaPozastavena: boolean
  lide: { employee_id: string; jmeno: string; pozastaveno: boolean }[]
}) {
  const [otevreno, setOtevreno] = useState(false)

  const pozastavenych = lide.filter((l) => l.pozastaveno).length

  return (
    <section style={karta}>
      <h2 style={nadpis}>Pozastavení výplaty</h2>
      <p style={popis}>
        Záloha je dobrovolnost, ne nárok. Pozastavení{' '}
        <strong>odmítne výplatu</strong>, nejen na ni upozorní — u horní
        meze stačí varování, protože je to odhad; tohle je rozhodnutí
        a má platit.
      </p>

      {/* --- celá firma ------------------------------------------- */}
      <form action={prepnoutPozastaveni} style={radek}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="zamestnanec" value="" />
        <input type="hidden" name="pozastavit" value={firmaPozastavena ? '0' : '1'} />

        <span style={{ flex: '1 1 260px' }}>
          <strong>Celá firma</strong>
          <span style={vysvetlivka}>
            {firmaPozastavena
              ? 'Vypnuto za firmu — neprojde nikomu nic, ani tomu, kdo pozastavené nemá.'
              : 'Na jinou situaci než jednotlivec: špatný měsíc, nebo než se vyjasní, jak se zálohy povedou.'}
          </span>
        </span>

        <button
          type="submit"
          className={firmaPozastavena ? 'ft-tl ft-tl-hlavni ft-tl-male' : 'ft-tl ft-tl-vedlejsi ft-tl-male'}
        >
          {firmaPozastavena ? 'Povolit zálohy' : 'Pozastavit za firmu'}
        </button>
      </form>

      {/* --- jednotlivci ------------------------------------------ */}
      <button
        type="button"
        onClick={() => setOtevreno(!otevreno)}
        style={rozbalovatko}
      >
        {otevreno ? '▼' : '▶'} U jednotlivců
        {pozastavenych > 0 ? ` — pozastaveno ${pozastavenych}` : ''}
      </button>

      {otevreno ? (
        <div style={{ display: 'grid', gap: '4px', marginTop: '8px' }}>
          {lide.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Žádní zaměstnanci na pobočkách, na které vidíte.
            </p>
          ) : (
            lide.map((l) => (
              <form key={l.employee_id} action={prepnoutPozastaveni} style={radek}>
                <input type="hidden" name="rozsah" value={rozsah} />
                <input type="hidden" name="zamestnanec" value={l.employee_id} />
                <input
                  type="hidden"
                  name="pozastavit"
                  value={l.pozastaveno ? '0' : '1'}
                />

                <span style={{ flex: '1 1 200px' }}>
                  {l.jmeno}
                  {l.pozastaveno ? (
                    <span style={{ color: 'var(--pozor)', fontSize: '13px' }}>
                      {' '}
                      — pozastaveno
                    </span>
                  ) : null}
                </span>

                <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  {l.pozastaveno ? 'Povolit' : 'Pozastavit'}
                </button>
              </form>
            ))
          )}
        </div>
      ) : null}

      <p style={{ ...popis, margin: '14px 0 0', fontSize: '12.5px' }}>
        Pozastavení <strong>nemaže historii</strong> — dřív vyplacené
        zálohy zůstávají v přehledech i v součtech. Storno projde i
        u pozastaveného člověka, jinak by se špatně zadaná záloha nedala
        opravit. Každé přepnutí jde do auditu, oběma směry.
      </p>
    </section>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  marginTop: '28px',
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

const radek = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap' as const,
  padding: '10px 0',
  borderTop: '1px solid var(--line)',
  fontSize: '14px',
} as const

const vysvetlivka = {
  display: 'block',
  fontSize: '12.5px',
  color: 'var(--muted)',
  marginTop: '2px',
  maxWidth: '52ch',
  lineHeight: 1.45,
} as const

const rozbalovatko = {
  marginTop: '10px',
  padding: 0,
  background: 'none',
  border: 'none',
  color: 'var(--muted)',
  fontSize: '13px',
  cursor: 'pointer',
  textAlign: 'left' as const,
} as const
