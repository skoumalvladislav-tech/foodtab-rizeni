/**
 * Přílohy ke zprávám — čistá logika (bez prohlížeče, bez databáze).
 *
 * Je to vlastní soubor z téhož důvodu jako lib/hlasove-zpravy.ts: modul
 * označený `'use server'` smí vyvážet jen funkce, a klientská komponenta
 * i server akce potřebují tytéž konstanty. Čísla tady musí sedět
 * s 20260921130000_prilohy.sql (kbelík `prilohy`, tabulka
 * `konverzace_prilohy`) — kbelík je vynucuje, tohle je jen UX, aby se
 * nesmyslný výběr odmítl dřív, než se začne nahrávat.
 */

/** Jméno kbelíku. Musí sedět s 20260921130000_prilohy.sql. */
export const KBELIK_PRILOH = 'prilohy'

/** Nejvíc příloh na jednu zprávu (drží pripojit_prilohu). */
export const MAX_PRILOH = 5

/** Největší soubor (drží kbelík: file_size_limit). */
export const MAX_BAJTU = 10 * 1024 * 1024

/** Podepsaný odkaz platí hodinu — stejná úvaha jako u hlasovek. */
export const PLATNOST_ODKAZU_PRILOH_S = 3600

/** Nejdelší zpráva (stejný strop jako u psané zprávy). */
export const MAX_DELKA_TEXTU = 4000

/** Nejdelší název souboru (drží tabulka: check char_length ≤ 120). */
export const MAX_DELKA_NAZVU = 120

/** Povolené typy a přípona v cestě v úložišti. */
export const TYPY_PRILOH = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const

export type TypPriloh = keyof typeof TYPY_PRILOH

export type SouborVyberu = { name: string; type: string; size: number }

export function jeTypPriloh(mime: string): mime is TypPriloh {
  return Object.prototype.hasOwnProperty.call(TYPY_PRILOH, mime)
}

/**
 * Typ souboru: co řekne prohlížeč, a když neřekne nic (některé telefony
 * dávají u PDF prázdný typ), přípona názvu. Cokoli jiného vrací prázdný
 * řetězec — nepovolený typ se nemá „uhodnout“.
 */
export function typSouboru(soubor: { name: string; type: string }): string {
  const t = (soubor.type ?? '').split(';')[0].trim().toLowerCase()
  if (t !== '') return t === 'image/jpg' ? 'image/jpeg' : t
  const pripona = (soubor.name.split('.').pop() ?? '').toLowerCase()
  if (pripona === 'pdf') return 'application/pdf'
  if (pripona === 'jpg' || pripona === 'jpeg') return 'image/jpeg'
  if (pripona === 'png') return 'image/png'
  if (pripona === 'webp') return 'image/webp'
  return ''
}

export function jeObrazek(mime: string): boolean {
  return mime.startsWith('image/')
}

/** Cesta v úložišti: firma / rozhovor / soubor.přípona — tvar, který čte app.hlasovka_cesta_rozsah. */
export function cestaPriloh(tenantId: string, konverzaceId: string, id: string, mime: TypPriloh): string {
  return `${tenantId}/${konverzaceId}/${id}.${TYPY_PRILOH[mime]}`
}

/** „120 kB“, „1,4 MB“ — česky, s desetinnou čárkou. */
export function velikostText(bajty: number): string {
  if (!Number.isFinite(bajty) || bajty < 0) return ''
  if (bajty < 1024) return `${bajty} B`
  if (bajty < 1024 * 1024) return `${Math.round(bajty / 1024)} kB`
  return `${(bajty / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * Název k zobrazení: jen jméno souboru (bez složek), bez řídicích znaků,
 * oříznuté na strop. Databáze si název čistí sama (lomítka); tohle je
 * pro seznam vybraných souborů a pro text zprávy.
 */
export function ocistitNazev(nazev: string): string {
  const bezCesty = String(nazev ?? '').split(/[/\\]/).pop() ?? ''
  const cisty = Array.from(bezCesty)
    .filter((z) => {
      const k = z.charCodeAt(0)
      return k >= 32 && k !== 127
    })
    .join('')
    .trim()
  const nazevBezMezer = cisty === '' ? 'soubor' : cisty
  return nazevBezMezer.length > MAX_DELKA_NAZVU ? nazevBezMezer.slice(0, MAX_DELKA_NAZVU) : nazevBezMezer
}

export type VysledekVyberu = {
  /** Indexy souborů, které jdou nahrát. */
  platne: number[]
  /** Věty pro člověka — proč se který soubor nevzal. */
  chyby: string[]
}

/**
 * Které z vybraných souborů se vezmou.
 *
 * `uzMa` je počet příloh, které už jsou u rozepsané zprávy vybrané.
 * Přebytek nad `MAX_PRILOH` se odřízne a řekne se to; nepovolený typ
 * a příliš velký soubor se odmítnou jmenovitě.
 *
 * Velikost se tu kontroluje ZA předpokladu, že se obrázek ještě
 * nezmenšoval — komponenta smí velký obrázek zmenšit a zkontrolovat ho
 * znovu (viz `zkontrolujPoZmenseni`).
 */
export function zkontrolujVyber(soubory: SouborVyberu[], uzMa: number): VysledekVyberu {
  const platne: number[] = []
  const chyby: string[] = []
  let volno = Math.max(0, MAX_PRILOH - uzMa)

  soubory.forEach((s, i) => {
    const nazev = ocistitNazev(s.name)
    const typ = typSouboru(s)

    if (typ === '' || (!jeTypPriloh(typ) && !jeObrazek(typ))) {
      chyby.push(`„${nazev}“: tenhle typ souboru nejde poslat (jen fotky a PDF).`)
      return
    }
    // Neznámý obrázkový typ (HEIC…) projde sem; komponenta ho zkusí
    // převést na JPEG. Když to nejde, odmítne ho tam.
    if (s.size <= 0) {
      chyby.push(`„${nazev}“: soubor je prázdný.`)
      return
    }
    if (!jeObrazek(typ) && s.size > MAX_BAJTU) {
      chyby.push(`„${nazev}“: je větší než ${velikostText(MAX_BAJTU)}.`)
      return
    }
    if (volno <= 0) {
      chyby.push(`„${nazev}“: ke zprávě jde přidat nejvýš ${MAX_PRILOH} příloh.`)
      return
    }
    volno -= 1
    platne.push(i)
  })

  return { platne, chyby }
}

/** Po zmenšení obrázku: prošel, nebo je pořád velký? */
export function zkontrolujPoZmenseni(nazev: string, mime: string, velikost: number): string | null {
  if (!jeTypPriloh(mime)) return `„${ocistitNazev(nazev)}“: tenhle typ souboru nejde poslat (jen fotky a PDF).`
  if (velikost <= 0) return `„${ocistitNazev(nazev)}“: soubor je prázdný.`
  if (velikost > MAX_BAJTU) return `„${ocistitNazev(nazev)}“: je větší než ${velikostText(MAX_BAJTU)}.`
  return null
}

/**
 * Text zprávy, ke které se přílohy připojují.
 *
 * Zpráva bez textu neexistuje (`konverzace_zpravy` chce text nebo
 * hlasovku), a seznam rozhovorů ukazuje poslední text. Když člověk nic
 * nenapsal, řekne text aspoň, co se posílá.
 */
export function textZpravyPrilohy(popisek: string, nazvy: string[]): string {
  const cisty = String(popisek ?? '').trim()
  if (cisty !== '') return cisty.length > MAX_DELKA_TEXTU ? cisty.slice(0, MAX_DELKA_TEXTU) : cisty
  if (nazvy.length === 0) return 'Příloha'
  if (nazvy.length === 1) return `Příloha: ${ocistitNazev(nazvy[0])}`
  return `Přílohy (${nazvy.length}): ${nazvy.map(ocistitNazev).join(', ')}`.slice(0, MAX_DELKA_TEXTU)
}
