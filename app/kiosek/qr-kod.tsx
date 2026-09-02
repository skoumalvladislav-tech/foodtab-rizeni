import { qrSvg } from '@/lib/qr'
import { odkazPichnuti } from '@/lib/qr-kiosek'

/**
 * Levá polovina kiosku: QR s odkazem na píchnutí, pod ním kód k opsání.
 *
 * ---------------------------------------------------------------------
 * PROČ JE TO SAMOSTATNÁ KOMPONENTA
 *
 * Aby na to šlo sáhnout kontrolou. `kiosek.tsx` si tahá stav ze
 * Supabase a čte localStorage, takže se v Node vykreslit nedá —
 * tohle ano. Kontrola (scripts/qr.test.mjs) si tuhle komponentu
 * VYKRESLÍ, vytáhne z výsledku hotové SVG a to pak dekóduje cizí
 * knihovnou. Ověřuje se tím obrázek, který uvidí člověk u baru, ne
 * řetězec poskládaný vedle.
 *
 * Nemá stav ani efekty schválně. Jakmile by sem přibyl hook, přestane
 * to jít vykreslit a kontrola ztratí to jediné, na čem jí záleží.
 *
 * ---------------------------------------------------------------------
 * DVĚ PODOBY
 *
 * S pobočkou: velký QR, který vede na Docházku s předvyplněným kódem.
 * Bez pobočky: žádný QR a kód velkým písmem k opsání.
 *
 * Ta druhá podoba není ozdoba. Dokud se v `kiosk_stav` nevrací slug
 * (migrace 20260902050000), adresa se sestavit nedá — a QR, ve kterém
 * je místo adresy osmiznakový kód, je horší než žádný. Fotoaparát ho
 * přečte, ukáže osm znaků a člověk je stejně přepíše. Přesně to se
 * stalo a přesně proto se tady nekreslí nic, co by to jen předstíralo.
 * Nadpis i popisek pro odečítač se mění spolu s obsahem: co obrazovka
 * slíbí, to se musí dát udělat.
 */
export default function QrKod({
  puvod,
  slug,
  kod,
  platnost,
}: {
  /** `window.location.origin`. Tablet i telefon jsou na téže adrese. */
  puvod: string
  /** Adresní podoba pobočky ze zařízení. `null`, dokud ji databáze nevrací. */
  slug: string | null
  kod: string
  platnost: number
}) {
  const odkaz = odkazPichnuti(puvod, slug, kod)

  if (!odkaz) {
    return (
      <section>
        <p style={popisek}>Opište kód</p>
        <p style={kodStyl}>{kod}</p>
        <p style={{ ...popis, marginBottom: 0 }}>
          Zadejte ho na Docházce v aplikaci. Mění se každých {platnost}{' '}
          vteřin — vyfocený je za chvíli k ničemu, a to je celý jeho smysl.
        </p>
      </section>
    )
  }

  return (
    <section>
      <p style={popisek}>Namiřte fotoaparát</p>

      <div
        style={{ lineHeight: 0, maxWidth: '100%' }}
        dangerouslySetInnerHTML={{
          __html: qrSvg(odkaz, {
            // Tablet stojí na baru a člověk se k němu nebude sklánět —
            // QR musí zabrat podstatnou část obrazovky. S celou adresou
            // vyjde verze kolem 4, tedy 33 modulů: při 320 px má modul
            // asi 8 px i s tichou zónou.
            velikost: 320,
            oprava: 'M',
            popis: 'QR kód: otevře Docházku s předvyplněným kódem',
          }),
        }}
      />

      <p style={{ ...popis, margin: '10px 0 0' }}>
        Nemáte čím načíst? Opište kód na Docházce v aplikaci:
      </p>
      <p style={kodMalyStyl}>{kod}</p>
      <p style={{ ...popis, marginBottom: 0 }}>
        Mění se každých {platnost} vteřin — vyfocený je za chvíli
        k ničemu, a to je celý jeho smysl.
      </p>
    </section>
  )
}

/* --- styly ---------------------------------------------------------- */

const popis = {
  margin: '10px 0 16px',
  fontSize: '13.5px',
  color: 'var(--muted)',
  maxWidth: '52ch',
} as const

const popisek = {
  margin: '0 0 6px',
  fontSize: '12px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.08em',
} as const

const kodMalyStyl = {
  margin: '4px 0 8px',
  fontSize: '26px',
  letterSpacing: '.14em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums' as const,
} as const

const kodStyl = {
  margin: '4px 0 8px',
  fontSize: '46px',
  letterSpacing: '.14em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums' as const,
} as const
