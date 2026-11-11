# Stav k 11. 11. 2026 — příjem faktur z e-mailu: proč stál a oprava

## Nejdřív to podstatné

- **Příjem z e-mailu běží, ale přes tisíc faktur se ztratilo v ruční
  kontrole.** Úloha čte všechny tři schránky každých 30 minut a AI od
  ~28. 10. zase čte. Jenže **9.–25. 10. AI nešla** — nejdřív u
  Anthropicu došel kredit (9.–13. 10.), pak neplatil klíč (14.–25. 10.).
  Kód tohle bral jako **vadu každého dokladu zvlášť** a každou přílohu
  odložil do „ruční kontroly“, odkud se už nikdy sama nevrátí:
  **1 017 příloh** (údaj z produkce 10. 11.). Úloha i hlídač přitom
  hlásily „v pořádku“ — nikdo se to nedozvěděl.
- **Druhý důvod, proč „faktury nejsou ve Fakturách“: 43 hotových návrhů
  čeká na kliknutí.** Obě schránky Černé Perly jsou v režimu „Jen
  návrhy“ (nejstarší návrh z 18. 10.). Přečtené jsou, do Faktur je pustí
  až „Zapsat návrhy do Faktur“. Rovnou zapisuje jen schránka FoodTabu.
- **Hotovo v PR #181 (nesloučená, bez migrace):**
  1. **Výpadek účtu AI už nikdy nepošle doklad do ruční kontroly.**
     Neplatný klíč, došlý kredit, chybějící oprávnění, limit útraty,
     zablokovaná organizace i vyřazený model: příloha počká ve frontě
     (pokus se nepočítá, do denního stropu se nezapočítá) a přečte se
     sama, až se účet spraví. AI se v takovém běhu zkusí jen jednou.
  2. **Poplach.** Když AI nejde, workflow „Faktury — příjem z e-mailu“
     na GitHubu **skončí červeně** a GitHub pošle e-mail; důvod je
     u schránky ve Finance → Integrace → E-mail (otázka 93).
  3. **Pojistka na chybu, kterou nikdo nepředvídal.** Když AI odmítne
     dvě přílohy za sebou **úplně stejnou chybou** (typicky změna na
     straně Anthropicu), zastaví se a hlásí poplach — místo aby
     vysypala celou frontu do ruční kontroly.
  4. **Tlačítko „Přečíst znovu (N)“** u každé schránky vrátí do fronty
     přílohy, které nepřečetl výpadek AI nebo nepovedený zápis do Faktur
     (otázka 92). PDF s heslem, moc velké přílohy a ISDOCX zůstanou.
     **Faktura z vrácené přílohy jde do Faktur vždy ke schválení**
     s poznámkou „ověřte, že ji mezitím nikdo nezadal ručně“ — ležela
     tam týdny a někdo ji mohl zadat ručně; dvojí platbě musí zabránit
     člověk.
  5. Drobnosti: po nepovedeném zápisu do Faktur se zapisuje už přečtený
     doklad (AI se neplatí znovu), nové e-maily mají ve frontě přednost
     před starými, a příloha, jejíž běh platforma zabila při posledním
     pokusu, už nevisí navždy jako „čeká“.
- **Je potřeba jen „sluč 181“** — žádná migrace, žádný `db push`. Pak
  ale **tři kroky v aplikaci** (níž v „Co čeká na Šéfíka“), jinak se
  1 017 starých příloh samo nevrátí.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| Chyba účtu AI = počkat, ne ruční kontrola; poplach `ai_nedostupne` → červený workflow; „Přečíst znovu“; fronta od nejnovějších; AI test v CI | `e6fe808` | ne (bez migrace) |
| Test: cizí firma u „Přečíst znovu“ i s otevřenou bránou Faktur | `29e3f19` | ne |
| Opravy po nezávislé kontrole: 404 / zablokovaná organizace = účet, holé „billing“ už ne, pojistka „stejné odmítnutí dvakrát“, vrácené ke schválení, přečtený doklad se nečte znovu, vrácení nenuluje denní strop, důvod AI u schránky má přednost, zaseknuté „chyba“ se vrátí | `e4f9ceb` | ne |
| Věta u „Přečíst znovu“: faktury přijdou ke schválení | `d207f31` | ne |
| Otázky 92 a 93, toto hlášení | `e4f9ceb` a commit s tímto hlášením | — |

## Čísla — a z čeho jsou

**Produkce (jen čtecí dotazy, se svolením „povoluji čtecí dotazy“, 10. 11.):**

- V ruční kontrole **1 017 příloh, které AI nikdy nepřečetla** — všechny
  mají uložený soubor:
  - 918 × „došel kredit“ (zpracováno 9.–13. 10.; 710 PDF, 208 fotek),
  - 93 × „klíč k AI neplatí“ (14.–25. 10.),
  - 6 × ISDOC, „zápis do Faktur se nepodařil“ (9. 10., stará databáze
    Faktur odmítla sloupec — dnes jsou Faktury jinde).
- Podle měsíce, kdy e-mail přišel: leden 34, únor 50, březen 47,
  duben 13, květen 31, červen 30, červenec 125, srpen 168, září 297,
  říjen 216 (bez 6 ISDOC). Většina je tedy dočet „od 1. 1. 2026“.
- Zbytek ruční kontroly jsou skutečně problémové přílohy, ty zůstanou:
  9 × ISDOCX (zabalené ISDOC), 3 × příloha nad 10 MB, 1 × PDF s heslem.
- Návrhy čekající na potvrzení: **43** (obě schránky Černé Perly,
  nejstarší z 18. 10.).
- Úloha hlásila 31× „vyčerpaný denní strop AI“ (naposledy 10. 10.) —
  strop sežraly právě ty neúspěšné pokusy s došlým kreditem (918 za
  necelé 4 dny ≈ 300 denně). Oprava je už nepočítá.
- Schránky Černé Perly občas nejdou otevřít (`ETIMEDOUT`, 10. 11. ve
  13 ze 47 běhů). Neztrácí se tím nic — další běh dočte.
- Teď (10. 11.) ve frontě nic nečeká a AI dnes přečetla 17 dokladů.

**Testy (Node 24, bez sítě a bez databáze):**

- `scripts/faktury-prijem-ai.test.mjs`: **93 kontrol OK** (řádky „OK“;
  chyby API přes skutečné SDK s podvrženou odpovědí — kódy a texty, které
  API 9.–25. 10. opravdu vracelo).
- `scripts/faktury-prijem-jadro.test.mjs`: **153 OK** (celý běh nad
  podvrženým světem v paměti: schránka, evidence, úložiště, Faktury, AI).
- `scripts/faktury-prijem-fronta.test.mjs` (nový): **21 OK** — skutečný
  `lib/faktury-prijem-sync.ts` nad podvrženým klientem databáze (stránky
  po 1000, dávky po 100, filtry schránky a stavu, co přesně vrácení mění).
- `scripts/planovac.test.mjs`: **251 OK** (pouští i skutečný bash
  z workflow s podvrženým `curl`).
- **Celý seznam testů z CI** (`TESTY` v `.github/workflows/aplikace.yml`):
  **104 ze 104 prošlo** (před posledním commitem `d207f31`, který mění
  jen jednu větu na obrazovce; ten prošel `eslint`).
- `npx tsc --noEmit` čisto, `npx eslint` na změněných souborech čisto.
- **Žádná migrace** → scénáře v databázi (PGlite / PostgreSQL) se
  netýkají; RLS ani granty se neměnily.

## Schválná rozbití

**39 rozbití, všech 39 shodilo svou jmenovanou kontrolu** (řádek
`CHYBA` s tím názvem a nenulový návratový kód). Každé se po běhu vrátilo
z gitu, po posledním byla pracovní kopie čistá.

- **20 z prvního kola** (místa upravená po změnách kódu): chyba účtu
  vs. vada dokladu, pokus a útrata u chyby účtu, poplach, kontrola firmy
  (proti jádru i proti skutečnému `sync.ts`), soubor u vrácení, vzory
  textů k vrácení, stránky a dávky, filtr stavu, pořadí fronty, výjimka
  při výpadku, `ai_nedostupne` v odpovědi úlohy, `exit 1` a příznak ve
  workflow.
- **19 nových na opravy po kontrole:** holé „billing“, 404, zablokovaná
  organizace, podpis odmítnutí, pojistka (nepotvrdí / bez odkladu /
  nevyřeší podezřelou / vrátí pokus i první → fronta se zasekne / nevrátí
  pokus druhé), vrácené ke schválení, značka po přechodné chybě, uložený
  doklad po chybě zápisu, přednost důvodu AI, vyčerpané pokusy, fronta
  bez „chyba“, co mění vrácení.
- **Rozbité dvěma cestami:** ke schválení (vypnutá podmínka / značka se
  nepozná podle důvodu), značka vrácení (neuloží se / nečte se z
  výsledku) a vrácení do fronty (vynuluje strop / zahodí doklad) — každá
  cesta shodila kontrolu sama.
- **Co rozbití v 1. kole ukázalo:** kontrola „cizí firma nic nevrátí“
  v testu jádra mlčela (viz níž) — opraveno v `29e3f19`.

## Nezávislá kontrola kódu

Jedno kolo nad commitem první opravy (agent četl kód jen přes git, testy
si pustil ve vlastní rozbalené kopii). **Vážný nález žádný**, 2 střední,
2 středně-nízké a 3 nízké:

| # | Nález | Co s tím |
|---|---|---|
| 1 | Jiné chyby celého účtu (vyřazený model 404, zablokovaná organizace, nový tvar dotazu po změně API) by dál posílaly celou frontu do ruční kontroly — s workflow zeleným, tedy 9.–25. 10. znovu | **opraveno** (`e4f9ceb`): 404 a zablokovaná organizace = chyba účtu; na ostatní pojistka „stejné odmítnutí u dvou příloh za sebou → stop a poplach“ |
| 2 | „Přečíst znovu“ může vytvořit druhou fakturu, kterou mezitím někdo zadal ručně (jiný název dodavatele nebo bez čísla — shoda ji nepozná) → riziko dvojí platby | **opraveno** (`e4f9ceb`): faktura z vrácené přílohy jde vždy ke schválení s poznámkou; značka přežije i další pokusy |
| 3 | Denní strop AI počítá řádky, ne volání: po nepovedeném zápisu se doklad četl (a platil) znovu, a „Přečíst znovu“ strop vynulovalo — každé kliknutí = dalších 300 čtení | **opraveno** (`e4f9ceb`): po chybě zápisu se zapisuje uložený doklad; vrácení mění jen stav, pokusy a důvod |
| 4 | Holé slovo „billing“ v textu chyby se bralo jako došlý kredit — vadný doklad (např. „billing address“) by pak zastavil AI pro celou frontu | **opraveno** (`e4f9ceb`): jen „credit balance“ / „Plans & Billing“ |
| 5 | Když v tomtéž běhu spadla i schránka, u schránky by byl vidět jen důvod schránky, ne AI (workflow přitom odkazuje na důvod u schránky) | **opraveno** (`e4f9ceb`): AI první, schránka za ním |
| 6 | Slabá místa testů: kontrola cizí firmy v testu jádra prošla i bez kontroly (brána Faktur ji odchytila), pořadí fronty se ověřuje jen ze zdrojáku | první **opraveno** (`29e3f19`); pořadí fronty **ponecháno** (skutečný dotaz bez databáze ověřit nejde, viz níž) |
| 7 | Běh z GitHubu, který se potká s během z pg_cron (oba v :09 a :39), dostane „už běží jinde“ a poplach v tom kole nevyhlásí | **ponecháno**, zapsané v otázce 93 — další kolo ho vyhlásí |
| — | Mimo změnu: řádek „chyba“ s vyčerpanými pokusy (běh zabitý při posledním) dřív nikdo nebral — visel jako „čeká“ navždy | **opraveno** (`e4f9ceb`): fronta bere všechny „chyba“, jádro je hned pošle do ruční kontroly |

## Co čeká na Šéfíka

1. **„sluč 181“** (bez `db push`).
2. **Než kliknete „Přečíst znovu“: zkontrolujte kredit u Anthropicu**
   (v konzoli Anthropicu, část Billing; ideálně zapnout automatické
   dobití). Přes tisíc příloh stojí zhruba tolik jako 2–3 měsíce běžného
   příjmu.
3. **U obou schránek Černé Perly** buď přepněte na „Zapisovat rovnou“,
   nebo klikněte **„Zapsat návrhy do Faktur“** (43 čeká). Nejlépe dřív
   než „Přečíst znovu“ — jinak k nim přibudou stovky dalších návrhů.
4. **Ve Finance → Integrace → E-mail klikněte u každé schránky
   „Přečíst znovu (N)“.** Appka je pak čte sama: nejvýš 300 přes AI
   denně, nové e-maily mají přednost — **zabere to zhruba 3–4 dny**.
   Všechny vrácené faktury přijdou **ke schválení**: projděte, jestli
   některou už nemáte zadanou ručně.
5. **Klíč ANTHROPIC_API_KEY na Vercelu** nechte platný — teď funguje.
6. **GitHub:** zapněte si upozornění e-mailem na spadlé Actions
   (Settings → Notifications → Actions), jinak se o červeném workflow
   nedozvíte. E-mail jde jen účtu, který plán workflow založil nebo
   naposledy změnil.
7. Volitelně: zeptat se hostingu schránek Černé Perly na výpadky
   spojení, nebo faktury z nich přeposílat do schránky FoodTabu.
8. Rozhodnout, jestli chcete čtení ISDOCX (9 příloh) — navazující práce.

## Otázky

- **92** — „Přečíst znovu“ je tlačítko, ne samo (přečíst přes tisíc
  příloh stojí peníze); vrácené jdou ke schválení.
- **93** — poplach o nefunkční AI jen přes GitHub (červený workflow),
  ne zvonkem v aplikaci.

Podrobně v `docs/hlaseni/otazky.md`.

## Na co jsem narazil a nešlo to

- **Proti skutečnému Anthropicu ani skutečné faktuře jsem nic
  nezkoušel.** Chyby účtu jsou ověřené přes skutečné SDK s podvrženou
  odpovědí (kódy a texty, které API 9.–25. 10. opravdu vracelo — vzaté
  z produkční evidence), ne voláním API. Že vrácené přílohy AI přečte,
  ukáže až první běh po „Přečíst znovu“.
- **Obrazovku s tlačítkem „Přečíst znovu“ jsem viděl jen nad
  smyšlenými daty** (dočasná stránka mimo git, headless Chrome; snímek
  je v relaci, do repa ho nedávám). Přihlášenou stránku Integrace
  s produkčními daty ne — to se z vývoje nedělá. Na snímku jsem si
  všiml jen chyby v náhledu samotném (špatné klíče počtů), ne v panelu.
- **Test AI v CI dřív neběžel vůbec** (`faktury-prijem-ai` byl ve
  `VYNECHANE`). Teď běží pod čistým Node — bez toho by změna chyb účtu
  neměla v CI žádnou kontrolu.
- **Moje vlastní kontrola cizí firmy mlčela.** První verze testu
  „cizí firma nic nevrátí“ prošla i s vymazanou kontrolou vlastníka
  schránky — cizí firmu odchytila už brána Faktur (podvržená ji
  nepustila). Ukázalo to schválné rozbití; test teď bránu otevře
  a kontrolu vlastníka zkouší samotnou.
- **Pořadí fronty „nejnovější první“ ověřuji jen ze zdrojáku**
  (`.order(…)` v `nactiKeZpracovani`). Skutečné řazení PostgRESTu bez
  databáze ověřit nejde a podvržený klient řadit neumí.
- **Pojistka „stejné odmítnutí dvakrát“ má cenu:** kdyby se změnilo
  něco u Anthropicu, do ruční kontroly i tak spadne zhruba jedna
  příloha za tři běhy (~16 denně, s důvodem od AI, „Přečíst znovu“ ji
  nevrátí) — místo stovek. Workflow je přitom červený, takže se o tom
  ví. Jediná odmítnutá příloha (není s čím srovnat) se zkusí třikrát,
  pak jde do ruční kontroly jako dřív.
- **401 a 403 se berou jako chyba účtu podle kódu**, ne podle textu.
  Kdyby nějaká brána po cestě vrátila 403 kvůli jednomu souboru,
  zastavila by AI — v API Anthropicu to tak nefunguje, ale nevylučuji to.
- **ISDOCX (9 příloh) jsem neřešil** — appka ten formát neumí, je to
  nová funkce, ne oprava. Zůstávají v ruční kontrole.
- **Výpadky spojení se schránkami Černé Perly (`ETIMEDOUT`) jsem
  neřešil** — je to síť mezi Vercelem a jejich hostingem, ne kód; nic se
  tím neztrácí.
- **Otevřené PR #152, #153 a #180** na soubory příjmu faktur nesahají,
  kolize nečekám. Větev je postavená na dnešním `main` (`8f4b16b`).

## Kde jsem skončil a co zbývá

Všechny body zadání jsou hotové v jedné PR, nesloučené: diagnóza
s čísly z produkce, oprava s testy (ověřenými schválným rozbitím),
nezávislá kontrola a opravy po ní, seznam kroků pro Šéfíka.

Navazující věci mimo zadání (nedělal jsem):

- Upozornění zvonkem v aplikaci, když AI nejde (otázka 93) — po vzoru
  výpadku Choice, s migrací.
- Čtení ISDOCX.
- Přílohy, které by pojistka v budoucnu poslala do ruční kontroly,
  „Přečíst znovu“ nevrátí — kdyby se to stalo, šlo by doplnit vzor do
  `DUVODY_K_OPAKOVANI`.

## Nenasazoval jsem

Nic. Nic sloučené, žádný `db push` (ani není potřeba), na AI ani do
schránek jsem se z vývoje nepřipojoval, v produkci jen čtecí dotazy.
