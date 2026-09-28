'use client'

import { useState } from 'react'

import { prepnoutNaJinyUcet } from './akce'

/**
 * Pozvánka je pro člověka, který už ve Foodtabu má JINÝ účet.
 *
 * Hlášení 25. 9. 2026: Kateřina přijala pozvánku z druhé adresy, přijetí
 * „prošlo" a nový účet zůstal bez jediného práva. Od 20260925150000
 * databáze takové přijetí odmítne větou „V téhle firmě už máte jiný
 * účet (k***@email.cz). Přihlaste se jím, nebo požádejte majitele
 * o novou pozvánku." — a tady se k ní nabídne cesta ven: odhlásit se
 * a přihlásit tím druhým účtem. Pozvánku, která přístup na novou adresu
 * přesune, vystavuje majitel v Lidech.
 *
 * Není to obecná chyba (červený řádek) — člověk nic nezkazil, jen je
 * přihlášený jinou adresou, než pod kterou ho firma zná.
 */
export default function JinyUcet({ hlaska }: { hlaska: string }) {
  const [ceka, setCeka] = useState(false)

  async function prepnout() {
    setCeka(true)
    try {
      await prepnoutNaJinyUcet()
    } finally {
      // Celé načtení: sezení se změnilo v cookie a přihlašovací stránka
      // si ho má přečíst od začátku.
      window.location.assign('/prihlaseni')
    }
  }

  return (
    <div style={ramecek} role="alert" data-jiny-ucet="">
      {/* Věta z databáze to řekne celé; nadpis ji jen neopakuje. */}
      <p style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600 }}>
        Jste přihlášení jiným účtem
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '13.5px', lineHeight: 1.5 }}>{hlaska}</p>
      <button type="button" className="ft-tl ft-tl-hlavni" disabled={ceka} onClick={prepnout}>
        {ceka ? 'Odhlašuji…' : 'Odhlásit se a přihlásit tím účtem'}
      </button>
    </div>
  )
}

const ramecek = {
  padding: '14px 16px',
  border: '1px solid var(--mosaz)',
  borderRadius: '12px',
  background: 'var(--paper)',
  color: 'var(--ink)',
} as const
