/**
 * ReservationProvider — úzký kontrakt pro rezervační/objednávkové
 * adaptéry.
 *
 * Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 3 a 6
 * ("V první verzi preferuj čtení. Zápis do zdroje přidávej jen na
 * základě konkrétního požadavku a podporovaného API."). Upřesnění
 * Šéfíka (7.10.2026): KAŽDÝ klient může mít jiného poskytovatele
 * rezervací/objednávek — appka se neváže na jeden konkrétní produkt,
 * kontrakt je proto záměrně obecný, ne postavený kolem jednoho jména.
 *
 * OD 25. 10. 2026 MÁ KONTRAKT CÍLOVÝ TVAR: tabulka `rezervace`
 * (20261027100000_rezervace_akce.sql) a zápis přes
 * `public.rezervace_importovat_zdroj`. Převod `RadekRezervace` → řádek
 * importu dělá `lib/rezervace-import.ts` (jedno místo pro všechny
 * adaptéry). Průzkum systémů a důvody: docs/rezervace-navrh.md.
 *
 * JAK SE PŘIDÁVÁ DALŠÍ SYSTÉM: popis do `lib/rezervace-poskytovatele.ts`,
 * adaptér podle tohohle kontraktu a jeden řádek do
 * `lib/rezervace-adaptery.ts`. Obrazovky, import ani databáze se
 * NEMĚNÍ — vidí jen `RadekRezervace`.
 *
 * ŽÁDNÝ KONKRÉTNÍ ENDPOINT/AUTH TVAR TADY NENÍ — appka si ho nevymýšlí
 * předem. Jakmile konkrétní klient přinese konkrétního poskytovatele
 * s dostupnou dokumentací, napíše se k němu vlastní adaptér podle
 * TOHOHLE kontraktu — ne vymyšlený podle jednoho konkrétního
 * poskytovatele předem.
 *
 * WEBHOOK JE ZVONEK, NE ZÁSILKA. TheFork posílá jen id, Dotykačka jen
 * „změnilo se“. Adaptér proto po webhooku vždycky dotáhne celý záznam
 * (`nacistRezervace`) a pravidelné stahování v překrývajících se oknech
 * je povinné i tam, kde webhooky jsou — doručení webhooku nikdo
 * nezaručuje. Rezervace, která v okně chybí, se NIKDY nepovažuje za
 * smazanou (smazaná je, až když to řekne zdroj).
 */

export type ZpusobPripojeniRezervace = 'api_klic' | 'oauth' | 'webhook'

/** Stejné hodnoty jako CHECK `rezervace.stav` v databázi. */
export type StavRezervace = 'ceka' | 'potvrzeno' | 'zrusena' | 'nedostavil_se' | 'dokonceno'

export type SchopnostiRezervacniProvidera = {
  zpusobPripojeni: ZpusobPripojeniRezervace
  webhooky: boolean
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  inkrementalniSync: boolean
  /** Appka v první verzi jen čte (zadání §6) — zápis se zapíná jedině na konkrétní, podporovaný požadavek. */
  zapisRezervace: boolean
  objednavky: boolean
}

/**
 * Jeden normalizovaný řádek rezervace. `jmenoHosta`/`telefonHosta`/
 * `emailHosta` jsou KONTAKTNÍ údaje k rezervaci, NIKDY marketingový
 * souhlas (zadání §6: „Kontakt z rezervace nepovažuj za marketingový
 * souhlas. Marketingové oprávnění eviduj samostatně včetně původu.") —
 * appka je ukládá do `rezervace_kontakty`, kterou čte jen
 * `rezervace.manage`, ne jako obecný marketingový kontakt.
 */
export type RadekRezervace = {
  /** Id U POSKYTOVATELE. Páruje se podle (pobočka, poskytovatel, externiId) — opakované stažení nic nezdvojí. */
  externiId: string
  /** Stav převedený adaptérem. Co adaptér nezná, převede opatrně (`ceka`), nikdy nevymyslí `dokonceno`. */
  stav: StavRezervace
  /** Stav tak, jak ho poslal poskytovatel („SEATED“, „Waiting List“) — ať se neznámá hodnota neztratí. */
  stavZdroje: string
  /** `null` = poskytovatel údaj neposkytuje — appka ho NEDOMÝŠLÍ jako 0 ani jako odhad. */
  pocetHostu: number | null
  /** ISO okamžik začátku S ČASOVÝM PÁSMEM. Bez pásma ho databáze odmítne (CLAUDE.md, pravidlo 11). */
  cas: string
  /** ISO okamžik konce s pásmem, nebo `null` (většina systémů konec neposílá). */
  konec: string | null
  /** Id provozovny U POSKYTOVATELE — appka ho mapuje na branch_id přes integrace_pripojeni, nehádá shodu sama. */
  externiProvozovna: string
  jmenoHosta: string | null
  telefonHosta: string | null
  emailHosta: string | null
  /** Co napsal host („u okna, dort v 20:00“). Interní poznámky obsluhy jsou ve Foodtabu zvlášť. */
  poznamka: string
  /** Stůl nebo prostor, když ho systém přiděluje. Ve Foodtabu jen doplní prázdný údaj, nikdy nepřepíše. */
  prostor: string | null
  /** Čas poslední změny U POSKYTOVATELE (s pásmem), nebo `null`. Podle něj se starší data nepustí přes novější. */
  zmenenoKdy: string | null
}

export type VysledekRezervaci = { stav: 'ok'; radky: RadekRezervace[] } | { stav: 'chyba'; duvod: string }
export type VysledekOvereniRezervace = { stav: 'ok'; provozovny: { externiId: string; nazev: string }[] } | { stav: 'chyba'; duvod: string }

export type ReservationProvider = {
  klic: string
  nazev: string
  schopnosti: SchopnostiRezervacniProvidera

  overitPripojeni(pristup: string): Promise<VysledekOvereniRezervace>
  nacistRezervace(pristup: string, externiProvozovna: string, od: string, doData: string): Promise<VysledekRezervaci>
  zkontrolovatPripojeni?(pristup: string): Promise<boolean>
  odvolatPristup?(pristup: string): Promise<void>

  /**
   * Zápis do zdroje (vytvoření/změna rezervace appkou) — NEIMPLEMENTOVAT
   * bez konkrétního, schváleného požadavku a potvrzené podpory API
   * (zadání §6). Typ tu stojí jako místo pro budoucí rozšíření, ne jako
   * návod, co se má postavit jako další.
   */
  zapsatRezervaci?(pristup: string, radek: Omit<RadekRezervace, 'externiId' | 'zmenenoKdy'>): Promise<{ stav: 'ok'; externiId: string } | { stav: 'chyba'; duvod: string }>
}
