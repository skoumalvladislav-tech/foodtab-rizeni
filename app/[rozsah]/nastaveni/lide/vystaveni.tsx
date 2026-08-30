'use client'

import { useState } from 'react'
import { vystavitPozvankuAction } from './akce'

interface Zamestnanec {
  id: string
  full_name: string
}

export default function VystavitPozvankuFormular({
  rozsah,
  zamestnanci,
}: {
  rozsah: string
  zamestnanci: Zamestnanec[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setToken(null)

    const formData = new FormData(e.currentTarget)
    formData.append('rozsah', rozsah)

    const result = await vystavitPozvankuAction(formData)

    if (result.chyba) {
      setError(result.chyba)
      setLoading(false)
      return
    }

    if (result.token) {
      setToken(result.token)
      ;(e.target as HTMLFormElement).reset()
    }

    setLoading(false)
  }

  function copyToken() {
    if (token) {
      navigator.clipboard.writeText(token).then(() => {
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
          {!token ? (
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
              <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--muted)' }}>
                Pozvánka byla vystavena. Zkopírujte token a pošlete jej pozvanému člověku.
              </p>
              <div style={tokenBox}>
                <code style={tokenText}>{token}</code>
                <button onClick={copyToken} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                  {copied ? '✓ Zkopírováno' : 'Kopírovat'}
                </button>
              </div>
              <button
                onClick={() => {
                  setToken(null)
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

const chybaHlaska = {
  margin: '8px 0 0',
  fontSize: '13px',
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

