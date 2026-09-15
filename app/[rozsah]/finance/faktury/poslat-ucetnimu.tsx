'use client'

import { useState } from 'react'

/**
 * Přeneseno z faktury-app (src/components/SendToAccountant.tsx). Prohlížeč
 * z bezpečnostních důvodů neumí přes `mailto:` přiložit soubor automaticky
 * — CSV se proto rovnou stáhne a uživatel ho k připravenému e-mailu jen
 * ručně přiloží. Appka žádný e-mail sama neodesílá, jen otevře koncept
 * v e-mailovém klientovi uživatele.
 */

function tentoMesic(): string {
  return new Date().toISOString().slice(0, 7)
}
function minulyMesic(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}
function nazevMesice(mesic: string): string {
  const d = new Date(`${mesic}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return mesic
  const popis = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(d)
  return popis.charAt(0).toUpperCase() + popis.slice(1)
}

const KLIC_ULOZENI = 'faktury-ucetni-email'

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '13.5px',
} as const

function nacistUlozenyEmail(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(KLIC_ULOZENI) ?? ''
  } catch {
    // localStorage nemusí být dostupný (např. soukromé okno) — appka funguje i bez zapamatování.
    return ''
  }
}

export default function PoslatUcetnimu({ rozsah }: { rozsah: string }) {
  const [email, setEmail] = useState(nacistUlozenyEmail)
  const [obdobi, setObdobi] = useState<'minuly' | 'tento'>('minuly')
  const [stav, setStav] = useState<'klid' | 'pracuje'>('klid')

  function odeslat() {
    if (!email) return
    try {
      window.localStorage.setItem(KLIC_ULOZENI, email)
    } catch {
      // ignore
    }

    const mesic = obdobi === 'tento' ? tentoMesic() : minulyMesic()
    const nazev = nazevMesice(mesic)
    const odkazKeStazeni = `${window.location.origin}/api/faktury/export?rozsah=${encodeURIComponent(rozsah)}&mesic=${mesic}`

    const a = document.createElement('a')
    a.href = odkazKeStazeni
    document.body.appendChild(a)
    a.click()
    a.remove()

    const predmet = `Faktury – ${nazev}`
    const telo =
      `Dobrý den,\n\nv příloze posílám přehled faktur za ${nazev.toLowerCase()} ` +
      `(CSV soubor se právě stáhl do Stažených souborů - prosím přiložte ho k tomuto e-mailu).\n\n` +
      `Případně jde stáhnout přímo zde: ${odkazKeStazeni}\n\nDěkuji`
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(predmet)}&body=${encodeURIComponent(telo)}`

    setStav('pracuje')
    window.setTimeout(() => setStav('klid'), 2500)
    window.location.href = mailto
  }

  return (
    <div style={karta}>
      <p style={{ margin: '0 0 6px', fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Poslat účetnímu
      </p>
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--muted)' }}>
        Stáhne CSV za zvolený měsíc a otevře připravený e-mail — CSV soubor stačí jen přiložit.
        E-mail účetního si appka zapamatuje v tomto prohlížeči.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="email"
          placeholder="e-mail účetního"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="E-mail účetního"
          style={{ ...pole, flex: '1 1 220px' }}
        />
        <select
          value={obdobi}
          onChange={(e) => setObdobi(e.target.value as 'minuly' | 'tento')}
          aria-label="Období"
          style={pole}
        >
          <option value="minuly">Minulý měsíc</option>
          <option value="tento">Tento měsíc</option>
        </select>
        <button type="button" className="ft-tl ft-tl-hlavni ft-tl-male" onClick={odeslat} disabled={!email}>
          {stav === 'pracuje' ? 'Otevírá se e-mail…' : 'Připravit e-mail'}
        </button>
      </div>
    </div>
  )
}
