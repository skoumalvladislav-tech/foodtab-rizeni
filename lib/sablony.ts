/**
 * Kdy si směna zkratku šablony opíše, a kdy ne.
 *
 * Šablona je předvyplnění. Vybere se „D“, doplní se 8–16 a tím její
 * práce končí — časy jde přepsat hned a bez odemykání. Jenže pak už
 * ta zkratka neplatí: „D“ u směny od devíti do pěti by v rozpisu
 * lhala a člověk by podle ní čekal osmou.
 *
 * Proto se zkratka ODVOZUJE z časů, ne pamatuje. Kdyby se držela ve
 * stavu a mazala se „při změně času“, dala by se ta obsluha obejít:
 * stačilo by přepsat časy a šablonu vybrat až potom.
 *
 * Bydlí to tady, a ne přímo ve formuláři, aby na to sáhla kontrola.
 * Ve vykresleném HTML se to ověřit nedá — je to větev, která nastane
 * až tím, že člověk do políčka napíše jinou hodinu.
 */

export type CasySablony = { klic: string; od: string; do: string }

export function zkratkaDoSmeny(
  sablony: CasySablony[],
  vybrany: string,
  od: string,
  doKdy: string,
): string {
  if (vybrany === '') return ''
  const s = sablony.find((x) => x.klic === vybrany)
  if (!s) return '' // Šablona zmizela z nabídky (jiná pobočka, jiná pozice).
  return s.od === od && s.do === doKdy ? vybrany : ''
}
