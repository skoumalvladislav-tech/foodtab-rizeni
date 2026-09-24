'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { kodZeSkenu } from '@/lib/qr-kiosek'

/**
 * Čtečka QR z kiosku přímo v aplikaci.
 *
 * ROZHODNUTÍ ŠÉFÍKA (24. 9. 2026): „přidej do aplikace možnost skenovat
 * přímo z apky". Do té doby platilo zadání z 2. 9. (docs/qr-na-kiosku-
 * zadani.md): čte se běžným fotoaparátem. Jenže fotoaparát otevře
 * odkaz v Chromu, ne v nainstalované aplikaci, a na iPhonu v Safari
 * bez přihlášení. Čtečka v aplikaci tohle obchází: kód se načte tam,
 * kde člověk už je přihlášený, a rovnou se předvyplní.
 *
 * Fotoaparát i textový kód zůstávají jako záložní cesty. Čtečka se
 * kreslí jen tam, kde prohlížeč kameru nabízí.
 *
 * NIC NEZAPISUJE. Jen vrátí kód rodiči (PoleKodu) — píchnutí vyrobí až
 * ťuknutí na Příchod/Odchod, stejně jako u odkazu z fotoaparátu.
 *
 * Čtení: `BarcodeDetector` tam, kde ho prohlížeč má (Chrome na Androidu),
 * jinak `jsqr` nad snímky z kamery (Safari). Knihovna se stahuje až po
 * otevření čtečky, ne s každou stránkou.
 */

type Detektor = { detect: (zdroj: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type DetektorTrida = {
  new (moznosti: { formats: string[] }): Detektor
  getSupportedFormats?: () => Promise<string[]>
}

export default function SkenerQr({ onKod }: { onKod: (kod: string) => void }) {
  const umiKameru = useSyncExternalStore(nicNeodebira, maKameru, naServeru)
  const [otevreno, setOtevreno] = useState(false)
  const [chyba, setChyba] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  // Rodič posílá novou funkci při každém vykreslení; kamera se kvůli
  // tomu nesmí restartovat.
  const poslat = useRef(onKod)
  useEffect(() => {
    poslat.current = onKod
  }, [onKod])

  useEffect(() => {
    if (!otevreno) return
    let konec = false
    let proud: MediaStream | null = null
    let snimek = 0
    const platno = document.createElement('canvas')
    const kontext = platno.getContext('2d', { willReadFrequently: true })

    const zastavit = () => {
      konec = true
      cancelAnimationFrame(snimek)
      proud?.getTracks().forEach((t) => t.stop())
    }

    void (async () => {
      try {
        proud = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        const v = video.current
        if (konec || !v) {
          proud.getTracks().forEach((t) => t.stop())
          return
        }
        v.srcObject = proud
        await v.play().catch(() => {})

        const Trida = (window as unknown as { BarcodeDetector?: DetektorTrida }).BarcodeDetector
        let detektor: Detektor | null = null
        if (Trida) {
          try {
            const formaty = await Trida.getSupportedFormats?.()
            if (!formaty || formaty.includes('qr_code')) detektor = new Trida({ formats: ['qr_code'] })
          } catch {
            detektor = null
          }
        }
        const jsQR = detektor ? null : (await import('jsqr')).default

        let posledni = 0
        const krok = async (cas: number) => {
          if (konec) return
          // Pět pokusů za vteřinu stačí a telefon se nezahřeje.
          if (cas - posledni >= 200 && v.readyState >= 2 && v.videoWidth > 0) {
            posledni = cas
            let text: string | null = null
            if (detektor) {
              try {
                text = (await detektor.detect(v))[0]?.rawValue ?? null
              } catch {
                text = null
              }
            } else if (jsQR && kontext) {
              // Zmenšit na nejvýš 640 px — QR z tabletu je velký a čte se i tak.
              const meritko = Math.min(1, 640 / v.videoWidth)
              platno.width = Math.round(v.videoWidth * meritko)
              platno.height = Math.round(v.videoHeight * meritko)
              kontext.drawImage(v, 0, 0, platno.width, platno.height)
              const obraz = kontext.getImageData(0, 0, platno.width, platno.height)
              text = jsQR(obraz.data, obraz.width, obraz.height, { inversionAttempts: 'dontInvert' })?.data ?? null
            }
            if (text && !konec) {
              const kod = kodZeSkenu(text, window.location.origin)
              if (kod) {
                zastavit()
                setOtevreno(false)
                setChyba('')
                poslat.current(kod)
                return
              }
              setChyba('Tohle není QR z kiosku Foodtabu. Namiřte na kód na tabletu.')
            }
          }
          snimek = requestAnimationFrame((t) => void krok(t))
        }
        snimek = requestAnimationFrame((t) => void krok(t))
      } catch (duvod) {
        if (konec) return
        zastavit()
        setChyba(hlaskaKamery(duvod))
        setOtevreno(false)
      }
    })()

    // Odchod z obrazovky kameru vypne — nesmí běžet v pozadí.
    const skryto = () => {
      if (document.visibilityState === 'hidden') {
        zastavit()
        setOtevreno(false)
      }
    }
    document.addEventListener('visibilitychange', skryto)
    return () => {
      document.removeEventListener('visibilitychange', skryto)
      zastavit()
    }
  }, [otevreno])

  if (!umiKameru) return null

  return (
    <div style={{ marginBottom: '10px' }}>
      {otevreno ? (
        <div style={ramecek}>
          <video ref={video} playsInline muted aria-label="Náhled kamery" style={nahled} />
          <p style={napoveda}>Namiřte telefon na QR kód na tabletu.</p>
          <button
            type="button"
            className="ft-tl ft-tl-vedlejsi ft-tl-male"
            onClick={() => setOtevreno(false)}
          >
            Zavřít kameru
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ft-tl ft-tl-vedlejsi"
          style={{ width: '100%', minHeight: '48px' }}
          onClick={() => {
            setChyba('')
            setOtevreno(true)
          }}
        >
          Naskenovat QR z tabletu
        </button>
      )}
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ marginTop: '8px' }}>
          {chyba}
        </p>
      ) : null}
    </div>
  )
}

/** Česky a s cestou ven — kód jde vždycky i opsat. */
function hlaskaKamery(duvod: unknown): string {
  const jmeno = duvod instanceof Error ? duvod.name : ''
  if (jmeno === 'NotAllowedError' || jmeno === 'SecurityError') {
    return 'Kameru jste nepovolili. Povolte ji v nastavení prohlížeče pro Foodtab, nebo kód z tabletu opište.'
  }
  if (jmeno === 'NotFoundError' || jmeno === 'OverconstrainedError') {
    return 'Kamera se nenašla. Kód z tabletu prosím opište.'
  }
  if (jmeno === 'NotReadableError') {
    return 'Kameru teď používá jiná aplikace. Zavřete ji a zkuste to znovu, nebo kód opište.'
  }
  return 'Kameru se nepodařilo spustit. Kód z tabletu prosím opište.'
}

/* --- Zdroje pro useSyncExternalStore ----------------------------- */

function nicNeodebira(): () => void {
  return () => {}
}
/* Kamera jde jen přes HTTPS a jen tam, kde ji prohlížeč vůbec nabízí. */
function maKameru(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    window.isSecureContext
  )
}
function naServeru(): boolean {
  return false
}

const ramecek = {
  display: 'grid',
  gap: '8px',
  padding: '10px',
  border: '1px solid var(--line-2)',
  borderRadius: '12px',
  background: 'var(--paper)',
} as const

const nahled = {
  width: '100%',
  maxHeight: '55vh',
  borderRadius: '10px',
  background: '#000',
  objectFit: 'cover' as const,
} as const

const napoveda = {
  margin: 0,
  fontSize: '13px',
  color: 'var(--muted)',
} as const
