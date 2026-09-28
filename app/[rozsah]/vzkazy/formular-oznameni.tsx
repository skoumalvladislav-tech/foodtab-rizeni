'use client'

import { startTransition, useActionState, useState } from 'react'

import Ikona from '@/app/[rozsah]/ikona'
import { napsatOznameni, type StavOznameni } from './akce-nastenka'
import TlacitkoOdeslat from './tlacitko-odeslat'

/**
 * Formulář „Nové oznámení“ na Nástěnce.
 *
 * VÝBĚR ADRESÁTA JE KLIENTSKÁ KOMPONENTA (27. 9.). Do té doby ho řídil
 * vložený `<script>`, který se spustí jen při prvním načtení stránky —
 * po přechodu na Nástěnku záložkou (klientská navigace) se nespustil
 * a byly vidět všechny čtyři výběry naráz.
 *
 * HLÁŠKA MÍSTO TICHA. Akce vrací českou větu, když oznámení nejde
 * uložit (chybí adresát, databáze odmítla) — do té doby formulář „nic
 * neudělal“.
 *
 * PO CHYBĚ ZŮSTANE VŠECHNO, JAK BYLO (28. 9.). React 19 po KAŽDÉ akci
 * formuláře (`<form action>`) sám vrátí pole do výchozího stavu, i když
 * akce vrátí chybu. Zaškrtávátka „Připnout“ a „Beru na vědomí“ se tak
 * odškrtla a výběr „Komu“ ukázal „Celá firma“, zatímco druhý výběr
 * (člověk, úsek) zůstal na obrazovce. Vedoucí pak vybral Petru a poslal
 * oznámení „Petro, přijď si pro smlouvu“ CELÉ FIRMĚ. Proto:
 *   * odeslání jde přes `onSubmit` + `startTransition` — React pak
 *     formulář nevrací (akce s `preventDefault` se jen označí jako
 *     běžící, `TlacitkoOdeslat` se dál zamkne proti dvojkliku);
 *   * všechna pole jsou řízená a po úspěchu se vyprázdní ručně;
 *   * akce na serveru odmítne rozpor „Celá firma + vybraný člověk“.
 * `action={odeslat}` zůstává kvůli odeslání bez JavaScriptu.
 */

type Volba = { id: string; nazev: string }

const POLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  // 16 px schválně: iOS jinak při zaostření pole zoomuje stránku.
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
}

export default function FormularOznameni({
  rozsah,
  pobocky,
  useky,
  pozice,
  lide,
}: {
  rozsah: string
  /** Víc než jedna, jinak se volba „Pobočka“ nenabízí. */
  pobocky: Volba[]
  useky: Volba[]
  pozice: Volba[]
  /** Jen lidé S ÚČTEM, kteří Nástěnku smí číst — ostatní by oznámení nikdy neviděli. */
  lide: Volba[]
}) {
  const [stav, odeslat] = useActionState<StavOznameni, FormData>(napsatOznameni, null)
  const [text, setText] = useState('')
  const [komu, setKomu] = useState('firma')
  const [komuId, setKomuId] = useState('')
  const [pripnout, setPripnout] = useState(false)
  const [vyzadat, setVyzadat] = useState(false)
  const [posledniOk, setPosledniOk] = useState<number | null>(null)

  // Po úspěchu se formulář vyprázdní — jednou na každé nové „ok“.
  if (stav?.ok && stav.kdy !== posledniOk) {
    setPosledniOk(stav.kdy)
    setText('')
    setKomu('firma')
    setKomuId('')
    setPripnout(false)
    setVyzadat(false)
  }

  const vyber = (nazev: string, popisek: string, volby: Volba[], prazdna: string) => (
    <select
      name={nazev}
      aria-label={popisek}
      value={komuId}
      onChange={(e) => setKomuId(e.target.value)}
      style={{ ...POLE, marginTop: '6px' }}
    >
      <option value="">{prazdna}</option>
      {volby.map((v) => (
        <option key={v.id} value={v.id}>
          {v.nazev}
        </option>
      ))}
    </select>
  )

  return (
    <form
      action={odeslat}
      onSubmit={(e) => {
        // Bez tohohle by React po akci vrátil pole do výchozího stavu
        // (viz hlavička). Akce běží dál jako přechod, tlačítko se zamkne.
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => odeslat(data))
      }}
      className="ds-plocha pc-oznameni-formular"
    >
      <div className="ds-plocha-hlava">
        <Ikona klic="tuzka" />
        <h2>Nové oznámení</h2>
      </div>
      <input type="hidden" name="rozsah" value={rozsah} />

      <label htmlFor="ft-nastenka-text" className="pc-oznameni-popisek">
        Co mají lidé vědět
      </label>
      <textarea
        id="ft-nastenka-text"
        name="text"
        required
        rows={3}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Např. Zítra od 14:00 porada, přijďte všichni."
        style={{ ...POLE, resize: 'vertical' }}
      />
      {/*
        Diktování — jediná hlasová cesta, která funguje i na iPhonu.
        Pole to unese: je řízené, ale nic v okolí se nepřekresluje po
        vteřinách, takže se diktování uprostřed věty neutne.
      */}
      <p className="pc-oznameni-rada">Můžete i diktovat — mikrofon na klávesnici telefonu.</p>

      <label htmlFor="ft-nastenka-komu-typ" className="pc-oznameni-popisek" style={{ marginTop: '10px' }}>
        Komu
      </label>
      <select
        id="ft-nastenka-komu-typ"
        name="komu_typ"
        value={komu}
        onChange={(e) => {
          setKomu(e.target.value)
          // Id z předchozí volby by k nové nepatřilo (úsek ≠ člověk).
          setKomuId('')
        }}
        style={POLE}
      >
        <option value="firma">Celá firma</option>
        {pobocky.length > 1 ? <option value="pobocka">Pobočka…</option> : null}
        {useky.length > 0 ? <option value="usek">Úsek…</option> : null}
        {pozice.length > 0 ? <option value="pozice">Pozice…</option> : null}
        {lide.length > 0 ? <option value="clovek">Konkrétní člověk…</option> : null}
      </select>

      {/* Druhý výběr jen k té volbě, která je zvolená — žádný skript navíc. */}
      {komu === 'pobocka' ? vyber('komu_id_pobocka', 'Vyberte pobočku', pobocky, 'Vyberte pobočku…') : null}
      {komu === 'usek' ? vyber('komu_id_usek', 'Vyberte úsek', useky, 'Vyberte úsek…') : null}
      {komu === 'pozice' ? vyber('komu_id_pozice', 'Vyberte pozici', pozice, 'Vyberte pozici…') : null}
      {komu === 'clovek' ? vyber('komu_id_clovek', 'Vyberte člověka', lide, 'Vyberte člověka…') : null}

      {stav && !stav.ok ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: '10px 0 0' }}>
          {stav.chyba}
        </p>
      ) : null}
      {stav?.ok && text === '' ? (
        <p className="pc-oznameni-ok" role="status">
          <Ikona klic="fajfkaKruh" /> Oznámení je na Nástěnce.
        </p>
      ) : null}

      <div className="pc-oznameni-radek">
        <div className="pc-oznameni-volby">
          <label>
            <input
              type="checkbox"
              name="pripnout"
              value="ano"
              checked={pripnout}
              onChange={(e) => setPripnout(e.target.checked)}
            />
            Připnout nahoru
          </label>
          <label>
            <input
              type="checkbox"
              name="vyzadat_potvrzeni"
              value="ano"
              checked={vyzadat}
              onChange={(e) => setVyzadat(e.target.checked)}
            />
            Vyžadovat „Beru na vědomí“
          </label>
        </div>
        <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Odesílá se…">
          Odeslat
        </TlacitkoOdeslat>
      </div>
    </form>
  )
}
