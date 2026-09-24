'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { dalsiPokusZa, hlaskaKiosku, jeSitovaChyba, stavPoChybe } from '@/lib/kiosek-spojeni'
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
 * VÝPADEK SPOJENÍ NENÍ ODPOJENÍ (24. 9. 2026). Hlášení: po zavření nebo
 * přepnutí aplikace chtěl tablet „znovu přihlašovací údaje". Do té doby
 * kiosek ukazoval „Tablet není připojený" s tlačítkem, které smazalo
 * klíč, a to při KAŽDÉM načtení, dokud nepřišla první odpověď (Android
 * kartu v pozadí zahodí a po návratu ji načte znovu), i při každé chybě
 * spojení. Navíc HTML ze serveru byl vždycky formulář „Zaregistrovat
 * tablet" — server klíč nezná — a zmizel až po načtení skriptů.
 * Je to nejpravděpodobnější vysvětlení, ne ověřené na tabletu.
 *
 * Teď: dokud se klíč nepřečte, je vidět „Připojuji…"; klíč se maže jen
 * na výslovné „tohle zařízení neznám" z databáze (lib/kiosek-spojeni.ts);
 * výpadek kiosek přečká s posledním stavem a zkouší to znovu sám —
 * a hned, jakmile se tablet vrátí do popředí nebo naskočí síť.
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

/*
  Server klíč nezná — a NESMÍ tvrdit, že žádný není. `null` by znamenalo
  „tablet není zaregistrovaný" a HTML ze serveru by byl registrační
  formulář, který na zaregistrovaném tabletu probleskne při každém
  spuštění. `undefined` = „ještě nevím", kreslí se neutrální obrazovka.
*/
function klicServer(): string | null | undefined {
  return undefined
}

/* Běží kiosek z ikony na ploše? (Na iPadu má jiné úložiště než Safari.) */
function nicNeodebira(): () => void {
  return () => {}
}
function zPlochy(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
    )
  } catch {
    return true
  }
}
function zPlochyServer(): boolean {
  return true
}

export default function Kiosek() {
  const klic = useSyncExternalStore<string | null | undefined>(odebirat, klicKlient, klicServer)
  const jeZPlochy = useSyncExternalStore(nicNeodebira, zPlochy, zPlochyServer)
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
  /** Poslední chyba spojení, drobně pod textem — jediná stopa z fotky tabletu. */
  const [posledniChyba, setPosledniChyba] = useState('')
  /*
    Počítadlo kol místo zámku. Návrat do popředí, naskočení sítě
    a časovač se můžou sejít v téže vteřině; platí jen odpověď
    POSLEDNÍHO kola a jen pro klíč, který v úložišti pořád je. Zámek
    („jeden dotaz naráz") by na visícím dotazu uvízl a spolkl všechny
    další pokusy.
  */
  const kolo = useRef(0)
  /*
    Kdy začalo kolo, které ještě běží (0 = žádné). Časovač ho nepřebíjí
    — jinak by každý tik po 3 s zahodil dotaz, který teprve čeká na
    časový limit (10 s), výpadek by se nikdy nezapočítal a opakování
    by nezpomalilo. Návrat do popředí, síť a „Zkusit hned" přebít smí.
  */
  const letiOd = useRef(0)

  const odpojit = useCallback(() => {
    setStav(null)
    setSpojeni('odpojeno')
    setChyba('')
    setHlaska('')
    setPin('')
    setZalohy([])
  }, [])

  const nacti = useCallback(async (k: string) => {
    const moje = ++kolo.current
    letiOd.current = Date.now()
    const platiPorad = () => moje === kolo.current && klicKlient() === k
    const vypadek = (zprava: string | undefined) => {
      if (!platiPorad()) return
      // „Odpojeno" přepíše jen úspěch nebo nová registrace, ne výpadek.
      setSpojeni((s) => (s === 'odpojeno' ? s : 'vypadek'))
      setPokusu((p) => p + 1)
      setPosledniChyba(zprava ?? '')
    }
    try {
      const supabase = getKioskSupabase()
      const { data, error } = await supabase.rpc('kiosk_stav', { p_klic: k })
      if (!platiPorad()) return
      if (error) {
        if (stavPoChybe(error) === 'odpojeno') odpojit()
        else vypadek(error.message)
        return
      }
      setStav(data as Stav)
      setSpojeni('ok')
      setPokusu(0)
      setPosledniChyba('')
      setChyba('')

      /*
        Nepotvrzené zálohy. Chodí zvlášť od stavu, protože se mění jindy:
        kód se obnovuje po vteřinách, záloha přibude, když ji někdo
        vyplatí. Chyba tady obrazovku neshodí — dokud není nasazená
        migrace se zálohami, funkce prostě není a kiosek má píchat dál.
        Při výpadku uprostřed se seznam NEmaže (nepotvrzená záloha je
        otevřený doklad); prázdný je jen, když funkce neexistuje.
      */
      const { data: z, error: chybaZaloh } = await supabase.rpc('kiosk_zalohy', { p_klic: k })
      if (!platiPorad()) return
      if (!chybaZaloh) setZalohy(Array.isArray(z) ? (z as Zaloha[]) : [])
      else if (chybaZaloh.code === 'PGRST202') setZalohy([])
    } catch (duvod) {
      vypadek(duvod instanceof Error ? duvod.message : undefined)
    } finally {
      if (moje === kolo.current) letiOd.current = 0
    }
  }, [odpojit])

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
      // Běžící kolo (do 12 s — limit dotazu je 10 s) tik nepřebíjí.
      if (letiOd.current && Date.now() - letiOd.current < 12_000) return
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
      if (document.visibilityState === 'visible') {
        // Po pobytu v pozadí začíná opakování zase od 3 s, ne od 30 s.
        setPokusu(0)
        void nacti(klic)
      } else {
        // Odchod z obrazovky: rozepsaný PIN na displeji nezůstane.
        setPin('')
      }
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
      // Bez časového limitu: kód je jednorázový (lib/supabase/kiosek.ts).
      const supabase = getKioskSupabase({ bezLimitu: true })
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
        if (stavPoChybe(error) === 'odpojeno') {
          odpojit()
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
    } catch (duvod) {
      setChyba(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Nepodařilo se potvrdit.'))
    } finally {
      // PIN po KAŽDÉM pokusu pryč — i po chybě, ať nezůstane na displeji.
      setPin('')
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
        if (stavPoChybe(error) === 'odpojeno') {
          odpojit()
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
    } catch (duvod) {
      setChyba(hlaskaKiosku(duvod instanceof Error ? duvod.message : null, 'Nepodařilo se zapsat.'))
    } finally {
      // PIN po KAŽDÉM pokusu pryč — i po chybě, ať nezůstane na displeji.
      setPin('')
      setCeka(false)
    }
  }

  /* --- ještě nevím, jestli klíč je (server, první vykreslení) ------ */

  if (klic === undefined) {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Připojuji…</h1>
          <p style={popis}>Načítám kiosek.</p>
        </div>
      </main>
    )
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
          {/*
            Klíč se uloží v TOMHLE prohlížeči. Na iPadu má ikona na ploše
            jiné úložiště než Safari — registrace v Safari by v aplikaci
            z plochy nebyla. Proto nejdřív na plochu, pak kód.
          */}
          {!jeZPlochy ? (
            <p role="note" style={vypadekStyl}>
              Kiosek máte otevřený v prohlížeči. Doporučujeme ho nejdřív
              přidat na plochu (Android, Chrome: ⋮ → <strong>Přidat na plochu</strong> /{' '}
              <strong>Instalovat</strong>; iPad, Safari: Sdílet → <strong>Přidat na
              plochu</strong>), otevřít ikonou <strong>Kiosek</strong> a kód zadat až
              tam. Na iPadu je to nutné — aplikace z plochy má jiné úložiště než
              Safari.
            </p>
          ) : null}
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
              setPosledniChyba('')
              setPin('')
              setHlaska('')
              setZalohy([])
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
            {spojeni !== 'vypadek'
              ? 'Načítám kiosek.'
              : jeSitovaChyba(posledniChyba)
                ? 'Spojení se serverem zatím nejde. Tablet zůstává zaregistrovaný a zkouší to znovu sám — zkontrolujte wifi.'
                : 'Server teď neodpovídá, jak má. Tablet zůstává zaregistrovaný a zkouší to znovu sám.'}
          </p>
          {spojeni === 'vypadek' ? (
            <>
              <button
                type="button"
                className="ft-tl ft-tl-vedlejsi"
                style={tlacitko}
                onClick={() => void nacti(klic)}
              >
                Zkusit hned
              </button>
              {/* Drobně: jediná stopa, když majitel pošle fotku tabletu. */}
              {posledniChyba ? <p style={stopaStyl}>{posledniChyba.slice(0, 160)}</p> : null}
            </>
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
          <div role="status" style={{ ...vypadekStyl, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 240px' }}>
              Spojení se serverem vypadlo — zkouším to znovu. Kód může být
              neplatný, PIN zkuste za chvíli.
            </span>
            <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => void nacti(klic)}>
              Zkusit hned
            </button>
          </div>
        ) : null}

        <div style={mrizka}>
          {/*
            QR, ne osmiznakový kód k opsání.

            Zadání (docs/kiosek-pin-zalohy-zadani.md, uspořádání A) chce
            QR měnící se s kódem, který se čte BĚŽNÝM FOTOAPARÁTEM
            telefonu. Od 24. 9. 2026 umí QR načíst i sama aplikace
            (Docházka → „Naskenovat kód z tabletu“) — rozhodnutí Šéfíka,
            viz docs/qr-na-kiosku-zadani.md.

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
              /*
                PIN se na displeji u baru nečte přes rameno: tečky místo
                číslic. `type="password"` by tablet nutil nabízet uložení
                hesla, proto jen maskování písmem (Chrome i Safari).
              */
              style={{ ...pole, letterSpacing: '.4em', fontSize: '30px', WebkitTextSecurity: 'disc' } as React.CSSProperties}
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

const stopaStyl = {
  margin: '10px 0 0',
  fontSize: '11.5px',
  color: 'var(--faint)',
  wordBreak: 'break-word' as const,
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
