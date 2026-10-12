/**
 * PosProvider — úzký kontrakt pro pokladní (POS) adaptéry.
 *
 * Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 3
 * ("Vytvoř výměnné adaptéry PosProvider... Každý deklaruje schopnosti:
 * autentizaci, datové oblasti, webhooky, historii, stránkování,
 * inkrementální načítání, limity a obnovu přístupu.") a oddíl 5
 * (Dotykačka jako první kandidát). Šéfík 11. 10. 2026: „potřebuji
 * univerzální formu připojení — je spoustu pos… okénko, kam se vloží
 * API token a POS se připojí."
 *
 * JAK SE PŘIDÁVÁ DALŠÍ POKLADNA: popis (pole formuláře, návod) do
 * `lib/pokladna-poskytovatele.ts`, adaptér podle tohohle kontraktu
 * (vzor `lib/pokladna-dotykacka.ts`) a jeden řádek do
 * `lib/pokladna-adaptery.ts`. Obrazovka, synchronizace, zápis do
 * `pokladna_prodeje_denni` a foodcost se NEMĚNÍ — vidí jen `RadekProdeje`.
 *
 * Adaptér NEPOČÍTÁ provozní den ani nezapisuje do databáze. Dostane
 * okno v milisekundách (od–do, spočítané z `branches.day_starts_at`
 * a časového pásma, `lib/pokladna-cas.ts`) a vrátí prodej po produktech
 * za to okno. Do kterého dne to patří, rozhoduje synchronizace —
 * jedno místo pro všechny pokladny, ne N různých výkladů půlnoci.
 *
 * Mantinel (rozhodnutí Šéfíka 2.10.2026, platí dál): appka NEBUDUJE
 * fyzický sklad/inventury. Adaptér dodává TRŽBY a prodané položky,
 * ne skladové pohyby — ty zůstávají doménou pokladny samotné.
 */

/** Hodnoty z formuláře připojení (klíče podle `PopisPokladny.pole`). Do databáze jen zašifrované. */
export type UdajePos = Record<string, string>

export type ProvozovnaPos = {
  /** Id provozovny U POSKYTOVATELE — appka ho mapuje na svou pobočku přes `integrace_pripojeni.branch_id`, nehádá shodu sama. */
  externiId: string
  nazev: string
}

/** Prodej jednoho produktu za jedno okno (provozní den). Tržba s DPH, jak ji ukazuje pokladna. */
export type RadekProdeje = {
  produktNazev: string
  mnozstvi: number
  trzbaHaleru: number
}

/**
 * `pristup` — token neplatí (vypršel, odvolaný, překlep): připojení
 *   potřebuje člověka, appka ho označí „Vyžaduje pozornost".
 * `docasna` — pokladna teď neodpovídá nebo odmítá rychlé dotazy:
 *   appka to zkusí příště sama, připojení nepřepíná.
 * `jina` — odpověď, které appka nerozumí, nebo chyba v datech.
 */
export type ChybaPos = { stav: 'chyba'; druh: 'pristup' | 'docasna' | 'jina'; duvod: string }

export type RelacePos = {
  /** Provozovny U POSKYTOVATELE — appka je nabídne k přiřazení na vlastní pobočku. */
  provozovny(): Promise<{ stav: 'ok'; provozovny: ProvozovnaPos[] } | ChybaPos>
  /**
   * Prodej po produktech v okně `[odMs, doMs)`. Stejný produkt nejvýš
   * jednou (adaptér sčítá). `vynechano` = položky, které appka nemohla
   * uložit (např. záporný součet po vratkách) — počítá se, nemlčí se.
   * `prazdne` = pokladna výslovně řekla „za tohle okno nic nemám"
   * (Dotykačka: 404). Synchronizace pak nic nemaže — jen ověří, že
   * provozovna pořád existuje, a den bere jako hotový (zavřeno, svátek).
   */
  prodeje(externiProvozovna: string, odMs: number, doMs: number): Promise<{ stav: 'ok'; radky: RadekProdeje[]; vynechano: number; prazdne?: boolean } | ChybaPos>
}

export type SchopnostiPosProvidera = {
  /** Appka dostane souhrn prodeje po produktu, nebo i jednotlivé účtenky? */
  urovenDat: 'denni_souhrn' | 'jednotlive_uctenky'
  webhooky: boolean
  /** `null` = neznámé/neomezené (appka to nikdy nedomýšlí jako konkrétní číslo). */
  historieDnu: number | null
  /** Rozpad plateb hotovost/karta — potřebné pro kontrolu vypořádání (zadání oddíl 4). */
  platebniMetody: boolean
  /** Appka nikdy nepočítá fyzickou skladovou spotřebu — ale poskytovatel ji může posílat, appka to musí umět poznat a NEzapsat jako vlastní sklad. */
  poskytujeSkladovePohyby: boolean
}

export type PosProvider = {
  /** Stejný klíč jako v `lib/pokladna-poskytovatele.ts` a v `integrace_pripojeni.poskytovatel`. */
  klic: string
  schopnosti: SchopnostiPosProvidera
  /** Ověří údaje u pokladny (živé volání) a otevře relaci na jeden běh synchronizace. */
  otevrit(udaje: UdajePos): Promise<{ stav: 'ok'; relace: RelacePos } | ChybaPos>
}
