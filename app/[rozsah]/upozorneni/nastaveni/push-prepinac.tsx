'use client'

import { useEffect, useState } from 'react'

/**
 * Upozornění do telefonu — zapnutí a vypnutí na TOMHLE zařízení.
 *
 * ČESTNĚ O STAVU. Push se zapne jen tehdy, když ho podporuje prohlížeč A když
 * je na serveru nastavený klíč VAPID (`verejnyKlic`). Bez klíče se tu píše,
 * že server push zatím nemá — nenabízí se tlačítko, které by nic neudělalo.
 * Doručení ověřit nejde bez klíče a zařízení (viz lib/komunikace/web-push.ts).
 *
 * Předplatné patří zařízení. Po zapnutí se pošle serveru (`push_odber_ulozit`);
 * vypnutí zruší odběr v prohlížeči i na serveru.
 *
 * Na iPhonu push funguje jen u aplikace přidané na plochu (iOS 16.4+).
 */

type Vysledek = { ok: true } | { ok: false; chyba: string }

type Stav =
  | 'zjistuji'
  | 'nepodporovano'
  | 'bez-klice'
  | 'zamitnuto'
  | 'vypnuto'
  | 'zapnuto'

function naBajty(base64url: string): Uint8Array<ArrayBuffer> {
  const doplneni = '='.repeat((4 - (base64url.length % 4)) % 4)
  const b64 = (base64url + doplneni).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const vysledek = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) vysledek[i] = bin.charCodeAt(i)
  return vysledek
}

export default function PushPrepinac({
  verejnyKlic,
  ulozit,
  zrusit,
}: {
  /** Veřejný klíč VAPID (base64url), nebo null, když ho server nemá. */
  verejnyKlic: string | null
  ulozit: (odber: { endpoint: string; p256dh: string; auth: string; agent: string }) => Promise<Vysledek>
  zrusit: (endpoint: string) => Promise<Vysledek>
}) {
  const [stav, setStav] = useState<Stav>('zjistuji')
  const [chyba, setChyba] = useState<string | null>(null)
  const [pracuje, setPracuje] = useState(false)

  useEffect(() => {
    let zruseno = false
    async function zjistit() {
      if (!verejnyKlic) return setStav('bez-klice')
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return setStav('nepodporovano')
      }
      if (Notification.permission === 'denied') return setStav('zamitnuto')
      try {
        const reg = await navigator.serviceWorker.ready
        const odber = await reg.pushManager.getSubscription()
        if (!zruseno) setStav(odber ? 'zapnuto' : 'vypnuto')
      } catch {
        if (!zruseno) setStav('nepodporovano')
      }
    }
    void zjistit()
    return () => {
      zruseno = true
    }
  }, [verejnyKlic])

  async function zapnout() {
    if (!verejnyKlic) return
    setChyba(null)
    setPracuje(true)
    try {
      const povoleni = await Notification.requestPermission()
      if (povoleni !== 'granted') {
        setStav(povoleni === 'denied' ? 'zamitnuto' : 'vypnuto')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const odber = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: naBajty(verejnyKlic),
      })
      const j = odber.toJSON()
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('Prohlížeč nevydal úplné údaje o zařízení.')
      const v = await ulozit({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, agent: navigator.userAgent })
      if (!v.ok) {
        // Server odběr nepřijal: v prohlížeči se ruší, ať nezbyde odběr, o kterém server neví.
        await odber.unsubscribe()
        throw new Error(v.chyba)
      }
      setStav('zapnuto')
    } catch (e) {
      setChyba(e instanceof Error ? e.message : 'Zapnutí se nepovedlo.')
    } finally {
      setPracuje(false)
    }
  }

  async function vypnout() {
    setChyba(null)
    setPracuje(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const odber = await reg.pushManager.getSubscription()
      if (odber) {
        await zrusit(odber.endpoint)
        await odber.unsubscribe()
      }
      setStav('vypnuto')
    } catch (e) {
      setChyba(e instanceof Error ? e.message : 'Vypnutí se nepovedlo.')
    } finally {
      setPracuje(false)
    }
  }

  return (
    <section className="ds-plocha" style={{ marginTop: '20px' }} aria-labelledby="push-nadpis">
      <h2 id="push-nadpis" style={{ margin: '0 0 8px', fontSize: '17px' }}>
        Upozornění do telefonu
      </h2>

      {stav === 'zjistuji' ? <p className="pc-prazdno">Zjišťuji, jestli to tohle zařízení umí…</p> : null}

      {stav === 'bez-klice' ? (
        <p className="pc-prazdno">
          <strong>Zatím nejsou zapnutá.</strong> Server nemá nastavené klíče pro upozornění do telefonu
          (VAPID). Zprávy se ukazují v aplikaci.
        </p>
      ) : null}

      {stav === 'nepodporovano' ? (
        <p className="pc-prazdno">
          Tenhle prohlížeč upozornění do telefonu neumí. Na iPhonu fungují jen u aplikace přidané na plochu.
        </p>
      ) : null}

      {stav === 'zamitnuto' ? (
        <p className="pc-prazdno">
          Upozornění máte v prohlížeči zakázaná. Povolit je jde v nastavení prohlížeče u téhle stránky.
        </p>
      ) : null}

      {stav === 'vypnuto' || stav === 'zapnuto' ? (
        <>
          <p className="pc-prazdno" style={{ marginBottom: '10px' }}>
            {stav === 'zapnuto'
              ? 'Na tomhle zařízení jsou zapnutá. Mimo směnu se neozývají — čekající zprávy se sloučí do jedné, až přijdete do práce. Jen naléhavá zpráva může zapípat i mimo směnu.'
              : 'Na tomhle zařízení jsou vypnutá. Po zapnutí přijde upozornění, když vám někdo napíše, změní směnu nebo zadá úkol — jen během směny.'}
          </p>
          <button
            type="button"
            className={stav === 'zapnuto' ? 'ft-tl ft-tl-vedlejsi' : 'ft-tl ft-tl-hlavni'}
            disabled={pracuje}
            onClick={stav === 'zapnuto' ? vypnout : zapnout}
          >
            {pracuje ? 'Chvilku…' : stav === 'zapnuto' ? 'Vypnout na tomhle zařízení' : 'Zapnout na tomhle zařízení'}
          </button>
        </>
      ) : null}

      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: '10px 0 0' }}>
          {chyba}
        </p>
      ) : null}
    </section>
  )
}
