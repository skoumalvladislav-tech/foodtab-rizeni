/**
 * Stabilní barva pro dodavatele podle jména — přeneseno z faktury-app
 * (src/lib/supplierColor.ts), ale místo vlastních `--sw-1..9` (patřily
 * ke starému `globals.css`, který zadání žádá zahodit) devět odstínů
 * v duchu foodtabové krémovo-mosazné palety (`app/_tokeny.css`), napsaných
 * napřímo — je jich málo a jsou to jen tečky u seznamu, nemá cenu kvůli
 * nim rozšiřovat sdílené tokeny o něco, co používá jediný modul.
 */
const ODSTINY = [
  '#916624', // mosaz
  '#5b7c99', // modrošedá
  '#7c8a5b', // olivová
  '#9c6b5b', // terakota
  '#6b7c99', // chladná modrá
  '#8a7c5b', // pískově hnědá
  '#5b9986', // petrolejová
  '#997c5b', // karamelová
  '#7c5b7c', // fialkošedá
]

export function barvaDodavatele(jmeno: string | null | undefined): string {
  const klic = (jmeno || '?').trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < klic.length; i++) {
    hash = (hash * 31 + klic.charCodeAt(i)) >>> 0
  }
  return ODSTINY[hash % ODSTINY.length]
}

export function inicialyDodavatele(jmeno: string | null | undefined): string {
  const casti = (jmeno || '').trim().split(/\s+/).filter(Boolean)
  if (casti.length === 0) return '–'
  if (casti.length === 1) return casti[0].slice(0, 2).toUpperCase()
  return (casti[0][0] + casti[1][0]).toUpperCase()
}
