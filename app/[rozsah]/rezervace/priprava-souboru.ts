import { NEMENIT_DO_BAJTU, zmensitObrazek } from '@/lib/obrazky'
import {
  MIME_DOCX,
  jeObrazek,
  jeTypPriloh,
  jeZip,
  ocistitNazev,
  typSouboru,
  zkontrolujPoZmenseni,
  type TypPriloh,
} from '@/lib/rezervace-prilohy'

/**
 * Příprava jednoho vybraného souboru před nahráním do kbelíku `rezervace`
 * — pro formulář nové rezervace i pro „Přidat dokument“ v detailu.
 *
 * Velká fotka (nebo HEIC z iPhonu) se zmenší na JPEG (lib/obrazky.ts,
 * delší strana 2000 px); PDF a Word jdou, jak jsou. Co se ani po zmenšení
 * nevejde do 10 MB, není fotka, PDF ani .docx, nebo se za .docx jen
 * vydává, vrátí důvod. Sahá na canvas, takže jen v prohlížeči — volají ho
 * jen klientské komponenty.
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
  if (!jeTypPriloh(mime)) return { stav: 'chyba', duvod: `„${ocistitNazev(s.name)}“: tenhle typ souboru nejde nahrát (jen fotky, PDF a Word .docx).` }
  if (mime === MIME_DOCX && !jeZip(new Uint8Array(await blob.slice(0, 4).arrayBuffer()))) {
    return { stav: 'chyba', duvod: `„${ocistitNazev(s.name)}“: tohle není dokument Word .docx. Starší .doc uložte ve Wordu jako .docx.` }
  }
  // Úložiště zapíše typ, který nese soubor sám — `contentType` u souboru
  // supabase-js nepoužije (stejně jako Jiné platby, nahrat-doklad.tsx).
  // .docx z telefonu s prázdným typem by jinak kbelík odmítl.
  if (blob.type !== mime) blob = new Blob([blob], { type: mime })
  // Zmenšená fotka je vždy JPEG — název dostane odpovídající příponu.
  const nazev = mime === 'image/jpeg' && typ !== 'image/jpeg' ? `${ocistitNazev(s.name).replace(/\.[^.]*$/, '')}.jpg` : ocistitNazev(s.name)
  return { stav: 'ok', blob, mime, nazev }
}
