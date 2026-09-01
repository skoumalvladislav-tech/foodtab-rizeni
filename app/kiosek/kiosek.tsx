'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { getBrowserSupabase } from '@/lib/supabase/client'

/**
 * Obrazovka kiosku.
 *
 * Umí přesně čtyři věci ze zadání (oddíl 2) a nic dalšího:
 * ukázat měnící se kód, přijmout PIN a podle něj píchnout, ukázat, kdo
 * má dnes na téhle pobočce směnu. Potvrzení zálohy přijde s bodem 5.
 *
 * Klíč zařízení leží v prohlížeči tabletu (localStorage). Do databáze
 * se posílá jen on — nikdy se nikam neukládá, kdo je přihlášený, protože
 * na kiosku není přihlášený nikdo.
 */

const ULOZISTE = 'foodtab-kiosek-klic'

type Smena = { jmeno: string; od: string; do: string }
type Stav = {
  pobocka: string
  zarizeni: string
  kod: string
  platnost: number
  den: string
  smeny: Smena[]
}

/* ---------------------------------------------------------------------
   Klíč zařízení nežije v Reactu, ale v localStorage tabletu. Číst ho
   v efektu a dosazovat setState by znamenalo vykreslit se dvakrát —
   a React to právem hlídá. useSyncExternalStore je přesně na tohle:
   řekne se mu, jak se stav čte a jak se pozná změna.

   Server o uloženém klíči nic neví a domýšlet si ho nesmí, jinak by se
   po připojení vykreslení neshodovalo.
   ------------------------------------------------------------------ */

let posluchaci: (() => void)[] = []

function odebirat(zmena: () => void) {
  posluchaci.push(zmena)
  window.addEventListener('storage', zmena)
  return () => {
    posluchaci = posluchaci.filter((p) => p !== zmena)
    window.removeEventListener('storage', zmena)
  }
}

function ohlasit() {
  for (const p of posluchaci) p()
}

function klicKlient(): string | null {
  try {
    return window.localStorage.getItem(ULOZISTE)
  } catch {
    return null
  }
}

function klicServer(): string | null {
  return null
}

export default function Kiosek() {
  const klic = useSyncExternalStore(odebirat, klicKlient, klicServer)
  const [stav, setStav] = useState<Stav | null>(null)
  const [chyba, setChyba] = useState('')
  const [hlaska, setHlaska] = useState('')
  const [pin, setPin] = useState('')
  const [ceka, setCeka] = useState(false)

  const nacti = useCallback(async (k: string) => {
    try {
      const supabase = getBrowserSupabase()
      const { data, error } = await supabase.rpc('kiosk_stav', { p_klic: k })
      if (error) throw new Error(error.message)
      setStav(data as Stav)
      setChyba('')
    } catch (duvod) {
      setStav(null)
      setChyba(duvod instanceof Error ? duvod.message : 'Nepodařilo se spojit se serverem.')
    }
  }, [])

  /*
    Kód se obnovuje sám. Perioda je o něco kratší než jeho platnost —
    kdyby se ptalo přesně na hranici, ukazoval by tablet chvílemi kód,
    který už neplatí, a lidi by to marně zkoušeli.
  */
  useEffect(() => {
    if (!klic) return
    // První načtení se odloží do mikroúlohy. Zavolat ho rovnou tady by
    // znamenalo setState uvnitř efektu — a to je právě to, co dělá
    // kaskádu vykreslení.
    queueMicrotask(() => {
      void nacti(klic)
    })
    const perioda = Math.max(((stav?.platnost ?? 45) - 5) * 1000, 10_000)
    const t = setInterval(() => {
      void nacti(klic)
    }, perioda)
    return () => clearInterval(t)
  }, [klic, stav?.platnost, nacti])

  async function registrovat(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const kod = new FormData(e.currentTarget).get('kod')
    setChyba('')
    try {
      const supabase = getBrowserSupabase()
      const { data, error } = await supabase.rpc('registrovat_zarizeni', {
        p_kod: String(kod ?? ''),
      })
      if (error) throw new Error(error.message)
      const radek = (data as { klic: string }[])[0]
      if (!radek?.klic) throw new Error('Server nevrátil klíč zařízení.')
      window.localStorage.setItem(ULOZISTE, radek.klic)
      ohlasit()
    } catch (duvod) {
      setChyba(duvod instanceof Error ? duvod.message : 'Registrace se nepovedla.')
    }
  }

  async function pichnout(druh: 'in' | 'out') {
    if (!klic || pin.length < 4) return
    setCeka(true)
    setHlaska('')
    setChyba('')
    try {
      const supabase = getBrowserSupabase()
      const { data, error } = await supabase.rpc('pichnout_pinem', {
        p_klic: klic,
        p_pin: pin,
        p_druh: druh,
      })
      if (error) throw new Error(error.message)
      const r = (data as { ok: boolean; jmeno: string | null; mimo_rozpis: boolean }[])[0]
      if (!r?.ok) {
        setChyba('PIN nesedí. Po pěti pokusech se na chvíli zamkne.')
      } else {
        setHlaska(
          `${r.jmeno} — ${druh === 'in' ? 'příchod' : 'odchod'} zapsán.` +
            (r.mimo_rozpis ? ' (mimo rozpis)' : ''),
        )
      }
      setPin('')
    } catch (duvod) {
      setChyba(duvod instanceof Error ? duvod.message : 'Nepodařilo se zapsat.')
    } finally {
      setCeka(false)
    }
  }

  /* --- zařízení ještě není zaregistrované ------------------------- */

  if (!klic) {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Zaregistrovat tablet</h1>
          <p style={popis}>
            V aplikaci na <strong>Nastavení → Zařízení</strong> si nechte
            vystavit registrační kód a opište ho sem. Platí pár minut
            a jde použít jednou.
          </p>
          {chyba ? <p style={chybaStyl}>{chyba}</p> : null}
          <form onSubmit={registrovat}>
            <input
              name="kod"
              required
              maxLength={8}
              autoComplete="off"
              placeholder="A1B2C3D4"
              style={{ ...pole, textTransform: 'uppercase' }}
            />
            <button type="submit" className="ft-tl ft-tl-hlavni" style={tlacitko}>
              Zaregistrovat
            </button>
          </form>
        </div>
      </main>
    )
  }

  /* --- klíč je, ale server ho nezná ------------------------------- */

  if (!stav) {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Tablet není připojený</h1>
          <p style={popis}>{chyba || 'Načítám…'}</p>
          <button
            type="button"
            className="ft-tl ft-tl-vedlejsi"
            style={tlacitko}
            onClick={() => {
              window.localStorage.removeItem(ULOZISTE)
              ohlasit()
              setChyba('')
            }}
          >
            Zaregistrovat znovu
          </button>
        </div>
      </main>
    )
  }

  /* --- běžný provoz ------------------------------------------------ */

  return (
    <main style={obal}>
      <div style={{ ...karta, maxWidth: '900px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          {stav.pobocka} · {stav.zarizeni}
        </p>

        <h1 style={{ ...nadpis, marginTop: '4px' }}>Docházka</h1>

        <div style={mrizka}>
          <section>
            <p style={popisek}>Kód k píchnutí telefonem</p>
            <p style={kodStyl}>{stav.kod}</p>
            <p style={{ ...popis, marginBottom: 0 }}>
              Načtěte ho v aplikaci na Docházce. Mění se každých{' '}
              {stav.platnost} vteřin — vyfocený je za chvíli k ničemu.
            </p>
          </section>

          <section>
            <p style={popisek}>Nebo zadejte svůj PIN</p>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••"
              aria-label="PIN"
              style={{ ...pole, letterSpacing: '.4em', fontSize: '30px' }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button
                type="button"
                className="ft-tl ft-tl-hlavni"
                style={{ ...tlacitko, marginTop: 0, flex: 1 }}
                disabled={ceka || pin.length < 4}
                onClick={() => pichnout('in')}
              >
                Příchod
              </button>
              <button
                type="button"
                className="ft-tl ft-tl-vedlejsi"
                style={{ ...tlacitko, marginTop: 0, flex: 1 }}
                disabled={ceka || pin.length < 4}
                onClick={() => pichnout('out')}
              >
                Odchod
              </button>
            </div>
            {hlaska ? (
              <p style={{ margin: '12px 0 0', fontSize: '16px', color: 'var(--dobre)' }}>
                {hlaska}
              </p>
            ) : null}
            {chyba ? <p style={chybaStyl}>{chyba}</p> : null}
          </section>
        </div>

        <section style={{ marginTop: '20px' }}>
          <p style={popisek}>Dnes na směně</p>
          {stav.smeny.length === 0 ? (
            <p style={{ ...popis, marginBottom: 0 }}>
              Na dnešek tu nikdo v rozpisu není. Píchnout jde i tak —
              záznam se označí jako mimo rozpis.
            </p>
          ) : (
            <ul style={seznam}>
              {stav.smeny.map((s, i) => (
                <li key={i} style={{ fontSize: '15px' }}>
                  <strong>{s.jmeno}</strong>{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    {cas(s.od)}–{cas(s.do)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

/** Z „07:30:00“ udělá „7:30“. */
function cas(t: string): string {
  const [h, m] = (t ?? '').split(':')
  return h ? `${Number(h)}:${m}` : ''
}

/* --- styly ---------------------------------------------------------- */

const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: 'var(--paper)',
} as const

const karta = {
  width: '100%',
  maxWidth: '520px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '18px',
  boxShadow: 'var(--shadow)',
  padding: '24px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '26px', color: 'var(--ink)' } as const

const popis = {
  margin: '10px 0 16px',
  fontSize: '13.5px',
  color: 'var(--muted)',
  maxWidth: '52ch',
} as const

const popisek = {
  margin: '0 0 6px',
  fontSize: '12px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.08em',
} as const

const kodStyl = {
  margin: 0,
  fontSize: '46px',
  letterSpacing: '.14em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums' as const,
} as const

const pole = {
  width: '100%',
  padding: '14px',
  fontSize: '24px',
  textAlign: 'center' as const,
  borderRadius: '12px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '60px',
} as const

const tlacitko = { width: '100%', minHeight: '56px', fontSize: '17px', marginTop: '14px' } as const

const chybaStyl = {
  margin: '12px 0 0',
  fontSize: '14px',
  color: 'var(--bad)',
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '24px',
  marginTop: '16px',
} as const

const seznam = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '6px',
} as const
