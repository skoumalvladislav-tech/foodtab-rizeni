/**
 * Příjmové API Foodtabu pro rezervace — tvar klíče a kontrola dávky.
 *
 * Šéfík 25. 10. 2026: „mám Choice, ale připravil bych univerzální
 * možnost". Rezervační systém (webhookem) nebo prostředník (n8n, Make,
 * Zapier) posílá `POST /api/rezervace/prijem` s `Authorization: Bearer
 * <klíč>`. Popis pro integrátora: docs/rezervace-api.md. Stejný vzor jako
 * příjmové API pokladen (lib/pokladna-prijem-api.ts).
 *
 * KLÍČ nese id připojení (`ftrez_<uuid>_<43 znaků náhody>`) — adresa
 * podle něj najde připojení a zašifrovaný klíč, rozšifruje ho a porovná
 * v konstantním čase. Klíč v databázi čitelně není.
 *
 * DÁVKA: `{ "system": "choice", "rezervace": [ … ] }` (nebo jedna
 * rezervace místo pole — jak to webhooky posílají). Jedna vadná
 * rezervace vrátí chybu celé dávky s jejím pořadím: polovičně zapsaná
 * dávka by byla horší než žádná. Zápis a párování dělá databáze
 * (`public.rezervace_prijmout` → `app.rezervace_zapsat_radky`).
 *
 * ČAS: buď `zacatek` jako okamžik S PÁSMEM („2026-11-20T19:00:00+01:00“),
 * nebo `datum` + `od` jako hodina na zdi pobočky — to je pro n8n/Make
 * jednodušší a pásmo dodá databáze. Okamžik bez pásma se odmítne
 * (CLAUDE.md, pravidlo 11).
 *
 * Čistý modul (žádné IO) — testuje ho scripts/rezervace.test.mjs.
 */

import { mapovatStav, naHodinu, type RadekImportu } from './rezervace-import.ts'
import { jePlatneDatum, STAVY, type StavRezervace } from './rezervace-typy.ts'

export const PREDPONA_KLICE_REZERVACI = 'ftrez'
export const MAX_REZERVACI_V_DAVCE = 500
/** Poskytovatel připojení příjmového API v registru (`integrace_pripojeni.poskytovatel`). */
export const POSKYTOVATEL_PRIJMU = 'obecne'

const RE_KLIC = /^ftrez_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/
/** Okamžik ISO 8601 — pásmo (Z nebo ±HH:MM) je POVINNÁ část vzoru, ne volitelná. */
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|z|[+-]\d{2}(:?\d{2})?)$/
const RE_SYSTEM = /^[a-z0-9_-]{1,40}$/

/** `nahodne` = 32 náhodných bajtů v base64url (43 znaků) — vyrábí volající přes `crypto.randomBytes`. */
export function slozitKlicRezervaci(pripojeniId: string, nahodne: string): string {
  return `${PREDPONA_KLICE_REZERVACI}_${pripojeniId}_${nahodne}`
}

export function rozebratKlicRezervaci(klic: string): { pripojeniId: string } | null {
  const m = RE_KLIC.exec(klic.trim())
  return m ? { pripojeniId: m[1] } : null
}

/** Řídicí znaky (i \u0000, který databáze v JSONu odmítne celou dávkou) pryč. */
function text(hodnota: unknown, max: number): string {
  if (hodnota === null || hodnota === undefined) return ''
  if (typeof hodnota !== 'string' && typeof hodnota !== 'number') return ''
  // Konce řádků (poznámka hosta) zůstávají; zdvojené mezery po vyhozeném znaku se slijí.
  return String(hodnota)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max)
}

/** Okamžik s pásmem a platným datem, nebo `null`. */
function okamzik(hodnota: unknown): string | null {
  if (typeof hodnota !== 'string') return null
  const t = hodnota.trim()
  if (!RE_ISO.test(t)) return null
  return Number.isNaN(new Date(t).getTime()) ? null : t
}

/**
 * Stav z API: naše hodnoty projdou rovnou, cizí se převedou stejně jako
 * u CSV. Co neznáme, se NEZAHODÍ (webhook by se neopakoval a rezervace by
 * se ztratila) — zapíše se jako předběžná a původní slovo zůstane ve
 * „stavu ze zdroje“, ať ho obsluha vidí.
 */
export function stavZApi(hodnota: string): StavRezervace {
  if ((STAVY as readonly string[]).includes(hodnota)) return hodnota as StavRezervace
  return mapovatStav(hodnota) ?? 'ceka'
}

export type VysledekDavkyRezervaci =
  | { stav: 'ok'; system: string; radky: RadekImportu[] }
  | { stav: 'chyba'; duvod: string }

export function overitDavkuRezervaci(telo: unknown): VysledekDavkyRezervaci {
  if (!telo || typeof telo !== 'object' || Array.isArray(telo)) {
    return { stav: 'chyba', duvod: 'Tělo musí být JSON objekt s polem „rezervace“.' }
  }
  const t = telo as { system?: unknown; rezervace?: unknown }

  const system = t.system === undefined || t.system === null || t.system === '' ? POSKYTOVATEL_PRIJMU : String(t.system).trim().toLowerCase()
  if (!RE_SYSTEM.test(system)) {
    return { stav: 'chyba', duvod: '„system“ musí být krátké jméno (malá písmena, číslice, pomlčka), např. „choice“.' }
  }

  const seznam = Array.isArray(t.rezervace) ? t.rezervace : t.rezervace && typeof t.rezervace === 'object' ? [t.rezervace] : null
  if (!seznam) return { stav: 'chyba', duvod: 'Chybí „rezervace“ — pole rezervací, nebo jedna rezervace.' }
  if (seznam.length === 0) return { stav: 'chyba', duvod: '„rezervace“ je prázdné pole.' }
  if (seznam.length > MAX_REZERVACI_V_DAVCE) {
    return { stav: 'chyba', duvod: `Nejvýš ${MAX_REZERVACI_V_DAVCE} rezervací v jedné dávce — pošlete je po částech.` }
  }

  const radky: RadekImportu[] = []
  const videna = new Set<string>()
  for (let i = 0; i < seznam.length; i++) {
    const kde = `Rezervace č. ${i + 1}`
    const r = seznam[i] as Record<string, unknown> | null
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { stav: 'chyba', duvod: `${kde} není objekt.` }

    const id = text(r.id, 200)
    if (!id) return { stav: 'chyba', duvod: `${kde}: chybí „id“ (číslo rezervace ve vašem systému).` }
    if (videna.has(id)) return { stav: 'chyba', duvod: `${kde}: „id“ ${id} je v dávce dvakrát.` }
    videna.add(id)

    const osobyText = r.osob === undefined || r.osob === null || r.osob === '' ? '' : String(r.osob).trim()
    if (osobyText !== '' && (!/^\d{1,5}$/.test(osobyText) || Number(osobyText) < 1)) {
      return { stav: 'chyba', duvod: `${kde} (${id}): „osob“ musí být kladné celé číslo.` }
    }

    const zmenenoText = r.zmeneno === undefined || r.zmeneno === null || r.zmeneno === '' ? '' : okamzik(r.zmeneno)
    if (zmenenoText === null) return { stav: 'chyba', duvod: `${kde} (${id}): „zmeneno“ musí být čas s pásmem (ISO 8601).` }

    const stavText = text(r.stav, 60)
    const spolecne = {
      externi_id: id,
      stav: stavZApi(stavText),
      stav_zdroje: stavText,
      jmeno_hosta: text(r.jmeno, 120),
      pocet_osob: osobyText,
      telefon: text(r.telefon, 40),
      email: text(r.email, 254),
      poznamka: text(r.poznamka, 4000),
      prostor: text(r.stul, 120),
    }

    if (r.zacatek !== undefined && r.zacatek !== null && r.zacatek !== '') {
      const zacatek = okamzik(r.zacatek)
      if (!zacatek) {
        return { stav: 'chyba', duvod: `${kde} (${id}): „zacatek“ musí být čas s pásmem, např. 2026-11-20T19:00:00+01:00 (bez pásma by se rezervace posunula).` }
      }
      const konec = r.konec === undefined || r.konec === null || r.konec === '' ? '' : okamzik(r.konec)
      if (konec === null) return { stav: 'chyba', duvod: `${kde} (${id}): „konec“ musí být čas s pásmem.` }
      if (konec && new Date(konec).getTime() <= new Date(zacatek).getTime()) {
        return { stav: 'chyba', duvod: `${kde} (${id}): „konec“ musí být po začátku.` }
      }
      radky.push({ ...spolecne, zacatek, konec, zmeneno_kdy: zmenenoText })
      continue
    }

    const datum = text(r.datum, 10)
    const od = naHodinu(text(r.od, 8))
    if (!jePlatneDatum(datum) || !od) {
      return { stav: 'chyba', duvod: `${kde} (${id}): chybí čas — pošlete „zacatek“ s pásmem, nebo „datum“ (RRRR-MM-DD) a „od“ (HH:MM).` }
    }
    const doText = text(r.do, 8)
    const doCas = doText ? naHodinu(doText) : ''
    if (doCas === null) return { stav: 'chyba', duvod: `${kde} (${id}): „do“ má tvar HH:MM.` }
    if (doCas && doCas === od) return { stav: 'chyba', duvod: `${kde} (${id}): „do“ je stejně jako „od“.` }
    radky.push({ ...spolecne, datum, od, do: doCas, zmeneno_kdy: zmenenoText })
  }

  return { stav: 'ok', system, radky }
}
