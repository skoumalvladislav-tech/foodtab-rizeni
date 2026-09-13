import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Přípona `.ts` je schválně — soubory v `lib/` se pouštějí přímo Nodem
// v testech a bez ní by modul nenašel (CLAUDE.md, oddíl Testy).
import { kanonickyJson } from './marketing.ts'

/**
 * Zákaznické přístupové údaje — šifrování a otisk.
 *
 * ---------------------------------------------------------------------
 * CO TU LEŽÍ
 *
 * Token k Instagramu firmy. Kdo ho má, publikuje jejím jménem — je to
 * horší ztráta než rozpis směn. Do databáze jde jen šifra a otisk
 * (CLAUDE.md, pravidlo 7); rozšifrovat to umí jen server, který má klíč
 * z prostředí.
 *
 * ---------------------------------------------------------------------
 * PROČ `server-only`
 *
 * Kdyby se tenhle modul dostal do klientského grafu, šifrovací klíč by
 * se přeložil do balíčku pro prohlížeč. `import 'server-only'` udělá
 * z toho omylu CHYBU PŘEKLADU, ne varování v logu, kterého si nikdo
 * nevšimne.
 *
 * ---------------------------------------------------------------------
 * KDYŽ KLÍČ V PROSTŘEDÍ CHYBÍ, SPADNE TO
 *
 * Žádné odvození z jiného tajemství, žádný náhradní režim. Odvozený
 * klíč vypadá, že šifrování funguje — a přitom je uhodnutelný z něčeho,
 * co je jinde v prostředí. Aplikace bez `MARKETING_KLIC_SIFRY`
 * zákaznický klíč prostě neuloží a řekne proč.
 */

/** Odkud se bere šifrovací klíč. Pojmenováno na jednom místě kvůli hláškám. */
export const NAZEV_PROMENNE = 'MARKETING_KLIC_SIFRY'

function klic(): Buffer {
  const hex = process.env[NAZEV_PROMENNE]

  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      `Chybí ${NAZEV_PROMENNE} — 64 znaků hexadecimálně (32 bajtů). ` +
        'Bez něj se zákaznické přístupové údaje neukládají.',
    )
  }

  return Buffer.from(hex, 'hex')
}

/** Je šifrování vůbec nastavené? Obrazovka se tím ptá, než nabídne formulář. */
export function sifrovaniJeNastavene(): boolean {
  const hex = process.env[NAZEV_PROMENNE]
  return Boolean(hex && /^[0-9a-f]{64}$/i.test(hex))
}

export type Udaje = Record<string, string>

/**
 * Zašifrování údajů jednoho připojení.
 *
 * AES-256-GCM: kromě utajení hlídá i to, že se šifra cestou nezměnila.
 * Kdyby se použil režim bez ověřovací značky, dal by se uložený řetězec
 * po bajtech přepsat a rozšifrování by mlčky vrátilo jiná data.
 *
 * Náhodné IV se pro každé uložení generuje znovu. Stejný klíč se
 * stejným IV dvakrát je u GCM chyba, po které se z obou šifer dá počítat
 * zpátky.
 */
export function zasifrovat(udaje: Udaje): { sifra: string; otisk: string } {
  const iv = randomBytes(12)
  const sifrator = createCipheriv('aes-256-gcm', klic(), iv)
  const otevreny = Buffer.from(kanonickyJson(udaje), 'utf8')
  const zasifrovano = Buffer.concat([sifrator.update(otevreny), sifrator.final()])
  const znacka = sifrator.getAuthTag()

  return {
    // `v1.` je místo, kde se pozná starý formát, až se šifra bude měnit.
    sifra: [
      'v1',
      iv.toString('base64url'),
      znacka.toString('base64url'),
      zasifrovano.toString('base64url'),
    ].join('.'),
    otisk: otiskUdaju(udaje),
  }
}

/**
 * Rozšifrování. Cizí nebo poškozená šifra spadne — nevrací se prázdno.
 *
 * Kdyby se u poškozené šifry vrátil prázdný objekt, poskytovatel by
 * dostal požadavek bez tokenu, odpověděl „nepřihlášen" a v aplikaci by
 * to vypadalo na vypršelé oprávnění. Hledalo by se u Mety něco, co je
 * u nás.
 */
export function rozsifrovat(sifra: string): Udaje {
  const [verze, ivB, znackaB, dataB] = sifra.split('.')

  if (verze !== 'v1' || !ivB || !znackaB || !dataB) {
    throw new Error('Uložené přístupové údaje mají neznámý tvar.')
  }

  const desifrator = createDecipheriv('aes-256-gcm', klic(), Buffer.from(ivB, 'base64url'))
  desifrator.setAuthTag(Buffer.from(znackaB, 'base64url'))

  const otevreny = Buffer.concat([
    desifrator.update(Buffer.from(dataB, 'base64url')),
    desifrator.final(),
  ])

  return JSON.parse(otevreny.toString('utf8')) as Udaje
}

/**
 * Otisk údajů — na otázku „je to pořád týž klíč?".
 *
 * Počítá se z KANONICKÉHO JSONU celé sady, ne z jednoho pole. Kdyby se
 * počítal jen z tokenu, výměna id stránky při zachovaném tokenu by dala
 * tentýž otisk a v auditu by to vypadalo, že se nic nestalo.
 *
 * Zkracuje se na 32 znaků: na porovnání to stačí a v auditu se z toho
 * hůř skládá slovníkový útok na krátké hodnoty.
 */
export function otiskUdaju(udaje: Udaje): string {
  return createHash('sha256').update(kanonickyJson(udaje), 'utf8').digest('hex').slice(0, 32)
}

/**
 * Co se smí ukázat na obrazovce: poslední čtyři znaky.
 *
 * Celý klíč se po uložení neukazuje nikdy — ani tomu, kdo ho zadal.
 * Kdo si ho nepamatuje, vygeneruje si u poskytovatele nový.
 */
export function zaslepit(hodnota: string): string {
  if (!hodnota) return ''
  if (hodnota.length <= 4) return '…'
  return `…${hodnota.slice(-4)}`
}
