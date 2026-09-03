'use client'

import { useActionState } from 'react'

import { pridelitPin, zrusitPin, type StavPinu } from './akce'

/**
 * Přidělení PINu u člověka.
 *
 * Zadání docs/pin-prideleni-zadani.md, oddíl 2.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ SERVEROVÁ KOMPONENTA S PŘESMĚROVÁNÍM
 *
 * Zbytek téhle obrazovky si stav předává adresou (`?upravuji=…`). PIN
 * takhle předat nejde: v adrese by zůstal v historii prohlížeče,
 * v odkazovači a v protokolech serveru. Chodí proto jako návratová
 * hodnota akce, ukáže se a zapomene.
 *
 * ---------------------------------------------------------------------
 * UKÁŽE SE JEDNOU
 *
 * V databázi je jen otisk se solí (pravidlo 7). Přečíst PIN zpětně
 * neumí nikdo — ani majitel, ani ten, kdo by získal zálohu databáze.
 * Když se ztratí, přenastaví se nový.
 *
 * Ta věta u něj je schválně stejného ražení jako u registrace tabletu:
 * lidé ji tam už jednou viděli a vědí, co znamená.
 *
 * ---------------------------------------------------------------------
 * PRÁZDNÉ POLE = VYGENEROVAT
 *
 * Nabízí se předvyplněný návrh z databáze, ale i když ho člověk smaže,
 * vygeneruje se volný. Kdyby prázdné pole znamenalo chybu, půlka lidí
 * by měla 1234.
 */
export default function PanelPinu({
  rozsah,
  zamestnanec,
  jmeno,
  maUcet,
  maPin,
  nastavenKdy,
  navrh,
}: {
  rozsah: string
  zamestnanec: string
  jmeno: string
  maUcet: boolean
  maPin: boolean
  nastavenKdy: string | null
  /** Předvyplněný volný PIN z databáze. Prázdný, když se nepodařil. */
  navrh: string | null
}) {
  const [stav, akce, ceka] = useActionState<StavPinu, FormData>(pridelitPin, {
    stav: 'nic',
  })
  const [stavZruseni, akceZruseni, cekaZruseni] = useActionState<StavPinu, FormData>(
    zrusitPin,
    { stav: 'nic' },
  )

  const hotovo = stav.stav === 'hotovo'
  const zruseno = stavZruseni.stav === 'zruseno'

  return (
    <section style={karta}>
      <h2 style={nadpis}>PIN ke kiosku — {jmeno}</h2>

      {hotovo ? (
        <>
          <p style={{ margin: '0 0 6px', fontSize: '14px', color: 'var(--muted)' }}>
            PIN pro {stav.jmeno}:
          </p>
          <p style={pinStyl}>{stav.pin}</p>
          <p style={ramecek}>
            <strong>Ukáže se jenom teď.</strong> Když ho ztratíte,
            přenastavte nový — přečíst se nedá ani z databáze.
            {maUcet
              ? ' Zaměstnanci jsme poslali upozornění, že mu byl PIN přenastaven; samotný PIN v něm není.'
              : ' Tenhle člověk nemá účet, takže mu ho musíte předat sami.'}
          </p>
        </>
      ) : (
        <>
          <p style={popis}>
            PINem se píchá na tabletu — nic jiného nedovolí. Zadává se
            jen PIN, žádné jméno, takže <strong>dva lidé na jedné
            pobočce ho nesmí mít stejný</strong>; obsazený se odmítne.
            {!maUcet ? (
              <>
                {' '}
                {jmeno} nemá účet, takže tohle je jediná cesta, jak mu
                PIN dát.
              </>
            ) : null}
          </p>

          {maPin && !zruseno ? (
            <p style={{ ...popis, color: 'var(--ink)' }}>
              PIN už nastavený má
              {nastavenKdy ? ` (nastaven ${denCesky(nastavenKdy)})` : ''}.
              Přenastavením starý přestane platit.
            </p>
          ) : null}
          {zruseno ? (
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--dobre)' }}>
              PIN zrušen. Na tabletu se tenhle člověk zatím nepíchne.
            </p>
          ) : null}

          <form action={akce} style={{ display: 'grid', gap: '12px', maxWidth: '360px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="zamestnanec" value={zamestnanec} />
            <input type="hidden" name="jmeno" value={jmeno} />

            <label style={poleLabel}>
              <span>PIN</span>
              <input
                name="pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                defaultValue={navrh ?? ''}
                placeholder="necháte-li prázdné, vygenerujeme ho"
                style={{ ...pole, letterSpacing: '.3em', fontSize: '22px' }}
              />
              <span style={vysvetlivka}>
                Čtyři až šest číslic. Samé stejné číslice a řady jako
                1234 se odmítnou — jinak by je měla půlka lidí a začaly
                by se plést.
              </span>
            </label>

            {stav.stav === 'chyba' ? <p className="hlaska-chyba">{stav.text}</p> : null}
            {stavZruseni.stav === 'chyba' ? (
              <p className="hlaska-chyba">{stavZruseni.text}</p>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
                {ceka ? 'Nastavuji…' : maPin && !zruseno ? 'Přenastavit PIN' : 'Přidělit PIN'}
              </button>
            </div>
          </form>

          {maPin && !zruseno ? (
            <form action={akceZruseni} style={{ marginTop: '12px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="zamestnanec" value={zamestnanec} />
              <button
                type="submit"
                className="ft-tl ft-tl-vedlejsi ft-tl-male"
                disabled={cekaZruseni}
              >
                {cekaZruseni ? 'Ruším…' : 'Zrušit PIN'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  )
}

/** „3. 9. 2026“ */
function denCesky(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`
}

/* --- styly ---------------------------------------------------------- */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  margin: '0 16px 24px',
  maxWidth: '640px',
} as const

const nadpis = { margin: '0 0 10px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.5,
} as const

const pinStyl = {
  margin: '0 0 14px',
  fontSize: '44px',
  letterSpacing: '.18em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums' as const,
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
  maxWidth: '62ch',
} as const

const poleLabel = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '48px',
} as const

const vysvetlivka = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  textTransform: 'none' as const,
  letterSpacing: 'normal',
  lineHeight: 1.45,
} as const
