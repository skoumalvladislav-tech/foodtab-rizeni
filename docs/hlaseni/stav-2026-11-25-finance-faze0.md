# Stav k 25. 11. 2026 — Finance Fáze 0: co ze zadání ještě chybí a jak to doděláme

Podle zadání `docs/finance-faze0-zadani.md` a celkového návrhu `docs/finance-erp-navrh.md`.
Navazuje na `stav-2026-11-24-finance-faze0.md` (krok 2) a `stav-2026-11-23-finance-faze0.md` (krok 1).

## Nejdřív to podstatné

- **Nic z Fáze 0 není nasazené ani sloučené a `db push` neproběhl, ani nasucho.** Všechno je ve větvi
  `finance-faze0`. Nasadí se najednou na konci, jen na pokyn majitele.
- **Kroky 0, 1 a 2 jsou hotové.** Krok 3 je naprogramovaný a právě prochází posledními koly kontroly.
- **Kroky 4–9 ještě nezačaly.** Od dneška běží souběžně ve třech větvích (viz „Jak to doděláme").
- **Část zadání nejde splnit bez majitele nebo bez někoho dalšího** (banka, účetní, soubory faktur,
  rozhodnutí). Seznam je v oddíle „Co čeká na Šéfíka". Bez toho budou kroky v kódu hotové, ale některé
  věci zůstanou prázdné, například suchý běh úklidu bez pohybů z banky.

## Kroky Fáze 0

| Krok | Co chce zadání | Stav | Co chybí |
|---|---|---|---|
| 0 | Audit ve správné větvi | ✅ hotovo, PR #183 | PR #183 čeká na přečtení a sloučení majitelem |
| 1 | Neutrální bankovní vrstva, import výpisu, konektor Komerční banky | ✅ hotovo ve větvi (`dd799c4` … `21d7f5b`) | Opravdové stažení z banky se nezkoušelo: účet nemá pohyby a bylo to zakázané. Napojení KB čeká na registraci u KB (otázka 96). Skutečný formát výpisu KB jsme nehádali, chybí vzorek (otázky 95, 112). |
| 2 | Párování plateb s fakturami, fronty Návrhy párování a Platby bez faktury | ✅ hotovo ve větvi (`6550932` … `9a9735d`) | Otázku 148 (vymyšlený výpis „zaplatí" fakturu) je potřeba rozhodnout před nasazením. Obrazovky nikdo neviděl vykreslené. |
| 3 | Každá pobočka má účet, a když ne, Finance to řeknou | 🔄 naprogramováno (`3360900` …), běží poslední kola kontroly | Účty ostrých poboček nikdo nepřiřadil. Majitel musí říct, který účet patří které pobočce (otázky 98, 114). |
| 4 | Právo „Schvalovat nákupy a platby" s limitem částky a omezením na pobočku, majitel ho má vždy | ⏳ od 25. 11. v práci | Celé. Udělá se buď celé, nebo vůbec. Otázka 99: kdo právo dostane při zavedení. |
| 5 | Kategorie nákladů (jídlo / nápoj / ostatní), výchozí kategorie dodavatele, AI jen navrhuje | ⏳ od 25. 11. v práci | Celé. Osnovu kategorií dodá účetní (otázka 100), do té doby základní sada. |
| 6 | Jeden registr dodavatelů podle IČO, sloučení jen jako návrh, jde vrátit | ⏳ po kroku 5 | Celé. Otázky 103 a 110 (vlastní IČO firmy se liší od toho, které má audit). |
| 7 | 217 možných duplicit vedle sebe, nic se nemaže | ⏳ po kroku 6 | Celé |
| 8 | Fronta 542 faktur „ke kontrole" znovu přes AI | ⏳ po kroku 7 | Jde jen připravit a ukázat odhad ceny. Těch 542 faktur nemá soubor ve Foodtabu, jen odkaz na OneDrive (otázka 101). Vzorek 20 i celá dávka se spustí až po schválení majitelem. |
| 9 | Suchý běh úklidu starých faktur (co banka potvrzuje jako zaplacené) | ⏳ od 25. 11. v práci | V bance je dnes 0 pohybů. Suchý běh bude mít smysl až po nahrání výpisu nebo napojení banky. |

## Zkoušky ze zadání (oddíl 5)

- **Hotové v testovací databázi (PGlite):**
  - 1: dvojí import nevytvoří druhý pohyb;
  - 2: jisté párování / návrh;
  - 3: platba za víc faktur a faktura po částech na haléř;
  - 4: stav faktury z párování;
  - 6: pobočka nevidí cizí účty.
- **PGlite neověří RLS ani sloupcové granty.** Rozhodne workflow Databáze proti PostgreSQL 16, a to
  poběží až s PR větve `finance-faze0`.
- **Chybí:**
  - 5: právo schvalovat (krok 4);
  - 7: sloučení dodavatelů (krok 6);
  - 8: faktury bez čísla nejsou duplicita (krok 7);
  - 9: AI se špatným součtem nejde do schválených (krok 8);
  - 10: suchý běh nic nezmění (krok 9);
  - 11: migrace na kopii ostrých dat. Kopie ostrých dat k dispozici není (otázka 109). Krok 9 připraví
    přesný postup a čtecí dotazy, spustit to musí majitel, případně se jeho svolením někdo nad zálohou
    nebo větví databáze v Supabase.

## Jak to doděláme (od 25. 11.)

Majitel chce rozpracovat víc věcí najednou. Kroky na sobě ale částečně stavějí, takže běží ve třech
souběžných pruzích, každý ve vlastní větvi a pracovní kopii:

| Pruh | Kroky | Větev | Proč takhle |
|---|---|---|---|
| A | 4 (práva) | `finance-faze0-k4` | Zásah do oprávnění. Celý, nebo nic: když nebude celý, větev se prostě nesloučí. |
| B | 5 → 6 → 7 → 8 | `finance-faze0-k5678` | Na sobě závislé: registr dodavatelů (6) potřebuje normalizaci názvů z kategorií (5), duplicity (7) potřebují registr, nové čtení (8) pravidlo duplicit. |
| C | 9 (suchý běh, podklad ke zkoušce 11) | `finance-faze0-k9` | Potřebuje jen párování z kroku 2. |

- Každý krok prochází stejným postupem jako kroky 1–3: implementace, dvě nezávislé kontroly
  (bezpečnost, správnost), oprava, kontrola oprav s ověřením každého nálezu, dooprava a ještě jedno kolo.
- Kde kroky 7–9 potřebují právo z kroku 4, použijí dočasně „jen majitel" a místo se označí. Po sloučení
  se přepne na nové právo.
- Na konci se větve slijí do `finance-faze0` v pořadí 3 → A → B → C. Po každém sloučení poběží celý řetěz
  scénářů a celé sloučení ještě projde nezávislou kontrolou. Hlavní riziko je, že dva kroky upraví tutéž
  databázovou funkci. Proto každý krok vypíše, co přepsal, a sloučení se kontroluje podle toho.
- **Strop souběhu je počítač:** 4 jádra a volných jen kolem 0,8 GB paměti (běží další aplikace a relace).
  Souběžně proto pracují nejvýš 2–3 části, a databázové testy (PGlite) a kontrola typů se pouštějí přes
  zámek jen jeden po druhém. Když na počítači zavřete jiné aplikace (Word, další okna Chrome a Codex), půjde
  to rychleji.

## Co čeká na Šéfíka (jinak se „všechno" splnit nedá)

1. **Rozhodnutí v otázkách** (`docs/hlaseni/otazky.md`). Nejdůležitější:
   - 98 a 114: který účet patří které pobočce;
   - 110: vlastní IČO firmy;
   - 117: pořadí nasazení;
   - 148: rozhodnout před nasazením;
   - 99: kdo dostane právo schvalovat;
   - 100: osnova kategorií od účetní;
   - 103: jedno IČO = jeden dodavatel.

   Kroky 1–3 přidaly otázky 112–156.
2. **Komerční banka:** registrace přímého napojení (otázka 96) a vzorek exportu výpisu (otázky 95, 112).
3. **Soubory 542 faktur** z OneDrivu, pokud je má krok 8 znovu přečíst (otázka 101).
4. **Účetní:** osnova kategorií (otázka 100) a pro Fázi 1 koeficient odvodů (otázka 108).
5. **Zkouška 11:** souhlas a přístup k záloze nebo větvi databáze (otázka 109).
6. **Na konci:** přečíst PR #183, otevřít PR větve `finance-faze0` (s testy na GitHubu), proklikat nové
   obrazovky (nikdo je neviděl vykreslené) a pak dát pokyn ke sloučení a `db push`.

## Co zadání záměrně odkládá (Fáze 1–4, teď se nedělá)

- Řídicí panel s prime costem.
- Kalendář plateb s dávkou do banky (ABO / SEPA).
- Cashflow z reálného zůstatku.
- Náklady práce s koeficientem odvodů.
- Foodcost z dat Dotykačky a sledování zdražování.
- Výsledovka s exportem ISDOC.
- AI analytik.
- Další bankovní konektory.

Zadání to výslovně zakazuje (oddíl 4: „Žádný dashboard ani Fázi 1+").

## Otázky

Jsou v `docs/hlaseni/otazky.md`, čísla 94–150. Otázky 151–156 z kroku 3 tam přibudou po jeho uzavření. Další
kroky dostaly vlastní rozsahy čísel, ať se při souběhu nepotkají:

| Krok | Rozsah otázek |
|---|---|
| 4 | 161–179 |
| 5 | 180–199 |
| 6 | 200–219 |
| 7 | 220–239 |
| 8 | 240–259 |
| 9 | 260–279 |

## Na co jsem narazil a nešlo to

- **Relace s Financemi se 25. 11. dvakrát přerušila.**
  - Poprvé v 8:11 během kontroly kroku 3. Kontrola se sama rozběhla znovu.
  - Podruhé v 11:53 uprostřed doopravy. Ta nechala necommitnuté změny. Zálohoval jsem je a doopravu jsem
    pustil znovu tak, aby na ně navázala a nic nezahodila. Hotová implementace se znovu nespouštěla.
- **Plný souběh všech šesti kroků najednou nejde.** Kroky 5–8 na sobě stavějí a počítač má málo paměti.
  Proto tři pruhy, ne šest.

## Kde jsem skončil a co zbývá

- Krok 3: běží poslední kola kontroly. Po nich ho sám ověřím (vlastní běh scénářů a schválná rozbití)
  a zapíšu otázky 151 a další.
- Pruhy A, B a C: rozjíždějí se 25. 11. večer.
- Potom: sloučení pruhů, celý řetěz, kontrola sloučení, hlášení, PR větve `finance-faze0` (bez sloučení).

## Nenasazoval jsem

Žádný `db push`, žádné sloučení do `main`, žádná změna ostrých dat.
