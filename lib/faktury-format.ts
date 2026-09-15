/** Formátování pro modul Faktury — přeneseno z faktury-app, src/lib/format.ts. */

export function formatCastku(castka: number, mena: string): string {
  try {
    return new Intl.NumberFormat('cs-CZ', {
      style: 'currency',
      currency: mena || 'CZK',
      maximumFractionDigits: 2,
    }).format(castka || 0)
  } catch {
    return `${castka} ${mena}`
  }
}

/**
 * Datum bez času — `issue_date`/`duzp`/`due_date` jsou v databázi
 * čisté `date`, ne `timestamptz`, takže se tu neřeší pásmo (CLAUDE.md,
 * pravidlo 11 se týká okamžiků, ne kalendářních dat).
 */
export function formatDatum(datum: string | null): string {
  if (!datum) return '–'
  const d = new Date(datum.length <= 10 ? datum + 'T00:00:00' : datum)
  if (Number.isNaN(d.getTime())) return datum
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}
