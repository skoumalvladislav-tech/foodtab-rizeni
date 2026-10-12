/**
 * Provozní den pro pokladní prodeje — z kdy do kdy se ptát pokladny.
 *
 * Tržba patří k PROVOZNÍMU dni pobočky, ne ke kalendářnímu:
 * `branches.day_starts_at` (výchozí 05:00, `20260823120000_foundation.sql`:
 * „Určuje business_date u tržeb") a pásmo pobočky/firmy. Pivo prodané
 * ve 2 ráno patří ještě k včerejšku. Totéž počítá `app.business_date`
 * v databázi — tady je to samé pravidlo pro chvíli, kdy se appka ptá
 * pokladny „dej mi prodeje od–do".
 *
 * Okno je `[začátek dne D, začátek dne D+1)` — v den přechodu na letní
 * čas má 23 hodin, na zimní 25. Proto se konec počítá jako začátek
 * DALŠÍHO dne, ne „začátek + 24 h".
 *
 * Čistý modul (žádné IO) — `scripts/pokladna-napojeni.test.mjs`.
 */

type MistniCasti = { rok: number; mesic: number; den: number; hodina: number; minuta: number; sekunda: number }

const formatovace = new Map<string, Intl.DateTimeFormat>()

function formatovac(pasmo: string): Intl.DateTimeFormat {
  let f = formatovace.get(pasmo)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: pasmo,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatovace.set(pasmo, f)
  }
  return f
}

function mistniCasti(ms: number, pasmo: string): MistniCasti {
  const casti: Record<string, number> = {}
  for (const c of formatovac(pasmo).formatToParts(new Date(ms))) {
    if (c.type !== 'literal') casti[c.type] = Number(c.value)
  }
  return { rok: casti.year, mesic: casti.month, den: casti.day, hodina: casti.hour, minuta: casti.minute, sekunda: casti.second }
}

/** O kolik je místní čas v `pasmo` napřed před UTC v okamžiku `ms` (v ms; Praha +1 h / +2 h). */
export function posunPasmaMs(ms: number, pasmo: string): number {
  const c = mistniCasti(ms, pasmo)
  return Date.UTC(c.rok, c.mesic - 1, c.den, c.hodina, c.minuta, c.sekunda) - Math.floor(ms / 1000) * 1000
}

function rozebratDatum(datum: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum)
  if (!m) throw new Error(`Neplatné datum „${datum}".`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** `'05:00'` i `'05:00:00'` (tvar sloupce `time` z Postgresu) → [hodiny, minuty, sekundy]. */
function rozebratCas(cas: string): [number, number, number] {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cas)
  if (!m) throw new Error(`Neplatný čas „${cas}".`)
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

/** Okamžik (epoch ms), kdy je v `pasmo` na hodinách `datum cas`. */
export function mistniCasNaMs(datum: string, cas: string, pasmo: string): number {
  const [r, m, d] = rozebratDatum(datum)
  const [h, mi, s] = rozebratCas(cas)
  const jakoUtc = Date.UTC(r, m - 1, d, h, mi, s)
  const prvniPosun = posunPasmaMs(jakoUtc, pasmo)
  let ms = jakoUtc - prvniPosun
  // Kolem přechodu času může mít okamžik o hodinu vedle jiný posun než
  // první odhad — druhé kolo to srovná.
  const druhyPosun = posunPasmaMs(ms, pasmo)
  if (druhyPosun !== prvniPosun) ms = jakoUtc - druhyPosun
  return ms
}

/** Odkud appka dotahuje historii, když člověk nic nezvolí: 1. 1. letošního roku (jako u faktur z e-mailu). */
export function vychoziHistorieOd(dnes: string): string {
  return `${dnes.slice(0, 4)}-01-01`
}

export function posunoutDen(datum: string, oDnu: number): string {
  const [r, m, d] = rozebratDatum(datum)
  return new Date(Date.UTC(r, m - 1, d) + oDnu * 86_400_000).toISOString().slice(0, 10)
}

/** Okno provozního dne `datum`: od začátku tohohle dne do začátku dalšího (23/24/25 h). */
export function oknoProvoznihoDne(datum: string, denZacina: string, pasmo: string): { odMs: number; doMs: number } {
  return {
    odMs: mistniCasNaMs(datum, denZacina, pasmo),
    doMs: mistniCasNaMs(posunoutDen(datum, 1), denZacina, pasmo),
  }
}

/** Provozní den okamžiku `ms` — totéž pravidlo jako `app.business_date` v databázi. */
export function provozniDen(ms: number, denZacina: string, pasmo: string): string {
  const c = mistniCasti(ms, pasmo)
  const [h, mi, s] = rozebratCas(denZacina)
  const mistne = Date.UTC(c.rok, c.mesic - 1, c.den, c.hodina, c.minuta, c.sekunda)
  return new Date(mistne - ((h * 60 + mi) * 60 + s) * 1000).toISOString().slice(0, 10)
}

/**
 * Které dny se tenhle běh ptá pokladny.
 *
 * `posledni` — dnešek a pár dní zpátky POKAŽDÉ: dnešek ještě běží
 * a v pokladně se dodatečně stornuje, takže čísla posledních dní se
 * přepisují aktuálními. `dohnat` — historie od `historieOd`, od
 * nejnovějšího dne ke staršímu, pokračuje tam, kde minulý běh skončil
 * (`dohnanoOd` = nejstarší den, který už appka má). Kolik se z ní
 * stihne, řídí synchronizace časem, ne tady počtem.
 *
 * Kurzor je výslovný, ne „nejstarší den s daty": den, kdy měla
 * provozovna zavřeno, nemá ani jeden řádek — appka by se na něj
 * ptala pořád dokola a dál by se nedostala.
 *
 * `mezera` — dny mezi `souvisleDo` (nejnovější den, do kterého appka
 * měla data souvisle, když naposledy doběhla) a posledními dny. Po
 * výpadku delším než pár dní (neplatný token, nedostupná pokladna,
 * nefunkční úloha) by jinak v datech zůstala tichá díra: posledních
 * pár dní se přepisuje a historie se dohání jen DOZADU od `dohnanoOd`.
 * Od nejstaršího dne, `souvisleDo` včetně (tehdy mohl být rozběhnutý).
 */
export function planDnu(vstup: { dnes: string; historieOd: string; dohnanoOd: string | null; souvisleDo?: string | null; poslednich?: number }): { posledni: string[]; mezera: string[]; dohnat: string[] } {
  const { dnes, historieOd, dohnanoOd } = vstup
  const souvisleDo = vstup.souvisleDo ?? null
  const poslednich = vstup.poslednich ?? 3

  const posledni: string[] = []
  for (let i = 0; i < poslednich; i++) {
    const den = posunoutDen(dnes, -i)
    if (den < historieOd) break
    posledni.push(den)
  }
  if (posledni.length === 0) return { posledni, mezera: [], dohnat: [] }

  const nejstarsiPosledni = posledni[posledni.length - 1]

  const mezera: string[] = []
  if (souvisleDo && souvisleDo < nejstarsiPosledni) {
    for (let den = souvisleDo < historieOd ? historieOd : souvisleDo; den < nejstarsiPosledni; den = posunoutDen(den, 1)) mezera.push(den)
  }

  const odkud = dohnanoOd && dohnanoOd < nejstarsiPosledni ? dohnanoOd : nejstarsiPosledni

  const dohnat: string[] = []
  for (let den = posunoutDen(odkud, -1); den >= historieOd; den = posunoutDen(den, -1)) dohnat.push(den)

  return { posledni, mezera, dohnat }
}
