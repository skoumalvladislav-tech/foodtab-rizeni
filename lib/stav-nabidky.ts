/**
 * Stav výsuvné nabídky — menu „Více" na telefonu (MobileVice) a nabídka
 * účtu pod iniciálami v horní liště na počítači a tabletu (MenuUctu).
 *
 * Pamatuje se ADRESA, na které se nabídka otevřela; `null` = zavřená.
 * Otevřená je jen na téže adrese: po přechodu jinam (odkazem z nabídky,
 * tlačítkem Zpět v prohlížeči) je zavřená.
 *
 * A to se musí i ZAPSAT (`poZmeneAdresy`), ne jen spočítat. Do 25. 9.
 * 2026 se to jen počítalo: menu otevřené na Dnes se po Zpět zavřelo,
 * ale po Vpřed — nebo ťuknutím na Dnes v liště — na Dnes vyskočilo
 * samo, protože si tu adresu pořád pamatovalo.
 *
 * Čistě, bez Reactu — dá se ověřit bez prohlížeče
 * (scripts/nabidka.test.mjs). Do 25. 9. to sedělo přímo v MobileVice
 * a nezávislá kontrola ukázala, že se tam dalo rozbít otevírání
 * i zavírání a žádná kontrola si toho nevšimla.
 */

export type StavNabidky = string | null;

export const ZAVRENA: StavNabidky = null;

/** Je nabídka na téhle adrese otevřená? */
export function jeOtevrena(stav: StavNabidky, cesta: string): boolean {
  return stav !== null && stav === cesta;
}

/** Ťuknutí na tlačítko nabídky: zavřenou otevře, otevřenou zavře. */
export function poKliknuti(stav: StavNabidky, cesta: string): StavNabidky {
  return jeOtevrena(stav, cesta) ? ZAVRENA : cesta;
}

/**
 * Stav, jak má platit na téhle adrese: otevření z jiné adresy se
 * zapomene. Komponenta ho volá při každém vykreslení a změnu hned
 * zapíše (React dovoluje nastavit stav během vykreslení, když se tím
 * dorovnává změna vlastností — nabídka tak ani na okamžik nevyskočí).
 */
export function poZmeneAdresy(stav: StavNabidky, cesta: string): StavNabidky {
  return stav !== null && stav !== cesta ? ZAVRENA : stav;
}
