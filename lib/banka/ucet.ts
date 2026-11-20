/**
 * Číslo účtu protistrany v jednom tvaru — ať přijde z banky, ze
 * stažení přes API nebo z importovaného výpisu.
 *
 * Proč: otisk pohybu bez id od banky (migrace 20261119100000) počítá
 * i s protiúčtem. Kdyby jeden výpis psal `19-2000145399/0800` a druhý
 * `CZ65 0800 0000 1920 0014 5399`, byl by tentýž pohyb dvakrát. Párování
 * a přehledy pak hledají protistranu podle jednoho tvaru.
 *
 *   * IBAN (dvě písmena, dvě číslice, zbytek) se zkontroluje modulem 97
 *     a vrátí velkými písmeny bez mezer;
 *   * český tvar `předčíslí-číslo/kód banky` se zkontroluje modulem 11
 *     (váhy ČNB) a převede na IBAN;
 *   * cokoli jiného (účet bez kódu banky, zahraniční tvar, překlep)
 *     zůstane jako text — jen bez mezer na krajích a se zdvojenými
 *     mezerami sraženými na jednu. Nic se nedomýšlí.
 *
 * Čistá logika, žádné IO (scripts/banka-ucet.test.mjs).
 */

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/
const CESKY_UCET = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{3,4})$/

/**
 * Kód banky má vždy 4 číslice. Excel ale při uložení výpisu úvodní nulu
 * smaže (0800 → 800, 0100 → 100) a týž pohyb by pak měl jiný protiúčet
 * — a jiný otisk. Žádný kód banky nezačíná dvěma nulami, takže se
 * doplňuje jen u tříčíslicového a jen jedna.
 */
function ctyrmistnyKod(kod: string): string {
  return kod.length === 3 ? `0${kod}` : kod
}

const VAHY_PREDCISLI = [10, 5, 8, 4, 2, 1]
const VAHY_CISLA = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]

/** Zbytek po dělení 97 u dlouhého čísla zapsaného textem (IBAN se do Number nevejde). */
function modulo97(cislice: string): number {
  let zbytek = 0
  for (const c of cislice) zbytek = (zbytek * 10 + Number(c)) % 97
  return zbytek
}

/** Písmena IBANu na čísla (A = 10 … Z = 35), jak to předepisuje ISO 13616. */
function naCislice(text: string): string {
  let vysledek = ''
  for (const c of text) {
    const kod = c.charCodeAt(0)
    vysledek += kod >= 65 && kod <= 90 ? String(kod - 55) : c
  }
  return vysledek
}

function vazenySoucet(cislice: string, vahy: number[]): number {
  let soucet = 0
  for (let i = 0; i < vahy.length; i++) soucet += Number(cislice[i]) * vahy[i]
  return soucet
}

/** Platný IBAN (tvar i kontrolní číslice)? Mezery a malá písmena nevadí. */
export function jePlatnyIban(text: string): boolean {
  const iban = text.replace(/\s+/g, '').toUpperCase()
  if (!IBAN.test(iban)) return false
  return modulo97(naCislice(iban.slice(4) + iban.slice(0, 4))) === 1
}

/**
 * Český účet na IBAN. Null, když nesedí kontrolní součet předčíslí
 * nebo čísla, nebo když číslo nemá aspoň dvě nenulové číslice.
 */
export function ceskyUcetNaIban(predcisli: string, cislo: string, kodBanky: string): string | null {
  if (!/^\d{0,6}$/.test(predcisli) || !/^\d{2,10}$/.test(cislo) || !/^\d{4}$/.test(kodBanky)) return null
  const pred = predcisli.padStart(6, '0')
  const zaklad = cislo.padStart(10, '0')
  if (vazenySoucet(pred, VAHY_PREDCISLI) % 11 !== 0) return null
  if (vazenySoucet(zaklad, VAHY_CISLA) % 11 !== 0) return null
  if (zaklad.replace(/0/g, '').length < 2) return null

  const bban = kodBanky + pred + zaklad
  const kontrola = 98 - modulo97(naCislice(bban + 'CZ00'))
  return `CZ${String(kontrola).padStart(2, '0')}${bban}`
}

/**
 * Protiúčet v jednotném tvaru (viz hlavička). Prázdný vstup = prázdný
 * text, ne null — sloupec `transakce.protiucet` je `not null default ''`.
 */
export function normalizovatUcet(text: string | null | undefined): string {
  const ocisteny = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!ocisteny) return ''

  const bezMezer = ocisteny.replace(/\s+/g, '').toUpperCase()
  if (IBAN.test(bezMezer)) return jePlatnyIban(bezMezer) ? bezMezer : ocisteny

  const cesky = CESKY_UCET.exec(ocisteny.replace(/\s+/g, ''))
  if (cesky) {
    const kod = ctyrmistnyKod(cesky[3])
    const iban = ceskyUcetNaIban(cesky[1] ?? '', cesky[2], kod)
    if (iban) return iban
    // Nesedí součet — text beze změny, jen kód banky doplněný na 4 číslice.
    return kod === cesky[3] ? ocisteny : `${cesky[1] ? `${cesky[1]}-` : ''}${cesky[2]}/${kod}`
  }

  return ocisteny
}

/**
 * Protistrana pro lidi a pro pravidla párování: jméno, a když ho banka
 * nedala, číslo účtu protistrany. Do kroku 1 (migrace 20261119100000)
 * stálo číslo účtu přímo v `protistrana`; seznam plateb, export
 * i párování (protistrana proti dodavateli, vrácená platba) s tím počítají
 * — bez náhrady by pohyb bez jména prošel kontrolou dodavatele vždycky.
 */
export function protistranaNeboUcet(protistrana: string | null | undefined, protiucet: string | null | undefined): string {
  return String(protistrana ?? '').trim() || String(protiucet ?? '').trim()
}

export type OvereniCislaUctu = { stav: 'ok'; ucet: string } | { stav: 'chyba'; text: string }

/** Nejdelší číslo účtu, které appka u vlastního účtu přijme (IBAN má nejvýš 34 znaků). */
const MAX_DELKA_CISLA = 64

/**
 * Číslo VLASTNÍHO účtu z formuláře (Platby → nový platební účet).
 *
 * U protiúčtu z banky se nic neodmítá — co banka poslala, to se uloží
 * (normalizovatUcet). U čísla, které člověk píše rukou, je to jinak:
 * tvar IBANu nebo českého účtu s chybnou kontrolní číslicí je skoro
 * jistě překlep, a ten se má ukázat hned, ne až u nesedícího výpisu.
 * Jiný text (účet bez kódu banky, zahraniční účet bez IBANu) projde
 * očištěný. Prázdné = účet bez čísla.
 */
export function overitCisloUctu(text: string): OvereniCislaUctu {
  const ocisteny = text.trim().replace(/\s+/g, ' ')
  if (!ocisteny) return { stav: 'ok', ucet: '' }
  if (ocisteny.length > MAX_DELKA_CISLA) return { stav: 'chyba', text: 'Číslo účtu je příliš dlouhé.' }

  const bezMezer = ocisteny.replace(/\s+/g, '').toUpperCase()
  if (IBAN.test(bezMezer) && !jePlatnyIban(bezMezer)) {
    return { stav: 'chyba', text: 'IBAN nesedí (kontrolní číslice) — zkontrolujte ho, prosím.' }
  }
  const cesky = CESKY_UCET.exec(bezMezer)
  if (cesky && ceskyUcetNaIban(cesky[1] ?? '', cesky[2], ctyrmistnyKod(cesky[3])) === null) {
    return { stav: 'chyba', text: 'Číslo účtu nesedí (kontrolní součet) — zkontrolujte ho, prosím.' }
  }
  return { stav: 'ok', ucet: normalizovatUcet(ocisteny) }
}
