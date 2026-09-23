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

/** „12. 9. 2026 10:24“ — s rokem, kde se ukazuje, KDY něco vzniklo. */
export function datumACasSRokemVPasmu(cas: string | Date, zona: string = ZONA_VYCHOZI): string {
  return format(cas, zona, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
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

/**
 * „2026-09-19T21:42“ — pro předvyplnění `<input type="datetime-local">`
 * existující hodnotou. Bez tohohle by úprava jednoho pole (třeba „komu“)
 * ve stejném formuláři tiše smazala `due_at`, protože prázdné `doKdy` se
 * v akci čte jako „zrušit termín“.
 */
export function datetimeLocalVPasmu(cas: string | Date, zona: string = ZONA_VYCHOZI): string {
  const d = new Date(cas)
  if (Number.isNaN(d.getTime())) return ''
  const sestav = (z: string): string => {
    const casti = new Intl.DateTimeFormat('en-CA', {
      timeZone: z,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d)
    const get = (typ: string) => casti.find((c) => c.type === typ)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  }
  try {
    return sestav(zona)
  } catch {
    return sestav(ZONA_VYCHOZI)
  }
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

/**
 * Délka směny v minutách z časů na zdi.
 *
 * Protějšek `app.delka_smeny_minut` z migrace 20260903030000. Ta je
 * pravda pro data, tahle je pro obrazovku — a musí říkat totéž. Když
 * se změní jedna, musí se druhá taky; kontroly obou používají stejné
 * případy (22:00–06:00 = 480 minut).
 *
 * Konec dřív než začátek znamená DRUHÝ DEN. Odečtením by 22:00–06:00
 * vyšlo jako mínus šestnáct hodin.
 *
 * Bez `new Date()`: jsou to hodiny na zdi, ne okamžik. Převod v pásmu
 * serveru je přesně ta chyba, kvůli které vznikl tenhle modul.
 */
export function delkaSmenyMinut(od: string, doKdy: string): number {
  const naMinuty = (t: string): number => {
    const [h, m] = t.split(':')
    return Number(h) * 60 + Number(m ?? 0)
  }
  const a = naMinuty(od)
  const b = naMinuty(doKdy)
  return b > a ? b - a : 24 * 60 - a + b
}

/**
 * Okamžik z hodin na zdi v pásmu pobočky: „2026-09-19“ + „08:00“ →
 * milisekundy od epochy.
 *
 * Protějšek databázového `(den + čas) at time zone zona_pobocky`. Potřeba
 * všude, kde se hodiny ze směny (čas bez data a pásma) porovnávají s
 * okamžikem (příchod, „teď“): směna 08:00 začíná v Praze o dvě hodiny
 * dřív než 08:00 UTC a server běží v UTC.
 *
 * Posun pásma se zjišťuje dvakrát, aby to vyšlo i těsně kolem přechodu
 * na letní/zimní čas. Hodina, která ten den neexistuje (02:30 při
 * přechodu na letní), vyjde jako nejbližší platný okamžik — pro otázku
 * „už ta směna začala?“ to stačí.
 */
export function okamzikVPasmu(den: string, cas: string, zona: string = ZONA_VYCHOZI): number {
  const [r, m, d] = den.split('-').map(Number)
  const [h, min = 0, s = 0] = cas.split(':').map(Number)
  const naZdi = Date.UTC(r, m - 1, d, h, min, s)

  const posunPasma = (okamzik: number): number => {
    let casti: Intl.DateTimeFormatPart[]
    try {
      casti = new Intl.DateTimeFormat('en-CA', {
        timeZone: zona,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(okamzik))
    } catch {
      // Neznámé pásmo: výchozí, nikdy pásmo serveru (viz hlavičku souboru).
      casti = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONA_VYCHOZI,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(new Date(okamzik))
    }
    const cislo = (typ: string) => Number(casti.find((c) => c.type === typ)?.value ?? 0)
    const vPasmu = Date.UTC(
      cislo('year'),
      cislo('month') - 1,
      cislo('day'),
      cislo('hour'),
      cislo('minute'),
      cislo('second'),
    )
    return vPasmu - Math.floor(okamzik / 1000) * 1000
  }

  const prvni = naZdi - posunPasma(naZdi)
  return naZdi - posunPasma(prvni)
}
