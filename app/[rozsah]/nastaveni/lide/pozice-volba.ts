/**
 * Hodnota volby „+ Nová pozice…“ v rozbalovátku.
 *
 * Stojí ve vlastním souboru schválně: čte ji klientská komponenta
 * i serverová akce, a ani jedna z nich nemůže být zdrojem té druhé —
 * soubor s 'use server' smí vyvážet jen asynchronní funkce a klientský
 * modul se do serverové akce tahat nemá.
 *
 * Dvě podtržítka na začátku, aby se to nedalo splést s uuid pozice.
 */
export const NOVA_POZICE = '__nova'
