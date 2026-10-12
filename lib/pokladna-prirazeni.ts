/**
 * Přiřazení provozoven pokladny k pobočkám v appce.
 *
 * Šéfík 11. 10. 2026: „provozovna [musí jít] přiřadit ke konkrétnímu
 * profilu zde v appce." Jeden přístup do pokladny (jeden token) může
 * pokrývat víc provozoven — Dotykačka má pod jedním cloudem třeba
 * Černou Perlu i Bernard Bar. Každá provozovna pokladny se v appce
 * přiřadí jedné pobočce, nebo se nestahuje. Appka podle názvu NEHÁDÁ;
 * sama přiřadí jen jediný jednoznačný případ (jedna provozovna, jedna
 * pobočka, volná).
 *
 * Čistý modul (žádné IO) — `scripts/pokladna-napojeni.test.mjs`.
 * Databáze to hlídá znovu: `public.pokladna_nahradit_prodeje` zapíše
 * jen do pobočky, která v přiřazení je.
 */

import type { ProvozovnaPos } from './pos-provider-contract.ts'

export type ProvozovnaUctu = {
  /** Id provozovny U POSKYTOVATELE. */
  id: string
  nazev: string
  /** Pobočka v appce; `null` = nepřiřazeno, nestahuje se. */
  branch_id: string | null
  /** Nejstarší provozní den, který appka pro tuhle provozovnu už má souvisle až do dneška. */
  dohnano_od: string | null
  /**
   * Nejnovější provozní den, do kterého appka měla data souvisle, když
   * běh naposledy doběhl (`lib/pokladna-cas.ts`, `planDnu` → `mezera`).
   * Chybí u provozovny, která se ještě nestahovala.
   */
  souvisle_do?: string | null
  /** Den, na kterém stahování uvázlo, a kolikrát po sobě selhal (`lib/pokladna-beh.ts`). */
  uvazl?: { den: string; pokusu: number } | null
}

/** `integrace_pripojeni.externi_ucet` u pokladny s tokenem. */
export type ExterniUcetPokladny = {
  /** Netajná pole přístupu (Dotykačka: Cloud ID) — ať je člověk vidí. */
  cloud_id?: string
  historie_od?: string
  provozovny?: ProvozovnaUctu[]
}

export function prirazeneProvozovny(ucet: ExterniUcetPokladny | null | undefined): (ProvozovnaUctu & { branch_id: string })[] {
  return (ucet?.provozovny ?? []).filter((p): p is ProvozovnaUctu & { branch_id: string } => Boolean(p.branch_id))
}

/**
 * Čerstvý seznam provozoven od pokladny + dosavadní přiřazení: známá
 * provozovna si nechá pobočku i kurzor historie (jen název se obnoví),
 * nová je nepřiřazená, zrušená v pokladně z přiřazení vypadne.
 */
export function sloucitProvozovny(nove: ProvozovnaPos[], dosavadni: ProvozovnaUctu[]): ProvozovnaUctu[] {
  const podleId = new Map(dosavadni.map((p) => [p.id, p]))
  return nove.map((n) => {
    const stara = podleId.get(n.externiId)
    return { id: n.externiId, nazev: n.nazev, branch_id: stara?.branch_id ?? null, dohnano_od: stara?.dohnano_od ?? null, souvisle_do: stara?.souvisle_do ?? null, uvazl: stara?.uvazl ?? null }
  })
}

/**
 * Jediný případ, kdy appka přiřadí sama: pokladna má jedinou
 * provozovnu, firma jedinou pobočku a ta není přiřazená jinde.
 */
export function automatickePrirazeni(provozovny: ProvozovnaUctu[], pobockyFirmy: string[], obsazeneJinde: ReadonlySet<string>): ProvozovnaUctu[] {
  if (provozovny.length !== 1 || pobockyFirmy.length !== 1) return provozovny
  const [jedina] = provozovny
  if (jedina.branch_id || obsazeneJinde.has(pobockyFirmy[0])) return provozovny
  return [{ ...jedina, branch_id: pobockyFirmy[0], dohnano_od: null, souvisle_do: null, uvazl: null }]
}

export type VysledekPrirazeni =
  | {
      stav: 'ok'
      provozovny: ProvozovnaUctu[]
      /** Pobočky, ze kterých provozovna odešla — appka v nich smaže, co z ní dřív zapsala. */
      opustenePobocky: string[]
    }
  | { stav: 'chyba'; duvod: string }

/**
 * Nové přiřazení z formuláře (`volby`: id provozovny → id pobočky, nebo
 * prázdné = nepřiřazovat). Pobočka musí patřit firmě, jedna pobočka
 * nejvýš jednou (dvě provozovny do jedné pobočky by si přepisovaly dny)
 * a ne taková, kterou už plní JINÉ napojení pokladny (jakékoli — dvě
 * napojení jedné pobočky by se ve foodcostu sečetla). Provozovna, která
 * mění pobočku, začne historii znovu. Nezměněné přiřazení se nekontroluje
 * proti `pobockyFirmy` — pobočka mezitím mohla být vypnutá a formulář
 * ji jinak nenabídne; tiché odpojení by smazalo její historii.
 */
export function zkontrolovatPrirazeni(
  provozovny: ProvozovnaUctu[],
  volby: Record<string, string>,
  pobockyFirmy: ReadonlySet<string>,
  obsazeneJinde: ReadonlySet<string>,
): VysledekPrirazeni {
  const pouzite = new Set<string>()
  const opustene = new Set<string>()
  const vysledek: ProvozovnaUctu[] = []

  for (const p of provozovny) {
    const volba = (volby[p.id] ?? '').trim()
    const nova = volba || null

    if (nova !== null) {
      if (pouzite.has(nova)) return { stav: 'chyba', duvod: 'Jedna pobočka může mít z téhle pokladny jen jednu provozovnu.' }
      if (nova !== p.branch_id) {
        if (!pobockyFirmy.has(nova)) return { stav: 'chyba', duvod: `Provozovna ${p.nazev}: vybraná pobočka nepatří vaší firmě.` }
        if (obsazeneJinde.has(nova)) return { stav: 'chyba', duvod: `Provozovna ${p.nazev}: vybraná pobočka už dostává prodeje z jiného napojení pokladny — dvě napojení by se v ní sečetla.` }
      }
      pouzite.add(nova)
    }

    if (nova === p.branch_id) {
      vysledek.push(p)
      continue
    }
    if (p.branch_id) opustene.add(p.branch_id)
    vysledek.push({ ...p, branch_id: nova, dohnano_od: null, souvisle_do: null, uvazl: null })
  }

  // I pobočka, kterou hned obsadila jiná provozovna, se čistí: do té doby,
  // než nová provozovna dožene historii, by v ní zůstala čísla té staré.
  return { stav: 'ok', provozovny: vysledek, opustenePobocky: [...opustene] }
}
