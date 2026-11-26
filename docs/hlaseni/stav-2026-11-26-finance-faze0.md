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
- **Hotový je dodatek ke kroku 3 (společný firemní účet), ale ještě ho nikdo nezávisle nezkontroloval.**
  Oba kontroloři spadli na výpadku. Kontrola teď běží znovu.
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

## Rozpracované

| Krok | Co je udělané | Commity |
|---|---|---|
| 4 — právo „Schvalovat nákupy a platby" | Migrace `20261122100000`, scénář `krok114` (jeho část prošla), obrazovka Schválení a limit v Nastavení. Celý řetěz testů v testovací databázi: 4 945 kontrol prošlo a spadly krok99 a známý krok101. Krok99 se pak opravil, ale druhý celý běh přerušil výpadek. | **Žádný, schválně.** Přepnutí práv se commituje jen celé, ne napůl (pravidlo projektu). Rozpracované soubory leží ve větvi a mám jejich zálohu. |
| 5 — kategorie nákladů (vaše vlastní osnova) | Migrace `20261123100000` s výchozí sadou kategorií po skupinách, scénář `krok115` (170 kontrol), obrazovky kategorií, odkazy z Přehledů Faktur. Zbývá dokončit schválná rozbití, celý řetěz a kontroly. | `ca5d439`, `b221c62`, `9c3b84f`, `c9f7880` |
| 9 — suchý běh úklidu starých faktur | Migrace s čtecím dotazem, scénář `krok119`, skript hlášení suchého běhu s testem, postup zkoušky 11 nanečisto (`docs/hlaseni/finance-faze0-zkouska-11.md` ve větvi kroku 9). Zbývá dokončit zkoušky a kontroly. | `eb596b3` … `4d688ca` (5 commitů) |
| 6, 7, 8 | Nezačaly. Ve stejné větvi čekají za krokem 5. | — |

## Čísla — a z čeho jsou

U dodatku ke kroku 3 (stav na `504c05a`):

- Celý řetěz v testovací databázi PGlite: 127 scénářů, **5 050 kontrol prošlo**. Spadl jen `krok101`, je to
  známá vada testovacího nástroje, s Financemi nesouvisí. Na konci kroku 3 to bylo 5 002 kontrol, přibylo
  46 v `krok113` a 2 v `krok112`.
- Typová kontrola (`tsc`) bez chyb. Node testy: 51 souborů, 4 838 kontrol prošlo, 0 spadlo.
- **22 schválných rozbití** a každé shodilo tu kontrolu, na kterou mířilo. Například bez podmínky „jen
  aktivní účet" spadla kontrola „vypnutý firemní účet je jako žádný" a bez kontroly práva spadla kontrola
  „bez práva vidět finance chyba 42501".
- **PGlite neověří RLS ani granty.** Že pobočka řádek firemního účtu opravdu nevidí a že nepřihlášený
  funkci nespustí, rozhodne až workflow Databáze proti PostgreSQL 16. To poběží s PR větve `finance-faze0`.
- **Pozor:** tahle čísla změřil agent, který krok dokončoval. Já sám jsem je zatím nepřeměřil a nezávislá
  kontrola ještě neproběhla.

## Co čeká na Šéfíka

- **Otázka 281:** co se počítá jako firemní účet (nová, viz níže).
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

Do `otazky.md` přibyla otázka 281. Otázka 160 je vyřízená v `937c69d`.

## Na co jsem narazil a nešlo to

- **Výpadek sítě opakování nepřečkalo.** Každá část se po pádu zkusila znovu až čtyřikrát, jenže pokusy šly
  hned po sobě a vyčerpaly se zhruba za 40 minut. Výpadek trval hodiny. Teď je pokusů osm, ale běh neumí
  čekat (nemá hodiny). Kdyby výpadek přišel znovu na dlouho, běh zase spadne a pustím ho znovu.
- **Mylné „kontroloři nic nenašli".** Agent, který dodatek ke kroku 3 dokončoval, dostal prázdný seznam
  nálezů a vzal ho jako „kontroloři nic nenašli". Ve skutečnosti oba kontroloři spadli dřív, než cokoli
  vrátili. Proto dodatek neberu jako zkontrolovaný, dokud nedoběhne nová kontrola. Do budoucna: prázdný
  výsledek kontroly porovnám s tím, jestli kontrolor vůbec doběhl.
- **Vykreslené stránky z dodatku nikdo neviděl** (Přehled, Platby, Cashflow, Rozpočty, Zakázky). Dev server
  se v noci nespouštěl. Potřeba je snímek obrazovky.

## Kde jsem skončil a co zbývá

1. Doběhnout tři běhy, které teď jedou: kroky 4 a 5 → 6 → 7 → 8, krok 9 a nezávislá kontrola dodatku ke
   kroku 3. Každý krok má implementaci a tři kola kontroly.
2. Sám ověřit výsledky: přeměřit čísla a vlastními rozbitími ověřit, že kontroly umí spadnout.
3. Sloučit větve do `finance-faze0` v pořadí krok 3 (s dodatkem) → 4 → 5–8 → 9. Po každém sloučení celý
   řetěz testů. Pozor na databázové funkce, které mění víc kroků naráz, a na místa, která kroky 5–9
   dočasně označily „PO KROKU 4" (přepnout na nové právo schvalovat).
4. Nezávislá kontrola sloučeného celku, otázky 161–289 do `otazky.md`, hlášení a PR větve `finance-faze0`.
   PR jen otevřu, nesloučím ho.

## Nenasazoval jsem

Žádný `db push` (ani nasucho), žádné sloučení do `main`, žádný zásah do Vercelu. Do ostré databáze jen
jeden zápis IČO na výslovný pokyn (výše). Všechny migrace Fáze 0 (`20261119100000` … `20261123100000` a další z kroků 4–9) čekají.
