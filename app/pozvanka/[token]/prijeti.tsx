'use client'

import { useState } from 'react'
import { redirect } from 'next/navigation'
import { prijmoutPozvankuAction } from './akce'

export default function PrijmoutPozvankuFormular({ token }: { token: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Volá se bez hesla — heslo se nastaví později
    // Teď se jen přijímá pozvánka
    const result = await prijmoutPozvankuAction(token)

    if (result.chyba) {
      setError(result.chyba)
      setLoading(false)
      return
    }

    if (result.success) {
      // Přesměrování na úvodní stránku
      redirect('/')
    }

    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} style={formular}>
      <p style={text}>
        Kliknutím na tlačítko níže potvrdíte, že chcete vstoupit do firmy.
      </p>

      {error && <p className="hlaska-chyba">{error}</p>}

      <button type="submit" disabled={loading} className="ft-tl ft-tl-hlavni">
        {loading ? 'Přijímám…' : 'Přijmout pozvánku'}
      </button>
    </form>
  )
}

/* --- Styly --- */

const formular = {
  display: 'grid',
  gap: '16px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: 'var(--shadow)',
} as const

const text = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--muted)',
} as const

const chybaHlaska = {
  margin: 0,
  fontSize: '13px',
} as const

