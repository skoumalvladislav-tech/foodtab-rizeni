# Stav k 23. 11. 2026 — Finance Fáze 0: audit a krok 1 (bankovní vrstva) hotové, kroky 2–9 začínají

> **Doplněno 24. 11.:** krok 2 je hotový, viz `stav-2026-11-24-finance-faze0.md`. Věty níž o tom, že
> kroky 2–9 nezačaly, platily k 23. 11. `krok64` 24. 11. už nepadá.

## Nejdřív to podstatné

- **Nic jsem nenasazoval ani nesloučil a `db push` neproběhl, ani nasucho.** Na ostrá data jsem sahal jen
  čtecími dotazy. Větev `finance-faze0` je na GitHubu jen jako záloha. Nemá PR, takže na ni neběží žádné
  testy na GitHubu.
- **Krok 0 (audit) je hotový** v PR #183. Jsou v něm jen dokumenty a otázky 94–109.
- **Krok 1 (bankovní vrstva bez jmen bank) je hotový v kódu a prošel čtyřmi koly nezávislé kontroly.**
  - Druhá kontrola našla, že hlídání „téže platby z výpisu i z napojení banky“ umělo v krajním případě
    **pohyb z banky zahodit**. To je horší než dvojí zápis, proto jsem pravidlo postavil znovu. Táž platba
    se teď pozná podle obsahu a pohyb, který pošle banka, se nikdy nezahodí: buď se zapíše, nebo spáruje
    s už nahraným výpisem.
  - Třetí a čtvrtá kontrola našly slabiny u storna (opravného řádku):
    - stornovaný řádek se s dalším výpisem vracel;
    - storno šlo zapsat i na pohyb cizí firmy;
    - služba mohla mazat potvrzení od banky.

    Všechno je opravené. Poslední kolo kontroly už nic nenašlo.
- **Kroky 2–9 ještě nezačaly.** Krok 1 zabral mnohem víc, než jsem čekal: čtyři kola kontroly
  a několikrát přerušená relace. Postup pro kroky 2–9 je připravený a pouštím ho hned po tomhle hlášení.
- **Dvě zjištění z ostré databáze:**
  - firma má v nastavení jiné IČO než 21249946, které audit bral za vlastní (otázka 110);
  - 284 faktur nemá vyplněnou měnu (otázka 111).
- **V ostré databázi zatím není žádný pohyb z banky.** Pohyby, dávky importu, zůstatky i párování jsou
  prázdné a je tam jeden účet bez pobočky. Migrace kroku 1 tedy při nasazení žádná data nezmění.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| Zadání a návrh Fáze 0 | `0d9f52d` | ne (dokumenty) |
| Audit kroku 0 (PR #183, otázky 94–109) | `fd698aa`, `3666422`, `750a33a` | ne (dokumenty) |
| Krok 1, databáze: jeden zdroj „banka přes napojení“ bez jmen bank, číslo protiúčtu zvlášť, import výpisu najednou (celý, nebo nic), účet patří pobočce, přístupové údaje k bance jen přes server | `dd799c4` | **ano**, migrace `20261119100000` (spolu s aplikací, otázka 117) |
| Krok 1, aplikace: `lib/banka/*` (jediné místo se jmény bank, převod čísla účtu na IBAN, import CSV v kódování windows-1250), stahování všech bank jednou cestou, kontrola čísla účtu ve formuláři | `4abaebb`, `6ca8073`, `609f200`, `322580c`, `b68cc14` | ano (s migrací) |
| Opravy po 1. kontrole (13 nálezů) | `6f5ee96`, `880b9b5` | ano |
| Opravy po 2. kontrole: táž platba z výpisu i z banky bez ztráty pohybu, ohlášený nezapsaný první zůstatek, protiúčet ve všech výčtech | `6ff8e49`, `76e8c60`, `4ef4887`, `256758f`, `9903733`, `ea08d91` | ano |
| Opravy po 3. kontrole: storno drží proti dalšímu výpisu, storno jen na pohyb téže firmy a účtu, služba nesmí mazat potvrzení od banky | `ebe3120` | ano |
| Opravy po 4. kontrole: storno pohybu z banky drží i proti stažení bez čísla pohybu, další kontroly | `21d7f5b` | ano |
| Otázky 110–123, pak 120 přepsaná a nové 124–126 | `f4312ec`, `33bb526` | — |

## Čísla — a z čeho jsou

**Databáze (PGlite, poslední stav `21d7f5b`):**
- Celý řetěz scénářů: **4 693 prošlých kontrol**. Ze 124 scénářů spadly 2, oba z příčin, které s krokem 1
  nesouvisejí:
  - `krok101`: známá chyba testovacího nástroje (neumí `\set` v uvozovkách);
  - `krok64`: srážka dat, viz „Na co jsem narazil“. Padá stejně i na `main`.
- Scénář kroku 1 (`krok111`) má teď 151 kontrol. Spolu s `etapa0` je to 190 a sám jsem je po poslední
  opravě pustil znovu: 190 z 190.
- **PGlite neověří RLS ani sloupcové granty.** Běží jako superuživatel a nemá výchozí práva Supabase.
  Rozhoduje workflow Databáze proti PostgreSQL 16, a to poběží, až bude PR.

**Aplikace:**
- Node testy pro Finance, Faktury, Jiné platby, pokladnu, banky a oprávnění: 46 z 46 souborů prošlo.
  Testy stahování z bank běží s `--conditions=react-server`, bez klíče k modelu.
- `npx tsc --noEmit`: 0 chyb.
- Kontrolu oprávnění (`scripts/provoz-granty.test.mjs`) jsem po poslední opravě pustil sám: prošla.

**Schválná rozbití:** každou novou kontrolu jsem schválně rozbil a ověřil, že spadne jménem.
- 1. kolo (20. 11.): 4 z 33 rozbití databáze nepojmenovala kontrolu. Scénář spadl syrovou chybou
  uprostřed přípravy a změna čtecí politiky účtů dokonce prošla. Opravené v `322580c` a `b68cc14`.
- Oprava po 2. kontrole: 77 z 77 spadlo jménem (56 databázových, 5 v kódu aplikace, 16 u hlášek
  a výčtů sloupců).
- Oprava po 3. kontrole: 9 z 9.
- Oprava po 4. kontrole: 6 z 6. Jedno z nich (vrácení podmínky do předchozího stavu) jsem zopakoval
  sám: spadla přesně kontrola „storno pohybu ze stažení bez id, pak totéž stažení bez id: pohyb se
  nevrátí“.

**Ostrá databáze (čtecí dotazy 20. 11.):**
- Finance: pohyby 0, dávky importu 0, zůstatky 0, párování 0, platební účty 1 (bez pobočky, bez čísla).
- Připojení: rezervace 7, e-mail dokladů 3, pokladna 2, banka 1 (bez účtu).
- Faktury: 2 848 v Kč, 284 bez měny. Vlastní IČO v nastavení ≠ 21249946. 13 IČO má víc názvů dodavatele
  (466 faktur).

## Co čeká na Šéfíka

1. Projít otázky 110–126. Nejdůležitější jsou:
   - 110: vlastní IČO;
   - 113: zápis plateb pobočkou;
   - 117: pořadí nasazení;
   - 124: výpis a napojení banky píšou platbu jinak (Salt Edge a Enable Banking);
   - 126: služba smí mazat pět starších tabulek. Je to dřívější stav, mimo Fázi 0.
2. Přečíst PR #183 (audit) a případně ho sloučit.
3. Krok 1 nenasazovat bez aplikace (otázka 117). Celá Fáze 0 se bude stejně slučovat a nasazovat najednou,
   až budou hotové všechny kroky.

## Otázky

Jsou v `docs/hlaseni/otazky.md`, čísla 110–126. Otázku 120 jsem 23. 11. přepsal, protože po druhé
kontrole se změnilo, jak se táž platba pozná.

## Na co jsem narazil a nešlo to

- **Oprava po první kontrole zavedla novou, horší chybu** (zahození pohybu z banky). Chytila ji až druhá
  nezávislá kontrola samotných oprav. Proto teď má každý krok povinně i kontrolu oprav, a když opravy
  něco změní, ještě jedno kolo.
- **`krok64` (směny) dnes, 23. 11. 2026, padá i na `main`.** Scénář `krok39` zakládá směnu „za 20 dní“
  a to dnes vychází přesně na pevné datum 13. 12. 2026, se kterým počítá `krok64`. S Financemi to nesouvisí
  a do modulu směn jsem nesahal. Zítra by to padat nemělo. Opravit by se to mělo pevným datem v `krok39`
  (pro relaci, která má na starosti směny).
- **Skutečné stažení z Fio, KB ani Salt Edge proti bance jsem nepouštěl.** Bylo to zakázané a účet stejně
  není. Ověřené je to jen testy nad podstrčenými daty.
- Převod starých pohybů jsem nad kopií ostrých dat nezkoušel (otázka 109). V ostré databázi ale žádné
  pohyby nejsou.
- **Paměť počítače:** volných bylo jen kolem 0,6–1 GB (běží další relace, Word, Chrome). Kontroly
  a testy proto jedou jedna po druhé a trvá to déle.
- Relace se během práce několikrát přerušila. Rozpracovaný krok 1 je proto ve víc commitech
  (`4abaebb` je rozpracovaný mezistav) a dvě kola kontroly jsem musel navázat ručně.

## Kde jsem skončil a co zbývá

- **Krok 1 je uzavřený** commitem `21d7f5b` a otázkami v `33bb526`. Větev je pushnutá.
- **Další je krok 2.** Normalizace čísla účtu v databázi musí dávat totéž co `lib/banka`. „Důvěryhodný
  pohyb“ pro automatické párování bude pohyb z banky NEBO řádek výpisu, který banka potvrdila. Pak
  následují kroky 3–9 podle `docs/finance-faze0-zadani.md`.
- Na konci: hlášení, push, PR větve `finance-faze0` (bez sloučení).

## Nenasazoval jsem

Žádný `db push`, žádné sloučení, žádná změna ostrých dat.
