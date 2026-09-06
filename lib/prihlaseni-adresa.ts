import 'server-only'

import { headers } from 'next/headers'

import { bezpecnyCil } from './prihlaseni.ts'

/**
 * Adresa přihlášení, která si pamatuje, odkud člověk šel.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NEJDE BEZ TOHOHLE
 *
 * `redirect('/prihlaseni')` původní adresu ZAHODÍ. Kdo si otevřel odkaz
 * na konkrétní rozhovor a nebyl přihlášený, skončil po přihlášení na
 * rozcestníku a ten rozhovor si musel najít znovu — u člověka, kterému
 * někdo poslal odkaz na vzkaz vedení, je to rozdíl mezi „přečetl si to"
 * a „vzdal to".
 *
 * Cestu podává `proxy.ts` hlavičkou `x-foodtab-adresa`; stránky
 * `searchParams` z původního požadavku nedostanou.
 *
 * ---------------------------------------------------------------------
 * PROČ SE TO NEDÁ VZÍT AŽ NA PŘIHLAŠOVACÍ OBRAZOVCE
 *
 * Tam už je ta hlavička `/prihlaseni` — přesměrování je nový požadavek.
 * Cesta se proto musí zabalit do adresy TEĎ, ve chvíli odmítnutí.
 *
 * Tenhle soubor je oddělený od `lib/prihlaseni.ts` schválně: ten druhý
 * si importuje i klientská komponenta, a `next/headers` v prohlížeči
 * neexistuje.
 */
export async function odkazNaPrihlaseni(
  parametry: Record<string, string> = {},
): Promise<string> {
  const adresa = (await headers()).get('x-foodtab-adresa') ?? ''
  const kam = bezpecnyCil(adresa)

  const q = new URLSearchParams(parametry)
  // Na rozcestník se vracet nemusí, to je stejně výchozí cíl — a kratší
  // adresa se líp čte v protokolu i v e-mailu.
  if (kam !== '/') q.set('kam', kam)

  const dotaz = q.toString()
  return dotaz ? `/prihlaseni?${dotaz}` : '/prihlaseni'
}
