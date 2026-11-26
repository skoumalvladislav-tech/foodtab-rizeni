# Stav k 26. 11. 2026 — Finance Fáze 0: noc s výpadky sítě

Navazuje na `stav-2026-11-25-finance-faze0.md` (přehled toho, co ze zadání chybí, a souběžný postup).
Rozhodnutí z 25. 11. (společný firemní účet, IČO 21249946, vlastní kategorie nákladů, doklady bez IČO)
jsou zapsaná v `otazky.md` u otázek 98, 100, 110 a 114.

## Nejdřív to podstatné

- **Nic z Fáze 0 není nasazené ani sloučené. `db push` neproběhl ani nasucho.** V ostré databázi jsem na
  pokyn „zapiš ičo" změnil jediný údaj: IČO firmy je teď 21249946 (viz „Zapsáno do ostré databáze"). Jinak
  jsem z ní jen četl.
- **V noci opakovaně nefungovalo připojení k internetu.** Wi-Fi byla připojená, ale počítač nedokázal
  přeložit adresy (DNS), takže žádná práce nemohla mluvit s AI. Výpadky začaly 25. 11. kolem 22:00
  a ve 23:40 pořád trvaly. V 0:37 spadl poslední noční pokus. Ráno ve 12:07 už připojení fungovalo.
  Všechny běhy kvůli tomu padaly. Nic se neztratilo, jen se nepokračovalo.
- **Dodatek ke kroku 3 (společný firemní účet) je hotový a nezávisle zkontrolovaný.** Tři kola kontroly
  našla pět drobností. Všechny jsou opravené a poslední kolo už nenašlo nic. Čísla jsem pak přeměřil sám
  a dodatek jsem sám schválně rozbil čtyřmi způsoby. Každé rozbití nějaká kontrola chytila.
- **Kroky 4, 5 a 9 jsou rozpracované, kroky 6–8 ještě nezačaly.** Ve 12:10 jsem všechno pustil znovu.
  Každá část se teď po výpadku sama zkusí až osmkrát a naváže na rozpracovanou práci.

## Co je hotové

| Co | Commit | Čeká na `db push` |
|---|---|---|
| Firma se společným firemním účtem dostane na Přehledu, v Platbách, Platbách bez faktury, Cashflow a Rozpočtech klidné vysvětlení („pobočky platí přes firemní účet, jeho platby jsou v přehledu za celou firmu") místo varování „pobočka nemá účet". Varování zůstává, když firma nemá žádný aktivní účet. | `3d0358e` | ne, jde jen o appku |
| U poboček se místo „zůstatek appka nezná" píše „Platí přes firemní účet — zůstatek je v přehledu za celou firmu". Čísla zůstávají „–", žádné vymyšlené nuly. | `3d0358e` | ne |
| Databáze umí jen odpovědět ano/ne na otázku „má firma aktivní firemní účet". Díky tomu i pobočka řekne „platby můžou chodit přes firemní účet, který tady nevidíte". Nic dalšího o účtu (číslo, název, zůstatek) pobočka nevidí. | `937c69d` | ano, migrace `20261121100000` |
| Hlášky při párování jmenují správné právo „Zadávat faktury a náklady" (otázka 160). | `937c69d` | ano, migrace `20261120100000` |
| Zakázky: zápis platby na mezitím vypnutý účet dá srozumitelnou větu („vyberte aktivní účet"). Přehled: když se nepodaří načíst pobočky, napíše „nepodařilo se načíst" místo nul. | `3d0358e` | ne |
| Otázka 281 je v kódu označená. | `504c05a` | — |
| Opravy po nezávislé kontrole. Věty říkají „nemá vlastní **aktivní** účet", protože pobočka může mít vlastní účet vypnutý. Rozpočty už neopakují stejnou větu dvakrát pod sebou. Test hlídá i množné „nemají" a scénář zkouší, že čtenář pobočky dostane i odpověď „ne". | `e9e32d1`, `42753f5`, `be527e3` | migrace `20261121100000` se změnila jen v komentáři |
| Otázka 282 je v kódu označená a zapsaná v `otazky.md`. | `3f7c24f` | — |

## Rozpracované

| Krok | Co je udělané | Commity |
|---|---|---|
| 4 — právo „Schvalovat nákupy a platby" | Migrace `20261122100000`, scénář `krok114`, obrazovka Schválení a limit v Nastavení. Po výpadku se dokončilo a commitnulo celé najednou. Kontrola bezpečnosti našla dvě závažné díry. Limit schvalovatele šel obejít tím, že se platba spárovala po menších kouscích. A kdo spravuje finance za celou firmu, mohl účtu přepsat pobočku, a tím obejít schvalovatele omezeného na pobočku. Obě díry kontrolor potvrdil zkouškou. Opravují se v témže běhu. | `2077d22`, `276d68b` (ve větvi kroku 4) |
| 5 — kategorie nákladů (vaše vlastní osnova) | Migrace `20261123100000` s výchozí sadou kategorií po skupinách, scénář `krok115`, obrazovky kategorií, odkazy z Přehledů Faktur. Implementace je dokončená. Kontrola bezpečnosti našla 4 věci, kontrola správnosti ještě běží. | `ca53d20` … `c368f28` (6 commitů ve větvi kroků 5–8) |
| 9 — suchý běh úklidu starých faktur | Migrace s čtecím dotazem, scénář `krok119`, skript hlášení suchého běhu s testem, postup zkoušky 11 nanečisto (`docs/hlaseni/finance-faze0-zkouska-11.md` ve větvi kroku 9) a obrazovka Úklid starých faktur. Kontroly našly 9 věcí, z toho 4 středně závažné. První oprava je commitnutá, opravy dál běží. | `eb596b3` … `0521593` (11 commitů ve větvi kroku 9) |
| 6, 7, 8 | Nezačaly. Ve stejné větvi čekají za krokem 5. | — |

## Čísla — a z čeho jsou

U dodatku ke kroku 3 (stav na `3f7c24f`; tohle všechno jsem po nezávislé kontrole pustil sám):

- Celý řetěz v testovací databázi PGlite: 127 scénářů, **5 055 kontrol prošlo**. Spadl jen `krok101`, je to
  známá vada testovacího nástroje, s Financemi nesouvisí. Na konci kroku 3 to bylo 5 002 kontrol. Dodatek
  přidal 51 kontrol v `krok113` (52 → 103) a 2 v `krok112` (194 → 196).
- Typová kontrola (`tsc`) bez chyb. Všechny node testy ze seznamu, který pouští CI: **117 ze 117 prošlo**,
  11 168 kontrol, žádná chyba.
- Agent při implementaci a opravách udělal přes 30 schválných rozbití: 14 v databázi, 20 v aplikaci a 3
  u nové kontroly. Každé shodilo tu kontrolu, na kterou mířilo. Například bez podmínky „jen aktivní účet"
  spadla kontrola „vypnutý firemní účet je jako žádný" a bez kontroly práva kontrola „bez práva vidět
  finance chyba 42501".
- **Moje vlastní rozbití, jiná než agentova.** Každou vlastnost jsem rozbil dvěma způsoby:
  - Chyba při zjišťování firemního účtu se nesmí tvářit jako „firma účet nemá". (1) Stránka z chyby udělala
    varování bez věty o chybě. Spadla kontrola „chyba … → nevíme". (2) Už načtení z databáze vrátilo místo
    chyby „nemá". Spadla kontrola „chyba databáze (42501) → stav chyba s kódem, NE nemá".
  - Vypnutý firemní účet je jako žádný. Podmínku „aktivní" jsem nahradil podmínkou, která platí vždycky.
    Spadla kontrola „jen vypnutý firemní účet: ne". Agent tu podmínku předtím smazal úplně, to je ten druhý
    způsob.
  - Funkce pouští toho, kdo smí finance vidět. Právo jsem přepsal na „spravovat finance". Spadla kontrola
    „čtenář celé firmy: ano". Scénář se zastaví na první chybě, takže na kontrolu čtenáře pobočky už nedošlo.
    Tu zvlášť shodilo agentovo rozbití, které právo omezilo jen na celou firmu.
- **PGlite neověří RLS ani granty.** Že pobočka řádek firemního účtu opravdu nevidí a že nepřihlášený
  funkci nespustí, rozhodne až workflow Databáze proti PostgreSQL 16. To poběží s PR větve `finance-faze0`.

## Co čeká na Šéfíka

- **Otázka 281:** co se počítá jako firemní účet (nová, viz níže).
- **Otázka 282:** smí odpověď „má firma firemní účet" dostat i člověk, který má Finance jen na pobočce?
  Nechal jsem ano, jak to zadání chtělo. Víc než ano/ne se z toho nedozví.
- **Otázka 280:** jestli se mají platby společného účtu připisovat pobočkám.
- **Otázka 148:** vymyšlený výpis by mohl „zaplatit" fakturu. Je potřeba rozhodnout před nasazením.

## Zapsáno do ostré databáze

Na pokyn Šéfíka „zapiš ičo" (26. 11.) jsem v ostré databázi změnil jeden řádek: IČO firmy Foodtab s.r.o.
je teď 21249946 (otázka 110). Zápis byl pojištěný tak, aby změnil přesně jeden řádek, jinak by se vrátil.
První pokus vypršel dřív, než se spojení s databází rozjelo, a nic nezměnil, což jsem ověřil čtením. Druhý
pokus prošel a čtení po zápisu ukázalo 21249946 u jediné firmy.

Co se tím mění: příjem faktur od teď pošle do kontroly doklad, jehož odběratel má platné IČO jiné než
21249946 (dosud takových přišlo 11). Doklady bez IČO odběratele se nemění. Už přijaté doklady se znovu
nepřepočítávají.

## Otázky

Do `otazky.md` přibyly otázky 281 a 282. Otázka 160 je vyřízená v `937c69d`.

## Na co jsem narazil a nešlo to

- **Výpadek sítě opakování nepřečkalo.** Každá část se po pádu zkusila znovu až čtyřikrát, jenže pokusy šly
  hned po sobě a vyčerpaly se zhruba za 40 minut. Výpadek trval hodiny. Teď je pokusů osm, ale běh neumí
  čekat (nemá hodiny). Kdyby výpadek přišel znovu na dlouho, běh zase spadne a pustím ho znovu.
- **Mylné „kontroloři nic nenašli".** Agent, který dodatek ke kroku 3 dokončoval, dostal prázdný seznam
  nálezů a vzal ho jako „kontroloři nic nenašli". Ve skutečnosti oba kontroloři spadli dřív, než cokoli
  vrátili. Proto jsem pustil novou kontrolu. Ta doběhla doopravdy a našla pět drobností (viz výše). Do budoucna:
  prázdný výsledek kontroly porovnám s tím, jestli kontrolor vůbec doběhl.
- **Vykreslené stránky z dodatku nikdo neviděl** (Přehled, Platby, Cashflow, Rozpočty, Zakázky). Dev server
  se v noci nespouštěl. Potřeba je snímek obrazovky.

## Kde jsem skončil a co zbývá

1. Doběhnout dva běhy, které teď jedou: kroky 4 a 5 → 6 → 7 → 8 a krok 9. Každý krok má implementaci a tři
   kola kontroly. Kontrola dodatku ke kroku 3 už doběhla.
2. Sám ověřit výsledky: přeměřit čísla a vlastními rozbitími ověřit, že kontroly umí spadnout. U dodatku ke
   kroku 3 je to hotové.
3. Sloučit větve do `finance-faze0` v pořadí krok 3 (s dodatkem) → 4 → 5–8 → 9. Po každém sloučení celý
   řetěz testů. Pozor na databázové funkce, které mění víc kroků naráz, a na místa, která kroky 5–9
   dočasně označily „PO KROKU 4" (přepnout na nové právo schvalovat).
4. Nezávislá kontrola sloučeného celku, otázky 161–289 do `otazky.md`, hlášení a PR větve `finance-faze0`.
   PR jen otevřu, nesloučím ho.

## Nenasazoval jsem

Žádný `db push` (ani nasucho), žádné sloučení do `main`, žádný zásah do Vercelu. Do ostré databáze jen
jeden zápis IČO na výslovný pokyn (výše). Všechny migrace Fáze 0 (`20261119100000` … `20261123100000` a další z kroků 4–9) čekají.
