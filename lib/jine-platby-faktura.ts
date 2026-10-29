/**
 * Jiné platby — podklady pro fakturu a co v nich chybí.
 *
 * Appka fakturu nevystavuje (vydané faktury zatím nejsou, otázka 51);
 * připraví podklady pro systém, kde se faktura vystaví (pokladna nebo
 * účetní program), a řekne, co chybí. Faktura není tržba a úhrada
 * není tržba — tohle jsou jen podklady.
 *
 * Pravidla:
 *   – ceny, množství, měna a DPH jen z OVĚŘENÝCH údajů: hlavička jen ze
 *     zkontrolovaného záznamu, řádek jen bez příznaku ke kontrole.
 *     Neověřený údaj zůstane prázdný a objeví se v `chybi`;
 *   – nic se nedomýšlí: chybějící DPH se nedoplní „běžnou sazbou",
 *     chybějící množství se nedopočte z ceny;
 *   – spropitné: řádek „spropitné" se převezme jen tak, jak je na
 *     dokladu výslovně uvedený. Z částek mimo položky (souhrn „Spropitné",
 *     rozdíl K úhradě − celkem) se řádek faktury nikdy nevyrábí —
 *     spropitné není prodej podniku a do ceny prodeje nepatří.
 *
 * Čistá funkce — testuje scripts/jine-platby.test.mjs přímo Nodem.
 */

import type { PolozkaNavrhu, ZaznamJinePlatby } from './jine-platby-typy.ts'
import { formatCislaHaleru, vynasobit } from './jine-platby-castky.ts'
import { TOLERANCE_ZAOKROUHLENI_HALERU } from './jine-platby-kontrola.ts'

export type KontaktFaktury = { id: string; nazev: string; ico: string | null; dic: string | null }

export type PolozkaFaktury = {
  nazev: string
  mnozstvi: string | null
  jednotka: string | null
  cenaJednotkovaHaleru: number | null
  cenaCelkemHaleru: number | null
  sazbaDph: string | null
}

export type PodkladyFaktury = {
  odberatel: KontaktFaktury | null
  mena: string | null
  datumPlneni: string | null
  polozky: PolozkaFaktury[]
  celkemHaleru: number | null
  externiUcet: string | null
}

const prazdne = (s: string | null | undefined) => s === null || s === undefined || s.trim() === ''

export function sestavitPodklady(
  z: ZaznamJinePlatby,
  polozky: readonly PolozkaNavrhu[],
  kontakt: KontaktFaktury | null,
): { podklady: PodkladyFaktury; chybi: string[] } {
  const chybi: string[] = []

  // Odběratel
  if (!kontakt) chybi.push('Odběratel — vyberte kontakt')
  else {
    if (prazdne(kontakt.nazev)) chybi.push('Název odběratele')
    if (prazdne(kontakt.ico)) chybi.push('IČO odběratele')
  }

  // Hlavička jen ze zkontrolovaného záznamu
  const overeno = z.stavKontroly === 'zkontrolovano'
  if (!overeno) chybi.push('Záznam není zkontrolovaný — částka, měna a datum zatím nejsou ověřené')
  const mena = overeno ? z.mena : null
  const datumPlneni = overeno ? z.datumProdeje : null
  const celkemHaleru = overeno ? z.castkaHaleru : null
  if (overeno && mena === null) chybi.push('Měna')
  if (overeno && datumPlneni === null) chybi.push('Datum prodeje (datum plnění)')
  if (overeno && celkemHaleru === null) chybi.push('Celková částka')

  if (polozky.length === 0) chybi.push('Položky faktury')

  // Řádky
  const radky: PolozkaFaktury[] = polozky.map((p, i) => {
    const kdo = `Položka ${i + 1} (${p.nazev.trim() || 'bez názvu'})`
    if (p.vyzadujeKontrolu) {
      chybi.push(`${kdo}: čeká na kontrolu — ceny, množství a DPH zatím nejsou ověřené`)
      return { nazev: p.nazev, mnozstvi: null, jednotka: p.jednotka, cenaJednotkovaHaleru: null, cenaCelkemHaleru: null, sazbaDph: null }
    }
    // Cena celkem: z dokladu, jinak přesný součin ověřeného množství a ověřené jednotkové ceny (počet, ne odhad).
    let cenaCelkem = p.cenaCelkemHaleru
    if (cenaCelkem === null && p.mnozstvi !== null && p.cenaJednotkovaHaleru !== null) {
      try {
        cenaCelkem = vynasobit(p.mnozstvi, p.cenaJednotkovaHaleru)
      } catch {
        cenaCelkem = null
      }
    }
    const bezMnozstviOk = p.druh === 'sleva' || p.druh === 'spropitne'
    if (p.mnozstvi === null && !bezMnozstviOk) chybi.push(`${kdo}: množství`)
    if (cenaCelkem === null) chybi.push(`${kdo}: cena`)
    if (prazdne(p.sazbaDph)) chybi.push(`${kdo}: sazba DPH`)
    return {
      nazev: p.nazev,
      mnozstvi: p.mnozstvi,
      jednotka: p.jednotka,
      cenaJednotkovaHaleru: p.cenaJednotkovaHaleru,
      cenaCelkemHaleru: cenaCelkem,
      sazbaDph: prazdne(p.sazbaDph) ? null : p.sazbaDph,
    }
  })

  // Součet řádků (bez spropitného) proti částce záznamu
  if (celkemHaleru !== null) {
    const prodej = radky.filter((_, i) => polozky[i].druh !== 'spropitne')
    if (prodej.length > 0 && prodej.every((r) => r.cenaCelkemHaleru !== null)) {
      const soucet = prodej.reduce((s, r) => s + (r.cenaCelkemHaleru as number), 0)
      const tol = mena === 'CZK' ? TOLERANCE_ZAOKROUHLENI_HALERU : 0
      if (Math.abs(soucet - celkemHaleru) > tol) {
        chybi.push(`Součet položek (${formatCislaHaleru(soucet)}) nesedí s částkou záznamu (${formatCislaHaleru(celkemHaleru)})`)
      }
    }
  }

  return {
    podklady: {
      odberatel: kontakt,
      mena,
      datumPlneni,
      polozky: radky,
      celkemHaleru,
      externiUcet: z.externiUcet,
    },
    chybi: [...new Set(chybi)],
  }
}
