'use client'

import { useEffect, useState } from 'react'

import { zbyvaDoZnovu } from '@/lib/prihlaseni'
import { overitPrvniKod, poslatPrvniKod } from './akce'

/**
 * První přihlášení z pozvánky — pro člověka, který ještě není přihlášený
 * (typicky nově pozvaný, který účet teprve dostane).
 *
 * Dva kroky na TÉŽE obrazovce: poslat kód na adresu z pozvánky → opsat
 * kód. Po ověření se pozvánka rovnou přijme a jde se do aplikace.
 * Adresu člověk nezadává — bere se z pozvánky na serveru (do prohlížeče
 * jde jen zkrácená), takže se nedá splést ani podstrčit.
 *
 * Krok „kód" žije jen v paměti stránky. Na telefonu se ale typicky stane
 * tohle: odkaz z pozvánky se otevře v kartě uvnitř Gmailu, člověk ji
 * zavře, aby si přečetl kód, a znovu ťukne na odkaz — a je zase na
 * začátku. Proto se k opsání kódu dá dostat i bez nového odeslání („Už
 * mám kód z e-mailu"), a limit odesílání vede taky na opsání kódu, ne do
 * slepé uličky. Nový kód by ten v e-mailu zneplatnil.
 */
export default function PrvniPrihlaseni({
  token,
  adresaZkracena,
}: {
  token: string
  /** Např. „j…i@seznam.cz“. Celá adresa do prohlížeče nejde. */
  adresaZkracena: string | null
}) {
  const [krok, setKrok] = useState<'start' | 'kod'>('start')
  const [kod, setKod] = useState('')
  const [ceka, setCeka] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)
  const [odeslanoKdy, setOdeslanoKdy] = useState(0)
  const [ted, setTed] = useState(0)

  // „Poslat znovu" se odpočítává od času ze serveru; hodiny tikají jen
  // v kroku s kódem.
  useEffect(() => {
    if (krok !== 'kod') return
    const id = setInterval(() => setTed(Date.now()), 1000)
    return () => clearInterval(id)
  }, [krok])

  const zbyva = zbyvaDoZnovu(odeslanoKdy, ted)

  async function poslat() {
    setCeka(true)
    setChyba(null)
    const v = await poslatPrvniKod(token)
    if (v.ok) {
      const kdy = v.odeslanoKdy ?? Date.now()
      setOdeslanoKdy(kdy)
      setTed(kdy)
      setKrok('kod')
    } else {
      setChyba(v.chyba ?? 'Kód se nepodařilo poslat.')
      if (v.zadatKod) setKrok('kod')
    }
    setCeka(false)
  }

  function uzMamKod() {
    setChyba(null)
    setKrok('kod')
  }

  async function overit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCeka(true)
    setChyba(null)
    const v = await overitPrvniKod(token, kod)
    if (v.ok) {
      // Celé načtení: nové sezení je v cookie a rozcestí si ho má přečíst
      // od začátku.
      window.location.assign('/')
      return
    }
    if (v.prihlasen) {
      // Přihlášený je, jen přijetí neprošlo — stránka ukáže tlačítko
      // „Přijmout pozvánku" s hláškou z databáze.
      window.location.reload()
      return
    }
    setChyba(v.chyba ?? 'Kód se nepodařilo ověřit.')
    setCeka(false)
  }

  if (krok === 'start') {
    return (
      <div style={formular}>
        <p style={text}>
          Poprvé se přihlásíte kódem, který vám pošleme
          {adresaZkracena ? <> na <strong>{adresaZkracena}</strong></> : ' na adresu z pozvánky'}.
          Heslo nepotřebujete.
        </p>
        {chyba ? <p className="hlaska-chyba" role="alert">{chyba}</p> : null}
        <button type="button" className="ft-tl ft-tl-hlavni" disabled={ceka} onClick={poslat}>
          {ceka ? 'Posílám…' : 'Poslat kód'}
        </button>
        <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" disabled={ceka} onClick={uzMamKod}>
          Už mám kód z e-mailu
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={overit} style={formular}>
      <p style={text}>
        {odeslanoKdy > 0 ? 'Kód jsme poslali' : 'Opište kód z e-mailu, který přišel'}
        {adresaZkracena ? <> na <strong>{adresaZkracena}</strong></> : ''}. Platí
        několik minut. Když nepřijde, podívejte se i do nevyžádané pošty.
      </p>

      <label htmlFor="kod-z-pozvanky" style={popisek}>
        Kód z e-mailu
      </label>
      <input
        id="kod-z-pozvanky"
        name="kod"
        value={kod}
        onChange={(e) => setKod(e.target.value)}
        autoComplete="one-time-code"
        inputMode="numeric"
        autoFocus
        required
        placeholder="123456"
        style={pole}
      />

      {chyba ? <p className="hlaska-chyba" role="alert">{chyba}</p> : null}

      <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
        {ceka ? 'Ověřuji…' : 'Přihlásit a vstoupit do firmy'}
      </button>

      <button
        type="button"
        className="ft-tl ft-tl-vedlejsi ft-tl-male"
        disabled={ceka || zbyva > 0}
        onClick={poslat}
      >
        {zbyva > 0 ? `Poslat kód znovu (za ${zbyva} s)` : 'Poslat kód znovu'}
      </button>
      <p style={{ ...text, fontSize: '12px' }}>Nový kód zneplatní ten předchozí.</p>
    </form>
  )
}

/* --- Styly (stejné jako u přijetí pozvánky) --- */

const formular = {
  display: 'grid',
  gap: '14px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: 'var(--shadow)',
} as const

const text = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--muted)',
  lineHeight: 1.55,
} as const

const popisek = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--ink)',
} as const

const pole = {
  minHeight: '48px',
  padding: '0 14px',
  fontSize: '20px',
  letterSpacing: '.2em',
  border: '1px solid var(--line-2)',
  borderRadius: '10px',
  background: 'var(--card)',
  color: 'var(--ink)',
  width: '100%',
  boxSizing: 'border-box',
} as const
