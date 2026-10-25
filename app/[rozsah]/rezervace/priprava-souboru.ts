import { NEMENIT_DO_BAJTU, zmensitObrazek } from '@/lib/obrazky'
import { zkontrolujPoZmenseni } from '@/lib/komunikace/prilohy'
import { jeObrazek, jeTypPriloh, ocistitNazev, typSouboru, type TypPriloh } from '@/lib/rezervace-prilohy'

/**
 * Příprava jednoho vybraného souboru před nahráním do kbelíku `rezervace`
 * — pro formulář nové rezervace i pro „Přidat dokument“ v detailu.
 *
 * Velká fotka (nebo HEIC z iPhonu) se zmenší na JPEG (lib/obrazky.ts,
 * delší strana 2000 px); PDF jde, jak je. Co se ani po zmenšení nevejde
 * do 10 MB nebo není fotka ani PDF, vrátí důvod. Sahá na canvas, takže
 * jen v prohlížeči — volají ho jen klientské komponenty.
 */
export type PripravenySoubor = { stav: 'ok'; blob: Blob; mime: TypPriloh; nazev: string } | { stav: 'chyba'; duvod: string }

export async function pripravitSoubor(s: File): Promise<PripravenySoubor> {
  const typ = typSouboru(s)
  let blob: Blob = s
  let mime = typ
  if (jeObrazek(typ) && (s.size > NEMENIT_DO_BAJTU || !jeTypPriloh(typ))) {
    const zmenseny = await zmensitObrazek(s)
    if (zmenseny) {
      blob = zmenseny
      mime = 'image/jpeg'
    }
  }
  const problem = zkontrolujPoZmenseni(s.name, mime, blob.size)
  if (problem) return { stav: 'chyba', duvod: problem }
  if (!jeTypPriloh(mime)) return { stav: 'chyba', duvod: `„${ocistitNazev(s.name)}“: tenhle typ souboru nejde nahrát (jen fotky a PDF).` }
  // Zmenšená fotka je vždy JPEG — název dostane odpovídající příponu.
  const nazev = mime === 'image/jpeg' && typ !== 'image/jpeg' ? `${ocistitNazev(s.name).replace(/\.[^.]*$/, '')}.jpg` : ocistitNazev(s.name)
  return { stav: 'ok', blob, mime, nazev }
}
