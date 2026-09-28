'use client'

import { useState } from 'react'
import { vystavitPozvankuAction, type VysledekPozvanky } from './akce'

interface Zamestnanec {
  id: string
  full_name: string
  /** Pobočka z Lidí. Předvyplní se, ale jde přepsat. */
  branch_id: string | null
  /** Člověk už účet má — pozvánka na jinou adresu je PŘESUN. */
  maUcet?: boolean
  /** Zamaskovaný kontakt toho účtu (k***@email.cz), když ho databáze dala. */
  ucet?: string | null
  jeMajitel?: boolean
}

/**
 * Věta pod výběrem člověka, když už účet má (hlášení 25. 9. 2026).
 *
 * Majitel poslal Kateřině, která účet měla, čtyři pozvánky na novou
 * adresu. Každá „prošla" a nic se nestalo — nový účet zůstal bez práv.
 * Od 20260925150000 je taková pozvánka PŘESUN: po přijetí se přístup
 * přestěhuje na novou adresu a starý účet se od firmy odpojí. Smí to jen
 * majitel a nikdy ne u majitele; tady se to říká DŘÍV, než se klikne.
 * Rozhoduje databáze (`create_invitation`) — věta je jen vysvětlení.
 */
export function PoznamkaKUctu({
  clovek,
  jsemMajitel,
}: {
  clovek: Zamestnanec | null
  jsemMajitel: boolean
}) {
  if (!clovek?.maUcet) return null

  const ucet = clovek.ucet ? ` (${clovek.ucet})` : ''

  if (clovek.jeMajitel) {
    return (
      <p style={poznamka} data-poznamka="majitel">
        {clovek.full_name} je majitel a účet už má{ucet}. Pozvánkou se
        účet majitele nepřesouvá — přihlašovací adresu majitele zatím
        změní jen správce Foodtabu.
      </p>
    )
  }

  if (!jsemMajitel) {
    return (
      <p style={poznamka} data-poznamka="jen-majitel">
        {clovek.full_name} už má účet{ucet}. Pozvánku na tutéž adresu
        vystavit můžete. Přesunout přístup na jinou adresu může jen
        majitel — požádejte ho.
      </p>
    )
  }

  return (
    <p style={poznamka} data-poznamka="presun">
      {clovek.full_name} už má účet{ucet}. Pozvánka na jinou adresu
      přesune přístup: po přijetí se bude přihlašovat novou adresou a starý
      účet se od firmy odpojí. Směny a docházka zůstanou v Lidech, jak jsou.
    </p>
  )
}

export default function VystavitPozvankuFormular({
  rozsah,
  zamestnanci,
  pobocky,
  smiFiremni,
  jsemMajitel = false,
  otevreno = false,
}: {
  rozsah: string
  zamestnanci: Zamestnanec[]
  /** Pobočky, na které přihlášený sám vidí — nabídnout jde jen to, co má. */
  pobocky: { id: string; nazev: string }[]
  /** Firemní rozsah nabízí jen ten, kdo ho má sám. */
  smiFiremni: boolean
  /** Přesun účtu na novou adresu vystaví jen majitel. */
  jsemMajitel?: boolean
  /**
   * Rozbalený hned. Okno „čeká na oprávnění" sem u účtu bez záznamu
   * vede odkazem `?pozvat=1#pozvanka` (lib/ceka-na-opravneni.ts) —
   * sbalený panel pod tabulkou by nikdo nenašel (kontrola 28. 9. 2026).
   */
  otevreno?: boolean
}) {
  const [expanded, setExpanded] = useState(otevreno)
  const [hotovo, setHotovo] = useState<VysledekPozvanky | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [vybranyId, setVybranyId] = useState('')
  const vybrany = zamestnanci.find((z) => z.id === vybranyId) ?? null

  /*
    Pobočka se předvyplní podle Lidí, ale je VIDĚT a jde přepsat —
    kdo zve, ví to nejlíp (docs/ukoly-codea-drobnosti, bod 7c).
    Bez toho by se rozhodovalo poslepu a člověk by po přijetí pozvánky
    koukal na prázdný rám.
  */
  const [pobocka, setPobocka] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setHotovo(null)

    const formData = new FormData(e.currentTarget)
    formData.append('rozsah', rozsah)

    const result = await vystavitPozvankuAction(formData)

    if (result.chyba) {
      setError(result.chyba)
      setLoading(false)
      return
    }

    if (result.odkaz) {
      setHotovo(result)
      ;(e.target as HTMLFormElement).reset()
    }

    setLoading(false)
  }

  function copyToken() {
    if (hotovo?.odkaz) {
      navigator.clipboard.writeText(hotovo.odkaz).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div style={panel} id="pozvanka">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        style={zahlavi}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>Vystavit pozvánku</span>
      </button>

      {expanded && (
        <div style={obsah}>
          {!hotovo ? (
            <form onSubmit={handleSubmit} style={formular}>
              <label style={formularLabel}>
                <span>Zaměstnanec *</span>
                <select
                  name="zamestnanec"
                  required
                  style={selectPole}
                  onChange={(e) => {
                    const z = zamestnanci.find((x) => x.id === e.target.value)
                    setPobocka(z?.branch_id ?? (smiFiremni ? 'firma' : ''))
                    setVybranyId(e.target.value)
                  }}
                >
                  <option value="">— Vyberte —</option>
                  {zamestnanci.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <PoznamkaKUctu clovek={vybrany} jsemMajitel={jsemMajitel} />

              <label style={formularLabel}>
                <span>Kanál</span>
                <select name="kanal" defaultValue="email" style={selectPole}>
                  <option value="email">E-mail</option>
                  <option value="sms">SMS</option>
                </select>
              </label>

              <label style={formularLabel}>
                <span>E-mailová adresa *</span>
                <input
                  type="email"
                  name="email"
                  required
                  style={inputPole}
                  placeholder="pozvany@example.com"
                />
              </label>

              {/*
                Pobočka i oprávnění rovnou v pozvánce (bod 7c). Tím se
                to hlavní vyřeší samo: kdo pozvánku přijme, rovnou vidí
                funkční aplikaci, ne prázdný rám s vysvětlením.
              */}
              <label style={formularLabel}>
                <span>Pobočka</span>
                <select
                  name="pobocka"
                  value={pobocka}
                  onChange={(e) => setPobocka(e.target.value)}
                  style={selectPole}
                >
                  <option value="">Podle Lidí</option>
                  {smiFiremni ? <option value="firma">Celá firma</option> : null}
                  {pobocky.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nazev}
                    </option>
                  ))}
                </select>
                <span style={vysvetlivka}>
                  Kam člověk uvidí. Předvyplní se podle Lidí; přepsat to
                  jde, protože kdo zve, ví to nejlíp.
                </span>
              </label>

              {/*
                VÝBĚR OPRÁVNĚNÍ TU UŽ NENÍ, a je to schválně.

                Od 9. 9. 2026 nese oprávnění zařazení u zaměstnance
                a pozvánka je bere z něj (zadání
                docs/zarazeni-misto-roli.md, oddíl 6.5). Rozbalovátko
                tady by nabízelo druhé místo, kde se rozhoduje o téže
                věci — a dvě místa se dřív nebo později rozejdou.
              */}
              <p style={vysvetlivka}>
                Oprávnění se bere ze zařazení toho člověka v Lidech.
                Kdo zatím žádné nemá, se přihlásí a uvidí jen svoje
                údaje — v Lidech u něj bude stát „čeká na přidělení“.
              </p>

              {error && (
                <p className="hlaska-chyba">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="ft-tl ft-tl-hlavni"
              >
                {loading ? 'Vystavuji…' : 'Vystavit pozvánku'}
              </button>
            </form>
          ) : (
            <div style={vysledek}>
              {/*
                Nejdřív se řekne, jestli e-mail odešel. Pozvánka, o které
                si vedoucí myslí, že je doručená, je horší než chyba —
                proto se neúspěch píše nahoře a barevně, ne jako poznámka
                pod odkazem.
              */}
              {hotovo.poslanoNa ? (
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
                  Pozvánka odešla na <strong>{hotovo.poslanoNa}</strong>. Odkaz
                  platí sedm dní a jde použít jednou.
                </p>
              ) : (
                <p style={neposlano}>
                  <strong>Pozvánka je vystavená, ale e-mail neodešel.</strong>{' '}
                  {hotovo.chybaMailu} Odkaz níž funguje — pošlete ho zatím
                  sami, jak vám to vyhovuje.
                </p>
              )}

              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {hotovo.poslanoNa
                  ? 'Kdyby e-mail nedošel, tady je tentýž odkaz ke zkopírování:'
                  : 'Odkaz k odeslání:'}
              </p>
              <div style={tokenBox}>
                <code style={tokenText}>{hotovo.odkaz}</code>
                <button onClick={copyToken} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  {copied ? '✓ Zkopírováno' : 'Kopírovat'}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
                Ukáže se jenom teď — v databázi po něm zůstane jen otisk.
                Když ho ztratíte, vystavte novou pozvánku.
              </p>
              <button
                onClick={() => {
                  setHotovo(null)
                  // Formulář se kreslí znovu s prázdným výběrem — věta
                  // o účtu nesmí zůstat viset u nikoho.
                  setVybranyId('')
                }}
                className="ft-tl ft-tl-vedlejsi"
              >
                Nová pozvánka
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* --- Styly --- */

const panel = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  marginTop: '32px',
  overflow: 'hidden',
  // Kotva #pozvanka: jako panel oprávnění, ať nezajede pod horní lištu.
  scrollMarginTop: '80px',
} as const

const zahlavi = {
  width: '100%',
  padding: '14px 16px',
  background: 'var(--sunken)',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  fontSize: '14px',
  fontWeight: '500',
  color: 'var(--ink)',
  textAlign: 'left' as const,
} as const

const obsah = {
  padding: '16px',
  borderTop: '1px solid var(--line)',
} as const

const formular = {
  display: 'grid',
  gap: '14px',
} as const

const formularLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const inputPole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const selectPole = {
  ...inputPole,
  cursor: 'pointer',
} as const

const neposlano = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const

const vysvetlivka = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  textTransform: 'none' as const,
  letterSpacing: 'normal',
  lineHeight: 1.45,
  maxWidth: '52ch',
} as const

const vysledek = {
  display: 'grid',
  gap: '12px',
} as const

/* Stejný rámeček jako „e-mail neodešel": je to věc, kterou je potřeba
   vědět předem, ne chyba. */
const poznamka = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--pozor-bg)',
  color: 'var(--ink)',
  fontSize: '13.5px',
  lineHeight: 1.5,
  maxWidth: '62ch',
} as const

const tokenBox = {
  display: 'flex',
  gap: '8px',
  padding: '12px',
  background: 'var(--sunken)',
  borderRadius: 'var(--radius-sm)',
  alignItems: 'center',
} as const

const tokenText = {
  flex: 1,
  margin: 0,
  fontFamily: 'monospace',
  fontSize: '13px',
  wordBreak: 'break-all' as const,
  color: 'var(--ink)',
} as const

