/**
 * Marketing — texty a drobná logika obrazovek.
 *
 * Proč to není přímo v obrazovce: serverová komponenta se mimo aplikaci
 * nedá vykreslit, takže by na to nešlo sáhnout kontrolou. Přesně kvůli
 * tomu vznikl `lib/dochazka-stav.ts` i `lib/upozorneni-text.ts` — tohle
 * je totéž pro marketing (`scripts/marketing.test.mjs`).
 */

/**
 * Stav příspěvku → věta pro člověka.
 *
 * Klíče se MUSÍ krýt s omezením sloupce `stav` v migraci
 * 20260909200000_marketing_obsah.sql. Hlídá to kontrola v
 * `scripts/marketing.test.mjs` obousměrně: chybějící překlad by na
 * obrazovku pustil syrový databázový výraz, přebývající by znamenal,
 * že se stav někde přejmenoval a nikdo to nedotáhl.
 */
export const STAVY_PRISPEVKU: Record<string, string> = {
  koncept: 'koncept',
  navrh_hotovy: 'návrh hotový',
  ceka_na_schvaleni: 'čeká na schválení',
  schvaleno: 'schváleno',
  naplanovano: 'naplánováno',
  zverejnuje_se: 'zveřejňuje se',
  zverejneno: 'zveřejněno',
  zamitnuto: 'zamítnuto',
  navrh_selhal: 'návrh selhal',
  render_selhal: 'obrázek se nepovedl',
  publikace_selhala: 'zveřejnění selhalo',
  archivovano: 'archivováno',
}

/** Stavy, které znamenají „něco se pokazilo a čeká to na člověka". */
export const STAVY_CHYBOVE = ['navrh_selhal', 'render_selhal', 'publikace_selhala']

/**
 * Neznámý stav se NEPŘEKLÁDÁ na prázdno ani na „neznámý".
 *
 * Kdyby se vrátil prázdný řetězec, zmizel by ze sloupce beze stopy
 * a vypadalo by to, že příspěvek žádný stav nemá. Radši ať je vidět
 * syrový výraz — je to nápadné a dá se podle něj hledat.
 */
export function popisStavu(stav: string): string {
  return STAVY_PRISPEVKU[stav] ?? stav
}

/**
 * „hovězí, domácí , , poctivé" → ['hovězí','domácí','poctivé']
 *
 * Strop je tu proto, že tenhle seznam jde do zadání pro jazykový model
 * jako pravidlo. Dvě stě výrazů by z pravidla udělalo šum, ve kterém
 * se ztratí to podstatné.
 */
export const STROP_VYRAZU = 40

export function seznamVyrazu(hodnota: string | null | undefined): string[] {
  return String(hodnota ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, STROP_VYRAZU)
}

/**
 * Prázdné pole znamená „nezadáno", ne prázdnou hodnotu.
 *
 * Rozdíl není kosmetický: podle `null` pozná návrh, že tenhle údaj
 * nemá odkud vzít, a vynechá ho. Prázdný řetězec by se do obrázku
 * vysázel jako prázdné místo pod podpisem.
 */
export function neboNull(hodnota: string | null | undefined): string | null {
  const s = String(hodnota ?? '').trim()
  return s === '' ? null : s
}

/**
 * Délka videa: co projde databázi (3–90 s).
 *
 * Ořezává se tady, aby uživatel místo syrové hlášky z Postgresu dostal
 * rozumnou hodnotu. Omezení v databázi tím nemizí — je to druhá linie,
 * ne náhrada (pravidlo 3).
 */
export const VIDEO_MIN = 3
export const VIDEO_MAX = 90

export function delkaVidea(hodnota: unknown, vychozi = 20): number {
  const n = Number(hodnota)
  if (!Number.isFinite(n)) return vychozi
  return Math.min(VIDEO_MAX, Math.max(VIDEO_MIN, Math.round(n)))
}

/**
 * Stav PUBLIKAČNÍ ÚLOHY → věta pro člověka.
 *
 * Je to něco jiného než stav příspěvku výš. Příspěvek je jeden, úloh
 * má tolik, na kolik sítí jde ven — a můžou dopadnout různě: na
 * Instagram to vyjde, na Facebook spadne.
 *
 * DO 14. 9. 2026 STÁL TENHLE SEZNAM UVNITŘ `[prispevek]/page.tsx`.
 * Když vznikla obrazovka Publikované, byla by z toho druhá kopie —
 * a dvě kopie téhož seznamu se rozejdou. Sem patří ze stejného důvodu
 * jako `STAVY_PRISPEVKU`: kontrola ho tady umí porovnat s omezením
 * sloupce v migraci, uvnitř obrazovky ne.
 *
 * Klíče se MUSÍ krýt s `check (stav in (…))` na
 * `marketing_publikace_ulohy` v 20260910000000_marketing_vystup.sql.
 */
export const STAVY_ULOH: Record<string, string> = {
  naplanovano: 'naplánováno',
  ve_fronte: 've frontě',
  odesila_se: 'odesílá se',
  zverejneno: 'zveřejněno',
  zverejneno_nanecisto: 'zveřejněno nanečisto (demo)',
  k_rucnimu_zverejneni: 'k ručnímu zveřejnění',
  selhalo: 'selhalo',
  vzdano: 'vzdáno po opakování',
  zruseno: 'zrušeno',
}

export function popisStavuUlohy(stav: string): string {
  return STAVY_ULOH[stav] ?? stav
}

/**
 * Stavy úloh, které opravdu znamenají poruchu.
 *
 * `k_rucnimu_zverejneni` V TOM SEZNAMU SCHVÁLNĚ NENÍ. Je to normální
 * stav: firma si vybrala ruční režim, úloha čeká na člověka a nic se
 * nepokazilo. Kdyby spadl pod chyby, svítil by v přehledu červeně
 * a někdo by ho šel opravovat. Totéž `zruseno` — to je následek nové
 * verze, ne závada.
 */
export const STAVY_ULOH_CHYBOVE = ['selhalo', 'vzdano']

/** Stavy, u kterých se ještě něco stane. */
export const STAVY_ULOH_CEKAJICI = ['naplanovano', 've_fronte', 'odesila_se']

/** Stavy, po kterých je práce hotová — ať dopadla jakkoli. */
export const STAVY_ULOH_HOTOVE = ['zverejneno', 'zverejneno_nanecisto']

/**
 * Co s tím, když se to pokazilo.
 *
 * Zadání, oddíl 16: „viditelné chybové hlášení v češtině s návrhem
 * řešení". Hláška od poskytovatele je anglicky a mluví o tokenech
 * a scopech — pro člověka, který vede restauraci, je to k ničemu.
 *
 * RADA SE ODVOZUJE ZE STAVU A REŽIMU, NE Z TEXTU CHYBY. Hádat podle
 * řetězce od poskytovatele znamená mít kód, který se rozbije, až
 * Meta přeformuluje hlášku — a nepozná se to, protože se nic
 * nezmění: jen se přestane radit. Původní hláška zůstává vidět vedle
 * rady, ne místo ní.
 */
export function radaKeStavu(stav: string, rezim: string): string {
  if (stav === 'k_rucnimu_zverejneni') {
    return rezim === 'rucni'
      ? 'Tohle je v pořádku — vybrali jste ruční zveřejnění. Text a fotky jsou připravené, zveřejníte to sami.'
      : 'Nástroj na zveřejňování není připojený, takže to čeká na ruční zveřejnění. Připojit ho jde v Marketing → Nástroje.'
  }

  if (stav === 'vzdano') {
    return 'Zkoušelo se to opakovaně a pokaždé to spadlo. Podívejte se na poslední chybu níž '
      + 'a na připojení v Marketing → Nástroje; pak příspěvek naplánujte znovu.'
  }

  if (stav === 'selhalo') {
    return 'Zkusí se to znovu samo. Když to spadne i napodruhé, bývá to připojením — '
      + 'zkoušku spojení najdete v Marketing → Nástroje.'
  }

  if (stav === 'zruseno') {
    return 'Zrušilo se to samo, protože se po naplánování změnil obsah. Schvaluje se přesné znění, '
      + 'takže nová verze potřebuje nové schválení a nové naplánování.'
  }

  if (stav === 'zverejneno_nanecisto') {
    return 'NIC NEODEŠLO. Byla to zkouška nanečisto — prošla celá cesta, jen se na síť nic neposlalo.'
  }

  return ''
}

/**
 * Kolik čeho je ve frontě.
 *
 * ---------------------------------------------------------------------
 * PROČ TO NENÍ PŘÍMO V OBRAZOVCE
 *
 * Bylo. A kontrola na to sahala grepem do zdrojáku — „stojí za
 * `skutecne:` řetězec `'zverejneno'`?". Při zkoušce se ukázalo, že
 * taková kontrola NEUMÍ SPADNOUT na tom, co hlídá: když jsem
 * `u.stav === 'zverejneno'` schválně přepsal na
 * `u.stav.startsWith('zverejneno')` — čímž se nanečisto začalo počítat
 * mezi skutečná zveřejnění —, řetězec tam pořád byl a kontrola zůstala
 * zelená.
 *
 * Proto je to tady: funkci jde zavolat a přepočítat, ne jen přečíst.
 *
 * ---------------------------------------------------------------------
 * NANEČISTO SE NIKDY NEPŘIČÍTÁ KE SKUTEČNÝM
 *
 * `zverejneno_nanecisto` znamená, že prošla celá cesta a na síť se NIC
 * neposlalo. Sečíst to se zveřejněnými by znamenalo hlásit počet
 * příspěvků, které nikdo nikdy neviděl.
 */
export type PoctyUloh = {
  skutecne: number
  nanecisto: number
  chyby: number
  rucne: number
  ceka: number
}

export function spocitatUlohy(ulohy: { stav: string }[]): PoctyUloh {
  const kolik = (podminka: (s: string) => boolean) =>
    ulohy.filter((u) => podminka(u.stav)).length

  return {
    // Rovná se, ne `startsWith`. Viz komentář výš — tohle je to místo.
    skutecne: kolik((s) => s === 'zverejneno'),
    nanecisto: kolik((s) => s === 'zverejneno_nanecisto'),
    chyby: kolik((s) => STAVY_ULOH_CHYBOVE.includes(s)),
    rucne: kolik((s) => s === 'k_rucnimu_zverejneni'),
    ceka: kolik((s) => STAVY_ULOH_CEKAJICI.includes(s)),
  }
}
