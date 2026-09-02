'use client'

import { useEffect, useState } from 'react'

/**
 * Políčko na kód z tabletu.
 *
 * Klientské kvůli dvěma věcem, které se na serveru udělat nedají:
 *
 *  1. **Kód z adresy se po předvyplnění zahodí.** Adresa se zapisuje do
 *     historie prohlížeče, dá se přidat do záložek a poslat dál —
 *     a tenhle kód tam po ťuknutí nemá co dělat. `history.replaceState`
 *     ho odstraní, aniž by se stránka načetla znovu a aniž by přibyl
 *     krok v historii. Viz docs/qr-na-kiosku-zadani.md, oddíl 3.
 *
 *  2. **Předvyplněná hodnota musí jít přepsat.** Kdo kód opisuje
 *     z tabletu ručně, píše do téhož políčka.
 *
 * Otevření odkazu tím pádem NIC NEZAPÍŠE — jen předvyplní. Zápis
 * vzniká teprve ťuknutím na Příchod nebo Odchod.
 */
export default function PoleKodu({ zQr }: { zQr: string | null }) {
  const [kod, setKod] = useState(zQr ?? '')

  useEffect(() => {
    if (!zQr) return

    /*
      Z adresy se odstraní JEN `kod`. Ostatní parametry (měsíc,
      předvyplnění odchodu) tam patří a zahazovat je by rozbilo
      obrazovku, ze které člověk přišel.
    */
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has('kod')) return
      url.searchParams.delete('kod')
      window.history.replaceState(
        null,
        '',
        url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '') + url.hash,
      )
    } catch {
      // Kdyby prohlížeč replaceState neuměl, kód v adrese zůstane.
      // Je to nepříjemné, ne nebezpečné — za 45 vteřin je k ničemu.
    }
  }, [zQr])

  return (
    <>
      {/*
        Příznak, že kód přišel z QR. Rozlišuje se podle něj JEN HLÁŠKA:
        kdo naskenoval a nestihl ťuknout, má jít k tabletu pro nový kód,
        kdežto kdo se překlepl při opisování, má zkusit znovu.
      */}
      <input type="hidden" name="zqr" value={zQr ? '1' : ''} />

      <input
        name="kod"
        required
        maxLength={8}
        autoComplete="off"
        inputMode="text"
        placeholder="A1B2C3D4"
        value={kod}
        onChange={(e) => setKod(e.target.value.toUpperCase().slice(0, 8))}
        style={pole}
      />
    </>
  )
}

const pole = {
  width: '100%',
  padding: '12px',
  fontSize: '22px',
  letterSpacing: '.18em',
  textAlign: 'center' as const,
  textTransform: 'uppercase' as const,
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '52px',
} as const
