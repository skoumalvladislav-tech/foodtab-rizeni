'use client'

import { useState } from 'react'
import { vystavitPozvankuAction, type VysledekPozvanky } from './akce'

interface Zamestnanec {
  id: string
  full_name: string
}

/**
 * Role do nabídky. Chodí sem už PROSEJTÉ stropem — nabídne se jen to,
 * co ten, kdo zve, smí přidělit (docs/pravidlo-neprideluj-vic.md).
 * Rozhodnutí ale padá v databázi, ne tady; tohle je pohodlí, ne ochrana.
 */
interface Opravneni {
  id: string
  label: string
}

export default function VystavitPozvankuFormular({
  rozsah,
  zamestnanci,
  opravneni,
}: {
  rozsah: string
  zamestnanci: Zamestnanec[]
  opravneni: Opravneni[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [hotovo, setHotovo] = useState<VysledekPozvanky | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

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
    <div style={panel}>
      <button
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
                <select name="zamestnanec" required style={selectPole}>
                  <option value="">— Vyberte —</option>
                  {zamestnanci.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.full_name}
                    </option>
                  ))}
                </select>
              </label>

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
                Oprávnění je NEPOVINNÉ a výchozí je „přidělím později“.
                Kdo ví dopředu, koho zve a na co, vybere ho rovnou;
                ostatní pozvou nejdřív a rozhodnou, až člověk pozvánku
                opravdu přijme. Viz docs/pozvanky-zadani.md, oddíl 2.
              */}
              <label style={formularLabel}>
                <span>Oprávnění</span>
                <select name="opravneni" defaultValue="" style={selectPole}>
                  <option value="">Přidělím později</option>
                  {opravneni.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span style={vysvetlivka}>
                  Bez oprávnění se člověk přihlásí, ale v aplikaci
                  neuvidí nic než svoje údaje. V Lidech u něj bude stát
                  „čeká na přidělení“.
                </span>
              </label>

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
  borderRadius: '12px',
  marginTop: '32px',
  overflow: 'hidden',
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
  borderRadius: '10px',
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
  borderRadius: '10px',
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

const tokenBox = {
  display: 'flex',
  gap: '8px',
  padding: '12px',
  background: 'var(--sunken)',
  borderRadius: '8px',
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

