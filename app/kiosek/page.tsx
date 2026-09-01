import Kiosek from './kiosek'

export const dynamic = 'force-dynamic'

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
