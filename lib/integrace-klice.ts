import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Finance: šifrování přístupových údajů k poskytovatelům (banka,
 * pokladna, účetnictví) uložených v `integrace_tajemstvi`.
 *
 * ---------------------------------------------------------------------
 * PROČ SAMOSTATNÝ MODUL, NE `lib/marketing-klice.ts`
 *
 * Marketing a Finance jsou different moduly (pravidlo „do cizího modulu
 * nesahej", skill foodtab-marketing) a jejich tajemství jsou jiná třída
 * dat — token na Instagram vs. přístup k bankovnímu účtu. Vlastní klíč
 * v prostředí (`INTEGRACE_KLIC_SIFRY`) znamená, že rotace jednoho
 * nevynutí rotaci druhého a kompromitace jednoho modulu neohrozí druhý.
 *
 * Mechanika (AES-256-GCM, formát `v1.iv.tag.data`, kanonický JSON pro
 * otisk) je záměrně identická s marketing-klice.ts — ověřený vzor, jen
 * s jiným klíčem. Viz ten soubor pro podrobné odůvodnění jednotlivých
 * voleb (náhodné IV, auth tag, žádný odvozený klíč bez `server-only`).
 */

export const NAZEV_PROMENNE = 'INTEGRACE_KLIC_SIFRY'

function klic(): Buffer {
  const hex = process.env[NAZEV_PROMENNE]

  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      `Chybí ${NAZEV_PROMENNE} — 64 znaků hexadecimálně (32 bajtů). ` +
        'Bez něj se přístupové údaje k poskytovatelům neukládají.',
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

/** Stabilní pořadí klíčů — stejná sada dá stejný otisk bez ohledu na pořadí zápisu. */
function kanonickyJson(hodnota: unknown): string {
  if (hodnota === null || typeof hodnota !== 'object') return JSON.stringify(hodnota ?? null)
  if (Array.isArray(hodnota)) return `[${hodnota.map(kanonickyJson).join(',')}]`
  const zaznam = hodnota as Record<string, unknown>
  const klice = Object.keys(zaznam).sort()
  return `{${klice.map((k) => `${JSON.stringify(k)}:${kanonickyJson(zaznam[k])}`).join(',')}}`
}

/** Zašifrování přístupových údajů jednoho připojení. Nové IV při každém uložení. */
export function zasifrovat(udaje: Udaje): { sifra: string; otisk: string } {
  const iv = randomBytes(12)
  const sifrator = createCipheriv('aes-256-gcm', klic(), iv)
  const otevreny = Buffer.from(kanonickyJson(udaje), 'utf8')
  const zasifrovano = Buffer.concat([sifrator.update(otevreny), sifrator.final()])
  const znacka = sifrator.getAuthTag()

  return {
    sifra: [
      'v1',
      iv.toString('base64url'),
      znacka.toString('base64url'),
      zasifrovano.toString('base64url'),
    ].join('.'),
    otisk: otiskUdaju(udaje),
  }
}

/** Rozšifrování. Cizí nebo poškozená šifra spadne — nevrací se prázdno. */
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

/** Otisk z kanonického JSONu celé sady — na otázku „je to pořád týž klíč?". */
export function otiskUdaju(udaje: Udaje): string {
  return createHash('sha256').update(kanonickyJson(udaje), 'utf8').digest('hex').slice(0, 32)
}

/** Co se smí ukázat na obrazovce: poslední čtyři znaky. Celý klíč se nikdy nezobrazuje znovu. */
export function zaslepit(hodnota: string): string {
  if (!hodnota) return ''
  if (hodnota.length <= 4) return '…'
  return `…${hodnota.slice(-4)}`
}
