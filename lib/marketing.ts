import { createHash } from 'node:crypto'

/**
 * Marketing — otisk verze příspěvku.
 *
 * Schválení se neváže na id verze, ale na OTISK JEJÍHO OBSAHU. Kdyby se
 * vázalo na id, stačilo by obsah pod tím id přepsat a schválení by
 * ukazovalo na něco jiného, než co schvalovatel viděl. (Přepsat verzi
 * sice nejde — hlídá to spoušť v databázi — ale spoléhat na jedinou
 * pojistku u téhle věci nechceme.)
 *
 * Otisk počítá aplikace a databáze ho jen porovnává. Proto musí být
 * stabilní: stejný obsah zapsaný v jiném pořadí klíčů musí dát stejný
 * otisk, jinak by se schválení „rozpadlo" jen tím, že se text uložil
 * podruhé beze změny.
 */

/**
 * JSON s klíči seřazenými podle abecedy, na všech úrovních.
 *
 * `JSON.stringify` zachovává pořadí, v jakém klíče vznikly — a to se
 * mezi dvěma průchody liší podle toho, co formulář poslal dřív. Bez
 * tohohle by dvě uložení téhož textu daly dva různé otisky.
 */
export function kanonickyJson(hodnota: unknown): string {
  if (hodnota === null || typeof hodnota !== 'object') return JSON.stringify(hodnota ?? null)
  if (Array.isArray(hodnota)) return `[${hodnota.map(kanonickyJson).join(',')}]`
  const zaznam = hodnota as Record<string, unknown>
  const klice = Object.keys(zaznam).sort()
  return `{${klice.map((k) => `${JSON.stringify(k)}:${kanonickyJson(zaznam[k])}`).join(',')}}`
}

/** Co do otisku vstupuje. Cokoli mimo tenhle tvar se do něj nepromítne. */
export type ObsahVerze = {
  zadani: string
  vstupy: Record<string, unknown>
  vybrana_varianta: string | null
  texty: Record<string, unknown>
  storyboard: unknown
  media_ids: string[]
  titulni_media_id: string | null
}

/**
 * Otisk obsahu verze.
 *
 * Média se řadí. Kdyby se neřadila, přehození dvou fotek v seznamu by
 * vypadalo jako změna obsahu a zrušilo by schválení — a přitom by šlo
 * o tutéž koláž.
 */
export function otiskVerze(v: ObsahVerze): string {
  return createHash('sha256')
    .update(
      kanonickyJson({
        zadani: v.zadani,
        vstupy: v.vstupy,
        vybrana_varianta: v.vybrana_varianta,
        texty: v.texty,
        storyboard: v.storyboard ?? null,
        media_ids: [...v.media_ids].sort(),
        titulni_media_id: v.titulni_media_id,
      }),
      'utf8',
    )
    .digest('hex')
}

/** Prázdný obsah — z něj se skládá první verze nového příspěvku. */
export function prazdnyObsah(): ObsahVerze {
  return {
    zadani: '',
    vstupy: {},
    vybrana_varianta: null,
    texty: {},
    storyboard: null,
    media_ids: [],
    titulni_media_id: null,
  }
}

/** Kanály, na které umí modul připravit příspěvek. */
export const KANALY = [
  { klic: 'instagram', nazev: 'Instagram' },
  { klic: 'facebook', nazev: 'Facebook' },
] as const

export type Kanal = (typeof KANALY)[number]['klic']

/**
 * Text pro kanál. Prázdný text není chyba dat, ale nedodělaná práce —
 * a schvalovatel to má vidět, ne se to dozvědět až z prázdného příspěvku.
 */
export function textProKanal(texty: Record<string, unknown>, kanal: string): string {
  const t = texty?.[kanal]
  if (t && typeof t === 'object' && 'popisek' in t) {
    return String((t as { popisek?: unknown }).popisek ?? '')
  }
  return ''
}
