/**
 * Zobrazení nákupní ceny. `unit_price_haleru` je haléře za `base_unit`
 * (g/ml/ks) — u gramu nebo mililitru jde o zlomky haléře, proto se
 * nezaokrouhluje na celé koruny jako `lib/mzdy.ts#koruny` (ta zaokrouhlená
 * cena by u drobného koření vyšla skoro vždycky na "0 Kč").
 */
export function cenaZaJednotku(haleru: number, jednotka: string): string {
  const kc = haleru / 100
  const text = kc.toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
  return `${text} Kč/${jednotka}`
}

/** "250 Kč" — cena balení, celé koruny (haléře tu nikdo nepočítá zpaměti). */
export function cenaBaleni(haleru: number): string {
  return `${Math.round(haleru / 100).toLocaleString('cs-CZ')} Kč`
}
