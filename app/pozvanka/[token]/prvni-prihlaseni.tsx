'use client'

import { useRef, useState, useSyncExternalStore } from 'react'

import { normalizujKod } from '@/lib/prihlaseni'
import { overitPrvniKod, poslatPrvniKod } from './akce'
import PoslatZnovu from './poslat-znovu'

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
 *
 * Pole na kód je stejné jako na přihlašovací stránce (commit 344094b):
 * NEŘÍZENÉ, bez `onChange`, a odpočet tiká ve vlastní komponentě
 * (`poslat-znovu.tsx`) — kdyby tikal tady, pole by se každou vteřinou
 * překreslilo a na telefonu by mizela bublina „Vložit".
 */
export default function PrvniPrihlaseni({
  token,
  adresaZkracena,
  vychoziKrok = 'start',
}: {
  token: string
  /** Např. „j…i@seznam.cz“. Celá adresa do prohlížeče nejde. */
  adresaZkracena: string | null
  /** Jen pro testy a náhled — v aplikaci se začíná vždycky od „start". */
  vychoziKrok?: 'start' | 'kod'
}) {
  const [krok, setKrok] = useState<'start' | 'kod'>(vychoziKrok)
  const [probiha, setProbiha] = useState<'posilam' | 'overuji' | null>(null)
  const [chyba, setChyba] = useState<string | null>(null)
  const [odeslanoKdy, setOdeslanoKdy] = useState(0)
  // Přihlášený je, jen pozvánka se nepřijala — ukáže se hláška
  // a „Pokračovat", žádné slepé obnovení stránky.
  const [jenPrihlasen, setJenPrihlasen] = useState(false)
  const poleKodu = useRef<HTMLInputElement>(null)
  const umiSchranku = useSyncExternalStore(nicNeodebira, maCteniSchranky, naServeru)

  async function poslat() {
    setProbiha('posilam')
    setChyba(null)
    try {
      const v = await poslatPrvniKod(token)
      if (v.ok) {
        setOdeslanoKdy(v.odeslanoKdy ?? Date.now())
        if (poleKodu.current) poleKodu.current.value = ''
        setKrok('kod')
      } else {
        setChyba(v.chyba ?? 'Kód se nepodařilo poslat.')
        if (v.zadatKod) setKrok('kod')
      }
    } catch {
      setChyba(SPOJENI)
    } finally {
      setProbiha(null)
    }
  }

  function uzMamKod() {
    setChyba(null)
    setKrok('kod')
  }

  async function overit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const kod = String(new FormData(e.currentTarget).get('kod') ?? '')
    setProbiha('overuji')
    setChyba(null)
    try {
      const v = await overitPrvniKod(token, kod)
      if (v.ok) {
        // Celé načtení: nové sezení je v cookie a rozcestí si ho má
        // přečíst od začátku. Tlačítka zůstanou zamčená až do odchodu.
        window.location.assign('/')
        return
      }
      if (v.prihlasen) setJenPrihlasen(true)
      setChyba(v.chyba ?? 'Kód se nepodařilo ověřit.')
    } catch {
      setChyba(SPOJENI)
    }
    setProbiha(null)
  }

  async function vlozitZeSchranky() {
    try {
      const text = await navigator.clipboard.readText()
      const pole = poleKodu.current
      if (!pole) return
      pole.value = normalizujKod(text)
      pole.focus()
    } catch {
      // Schránka je prázdná nebo ji prohlížeč nevydal — kód jde opsat.
    }
  }

  if (jenPrihlasen) {
    return (
      <div style={formular}>
        <p className="hlaska-chyba" role="alert">{chyba}</p>
        <button type="button" className="ft-tl ft-tl-hlavni" onClick={() => window.location.reload()}>
          Pokračovat
        </button>
      </div>
    )
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
        <button type="button" className="ft-tl ft-tl-hlavni" disabled={probiha !== null} onClick={poslat}>
          {probiha === 'posilam' ? 'Posílám…' : 'Poslat kód'}
        </button>
        <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" disabled={probiha !== null} onClick={uzMamKod}>
          Už mám kód z e-mailu
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={overit} style={formular}>
      <p style={text} role="status">
        {odeslanoKdy > 0 ? 'Kód jsme poslali' : 'Opište kód z e-mailu, který přišel'}
        {adresaZkracena ? <> na <strong>{adresaZkracena}</strong></> : ''}. Platí
        několik minut. Když nepřijde, podívejte se i do nevyžádané pošty.
      </p>

      <label htmlFor="kod-z-pozvanky" style={popisek}>
        Kód z e-mailu
      </label>
      <input
        ref={poleKodu}
        id="kod-z-pozvanky"
        name="kod"
        type="text"
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9  ]*"
        maxLength={16}
        autoFocus
        required
        placeholder="123456"
        style={pole}
      />
      {umiSchranku ? (
        <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={vlozitZeSchranky}>
          Vložit kód
        </button>
      ) : null}

      {chyba ? <p className="hlaska-chyba" role="alert">{chyba}</p> : null}

      <button type="submit" className="ft-tl ft-tl-hlavni" disabled={probiha !== null}>
        {probiha === 'overuji' ? 'Ověřuji…' : 'Přihlásit a vstoupit do firmy'}
      </button>

      <PoslatZnovu odeslanoKdy={odeslanoKdy} zamceno={probiha !== null} poslat={poslat} />
    </form>
  )
}

const SPOJENI = 'Spojení vypadlo. Zkuste to prosím znovu.'

/* --- Zdroje pro useSyncExternalStore ----------------------------- */

function nicNeodebira(): () => void {
  return () => {}
}
/* Firefox `readText()` nemá, Safari jen z gesta — kde to nejde, tlačítko se nekreslí. */
function maCteniSchranky(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
}
function naServeru(): boolean {
  return false
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
