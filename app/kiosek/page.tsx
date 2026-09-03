import type { Metadata } from 'next'

import Kiosek from './kiosek'

export const dynamic = 'force-dynamic'

/**
 * Odkaz na KIOSKOVÝ manifest, ne na společný.
 *
 * Tohle je celá oprava toho, že ikona z plochy otevírala přihlášení:
 * Android bere start_url z manifestu, který stránka odkazuje, ne
 * z adresy, na které člověk stojí. Metadata z bližšího segmentu
 * přebijí ta z rozvržení, takže na /kiosek platí tenhle.
 *
 * Viz docs/kiosek-vlastni-manifest.md a app/kiosek.webmanifest/route.ts.
 */
export const metadata: Metadata = {
  title: 'Foodtab kiosek',
  manifest: '/kiosek.webmanifest',
}

/**
 * Kiosek na provozovně.
 *
 * Zadání docs/kiosek-pin-zalohy-zadani.md, oddíl 2. Adresa je schválně
 * MIMO /[rozsah] a mimo přihlášení: tablet nikoho přihlášeného nemá
 * a mít nesmí. Kdyby byl přihlášený jako vedoucí, ležel by na baru
 * účet, který vidí tržby, mzdy a osobní údaje.
 *
 * Totožnost dává zařízení: klíč z registrace, uložený v prohlížeči
 * tabletu. Server podle něj pozná pobočku a nic víc nepustí —
 * `kiosk_stav` a `pichnout_pinem` jsou jediné dvě funkce, na které
 * zařízení dosáhne.
 *
 * Nová aplikace se nepíše. Foodtab už je PWA, takže se tahle adresa na
 * tabletu přidá na plochu. Zamknout aplikaci systémem (Android:
 * připnutí, iPad: Guided Access) je věc nastavení zařízení, ne kódu —
 * ale patří do návodu pro provozovnu.
 */
export default function KioskovaStranka() {
  return <Kiosek />
}
