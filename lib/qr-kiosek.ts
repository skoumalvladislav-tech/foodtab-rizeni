/**
 * Odkaz, který nese QR na kiosku.
 *
 * Zadání docs/qr-na-kiosku-zadani.md, oddíl 2:
 *
 *     https://<adresa>/<pobocka>/dochazka?kod=CE8CA63E
 *
 * NIC DALŠÍHO V NĚM BÝT NESMÍ. Žádné jméno, žádný druh píchnutí —
 * o tom, jestli je to příchod nebo odchod, rozhoduje stav člověka, ne
 * adresa. Kdyby o tom rozhodovala adresa, stačilo by podstrčit odkaz
 * a píchnout někomu opačný směr.
 *
 * Kód v adrese je v pořádku: žije 45 vteřin a stejně svítí na obrazovce
 * za barem, kde ho vidí každý host. Není to tajemství, je to důkaz
 * přítomnosti.
 *
 * ---------------------------------------------------------------------
 * PROČ TO STOJÍ SAMOSTATNĚ A PROČ VRACÍ `null`
 *
 * Tahle funkce je JEDINÉ místo, kde ta adresa vzniká. Kontrola
 * (scripts/qr.test.mjs) sahá přesně sem — ne na řetězec poskládaný
 * vedle. Když se to rozejde, rozejde se to na jednom místě a kontrola
 * to uvidí.
 *
 * Když pobočku neznáme, vrací se `null`, ne náhradní obsah. Předchozí
 * podoba místo toho vracela SAMOTNÝ KÓD — a protože se pobočka
 * v nasazené databázi ještě nevracela, tabletu se osm dní kreslil QR
 * s osmi znaky místo adresy. Fotoaparát ho přečetl a ukázal osm znaků,
 * které si člověk stejně musel opsat. To je horší než žádný QR, protože
 * to vypadá, že to funguje. Bez pobočky se proto QR nekreslí vůbec.
 */

export function odkazPichnuti(
  puvod: string,
  slug: string | null | undefined,
  kod: string | null | undefined,
): string | null {
  if (!puvod || !slug || !kod) return null
  return `${puvod}/${encodeURIComponent(slug)}/dochazka?kod=${encodeURIComponent(kod)}`
}
