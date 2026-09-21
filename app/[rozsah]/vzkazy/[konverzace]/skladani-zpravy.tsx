'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import Ikona from '@/app/[rozsah]/ikona'
import { poslatZpravu, odeslatZpravuKlient } from '../akce'

/**
 * Psaní zprávy — s frontou neodeslaných.
 *
 * PROČ FRONTA. Na telefonu mezi regály se spojení ztrácí. Zpráva, která se
 * neodeslala a zmizela z pole, je horší než ta, která čeká: člověk by si
 * myslel, že ji poslal. Proto se každá zpráva nejdřív uloží do fronty
 * (v tomhle prohlížeči, `localStorage`), teprve pak se odesílá — a ve
 * frontě zůstane, dokud ji server nepřijme. Po obnovení spojení se odešle
 * sama; ručně jde znovu spustit nebo zahodit.
 *
 * NEDUPLIKUJE SE. Každá zpráva nese klientské id; opakované odeslání téhož
 * id databáze pozná (`poslat_zpravu`, `p_klient_id`) a vrátí původní
 * zprávu. Zdvojení tedy nehrozí ani když odpověď serveru ztratí spojení
 * dřív, než dorazí.
 *
 * ČESTNĚ O MEZÍCH:
 *   * fronta žije jen v tomhle prohlížeči a zařízení — po vymazání dat
 *     prohlížeče zmizí;
 *   * hlasovky se do fronty neukládají (zvuk je velký), ty selžou nahlas;
 *   * bez JavaScriptu se formulář odešle klasicky (server action níž).
 *
 * NALÉHAVÁ ZPRÁVA se odešle jen s potvrzením, že upozorní i mimo směnu.
 * Server to vyžaduje znovu — pole v prohlížeči je návrh, ne zámek.
 */

type Priorita = 'normal' | 'important' | 'urgent'

type Neodeslana = {
  klientId: string
  text: string
  priorita: Priorita
  potvrzeno: boolean
  chyba: string | null
  trvale: boolean
}

// Klíč nese i UŽIVATELE: na sdíleném telefonu by neodeslaná zpráva jednoho člověka
// jinak čekala v prohlížeči a odešla by pod jménem toho, kdo se přihlásí po něm.
const KLIC = (uzivatel: string, konverzace: string) => `foodtab:fronta-zprav:${uzivatel}:${konverzace}`

function nactiFrontu(uzivatel: string, konverzace: string): Neodeslana[] {
  try {
    const hrube = window.localStorage.getItem(KLIC(uzivatel, konverzace))
    if (!hrube) return []
    const pole = JSON.parse(hrube)
    return Array.isArray(pole)
      ? pole.filter(
          (p): p is Neodeslana =>
            typeof p?.klientId === 'string' && typeof p?.text === 'string' && typeof p?.priorita === 'string',
        )
      : []
  } catch {
    // Zablokované úložiště (soukromé okno, vypnuté ukládání): aplikace jede dál bez fronty.
    return []
  }
}

function ulozFrontu(uzivatel: string, konverzace: string, fronta: Neodeslana[]): void {
  try {
    if (fronta.length === 0) window.localStorage.removeItem(KLIC(uzivatel, konverzace))
    else window.localStorage.setItem(KLIC(uzivatel, konverzace), JSON.stringify(fronta))
  } catch {
    /* viz nactiFrontu */
  }
}

function noveId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Starší prohlížeče: RFC 4122 v4 z náhodných čísel. Stačí na rozlišení zpráv jednoho člověka.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export default function SkladaniZpravy({
  rozsah,
  konverzace,
  uzivatel,
  smiNalehavou,
}: {
  rozsah: string
  konverzace: string
  /** Přihlášený člověk — fronta neodeslaných zpráv patří jemu, ne prohlížeči. */
  uzivatel: string
  smiNalehavou: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [priorita, setPriorita] = useState<Priorita>('normal')
  const [potvrzeno, setPotvrzeno] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)
  const [fronta, setFronta] = useState<Neodeslana[]>([])
  const [odesila, setOdesila] = useState(false)
  const bezi = useRef(false)
  const frontaRef = useRef<Neodeslana[]>([])

  const nastavFrontu = useCallback(
    (nova: Neodeslana[]) => {
      frontaRef.current = nova
      setFronta(nova)
      ulozFrontu(uzivatel, konverzace, nova)
    },
    [uzivatel, konverzace],
  )

  // Odeslání všeho, co čeká. Jedna dávka naráz — dvě souběžné by si šlapaly po frontě.
  const odeslatFrontu = useCallback(async () => {
    if (bezi.current) return
    bezi.current = true
    setOdesila(true)
    try {
      let zmena = false
      // Co se v téhle dávce už zkoušelo — ať se zpráva, kterou server odmítl, netočí dokola.
      const zkouseno = new Set<string>()
      for (;;) {
        // Vždy nejstarší zpráva, která ještě nebyla na řadě: přibude-li nová za
        // běhu, odejde v téže dávce, ne až po 20 s časovači.
        const p = frontaRef.current.find((x) => !x.trvale && !zkouseno.has(x.klientId))
        if (!p) break
        zkouseno.add(p.klientId)
        try {
          const v = await odeslatZpravuKlient({
            rozsah,
            konverzace,
            text: p.text,
            priorita: p.priorita,
            klientId: p.klientId,
            potvrzeno: p.potvrzeno,
          })
          if (v.ok) {
            nastavFrontu(frontaRef.current.filter((x) => x.klientId !== p.klientId))
            zmena = true
          } else {
            nastavFrontu(
              frontaRef.current.map((x) =>
                x.klientId === p.klientId ? { ...x, chyba: v.chyba, trvale: v.trvale } : x,
              ),
            )
            // Server odpověděl, ale zprávu nepřijal, a příště by neprošla
            // taky: dál se nezkouší, ať se nezahlcuje.
            if (!v.trvale) break
          }
        } catch {
          // Výpadek spojení: zpráva zůstává ve frontě, zkusí se po obnovení.
          nastavFrontu(
            frontaRef.current.map((x) =>
              x.klientId === p.klientId ? { ...x, chyba: 'Není spojení — zkusí se znovu.', trvale: false } : x,
            ),
          )
          break
        }
      }
      if (zmena) router.refresh()
    } finally {
      bezi.current = false
      setOdesila(false)
    }
  }, [rozsah, konverzace, nastavFrontu, router])

  // Po načtení stránky: co zbylo z minula, se zkusí odeslat.
  useEffect(() => {
    const ulozena = nactiFrontu(uzivatel, konverzace)
    frontaRef.current = ulozena
    // Fronta žije v localStorage (na serveru není) — načíst ji jde až v prohlížeči, po vykreslení.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFronta(ulozena)
    if (ulozena.length > 0) void odeslatFrontu()
  }, [uzivatel, konverzace, odeslatFrontu])

  // Po obnovení spojení a po čase (spojení se občas vrátí bez události).
  useEffect(() => {
    const zkusit = () => {
      if (frontaRef.current.some((p) => !p.trvale)) void odeslatFrontu()
    }
    window.addEventListener('online', zkusit)
    const t = window.setInterval(zkusit, 20_000)
    return () => {
      window.removeEventListener('online', zkusit)
      window.clearInterval(t)
    }
  }, [odeslatFrontu])

  function odeslat(e: React.FormEvent) {
    // Preventuje se klasické odeslání formuláře; bez JavaScriptu proběhne ono.
    e.preventDefault()
    setChyba(null)

    const cisty = text.trim()
    if (cisty === '') return
    if (priorita === 'urgent' && !potvrzeno) {
      setChyba('Naléhavou zprávu nejdřív potvrďte — upozorní příjemce i mimo směnu.')
      return
    }

    nastavFrontu([
      ...frontaRef.current,
      { klientId: noveId(), text: cisty, priorita, potvrzeno: priorita === 'urgent' && potvrzeno, chyba: null, trvale: false },
    ])
    setText('')
    setPriorita('normal')
    setPotvrzeno(false)
    void odeslatFrontu()
  }

  function znovu(klientId: string) {
    nastavFrontu(frontaRef.current.map((x) => (x.klientId === klientId ? { ...x, chyba: null, trvale: false } : x)))
    void odeslatFrontu()
  }

  function zahodit(klientId: string) {
    nastavFrontu(frontaRef.current.filter((x) => x.klientId !== klientId))
  }

  return (
    <form action={poslatZpravu} onSubmit={odeslat} className="pc-skladani" noValidate>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="konverzace" value={konverzace} />

      {fronta.length > 0 ? (
        <ul className="pc-neodeslano" aria-live="polite">
          {fronta.map((p) => (
            <li key={p.klientId}>
              <Ikona klic="varovani" />
              <span title={p.text}>
                {p.trvale ? 'Nepřijato' : odesila ? 'Odesílá se' : 'Neodesláno'}: {p.text}
                {p.chyba ? ` — ${p.chyba}` : ''}
              </span>
              <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => znovu(p.klientId)}>
                Znovu
              </button>
              <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" onClick={() => zahodit(p.klientId)}>
                Zahodit
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        aria-label="Zpráva"
        name="text"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit()
        }}
        placeholder="Napište zprávu…"
        maxLength={4000}
        required
      />

      {priorita === 'urgent' ? (
        <label className="pc-potvrzeni-nalehave">
          <input
            type="checkbox"
            name="potvrzeno"
            checked={potvrzeno}
            onChange={(e) => setPotvrzeno(e.target.checked)}
          />
          <span>
            <strong>Naléhavá zpráva upozorní příjemce i mimo směnu.</strong> Potvrzuji, že to je
            nutné. Odeslání se zapíše do auditu (bez textu zprávy).
          </span>
        </label>
      ) : null}

      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {chyba}
        </p>
      ) : null}

      <div className="pc-skladani-radek">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--muted)' }}>
          Priorita
          <select
            name="priorita"
            value={priorita}
            onChange={(e) => {
              setPriorita(e.target.value as Priorita)
              setPotvrzeno(false)
            }}
          >
            <option value="normal">Běžná</option>
            <option value="important">Důležitá</option>
            {smiNalehavou ? <option value="urgent">Naléhavá — dorazí i mimo směnu</option> : null}
          </select>
        </label>
        <button type="submit" className="ft-tl ft-tl-hlavni" disabled={text.trim() === ''}>
          Odeslat
        </button>
      </div>
      {!smiNalehavou ? (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
          Doručí se, až bude příjemce na směně. Přečíst si zprávu může kdykoli, když aplikaci otevře.
        </p>
      ) : null}
    </form>
  )
}
