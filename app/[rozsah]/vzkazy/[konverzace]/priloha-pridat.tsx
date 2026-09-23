'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import Ikona from '@/app/[rozsah]/ikona'
import {
  KBELIK_PRILOH,
  MAX_PRILOH,
  cestaPriloh,
  jeObrazek,
  jeTypPriloh,
  ocistitNazev,
  velikostText,
  zkontrolujPoZmenseni,
  zkontrolujVyber,
  typSouboru,
  type TypPriloh,
} from '@/lib/komunikace/prilohy'
import { NEMENIT_DO_BAJTU, noveId, zmensitObrazek } from '@/lib/obrazky'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { poslatSPrilohami } from './akce-prilohy'

/**
 * Přidání příloh ke zprávě — fotka nebo PDF.
 *
 * SOUBORY IDOU Z PROHLÍŽEČE PŘÍMO DO ÚLOŽIŠTĚ, ne přes Server Action:
 * ta má strop na tělo požadavku 1 MB a fotka z telefonu je mnohem větší.
 * Nahrává se pod přihlášeným člověkem — o tom, kdo smí kam, rozhoduje
 * politika úložiště (20260921130000_prilohy.sql), ne tenhle soubor. Klíč
 * `service_role` v prohlížeči není a nikdy nebude.
 *
 * FOTKY SE ZMENŠUJÍ. Snímek z telefonu má několik MB, čtenář na směně ho
 * otevírá přes mobilní data. Zmenšuje se na delší stranu 2000 px a JPEG,
 * což je na čtení dokladu nebo fotky z kuchyně víc než dost. Když se
 * zmenšení nepodaří (starší prohlížeč), pošle se originál, pokud vyhovuje
 * limitu a typu.
 *
 * NEZDVOJUJE SE: zpráva nese klientské id, takže opakované odeslání po
 * výpadku spojení založí zprávu jen jednou; už nahrané soubory se
 * nenahrávají znovu.
 *
 * ČESTNĚ O MEZÍCH:
 *   * přílohy se do fronty neodeslaných neukládají (jako hlasovky) — bez
 *     spojení odeslání selže nahlas a výběr zůstane, dokud ho člověk
 *     nezruší;
 *   * soubor, který se nahrál a k žádné zprávě nepřipojil (zavřená karta),
 *     zůstane v úložišti jako sirotek.
 */

type Vybrana = {
  id: string
  nazev: string
  mime: TypPriloh
  blob: Blob
  cesta: string
  nahrano: boolean
}

export default function PridatPrilohu({
  rozsah,
  konverzace,
  tenantId,
}: {
  rozsah: string
  konverzace: string
  tenantId: string
}) {
  const router = useRouter()
  const vstupRef = useRef<HTMLInputElement>(null)
  const bezi = useRef(false)
  const klientId = useRef(noveId())
  const vybraneRef = useRef<Vybrana[]>([])

  const [vybrane, setVybrane] = useState<Vybrana[]>([])
  const [popisek, setPopisek] = useState('')
  const [chyby, setChyby] = useState<string[]>([])
  const [stav, setStav] = useState<'klid' | 'pripravuje' | 'odesila'>('klid')
  const [hotovo, setHotovo] = useState<string | null>(null)

  function nastav(nove: Vybrana[]) {
    vybraneRef.current = nove
    setVybrane(nove)
  }

  async function pridat(seznam: FileList | null) {
    if (!seznam || seznam.length === 0 || bezi.current) return
    bezi.current = true
    setHotovo(null)
    setStav('pripravuje')
    try {
      const soubory = Array.from(seznam)
      const kontrola = zkontrolujVyber(
        soubory.map((s) => ({ name: s.name, type: s.type, size: s.size })),
        vybraneRef.current.length,
      )
      const nove: string[] = [...kontrola.chyby]
      const pridane: Vybrana[] = []

      for (const i of kontrola.platne) {
        const s = soubory[i]
        const typ = typSouboru(s)
        let blob: Blob = s
        let mime = typ

        if (jeObrazek(typ) && (s.size > NEMENIT_DO_BAJTU || !jeTypPriloh(typ))) {
          const zmenseny = await zmensitObrazek(s)
          if (zmenseny) {
            blob = zmenseny
            mime = 'image/jpeg'
          }
        }

        const problem = zkontrolujPoZmenseni(s.name, mime, blob.size)
        if (problem) {
          nove.push(problem)
          continue
        }
        if (!jeTypPriloh(mime)) continue

        pridane.push({
          id: noveId(),
          // Zmenšená fotka je vždy JPEG — název dostane odpovídající příponu.
          nazev: mime === 'image/jpeg' && typ !== 'image/jpeg'
            ? `${ocistitNazev(s.name).replace(/\.[^.]*$/, '')}.jpg`
            : ocistitNazev(s.name),
          mime,
          blob,
          cesta: cestaPriloh(tenantId, konverzace, noveId(), mime),
          nahrano: false,
        })
      }

      nastav([...vybraneRef.current, ...pridane])
      setChyby(nove)
    } finally {
      bezi.current = false
      setStav('klid')
      if (vstupRef.current) vstupRef.current.value = ''
    }
  }

  function odebrat(id: string) {
    const zbyva = vybraneRef.current.filter((v) => v.id !== id)
    const smazana = vybraneRef.current.find((v) => v.id === id)
    nastav(zbyva)
    if (smazana?.nahrano) void uklidit([smazana.cesta])
  }

  async function uklidit(cesty: string[]) {
    if (cesty.length === 0) return
    try {
      await getBrowserSupabase().storage.from(KBELIK_PRILOH).remove(cesty)
    } catch {
      /* soubor navíc nikomu neškodí */
    }
  }

  function zrusit() {
    void uklidit(vybraneRef.current.filter((v) => v.nahrano).map((v) => v.cesta))
    nastav([])
    setPopisek('')
    setChyby([])
    klientId.current = noveId()
  }

  async function odeslat() {
    if (bezi.current || vybraneRef.current.length === 0) return
    bezi.current = true
    setStav('odesila')
    setChyby([])
    setHotovo(null)

    try {
      const supabase = getBrowserSupabase()

      // 1) Nahrát, co ještě nahrané není. Při chybě zůstává výběr i to, co už je nahrané.
      for (const v of vybraneRef.current) {
        if (v.nahrano) continue
        const { error } = await supabase.storage.from(KBELIK_PRILOH).upload(v.cesta, v.blob, {
          contentType: v.mime,
          upsert: false,
        })
        if (error) {
          setChyby([`„${v.nazev}“ se nepodařilo nahrát: ${error.message}`])
          return
        }
        nastav(vybraneRef.current.map((x) => (x.id === v.id ? { ...x, nahrano: true } : x)))
      }

      // 2) Poslat zprávu a připojit přílohy.
      const vysledek = await poslatSPrilohami({
        rozsah,
        konverzace,
        popisek,
        klientId: klientId.current,
        prilohy: vybraneRef.current.map((v) => ({
          cesta: v.cesta,
          nazev: v.nazev,
          mime: v.mime,
          velikost: v.blob.size,
        })),
      })

      if (vysledek.ok) {
        nastav([])
        setPopisek('')
        klientId.current = noveId()
        setHotovo('Odesláno.')
        router.refresh()
        return
      }

      setChyby([vysledek.chyba])
      if (vysledek.zpravaOdeslana) {
        // Zpráva je venku; zopakováním by vznikla druhá. Výběr se zahodí.
        nastav([])
        setPopisek('')
        klientId.current = noveId()
        router.refresh()
      } else if (vysledek.trvale) {
        // Server soubory uklidil (zpráva nevznikla) — příště se nahrají znovu.
        nastav(vybraneRef.current.map((x) => ({ ...x, nahrano: false })))
      }
    } catch {
      // Výpadek spojení: výběr, nahrané soubory i klientské id zůstávají, ať
      // zopakování zprávu nezdvojí a nenahrává znovu.
      setChyby(['Není spojení — zkuste to znovu, až se vrátí.'])
    } finally {
      bezi.current = false
      setStav('klid')
    }
  }

  const zaneprazdneno = stav !== 'klid'
  const jeVybrano = vybrane.length > 0

  return (
    <div className="pc-priloha">
      <input
        ref={vstupRef}
        type="file"
        hidden
        multiple
        accept="image/*,application/pdf"
        onChange={(e) => void pridat(e.target.files)}
      />

      <div className="pc-priloha-radek">
        <button
          type="button"
          className="ft-tl ft-tl-vedlejsi"
          onClick={() => vstupRef.current?.click()}
          disabled={zaneprazdneno || vybrane.length >= MAX_PRILOH}
        >
          <Ikona klic="fotka" /> Přidat přílohu
        </button>
        <small>Fotka nebo PDF, nejvýš {MAX_PRILOH} souborů, každý do 10 MB.</small>
      </div>

      {jeVybrano ? (
        <div className="pc-priloha-vyber">
          <ul>
            {vybrane.map((v) => (
              <li key={v.id}>
                <Ikona klic={jeObrazek(v.mime) ? 'fotka' : 'faktura'} />
                <span className="pc-priloha-nazev" title={v.nazev}>
                  {v.nazev}
                </span>
                <small>{velikostText(v.blob.size)}</small>
                <button
                  type="button"
                  className="ft-tl ft-tl-vedlejsi ft-tl-male"
                  onClick={() => odebrat(v.id)}
                  disabled={zaneprazdneno}
                  aria-label={`Odebrat přílohu ${v.nazev}`}
                >
                  Odebrat
                </button>
              </li>
            ))}
          </ul>

          <label className="pc-priloha-popisek">
            <span>Popisek (nepovinný)</span>
            <input
              type="text"
              value={popisek}
              onChange={(e) => setPopisek(e.target.value)}
              maxLength={4000}
              placeholder="K čemu ta příloha je?"
              disabled={zaneprazdneno}
            />
          </label>

          <div className="pc-priloha-radek">
            <button type="button" className="ft-tl ft-tl-hlavni" onClick={() => void odeslat()} disabled={zaneprazdneno}>
              {stav === 'odesila' ? 'Odesílá se…' : 'Odeslat s přílohou'}
            </button>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={zrusit} disabled={zaneprazdneno}>
              Zrušit
            </button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite">
        {stav === 'pripravuje' ? <small>Připravuje se…</small> : null}
        {hotovo ? <small>{hotovo}</small> : null}
        {chyby.map((c, i) => (
          <p key={i} className="hlaska-chyba" role="alert" style={{ margin: '4px 0 0' }}>
            {c}
          </p>
        ))}
      </div>
    </div>
  )
}
