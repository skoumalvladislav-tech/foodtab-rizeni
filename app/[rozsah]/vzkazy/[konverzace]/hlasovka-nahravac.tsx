'use client'

import { useEffect, useRef, useState } from 'react'

import { MAX_DELKA_S } from '@/lib/hlasove-zpravy'
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

/** „1:07" z počtu sekund. */
function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const zbytek = s % 60
  return `${m}:${String(zbytek).padStart(2, '0')}`
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
    setChyba(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setChyba('Tenhle prohlížeč neumí nahrávat zvuk.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setChyba('Přístup k mikrofonu se nepovedl. Povolte ho v prohlížeči a zkuste to znovu.')
      return
    }

    streamRef.current = stream
    chunkyRef.current = []

    const typ = vybratTyp()
    const recorder = typ ? new MediaRecorder(stream, { mimeType: typ }) : new MediaRecorder(stream)
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

    casovacRef.current = setInterval(() => {
      setUplynulo((s) => {
        const dalsi = s + 1
        // Automatické zastavení — stejný strop jako Storage
        // (file_size_limit), jen dřív a s vysvětlením, ne chybou.
        if (dalsi >= MAX_DELKA_S) {
          ukoncitNahravani()
        }
        return dalsi
      })
    }, 1000)
  }

  function ukoncitNahravani() {
    if (casovacRef.current) clearInterval(casovacRef.current)
    casovacRef.current = null
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function zahodit() {
    if (odkazRef.current) URL.revokeObjectURL(odkazRef.current)
    odkazRef.current = null
    blobRef.current = null
    chunkyRef.current = []
    setUplynulo(0)
    setStav('klid')
  }

  async function odeslat() {
    if (!blobRef.current) return
    setStav('odesilani')
    setChyba(null)

    const pripona = blobRef.current.type.includes('mp4')
      ? 'mp4'
      : blobRef.current.type.includes('ogg')
        ? 'ogg'
        : 'webm'

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
