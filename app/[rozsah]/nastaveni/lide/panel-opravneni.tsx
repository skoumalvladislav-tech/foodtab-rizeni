'use client'

import { useState } from 'react'

import { prideleniOpravneni } from './akce'

/**
 * Přidělení oprávnění a rozsahu jednomu člověku.
 *
 * Obojí na jedné obrazovce, protože ani jedno samo nic neotevře:
 * role bez rozsahu nedá právo nikde, rozsah bez role nedá právo žádné.
 * Viz docs/odpovedi-pozvanky-2026-09-01.md, oddíl 1.
 *
 * Klientské je to jen kvůli tomu, aby seznam poboček zmizel, když se
 * vybere celá firma. Zápis dělá serverová akce a rozhoduje databáze.
 */
export default function PanelOpravneni({
  rozsah,
  jmeno,
  zamestnanec,
  opravneni,
  pobocky,
  smiFiremni,
  nynejsiRole,
  nynejsiUroven,
  nynejsiPobocky,
  jaSam,
  posledniMajitel,
}: {
  rozsah: string
  jmeno: string
  zamestnanec: string
  /** Role, které smí přihlášený přidělit — už prosejté stropem. */
  opravneni: { id: string; label: string }[]
  /** Pobočky, na které přihlášený sám vidí. */
  pobocky: { id: string; nazev: string }[]
  /** Firemní rozsah nabízí jen ten, kdo ho má sám. */
  smiFiremni: boolean
  nynejsiRole: string | null
  nynejsiUroven: 'tenant' | 'branch'
  nynejsiPobocky: string[]
  /** Vlastní členství nejde měnit — ani vlastníkem. */
  jaSam: boolean
  /** Jediný majitel firmy. Přeřadit ho nejde, jinak firma zůstane bez majitele. */
  posledniMajitel: boolean
}) {
  const [uroven, setUroven] = useState<'tenant' | 'branch'>(
    smiFiremni ? nynejsiUroven : 'branch',
  )

  // Obojí zavírá formulář ze stejného důvodu: změna by neprošla.
  const zamceno = jaSam || posledniMajitel

  // Role, kterou má člověk dnes, ale přihlášený ji přidělit nesmí. Do
  // nabídky patří, jinak by ji odeslání formuláře tiše sebralo.
  const chybejici =
    nynejsiRole && !opravneni.some((o) => o.id === nynejsiRole)
      ? [{ id: nynejsiRole, label: 'Nynější oprávnění (přidělit ho neumíte)' }]
      : []

  return (
    <section style={karta}>
      <h2 style={nadpis}>Oprávnění pro {jmeno}</h2>

      {jaSam ? (
        <p style={ramecek}>
          <strong>Vlastní členství měnit nejde</strong>, ani vlastníkem.
          Povyšovat se nemá nikdo; kdo se potřebuje přeřadit, požádá
          někoho jiného.
        </p>
      ) : null}

      {/*
        Druhá obranná linie (docs/vlastniku-muze-byt-vic.md). Rozhodnutí
        padá ve spoušti v databázi — tohle jen říká proč dřív, než na to
        někdo klikne.
      */}
      {posledniMajitel ? (
        <p style={ramecek}>
          <strong>Tohle je jediný majitel firmy.</strong> Ve firmě musí
          zůstat aspoň jeden — nejdřív jmenujte dalšího, teprve pak jde
          tenhle přeřadit.
        </p>
      ) : null}

      <p style={popis}>
        Oprávnění říká <em>co</em> smí, rozsah <em>kde</em>. Jedno bez
        druhého neotevře nic — člověk s rolí a bez pobočky se přihlásí
        a nic neuvidí.
      </p>

      <form action={prideleniOpravneni} style={{ display: 'grid', gap: '16px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="zamestnanec" value={zamestnanec} />

        <label style={poleLabel}>
          <span>Oprávnění</span>
          <select
            name="opravneni"
            defaultValue={nynejsiRole ?? ''}
            disabled={zamceno}
            style={pole}
          >
            <option value="">Žádné — čeká na přidělení</option>
            {[...chybejici, ...opravneni].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset style={skupina} disabled={zamceno}>
          <legend style={legenda}>Rozsah</legend>

          {smiFiremni ? (
            <label style={volba}>
              <input
                type="radio"
                name="uroven"
                value="tenant"
                checked={uroven === 'tenant'}
                onChange={() => setUroven('tenant')}
              />
              <span>
                <strong>Celá firma</strong>
                <span style={vysvetlivka}>
                  Vidí všechny pobočky, i ty, které přibudou později.
                </span>
              </span>
            </label>
          ) : null}

          <label style={volba}>
            <input
              type="radio"
              name="uroven"
              value="branch"
              checked={uroven === 'branch'}
              onChange={() => setUroven('branch')}
            />
            <span>
              <strong>Vybrané pobočky</strong>
              <span style={vysvetlivka}>
                Nová pobočka se sama nepřidá — musí se sem doplnit.
              </span>
            </span>
          </label>

          {uroven === 'branch' ? (
            <div style={seznamPobocek}>
              {pobocky.length === 0 ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Nevidíte žádnou pobočku, kterou byste mohli přidělit.
                </p>
              ) : (
                pobocky.map((p) => (
                  <label key={p.id} style={volba}>
                    <input
                      type="checkbox"
                      name="pobocka"
                      value={p.id}
                      defaultChecked={nynejsiPobocky.includes(p.id)}
                    />
                    <span>{p.nazev}</span>
                  </label>
                ))
              )}
            </div>
          ) : null}
        </fieldset>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={zamceno}>
            Uložit oprávnění
          </button>
          <a
            href={`/${rozsah}/nastaveni/lide`}
            className="ft-tl ft-tl-vedlejsi"
          >
            Zpět
          </a>
        </div>
      </form>

      <p style={{ ...popis, margin: '16px 0 0' }}>
        Nabízí se jen to, co smíte přidělit sami — nikdo nepřidělí víc,
        než má. Kdyby se sem něco propašovalo jinudy, odmítne to
        databáze.
      </p>
    </section>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '16px 18px',
  marginTop: '16px',
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
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const skupina = {
  border: '1px solid var(--line)',
  borderRadius: '10px',
  padding: '12px 14px',
  display: 'grid',
  gap: '10px',
  margin: 0,
} as const

const legenda = {
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
  padding: '0 6px',
} as const

const volba = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  fontSize: '14px',
  color: 'var(--ink)',
  minHeight: '32px',
  cursor: 'pointer',
} as const

const vysvetlivka = {
  display: 'block',
  fontSize: '12.5px',
  color: 'var(--muted)',
  marginTop: '2px',
} as const

const seznamPobocek = {
  display: 'grid',
  gap: '4px',
  paddingLeft: '26px',
  borderLeft: '2px solid var(--line)',
  marginLeft: '6px',
} as const

const ramecek = {
  margin: '0 0 14px',
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const
