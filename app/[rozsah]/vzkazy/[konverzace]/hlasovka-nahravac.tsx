'use client'

import { useEffect, useRef, useState } from 'react'

import { AUDIO_BITRATE_BPS, MAX_DELKA_S, mmss, priponaZMime } from '@/lib/hlasove-zpravy'
import { odeslatHlasovku } from '../akce'

/**
 * Nahrávání a odeslání hlasovky.
 *
 * JEDINÝ klientský ostrůvek v celém vlákně — mikrofon jde jen
 * z prohlížeče, server na něj nesáhne. Zbytek obrazovky zůstává
 * server komponenta; tenhle soubor je schválně malý a soběstačný,
 * ať se klientský kód neroztahuje do zbytku stránky.
 *
 * ŽÁDNÝ AI PŘEPIS. Nahraje se, co se řekne, a tím to končí — viz
 * hlavička 20260917060000_hlasove_zpravy.sql.
 */

type Stav = 'klid' | 'nahravani' | 'pripraveno' | 'odesilani'

const TYPY_PODLE_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
]

function vybratTyp(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return TYPY_PODLE_PREFERENCE.find((t) => MediaRecorder.isTypeSupported(t))
}

export default function HlasovkaNahravac({
  rozsah,
  konverzace,
}: {
  rozsah: string
  konverzace: string
}) {
  const [stav, setStav] = useState<Stav>('klid')
  const [chyba, setChyba] = useState<string | null>(null)
  const [uplynulo, setUplynulo] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkyRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const odkazRef = useRef<string | null>(null)
  const casovacRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /*
    Nastaví se SYNCHRONNĚ na začátku zacitNahravat, ne až po
    `setStav('nahravani')`. `stav` se mění až po `await
    getUserMedia(...)` — rychlý dvojklik (nebo druhý klik, než se
    stihne zobrazit svolení prohlížeče) by jinak spustil funkci
    podruhé, než React vůbec překreslí tlačítko, a druhé volání by
    tiše přepsalo streamRef/recorderRef/casovacRef prvního: mikrofon
    z prvního pokusu by zůstal navždy zapnutý a jeho časovač by nikdy
    nešel zastavit.
  */
  const zahajujeSeRef = useRef(false)

  // Úklid při odchodu ze stránky — mikrofon nesmí zůstat zapnutý
  // a odkaz na náhled by jinak nikdo neuvolnil.
  useEffect(() => {
    return () => {
      if (casovacRef.current) clearInterval(casovacRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (odkazRef.current) URL.revokeObjectURL(odkazRef.current)
    }
  }, [])

  async function zacitNahravat() {
    if (zahajujeSeRef.current) return
    zahajujeSeRef.current = true

    setChyba(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setChyba('Tenhle prohlížeč neumí nahrávat zvuk.')
      zahajujeSeRef.current = false
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setChyba('Přístup k mikrofonu se nepovedl. Povolte ho v prohlížeči a zkuste to znovu.')
      zahajujeSeRef.current = false
      return
    }

    streamRef.current = stream
    chunkyRef.current = []

    const typ = vybratTyp()
    const recorder = new MediaRecorder(stream, {
      ...(typ ? { mimeType: typ } : {}),
      // Bez tohohle dá MediaRecorder v některých prohlížečích hudební
      // kvalitu a nahrávka blízko MAX_DELKA_S naráží na 1MB strop
      // Server Actions v Next.js dřív, než se vůbec pošle — viz
      // lib/hlasove-zpravy.ts.
      audioBitsPerSecond: AUDIO_BITRATE_BPS,
    })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunkyRef.current.push(e.data)
    }
    recorder.onstop = () => {
      blobRef.current = new Blob(chunkyRef.current, { type: recorder.mimeType || 'audio/webm' })
      odkazRef.current = URL.createObjectURL(blobRef.current)
      setStav('pripraveno')
    }

    recorder.start()
    setStav('nahravani')
    setUplynulo(0)

    // Updater zůstává čistý — jen počítá. Zastavení při dosažení
    // MAX_DELKA_S řeší samostatný useEffect níž, ne vedlejší účinek
    // uvnitř setState. React v StrictModu volá updater dvakrát;
    // vedlejší účinek uvnitř by se tak mohl spustit dvakrát taky.
    casovacRef.current = setInterval(() => {
      setUplynulo((s) => s + 1)
    }, 1000)
  }

  // Automatické zastavení — stejný strop jako Storage (file_size_limit),
  // jen dřív a s vysvětlením, ne chybou.
  useEffect(() => {
    if (stav === 'nahravani' && uplynulo >= MAX_DELKA_S) {
      ukoncitNahravani()
    }
  }, [stav, uplynulo])

  /**
   * Musí být bezpečné zavolat víckrát za sebou beze změny stavu.
   * Dosáhne se sem tolika cestami (tlačítko „Ukončit", dvojklik na
   * něj, i automatický strop výš), že spoléhat na to, že se zavolá
   * přesně jednou, by dřív nebo později spadlo na
   * `MediaRecorder.stop()` vyhozeném `InvalidStateError` nad už
   * zastaveným nahráváním.
   */
  function ukoncitNahravani() {
    if (casovacRef.current) {
      clearInterval(casovacRef.current)
      casovacRef.current = null
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function zahodit() {
    if (odkazRef.current) URL.revokeObjectURL(odkazRef.current)
    odkazRef.current = null
    blobRef.current = null
    chunkyRef.current = []
    setUplynulo(0)
    zahajujeSeRef.current = false
    setStav('klid')
  }

  async function odeslat() {
    if (!blobRef.current) return
    setStav('odesilani')
    setChyba(null)

    const pripona = priponaZMime(blobRef.current.type)

    const formData = new FormData()
    formData.set('rozsah', rozsah)
    formData.set('konverzace', konverzace)
    formData.set('delka_s', String(uplynulo))
    formData.set('zvuk', blobRef.current, `hlasovka.${pripona}`)

    // odeslatHlasovku vždycky skončí přes next/navigation redirect() —
    // ten funguje přes vyhození speciální výjimky, kterou Next.js sám
    // zachytí výš. Nezachytává se tady schválně: try/catch okolo by ji
    // srazil a odeslání by navenek vypadalo jako chyba, i když se
    // povedlo.
    await odeslatHlasovku(formData)
  }

  if (stav === 'klid') {
    return (
      <div>
        <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={zacitNahravat}>
          🎤 Nahrát hlasovku
        </button>
        {chyba ? (
          <p style={{ margin: '6px 0 0', fontSize: '12.5px', color: 'var(--bad)' }}>{chyba}</p>
        ) : null}
      </div>
    )
  }

  if (stav === 'nahravani') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          aria-hidden
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'var(--bad)',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
          Nahrávám… {mmss(uplynulo)}
        </span>
        <button type="button" className="ft-tl ft-tl-hlavni ft-tl-male" onClick={ukoncitNahravani}>
          ⏹ Ukončit
        </button>
      </div>
    )
  }

  if (stav === 'pripraveno') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {odkazRef.current ? (
          <audio controls src={odkazRef.current} style={{ height: '32px', maxWidth: '220px' }} />
        ) : null}
        <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{mmss(uplynulo)}</span>
        <button type="button" className="ft-tl ft-tl-hlavni ft-tl-male" onClick={odeslat}>
          Odeslat
        </button>
        <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={zahodit}>
          Zahodit
        </button>
        {chyba ? <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--bad)' }}>{chyba}</p> : null}
      </div>
    )
  }

  // 'odesilani'
  return <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Odesílám…</p>
}
