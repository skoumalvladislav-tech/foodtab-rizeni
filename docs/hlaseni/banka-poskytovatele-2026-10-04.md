# Výběr poskytovatele pro bankovní modul — 4. 10. 2026

Zadání (`docs/bankovni-modul-zadani-2026-10-04.md`, oddíl 2) žádá
posoudit **Finbricks MULTIBANK** a **Enable Banking**, zapsat výběr
s doloženými fakty a neznámými údaji, nevymýšlet ceny ani pokrytí.
Tenhle zápis je ten doklad. Tři agregátory prošly výzkumem (živé
dotazy na jejich vlastní dokumentaci, ne jen marketing): **GoCardless
Bank Account Data**, **Finbricks MULTIBANK**, **Enable Banking**.

## Shrnutí — co appka staví

| Poskytovatel | Role | Stav v tomhle commitu |
|---|---|---|
| **Fio banka** (přímý adaptér) | Jediná banka s vlastním read-only tokenem bez licence navíc | **Plně funkční** (`lib/integrace-fio.ts`) |
| **Enable Banking** (multibank agregátor) | KB/ČSOB/ČS/Raiffeisenbank | **Kostra**, self-serve sandbox dostupný bez smlouvy |
| GoCardless Bank Account Data | — | Nezařazeno dál — nové registrace zastavené od 7/2025 |
| Finbricks MULTIBANK | — | Nezařazeno dál — jen přes obchodní jednání, žádný self-serve |

## GoCardless Bank Account Data — DŮVOD VYŘAZENÍ

Od července 2025 **zastavil samoobslužné registrace nových účtů**
(`bankaccountdata.gocardless.com/new-signups-disabled`, přímo
ověřeno). Nový zákazník se dnes dostane jen přes obchodní jednání.
Existující účty dál běží, ale appka žádný nemá a nemůže si ho
založit sama (zakládání účtů u třetí strany je mimo to, co appka
dělá bez výslovného svolení a bez reálných firemních údajů).

## Finbricks MULTIBANK — DŮVOD VYŘAZENÍ (pro tenhle krok)

**Ověřeno (živě, docs.finbricks.com + český obchodní rejstřík):**
Finbricks, s.r.o. (IČO 10669205) je dceřinou společností KB
SmartSolutions (fintech ramene Komerční banky), od 3/2025 vedená
v rejstříku ČNB jako platební instituce s oprávněním i pro službu
informování o platebním účtu (AIS). Produkt MULTIBANK pokrývá KB,
ČS, Fio, MONETA, Raiffeisenbank, UniCredit CZ, Creditas (ČSOB a
UniCredit CZ chybí appce stabilní `fbxReference` — appka by u nich
nedostala spolehlivé externí id transakce pro dedup).

**Proč appka nestaví kostru proti němu TEĎ:** podle jejich vlastní
dokumentace (`docs.finbricks.com`, „Get Started") **neexistuje
samoobslužný přístup ani sandbox bez podepsané smlouvy** — čtyři
kroky: kontaktní formulář → obchodní hovor do druhého pracovního dne
→ podpis PŘED-smlouvy → až POTOM sandbox, a ten sandbox navíc běží
proti REÁLNÉMU produkčnímu bankovnímu API (plateb příkazy omezené na
1 Kč, ne mock prostředí). Appka by si bez Šéfíkova přímého obchodního
kroku nemohla ani vyzkoušet, jestli kód funguje.

**Kdy se vrátit k Finbricks:** až bude chtít Šéfík řešit banky, které
Enable Banking nepodporuje (Fio má appka přímo, takže hlavní zbylá
mezera je MONETA) — nebo pokrytí šíří přes Enable Banking samotný.
Vyžaduje obchodní hovor, ne engineering krok.

## Enable Banking — DŮVOD VOLBY

**Ověřeno (živě, enablebanking.com/docs/*):**
- **Licence**: Enable Banking Oy (Finsko, IČO 2988499-7), registrovaný
  AISP u finského FIN-FSA — PSD2 passporting umožňuje službu v ČR bez
  toho, aby appka potřebovala vlastní licenci u ČNB.
- **České banky** (`enablebanking.com/docs/markets/cz`, přímo
  ověřeno): **Česká spořitelna, ČSOB, Komerční banka, Raiffeisenbank**
  — ano. **MONETA Money Bank a Fio banka — výslovně NE** („not yet
  supported"). Fio appka řeší přímým adaptérem, takže tahle mezera
  nevadí; MONETA zůstává nepokrytá (zapsáno jako mezera níž).
- **Samoobslužný přístup**: `enablebanking.com/sign-in` → kontrolní
  panel → sandbox ZDARMA, bez smlouvy, bez obchodního hovoru. Navíc
  existuje „Restricted Production" — reálné bankovní připojení,
  zdarma, bez smlouvy, omezené na účty/IBANy, které si appka sama
  vyjmenuje (typicky vlastní testovací účet). **Tohle je jediný ze
  tří poskytovatelů, u kterého by šlo kód reálně vyzkoušet bez
  podpisu čehokoli** — zbývá jen založit si kontrolní panel (krok
  pro Šéfíka, appka účty třetích stran nezakládá sama).
- **Technický tvar**: appka se nepřihlašuje OAuth client-credentials,
  ale podepisuje si vlastní JWT (RS256, soukromý klíč appka sama
  vygeneruje a zaregistruje). Zůstatky chodí v ISO 20022 kódech
  (`CLBD`/`CLAV`/`ITBD`/`ITAV` — knihovní/disponibilní, uzávěrkový/
  mezitímní), transakce nesou `credit_debit_indicator`
  (`CRDT`/`DBDT`) a stav `BOOK` pro zaúčtované.
- **Souhlas**: appka si nesmí vymýšlet pevný počet dnů — Enable
  Banking vrací `maximum_consent_validity` PODLE KAŽDÉ BANKY
  („pro většinu bank 180 dní", ne 90 — oprava vlastní domněnky, ČR
  banky nejedou podle britské 730denní výjimky, ta je jen pro FCA).
- **Limit**: žádný číselný limit od Enable Banking samotného — limit
  dává KAŽDÁ BANKA (typicky 4 dotazy/den bez aktivního uživatele),
  appka ho tedy nesmí předpokládat napevno a musí číst `429
  ASPSP_RATE_LIMIT_EXCEEDED`.
- **Node/TS SDK**: žádný, appka volá REST přímo (JWT podpis přes
  `jose`/`jsonwebtoken`, běžná knihovna, žádná závislost na
  Enable Banking balíčku).

## Co appka dělá s touhle volbou

`lib/integrace-enablebanking.ts` — KOSTRA (žádný `ENABLEBANKING_*`
klíč v tomhle prostředí, appka proto nikdy nezkouší zavolat ven,
stav zůstává `nepripojeno`). Kontrakt (`lib/bank-provider-contract.ts`,
`BankDataProvider`) je stejný pro Fio, Enable Banking i CSV import —
přidání dalšího poskytovatele (třeba Finbricks, až bude obchodně
dostupný) nebude vyžadovat změnu párování ani cashflow.

## Neznámé, které appka nedoložila (zapsáno, ne vymyšleno)

- Finbricks: přesný tvar odpovědi `/account/transactions` (pending
  vs. booked, VS/KS/SS na příchozí platbě) — ReDoc schéma nešlo
  rozbalit bez přihlášení.
- Enable Banking: přesný kód pro „nevypořádanou" (pending) transakci
  nebyl v dokumentaci jednoznačně dohledaný (jen `BOOK` pro
  zaúčtované je jistý).
- Enable Banking: „Restricted Production" mechanika ověřena jen
  nepřímo (souhrn vyhledávání, ne přímo načtená stránka) — než se na
  ní bude stavět reálné připojení, ověřit přímo v kontrolním panelu.
- Ani jeden poskytovatel nepublikuje ceník — oba řeší poptávkou.

## Krok pro Šéfíka (ne pro appku)

1. Založit si kontrolní panel na `enablebanking.com/sign-in`
   (e-mail, zdarma, bez smlouvy) — appka tohle krok nesmí udělat
   za Šéfíka (založení účtu u třetí strany).
2. V kontrolním panelu vytvořit API aplikaci (sandbox), stáhnout
   soukromý klíč, zapsat `ENABLEBANKING_APPLICATION_ID` a
   `ENABLEBANKING_PRIVATE_KEY` do prostředí appky.
3. Volitelně ověřit „Restricted Production" mechaniku přímo
   v kontrolním panelu — appka tenhle krok nedoložila líp než
   nepřímo.
