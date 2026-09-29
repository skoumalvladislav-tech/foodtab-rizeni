/**
 * Nástěnka — komu je oznámení určené a v jakém pořadí se ukáže.
 *
 * POŘADÍ. Zadání 5., 6. a 8. 9. 2026 (a Deputy, ze kterého vychází):
 * oznámení, které čeká na MOJE „Beru na vědomí“, je NAHOŘE — a mezi
 * sebou OD NEJSTARŠÍHO, ať to, co visí nejdéle, nezapadne. Pak připnutá,
 * pak všechno ostatní od nejnovějšího.
 *
 * Do 27. 9. se řadilo jen „připnuté, pak od nejnovějšího“ (rozpor R12
 * v docs/komunikace-stav-a-plan-2026-09-27.md): nepotvrzené oznámení
 * se starší novinkou sjelo dolů a nikdo ho nepotvrdil.
 *
 * „PRO MĚ“ (28. 9.). RLS pustí vedoucímu s `communication.manage`
 * i oznámení jiných úseků, pozic a lidí, a autorovi jeho vlastní. Do
 * 28. 9. se všechno, co RLS pustila, počítalo jako „čeká na vaše
 * potvrzení“ a „nové oznámení“ — majitel tak měl nahoře vlastní text
 * a číslo ve zvonečku, dokud ho sám nepotvrdil, a vedoucí baru
 * oznámení pro kuchyni. Teď se čeká a počítá jen to, co je pro mě
 * podle STEJNÝCH pravidel jako upozornění (`app.upozornit_na_oznameni_trg`)
 * a „Nepotvrdili: …“ (`public.kdo_nepotvrdil`): nejsem autor, a adresát
 * sedí na mě — člověk, jinak úsek, jinak pozice, jinak DOMOVSKÁ pobočka,
 * jinak celá firma. Ostatní oznámení se ukážou, ale bez štítku, bez
 * tlačítka a bez čísla.
 *
 * Čisté funkce: řadí a třídí to, co stránka načetla, nic nevynechává
 * a nic nepřidává. Test: scripts/komunikace.test.mjs.
 */

export type OznameniKRazeni = {
  id: string
  pinned: boolean
  requires_acknowledgment: boolean
  /** ISO čas vzniku. */
  created_at: string
  /** profiles.user_id autora. */
  author_id: string | null
  employee_id: string | null
  usek_id: string | null
  position_id: string | null
  branch_id: string | null
}

/**
 * Kdo čte — z vlastního řádku v `employees` (RLS ho pustí vždy).
 * Bez zaměstnaneckého záznamu (`employeeId` null) není pro mě nic:
 * upozornění i „Nepotvrdili“ vycházejí ze zaměstnanců.
 */
export type CtenarNastenky = {
  userId: string
  employeeId: string | null
  branchId: string | null
  usekId: string | null
  positionId: string | null
}

/** Je oznámení určené mně? Stejné pořadí adresování jako trigger upozornění. */
export function jeProMe(z: OznameniKRazeni, ja: CtenarNastenky): boolean {
  if (z.author_id !== null && z.author_id === ja.userId) return false
  if (ja.employeeId === null) return false
  if (z.employee_id !== null) return z.employee_id === ja.employeeId
  if (z.usek_id !== null) return ja.usekId !== null && z.usek_id === ja.usekId
  if (z.position_id !== null) return ja.positionId !== null && z.position_id === ja.positionId
  if (z.branch_id !== null) return ja.branchId !== null && z.branch_id === ja.branchId
  return true
}

/** Nepřečtené oznámení pro mě — to, co počítá zvoneček a záložka. */
export function jeNoveProMe(z: OznameniKRazeni, prectene: ReadonlySet<string>, ja: CtenarNastenky): boolean {
  return !prectene.has(z.id) && jeProMe(z, ja)
}

/** Čeká na moje „Beru na vědomí“ — štítek a místo nahoře. */
export function cekaNaMe(z: OznameniKRazeni, prectene: ReadonlySet<string>, ja: CtenarNastenky): boolean {
  return z.requires_acknowledgment && jeNoveProMe(z, prectene, ja)
}

/** 0 = čeká na moje potvrzení, 1 = připnuté, 2 = ostatní. */
function skupina(z: OznameniKRazeni, prectene: ReadonlySet<string>, ja: CtenarNastenky): 0 | 1 | 2 {
  if (cekaNaMe(z, prectene, ja)) return 0
  if (z.pinned) return 1
  return 2
}

export function seraditOznameni<T extends OznameniKRazeni>(
  oznameni: readonly T[],
  /** Id oznámení, která už mám přečtená / potvrzená. */
  prectene: ReadonlySet<string>,
  ja: CtenarNastenky,
): T[] {
  return [...oznameni].sort((a, b) => {
    const sa = skupina(a, prectene, ja)
    const sb = skupina(b, prectene, ja)
    if (sa !== sb) return sa - sb
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    // Nepotvrzená od nejstaršího, zbytek od nejnovějšího.
    if (ta !== tb) return sa === 0 ? ta - tb : tb - ta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
