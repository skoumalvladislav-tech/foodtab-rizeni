/**
 * Auditní přehled marketingu — překlad databázových názvů do češtiny.
 *
 * Zadání: master prompt, obrazovka 16 z oddílu 22.
 *
 * Proč to není přímo v obrazovce: serverová komponenta se mimo aplikaci
 * nedá vykreslit, takže by na to nešlo sáhnout kontrolou. Totéž jako
 * u `lib/marketing-text.ts` (`scripts/marketing-audit.test.mjs`).
 *
 * ---------------------------------------------------------------------
 * AUDIT, KTERÝ SE NEDÁ PŘEČÍST, NENÍ AUDIT
 *
 * V databázi stojí `marketing_publikace_uloha.update`. Na obrazovce má
 * stát „Odeslání na síť — změněno". Kdyby se ukazoval syrový název,
 * byla by to sice pravda, ale nikdo z provozu by z toho nic nevyčetl —
 * a obrazovka, na kterou se nikdo nedívá, nehlídá nic.
 */

/**
 * Entita v auditu → jak se tomu říká na obrazovce.
 *
 * Klíče se MUSÍ krýt s argumentem, který dostane spoušť
 * `app.audit_zmenu('…')` v migracích marketingu. Hlídá to kontrola
 * obousměrně: chybějící překlad pustí na obrazovku databázový název,
 * přebývající znamená, že se něco přejmenovalo a nedotáhlo.
 *
 * Jednotné číslo a velké první písmeno, protože to na obrazovce stojí
 * samostatně ve sloupci, ne uprostřed věty.
 */
export const ENTITY: Record<string, string> = {
  marketing_prispevek: 'Příspěvek',
  marketing_verze: 'Verze textu',
  marketing_varianta: 'Varianta',
  marketing_schvaleni: 'Schválení',
  marketing_publikace: 'Publikace',
  marketing_publikace_uloha: 'Odeslání na síť',
  marketing_render_uloha: 'Vykreslení grafiky',
  marketing_sablona: 'Šablona',
  /*
    ANGLICKY, A NENÍ TO PŘEKLEP. Spoušť na `marketing_media` zapisuje
    do auditu `marketing_medium` — zbytek modulu je česky. Přejmenovat
    to nejde: pod starým názvem už jsou v `audit_log` záznamy a ten se
    z principu nepřepisuje (`audit_log_no_update`). Nahlášeno
    v hlášení ze 14. 9.
  */
  marketing_medium: 'Fotka',
  marketing_nastaveni: 'Značka a nastavení',
  marketing_pripojeni: 'Připojený nástroj',
  marketing_ucet: 'Účet na síti',
  marketing_menu: 'Menu',
  marketing_menu_den: 'Den v menu',
  marketing_menu_polozka: 'Položka menu',
  marketing_kampan: 'Kampaň',
  marketing_automatizace: 'Automatizace',
  marketing_automatizace_beh: 'Běh automatizace',
  marketing_metrika: 'Naměřené číslo',
  marketing_odkaz: 'Měřitelný odkaz',
}

export function popisEntity(entita: string): string {
  return ENTITY[entita] ?? entita
}

/** Co se s tím stalo. Koncovka akce za poslední tečkou. */
export const UKONY: Record<string, string> = {
  insert: 'založeno',
  update: 'změněno',
  delete: 'smazáno',
}

export function popisUkonu(akce: string): string {
  const ukon = akce.slice(akce.lastIndexOf('.') + 1)
  return UKONY[ukon] ?? ukon
}

/**
 * Názvy sloupců → česky.
 *
 * Neúplný schválně: sloupců jsou stovky a většina se nikdy nezmění
 * ručně. Co tu není, ukáže se tak, jak je v databázi — název sloupce
 * je pořád čitelnější než nic. Doplňuje se podle toho, co se
 * v přehledu opravdu objeví.
 */
export const SLOUPCE: Record<string, string> = {
  stav: 'stav',
  nazev: 'název',
  text: 'text',
  pripominka: 'připomínka',
  rozhodl: 'kdo rozhodl',
  rozhodnuto_kdy: 'kdy rozhodnuto',
  schvalena_verze_id: 'schválená verze',
  planovano_na: 'termín',
  kanaly: 'kanály',
  kanal: 'kanál',
  obrazky: 'obrázky',
  pilir: 'pilíř',
  kampan_id: 'kampaň',
  zapnuta: 'vypínač',
  cas_spusteni: 'čas spuštění',
  dny_v_tydnu: 'dny v týdnu',
  vlastnik: 'vlastník',
  aktivni: 'zapnuto',
  cil: 'cíl',
  prokliku: 'prokliky',
  posledni_chyba: 'chyba',
  pokusy: 'pokusy',
  zverejneno_kdy: 'kdy zveřejněno',
  externi_id: 'číslo u poskytovatele',
}

export function popisSloupce(sloupec: string): string {
  return SLOUPCE[sloupec] ?? sloupec
}

/**
 * Seznam změněných sloupců na větu.
 *
 * Nad tři se to usekne. Výpis dvaceti názvů nikdo nečte a řádek se
 * rozteče přes celou obrazovku — a hlavně: když se změnilo dvacet
 * sloupců najednou, byl to import nebo hromadná akce, a tam je
 * podstatné, ŽE se to stalo, ne které pole to byla.
 */
export function popisZmen(zmeneno: string[] | null | undefined): string {
  if (!zmeneno || zmeneno.length === 0) return ''
  const nazvy = zmeneno.map(popisSloupce)
  if (nazvy.length <= 3) return nazvy.join(', ')
  return `${nazvy.slice(0, 3).join(', ')} a další ${nazvy.length - 3}`
}

/**
 * Kdo to udělal.
 *
 * `actor_label` může být prázdné — u záznamu, který vznikl serverovou
 * úlohou, nebo když se člověk mezitím smazal. Prázdné jméno se
 * NEVYPLŇUJE dohadem: „někdo" je pravda, vymyšlené jméno by nebylo.
 */
export function popisKonatele(kdo: string | null, druh: string): string {
  if (kdo && kdo.trim() !== '') return kdo
  if (druh === 'system') return 'automat'
  if (druh === 'agent') return 'agent'
  return 'někdo'
}

/**
 * Vejde se ten záznam do okna, které si člověk vybral?
 *
 * Dny, ne hodiny — a počítá se od PŮLNOCI v pásmu pobočky, ne „před
 * 168 hodinami". Kdyby se počítalo od okamžiku, vypadal by přehled po
 * každém načtení jinak a záznam ze začátku okna by z něj v poledne
 * vypadl. Pásmo dodá volající, tady se jen porovnává.
 */
export function vOkne(kdy: string, hraniceIso: string): boolean {
  return kdy >= hraniceIso
}

/** Nabídka oken. Klíč je v adrese, takže se nesmí měnit. */
export const OKNA: { klic: string; popis: string; dnu: number }[] = [
  { klic: '7', popis: 'posledních 7 dní', dnu: 7 },
  { klic: '30', popis: 'posledních 30 dní', dnu: 30 },
  { klic: '90', popis: 'posledních 90 dní', dnu: 90 },
  { klic: 'vse', popis: 'všechno', dnu: 0 },
]

export function okno(klic: string | undefined): { klic: string; popis: string; dnu: number } {
  return OKNA.find((o) => o.klic === klic) ?? OKNA[0]
}
