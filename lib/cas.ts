/**
 * Časy na obrazovce.
 *
 * ---------------------------------------------------------------------
 * PROČ TO EXISTUJE
 *
 * Docházka ukazovala časy přes `new Date(iso).getHours()`. To vrací
 * hodinu v pásmu SERVERU — a server na Vercelu běží v UTC. Událost
 * z 13:27 pražského času se tedy na obrazovce ukázala jako 11:27.
 *
 * Sama o sobě by to byla nepříjemnost. Zlé bylo, že ruční zápis měl
 * tutéž chybu obráceně (`new Date('…T22:00')` se v UTC serveru přečetlo
 * jako 22:00 UTC), takže se to na obrazovce VYRUŠILO: co se zadalo jako
 * 22:00, se jako 22:00 i ukázalo. Nikdo nic nepoznal — ale minuty
 * i hranice provozního dne se počítaly z okamžiku o dvě hodiny jinde.
 *
 * Viz docs/odpoved-na-nalez-casu-2026-09-02.md.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLO
 *
 * Okamžik (`timestamptz`) se NIKDY neformátuje bez pásma. Pásmo je
 * pásmo POBOČKY — firma může mít provozovny ve dvou zemích dřív, než
 * by se čekalo, a časy se ukazují u pobočky, ne u firmy.
 *
 * `Intl` bere pravidla letního času pro to konkrétní datum, takže
 * záznam z ledna vyjde jinak než z července. Paušální posun by byl
 * jen jinak zapsaná táž chyba.
 */

/** Když pásmo neznáme. Firma i pobočky ho v databázi mají, tohle je pojistka. */
export const ZONA_VYCHOZI = 'Europe/Prague'

/** „13:27“ */
export function hodinaVPasmu(cas: string | Date, zona: string = ZONA_VYCHOZI): string {
  return format(cas, zona, { hour: '2-digit', minute: '2-digit' })
}

/** „31. 8. 13:27“ */
export function datumACasVPasmu(cas: string | Date, zona: string = ZONA_VYCHOZI): string {
  return format(cas, zona, {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Datum provozního dne z okamžiku: „2026-08-31“. */
export function denVPasmu(cas: string | Date, zona: string = ZONA_VYCHOZI): string {
  const d = new Date(cas)
  if (Number.isNaN(d.getTime())) return ''
  // `en-CA` dává rok-měsíc-den, což je přesně tvar ISO data.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function format(cas: string | Date, zona: string, volby: Intl.DateTimeFormatOptions): string {
  const d = new Date(cas)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      timeZone: zona,
      // h23: „00:30“, ne „24:30“ ani „12:30 AM“.
      hourCycle: 'h23',
      ...volby,
    }).format(d)
  } catch {
    /*
      Neznámé pásmo shodí `Intl`. Radši ukázat čas ve výchozím pásmu než
      shodit obrazovku — ale nikdy ne v pásmu serveru, to je právě ta
      chyba, kvůli které tenhle modul vznikl.
    */
    return new Intl.DateTimeFormat('cs-CZ', {
      timeZone: ZONA_VYCHOZI,
      hourCycle: 'h23',
      ...volby,
    }).format(d)
  }
}
