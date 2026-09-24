'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { dalsiPokusZa, hlaskaKiosku, jeOdpojeneZarizeni } from '@/lib/kiosek-spojeni'
import { getKioskSupabase } from '@/lib/supabase/kiosek'
import { denCesky } from '@/lib/upozorneni-text'

import QrKod from './qr-kod'

/**
 * Obrazovka kiosku.
 *
 * Umí přesně to ze zadání a nic dalšího: ukázat měnící se kód,
 * přijmout PIN a podle něj píchnout, ukázat, kdo má dnes na téhle
 * pobočce směnu, a nechat zaměstnance potvrdit zálohu PINem.
 *
 * Klíč zařízení leží v prohlížeči tabletu (localStorage). Do databáze
 * se posílá jen on — nikdy se nikam neukládá, kdo je přihlášený, protože
 * na kiosku není přihlášený nikdo (a klient kiosku přihlášení ani nečte,
 * viz lib/supabase/kiosek.ts).
 *
 * VÝPADEK SPOJENÍ NENÍ ODPOJENÍ (24. 9. 2026). Po zavření nebo přepnutí
 * aplikace tablet chvíli nemá síť. Kiosek dřív při první chybě ukázal
 * „Tablet není připojený" s tlačítkem, které smazalo klíč, a tablet pak
 * chtěl nový registrační kód. Teď: klíč se maže jen na výslovné „tohle
 * zařízení neznám" z databáze (lib/kiosek-spojeni.ts); výpadek kiosek
 * přečká s posledním stavem a zkouší to znovu sám — a hned, jakmile se
 * tablet vrátí do popředí nebo naskočí síť.
 */

const ULOZISTE = 'foodtab-kiosek-klic'

type Smena = { jmeno: string; od: string; do: string }
type Zaloha = { id: string; jmeno: string; castka_haleru: number }
type Stav = {
  pobocka: string
  /** Adresní podoba pobočky. Do odkazu v QR patří slug, ne název. */
  slug: string | null
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
  const [zalohy, setZalohy] = useState<Zaloha[]>([])
  const [chyba, setChyba] = useState('')
  const [hlaska, setHlaska] = useState('')
  const [pin, setPin] = useState('')
  const [ceka, setCeka] = useState(false)
  /**
   * `ok` — poslední dotaz prošel; `vypadek` — spojení vypadlo, klíč
   * platí a zkouší se znovu; `odpojeno` — databáze klíč nezná.
   */
  const [spojeni, setSpojeni] = useState<'ok' | 'vypadek' | 'odpojeno'>('ok')
  const [pokusu, setPokusu] = useState(0)
  // Jen jeden dotaz naráz: návrat do popředí, naskočení sítě a časovač
  // se můžou sejít v téže vteřině.
  const bezi = useRef(false)

  const nacti = useCallback(async (k: string) => {
    if (bezi.current) return
    bezi.current = true
    try {
      const supabase = getKioskSupabase()
      const { data, error } = await supabase.rpc('kiosk_stav', { p_klic: k })
      if (error) {
        if (jeOdpojeneZarizeni(error)) {
          setStav(null)
          setSpojeni('odpojeno')
          setChyba('')
          return
        }
        throw new Error(error.message)
      }
      setStav(data as Stav)
      setSpojeni('ok')
      setPokusu(0)

      /*
        Nepotvrzené zálohy. Chodí zvlášť od stavu, protože se mění jindy:
        kód se obnovuje po vteřinách, záloha přibude, když ji někdo
        vyplatí. Chyba tady obrazovku neshodí — dokud není nasazená
        migrace se zálohami, funkce prostě není a kiosek má píchat dál.
      */
      const { data: z } = await supabase.rpc('kiosk_zalohy', { p_klic: k })
      setZalohy(Array.isArray(z) ? (z as Zaloha[]) : [])
    } catch {
      // Výpadek: poslední stav zůstává na obrazovce, klíč taky.
      setSpojeni('vypadek')
      setPokusu((p) => p + 1)
    } finally {
      bezi.current = false
    }
  }, [])

  /*
    Kód se obnovuje sám. Perioda je o něco kratší než jeho platnost —
    kdyby se ptalo přesně na hranici, ukazoval by tablet chvílemi kód,
    který už neplatí, a lidi by to marně zkoušeli. Po výpadku se to
    zkouší dřív (3 s, 5 s, 10 s … nejvýš po 30 s).
  */
  useEffect(() => {
    if (!klic) return
    // První načtení se odloží do mikroúlohy. Zavolat ho rovnou tady by
    // znamenalo setState uvnitř efektu — a to je právě to, co dělá
    // kaskádu vykreslení.
    queueMicrotask(() => {
      void nacti(klic)
    })
  }, [klic, nacti])

  // Časovač zvlášť: po každém neúspěchu se jen přenastaví (a zpomalí),
  // NEptá se hned znovu — jinak by výpadek sítě vyrobil smyčku dotazů.
  const bezne = Math.max(((stav?.platnost ?? 45) - 5) * 1000, 10_000)
  const perioda = spojeni === 'vypadek' ? Math.min(dalsiPokusZa(pokusu), bezne) : bezne
  useEffect(() => {
    if (!klic || spojeni === 'odpojeno') return
    const t = setInterval(() => {
      void nacti(klic)
    }, perioda)
    return () => clearInterval(t)
  }, [klic, spojeni, perioda, nacti])

  /*
    Návrat do popředí. Časovače v pozadí prohlížeč brzdí nebo zastaví,
    takže po přepnutí z jiné aplikace by kiosek až do dalšího tiku
    ukazoval propadlý kód. Proto se ptá hned — při zviditelnění stránky,
    návratu z mezipaměti prohlížeče i naskočení sítě.
  */
  useEffect(() => {
    if (!klic) return
    const hned = () => {
      if (document.visibilityState === 'visible') void nacti(klic)
    }
    document.addEventListener('visibilitychange', hned)
    window.addEventListener('pageshow', hned)
    window.addEventListener('online', hned)
    window.addEventListener('focus', hned)
    return () => {
      document.removeEventListener('visibilitychange', hned)
      window.removeEventListener('pageshow', hned)
      window.removeEventListener('online', hned)
      window.removeEventListener('focus', hned)
    }
  }, [klic, nacti])

  /*
    Požádat prohlížeč, ať úložiště tabletu nemaže, když dojde místo.
    Nainstalovaná aplikace ho obvykle dostane bez ptaní; kde to prohlížeč
    neumí nebo odmítne, nic se neděje.
  */
  useEffect(() => {
    if (!klic) return
    try {
      void navigator.storage?.persist?.().catch(() => {})
    } catch {
      // Starší prohlížeč — klíč zůstává v localStorage jako dosud.
    }
  }, [klic])

  async function registrovat(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const kod = new FormData(e.currentTarget).get('kod')
    setChyba('')
    try {
      const supabase = getKioskSupabase()
      const { data, error } = await supabase.rpc('registrovat_zarizeni', {
        p_kod: String(kod ?? ''),
      })
      if (error) throw new Error(error.message)
      const radek = (data as { klic: string }[])[0]
      if (!radek?.klic) throw new Error('Server nevrátil klíč zařízení.')
      window.localStorage.setItem(ULOZISTE, radek.klic)
      setSpojeni('ok')
      setPokusu(0)
      ohlasit()
    } catch (duvod) {
      setChyba(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Registrace se nepovedla.'))
    }
  }

  /*
    Potvrzení zálohy TÝMŽ PINem, jakým se píchá. Je to schválně stejné
    gesto: člověk se u tabletu prokazuje jednou věcí, ne dvěma.

    Potvrdit smí jen ten, komu záloha patří — a když PIN sedne někomu
    jinému, dozví se jen „nesedí“. Kdo hádá, se nesmí z odpovědi
    dozvědět, jestli se trefil.
  */
  async function potvrditZalohu(z: Zaloha) {
    if (!klic || pin.length < 4) return
    setCeka(true)
    setHlaska('')
    setChyba('')
    try {
      const supabase = getKioskSupabase()
      const { data, error } = await supabase.rpc('potvrdit_zalohu_pinem', {
        p_klic: klic,
        p_pin: pin,
        p_zaloha: z.id,
      })
      if (error) {
        if (jeOdpojeneZarizeni(error)) {
          setStav(null)
          setSpojeni('odpojeno')
          return
        }
        throw new Error(error.message)
      }
      const r = (data as { ok: boolean; jmeno: string | null }[])[0]
      if (!r?.ok) {
        setChyba('PIN nesedí. Potvrdit zálohu může jen ten, komu patří.')
      } else {
        setHlaska(`${r.jmeno} — záloha ${koruny(z.castka_haleru)} potvrzena.`)
        setZalohy((d) => d.filter((x) => x.id !== z.id))
      }
      setPin('')
    } catch (duvod) {
      setChyba(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Nepodařilo se potvrdit.'))
    } finally {
      setCeka(false)
    }
  }

  async function pichnout(druh: 'in' | 'out') {
    if (!klic || pin.length < 4) return
    setCeka(true)
    setHlaska('')
    setChyba('')
    try {
      const supabase = getKioskSupabase()
      const { data, error } = await supabase.rpc('pichnout_pinem', {
        p_klic: klic,
        p_pin: pin,
        p_druh: druh,
      })
      if (error) {
        if (jeOdpojeneZarizeni(error)) {
          setStav(null)
          setSpojeni('odpojeno')
          return
        }
        throw new Error(error.message)
      }
      const r = (
        data as {
          ok: boolean
          jmeno: string | null
          mimo_rozpis: boolean
          uzavren_stary: boolean | null
          stary_den: string | null
        }[]
      )[0]
      if (!r?.ok) {
        setChyba('PIN nesedí. Po pěti pokusech se na chvíli zamkne.')
      } else {
        setHlaska(
          `${r.jmeno} — ${druh === 'in' ? 'příchod' : 'odchod'} zapsán.` +
            (r.mimo_rozpis ? ' (mimo rozpis)' : '') +
            /*
              Uzavřený starý příchod se nesmí zamlčet. Vedoucí o tom ví
              z upozornění; člověk stojí u tabletu a dozví se to tady —
              a hned s tím, že ho to dnes nezdrží, ať neodchází s pocitem,
              že něco provedl.
            */
            (r.uzavren_stary && r.stary_den
              ? ` Váš příchod z ${denCesky(r.stary_den)} zůstal bez odchodu` +
                ' — dali jsme o něm vědět vedoucímu, dnešní směnu vám to nezdrží.'
              : ''),
        )
      }
      setPin('')
    } catch (duvod) {
      setChyba(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Nepodařilo se zapsat.'))
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

  /* --- klíč je, ale databáze ho NEZNÁ ------------------------------ */

  /*
    Jediné místo, kde se klíč maže — a jen když to databáze řekla
    výslovně (lib/kiosek-spojeni.ts). Výpadek sítě sem nevede.
  */
  if (spojeni === 'odpojeno') {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Tablet je odpojený</h1>
          <p style={popis}>
            Server tenhle tablet nezná — v aplikaci na{' '}
            <strong>Nastavení → Zařízení</strong> ho někdo odvolal. Pro nové
            připojení si tam nechte vystavit registrační kód.
          </p>
          <button
            type="button"
            className="ft-tl ft-tl-vedlejsi"
            style={tlacitko}
            onClick={() => {
              window.localStorage.removeItem(ULOZISTE)
              setSpojeni('ok')
              setPokusu(0)
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

  /* --- klíč je, stav ještě nepřišel (načítání nebo výpadek) -------- */

  /*
    Tady se NIC nemaže a nenabízí se nová registrace: klíč platí, jen
    se zatím nepovedlo spojit. Kiosek to zkouší sám dál.
  */
  if (!stav) {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>{spojeni === 'vypadek' ? 'Čekám na spojení' : 'Připojuji…'}</h1>
          <p style={popis}>
            {spojeni === 'vypadek'
              ? 'Spojení se serverem zatím nejde. Tablet zůstává zaregistrovaný a zkouší to znovu sám — zkontrolujte wifi.'
              : 'Načítám kiosek.'}
          </p>
          {spojeni === 'vypadek' ? (
            <button
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              style={tlacitko}
              onClick={() => void nacti(klic)}
            >
              Zkusit hned
            </button>
          ) : null}
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

        {/*
          Výpadek za provozu: obrazovka zůstává (poslední stav), jen se
          řekne, že kód nahoře může být starý. Nic se nemaže.
        */}
        {spojeni === 'vypadek' ? (
          <p role="status" style={vypadekStyl}>
            Spojení se serverem vypadlo — zkouším to znovu. Kód může být
            neplatný, PIN zkuste za chvíli.
          </p>
        ) : null}

        <div style={mrizka}>
          {/*
            QR, ne osmiznakový kód k opsání.

            Zadání (docs/kiosek-pin-zalohy-zadani.md, uspořádání A) chce
            QR měnící se s kódem, který se čte BĚŽNÝM FOTOAPARÁTEM
            telefonu — čtečka uvnitř aplikace není a nebude
            (docs/qr-na-kiosku-zadani.md).

            V odkazu je jen pobočka a kód, nic jiného. Pobočku bere
            kiosek ze svého zařízení, ne z ničeho, co přijde
            z prohlížeče; tajemství pobočky do prohlížeče nejde vůbec.

            Otevření odkazu NIC NEZAPÍŠE. Jen předvyplní kód na
            Docházce — teprve ťuknutí tam vyrobí píchnutí.

            Textový kód zůstává POD QR, menším písmem: kdo nemá čím
            načíst, opíše ho jako dosud.
          */}
          {/*
            Obsah QR i texty kolem něj žijí v QrKod. Nekreslí se tu,
            aby na hotové SVG mohla sáhnout kontrola — viz qr-kod.tsx.
          */}
          <QrKod
            puvod={typeof window === 'undefined' ? '' : window.location.origin}
            slug={stav.slug}
            kod={stav.kod}
            platnost={stav.platnost}
          />

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

        {/*
          Zálohy k potvrzení. Jsou nad seznamem směn schválně: je to
          jediná věc na téhle obrazovce, na kterou se čeká — nepotvrzená
          záloha je otevřený doklad.
        */}
        {zalohy.length > 0 ? (
          <section style={{ marginTop: '20px' }}>
            <p style={popisek}>Zálohy k potvrzení</p>
            <p style={{ ...popis, margin: '0 0 10px' }}>
              Zadejte svůj PIN nahoře a potvrďte svůj řádek. Potvrzením
              stvrzujete, že jste hotovost dostali.
            </p>
            <ul style={seznam}>
              {zalohy.map((z) => (
                <li
                  key={z.id}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    padding: '10px 12px',
                    border: '1px solid var(--line-2)',
                    borderRadius: '12px',
                  }}
                >
                  <span style={{ flex: '1 1 160px', fontSize: '15px' }}>
                    <strong>{z.jmeno}</strong>{' '}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {koruny(z.castka_haleru)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="ft-tl ft-tl-vedlejsi"
                    disabled={ceka || pin.length < 4}
                    onClick={() => potvrditZalohu(z)}
                  >
                    Potvrdit PINem
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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

/** Haléře na „2 000 Kč“. Mezera je oddělovač tisíců, ne čárka. */
function koruny(halere: number): string {
  const kc = Math.round(halere / 100)
  return `${kc.toString().replace(/\B(?=(\d{3})+$)/g, '\u00a0')} Kč`
}

/** Z „07:30:00“ udělá „7:30“. */
function cas(t: string): string {
  const [h, m] = (t ?? '').split(':')
  return h ? `${Number(h)}:${m}` : ''
}

/* --- styly ---------------------------------------------------------- */

/*
  Kiosek běží na tabletu NA ŠÍŘKU a v režimu `fullscreen`, takže sahá
  úplně do krajů — pod zaoblené rohy i pod ostrůvek. Na šířku jsou
  nenulové hlavně boční vložky; svislé bývají malé, ale započítat se
  musí taky, protože tablet leží jednou na jednu a jednou na druhou
  stranu a `env()` se s ním otočí.

  `max(24px, …)` po každé straně zvlášť: součet by na iPhonu na šířku
  udělal skoro sedmdesátibodový okraj a karta by se scvrkla.
*/
const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding:
    'max(24px, var(--vlozka-nahore)) max(24px, var(--vlozka-vpravo))' +
    ' max(24px, var(--vlozka-dole)) max(24px, var(--vlozka-vlevo))',
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

const vypadekStyl = {
  margin: '8px 0 0',
  padding: '10px 12px',
  fontSize: '14px',
  borderRadius: '12px',
  border: '1px solid var(--mosaz)',
  background: 'var(--paper)',
  color: 'var(--ink)',
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
