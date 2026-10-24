# Jiné platby: technický návrh (zdroj pravdy pro implementaci)

Zadání: Šéfík 15. 10. 2026, „Finance → Tržby → Jiné platby“. Doslovné
znění je v PR. Tenhle dokument popisuje, **jak** je agenda postavená,
a hlavně **proč**. Kdo kód přebírá, má tady najít, co je zdroj pravdy
a co se nesmí započítat dvakrát.

Pro nevývojáře je návod `docs/jine-platby-navod.md` a přehled
podporovaných operací v pokladně `docs/jine-platby-pos-operace.md`.

---

## 1. Co jsme našli (16. 10. 2026)

| Oblast | Stav před touto prací | Dopad na návrh |
|---|---|---|
| Okno „Ostatní platby“ | Jen prázdná karta „modul se připravuje“ v Tržbách (`app/[rozsah]/finance/trzby/obsah.tsx`). Žádná data ani tabulka. | Kartu přejmenujeme na **Jiné platby** a napojíme. Žádné záznamy k zachování nejsou. |
| Agenda „Ostatní tržby“ | **Neexistuje.** Tržby jsou jen z pokladny (`pokladna_prodeje_denni`). | Vzniká jediná nová evidence `ostatni_trzby`. Viz oddíl 3. |
| Tržby z pokladny | Jen **denní souhrn po názvu produktu**, bez ID účtu. Poslední 3 dny se při každé synchronizaci smažou a zapíší znovu. | Do `pokladna_prodeje_denni` se **nikdy nezapisuje** (synchronizace by řádek smazala, nebo by se tržba sečetla dvakrát). |
| Vydané faktury | **Neexistují.** Modul Faktury umí jen přijaté faktury. Leží v oddělené DB bez `tenant_id`, přes veřejný klíč. | Do DB Faktur se **nic nezapisuje**. Vystavení faktury je blokované rozhodnutím (otázka 51). Hotové je propojení existující faktury a podklady. |
| Právní subjekt | Neexistuje. Firma (`tenants`) = právní subjekt 1:1. | Záznam nese `tenant_id` (= klient i právní subjekt) a `branch_id`. |
| Sklad | Rozhodnutí 2. 10. 2026: sklad a inventury dělá pokladna. Appka nemá skladové karty ani pohyby. | Appka eviduje jen **návrh výdeje, schválení a stav operace v pokladně**. Žádná zásoba, žádná karta. |
| Dotykačka API | Appka čte jen provozovny a denní report. Dokumentace (docs.api.dotypos.com, verze 2026.38.1) popisuje i katalog, účty, sklady a „POS akce“. | Rozšiřujeme kontrakt o nepovinné schopnosti. Zápis do skladu je připravený, ale **vypnutý** (oddíl 7). |
| Oprávnění na pobočku | Rozsah je vlastnost **členství**, ne jednotlivého práva (`app.has_access`). | „Potvrdit výdej do POS“ je právo, které platí na pobočkách členství. Jemnější přidělení by byl druhý model práv (otázka 52). |
| Vstup do Financí na pobočce | Jen s `finance.read` za celou firmu (otázka 48). Obsluha ho nemá a mít nemá. | Agenda má vlastní vstupní kontrolu `zkusPristupJinymPlatbam` (oddíl 6). |

---

## 2. Odpovědi na otázku „co je zdroj pravdy“

| Údaj | Zdroj pravdy | Co se s tím NESMÍ stát |
|---|---|---|
| Tržba z pokladny | `pokladna_prodeje_denni` (synchronizace) | Jiné platby do ní nepíšou. |
| Tržba mimo pokladnu | `ostatni_trzby` s `zapocitat = true` | Nesmí vzniknout, když stejný prodej už je v pokladně. |
| Prodej, který už v pokladně je | `ostatni_trzby` s `zapocitat = false` a `pos_prodej_id` | Jen se propojí a ukáže. Do součtu se nepřičte. |
| Doklad a jeho položky | `jine_platby` + `jine_platby_polozky` + originály v `jine_platby_soubory` | Výsledek AI se neukládá jako hotová pravda. Je to návrh, který člověk potvrdí. |
| Co přečetla AI | `jine_platby_rozpoznani` (jen přidávat, nikdy neměnit) | Opravy člověka jdou do položek a do historie. Původní výsledek AI zůstává. |
| Skladový výdej | Pokladna. Appka má jen `jine_platby_skladove_navrhy` (návrh + schválení) a `pos_operace` (sledovaný krok) | Appka nikdy nepočítá zásobu. „Odečteno v POS“ jen po ověřeném úspěchu. |
| Faktura | Systém, kde byla vystavena (pokladna nebo účetní program). Appka drží číslo a vazbu. | Faktura není tržba. Úhrada není tržba. |
| Úhrada | `transakce` (banka) | Appka nikdy nepřidá peníze do cashflow jen podle rozpoznaného dokladu. |

**Prodej + faktura + úhrada = jedna tržba.** Tržba se uznává jednou, buď
v pokladně, nebo v `ostatni_trzby` se `zapocitat = true`. Faktura je jen
vazba (pohledávka). Úhrada je bankovní pohyb a jde do cashflow, ne do tržeb.

---

## 3. Datový model

Všechny tabulky mají `id uuid`, `tenant_id` (kvůli auditu a RLS), zapnuté
RLS. Zápis jde **jen přes funkce** (`revoke all … from anon, authenticated`
a zpět jen `select`). Každá tabulka s pobočkou má `branch_id not null`
a spoušť `hlida_firmu_*` (pobočka i každá vazba patří téže firmě).
Peníze jsou `*_haleru integer`, množství `numeric(12,3)`.

### 3.1 `jine_platby`: záznam (jeden doklad)

| sloupec | typ | poznámka |
|---|---|---|
| `branch_id` | uuid not null | provozovna |
| `pripojeni_id` | uuid null → `integrace_pripojeni` | pokladna, která provozovnu obsluhuje; null = bez pokladny |
| `pos_provozovna` | text null | ID provozovny u poskytovatele (z `externi_ucet.provozovny[]`) |
| `klient_id` | uuid not null | idempotence založení (dvojklik), unikátní na firmu |
| `datum_prodeje` | date null | **provozní** den |
| `oznaceni` | text | zákazník nebo označení účtu |
| `kontakt_id` | uuid null → `kontakty` | odběratel pro fakturu |
| `mena` | text null `^[A-Z]{3}$` | null = neznámá, nikdy se nedomýšlí |
| `castka_haleru` | integer null ≥ 0 | celková cena prodeje (ne „K úhradě“, ne přijatá hotovost) |
| `castka_puvod` | `doklad` / `vypocet` / `rucne` | „vypocet“ = součet položek nabídnutý jako návrh |
| `typ_dokladu` | `otevreny_ucet` / `uzavreny_prodej` / `informativni_sjetina` / `rucni_spotreba` / `nezjisteno` | |
| `externi_ucet` | text null | číslo účtu nebo dokladu z fotky |
| `pos_prodej_id` | text null | **ověřené** ID prodeje v pokladně |
| `stav_kontroly` | `rozpracovano` / `ke_kontrole` / `zkontrolovano` / `zruseno` | |
| `stav_trzby` | `nezapsano` / `zapsano` / `propojeno` / `stornovano` | |
| `stav_skladu` | viz 3.6 | |
| `stav_faktury` | `bez_faktury` / `podklady` / `propojena` | |
| `faktura_cislo`, `faktura_zdroj` (`pos`/`externi`), `faktura_castka_haleru`, `faktura_podklady jsonb` | | |
| `stav_uhrady` | `neovereno` / `castecne` / `uhrazeno` | jen z napárované bankovní transakce |
| `uhrada_transakce_id`, `uhrada_castka_haleru` | | |
| `kontrola_trzby`, `kontrola_skladu` | jsonb null | poslední kontrola proti pokladně (3.7) |
| `duplicita` | jsonb null | rozhodnutí člověka „není to duplicita“ s důvodem |
| `rozpoznani_id` | uuid null → `jine_platby_rozpoznani` | čtení AI, ze kterého je uložený návrh (zapíše `ulozit_navrh`, když ho rozpoznání předá); panel „Částky na dokladu“ čte tenhle řádek, ruční uložení vazbu nechá |
| `upozorneni_dokladu` | jsonb pole textů | upozornění AI k celému dokladu (nízká jistota, víc dokladů, pokyn v textu…); dokud nějaké je, záznam je „ke kontrole“ a „zkontrolováno“ chce výslovné „prověřeno“; ruční uložení je nesmaže |
| `verze` | integer | roste s každou změnou návrhu |
| `vytvoril`, `vytvoreno`, `zmeneno` | | |

Unikát: `(tenant_id, pripojeni_id, pos_prodej_id)`, kde `pos_prodej_id`
není null a záznam není zrušený. **Jeden prodej v pokladně patří nejvýš
jednomu záznamu.** Druhá fotka téže sjetiny se na něj nepropojí.

### 3.2 `jine_platby_soubory`: originály

`zaznam_id`, `branch_id`, `poradi`, `cesta` (unikátní,
`<tenant>/<pobočka>/<záznam>/<uuid>.<přípona>`), `mime` (jpeg/png/webp/pdf),
`velikost` (≤ 10 MB), `otisk` (sha256, počítá server ze stažených bajtů),
`nahral`, `nahrano`. Unikát `(tenant_id, otisk)` nad živými soubory: **tentýž
soubor nejde připojit ke dvěma živým záznamům.** Nejvýš 10 souborů na záznam.
Zapsat soubor (a tím otisk) smí jen server: `jine_platby_pripojit_soubor`
má jen `service_role` (kontrola 19. 10. — přihlášený by jinak poslal
vymyšlený otisk a tutéž fotku připojil podruhé).

Kbelík `jine-platby` je soukromý, 10 MB a 4 typy. Politiky:
- číst smí, kdo vidí záznamy pobočky;
- nahrát smí, kdo má `jine_platby.zadat` nebo `.upravit` na pobočce z cesty;
- změnit nesmí nikdo;
- smazat jde jen vlastní soubor, ke kterému žádný řádek neukazuje.

### 3.3 `jine_platby_rozpoznani`: výstup AI (jen přidávat)

`zaznam_id`, `verze_zaznamu`, `stav` (`bezi`/`ok`/`chyba`/`bez_klice`),
`model`, `verze_zadani`, `vysledek jsonb` (strukturovaný výstup po
kontrole schématu, **před** opravami člověka), `text_dokladu` (rozpoznaný
text), `duvod`, `spustil`, `vytvoreno`. Zapisuje jen server (service_role).
Denní strop: 200 rozpoznání na firmu, pokus se započítá **před** voláním AI.

### 3.4 `jine_platby_polozky`: položky návrhu

`poradi`, `nazev_puvodni` (z dokladu), `nazev`, `mnozstvi numeric(12,3)
null`, `jednotka`, `cena_jednotkova_haleru`, `cena_celkem_haleru`,
`sazba_dph numeric(5,2) null` (jen když je na dokladu), `jistota`,
`zdroj` (`ai`/`rucne`), `druh` (`pokrm` / `rozlevany_napoj` /
`kusove_zbozi` / `sluzba` / `spropitne` / `sleva` / `neskladova` /
`nezarazeno`), `pos_produkt_id`, `pos_produkt_nazev`, `pos_mnozstvi`
(v jednotkách prodeje pokladny), `mapovani` (`nenamapovano` / `navrh` /
`overeno` / `neskladova`), `vyzaduje_kontrolu`, `duvod_kontroly`.

Ukládá se celý seznam najednou (`jine_platby_ulozit_navrh`) s kontrolou
verze (souběžné úpravy se nepřepíšou potichu).

### 3.5 `pos_katalog`, `pos_mapovani`

- `pos_katalog`: katalog produktů z pokladny, pro každé připojení. Pole
  `externi_id`, `nazev`, `jednotka`, `mira`, `odecita_sklad`,
  `ma_recepturu`, `plu[]`, `ean[]`, `smazano`, `aktualizovano`. Plní jen
  server (service_role) z `RelacePos.katalog()`. Pokladna bez katalogu =
  mapování podle prodaných názvů, bez externího ID, a výdej jen ručně.
- `pos_mapovani`: ověřené aliasy „název z dokladu → produkt v pokladně“
  pro jedno připojení. Ukládá je člověk s `jine_platby.upravit`.

### 3.6 Sklad: `jine_platby_skladove_navrhy` a `pos_operace`

**Návrh** (`jine_platby_skladove_navrhy`): `verze_zaznamu`, `obsah jsonb`,
`otisk` = sha256 z `obsah::text`, `stav` (`ceka_na_schvaleni` /
`schvaleno` / `zamitnuto` / `nahrazeno` / `provedeno`), `odeslal`,
`schvalil`, `zamitl`, `duvod_zamitnuti`, `kontrola_pri_schvaleni`.
Nejvýš jeden živý (`ceka_na_schvaleni` / `schvaleno`) na záznam.

`obsah` **sestavuje databáze** (`app.jine_platby_sestavit_vydej`) z položek,
ne prohlížeč:
- `pripojeni_id`, `pos_provozovna`, `polozky: [{pos_produkt_id, nazev, mnozstvi}]`;
- jen položky, které v pokladně odečítají sklad;
- zablokuje se, když je nějaká položka nezařazená, nenamapovaná nebo bez množství.

Pokrm s recepturou se vydá **jako pokrm**: pokladna sama odečte suroviny
podle své receptury. Appka receptury nečte, takže nepozná, jestli kusové
zboží ve výdeji není surovina téhož pokrmu (smetana ke svíčkové). Když výdej
obsahuje pokrm i kusové zboží, sestavení vrátí varování (`varovani`) a
schválení chce výslovné potvrzení `p_bez_surovin` (zapíše se do historie).
Rozlévaný nápoj (pivo) surovinou pokrmu není a varování nedává.

**Schválení je svázané s verzí a otiskem.** Změna položek, množství,
mapování, provozovny nebo pokladny zvedne verzi. Živý návrh pak přejde
do `nahrazeno` a schválení je potřeba znovu. Po zahájení výdeje už
změnu, která se skladu týká, nejde uložit, jen opravou.

**Operace** (`pos_operace`, nezávislá na dodavateli): `druh`
(`vydej`/`korekce`), `idempotencni_klic` (unikátní, zároveň externí ID
v pokladně), `stav` (`pripraveno` / `odesila_se` / `uspech` /
`nejasny_vysledek` / `chyba` / `nepodporovano` / `rucne_dolozeno` /
`zruseno`), `pokusu`, `platnost_do`, `externi_id`, `externi_doklad`,
`vysledek jsonb` (bez tajemství), `chyba`, `zahajil`, `korekce_pro`, `duvod`.
Nejvýš jedna neukončená operace na návrh.

`jine_platby.stav_skladu`:

| stav | význam |
|---|---|
| `bez_navrhu` | ještě neodesláno |
| `nevyzaduje` | žádná položka neodečítá sklad (služba, spropitné…) |
| `ceka_na_schvaleni` | čeká na „Potvrdit výdej do POS“ |
| `zamitnuto` | zamítnuto s důvodem |
| `schvaleno` | schváleno, operace čeká na provedení |
| `zpracovava_se` | požadavek odešel do pokladny |
| `nejasny_vysledek` | timeout nebo nejasná odpověď. **Neopakuje se naslepo**, jen dohledá |
| `odecteno_v_pos` | ověřeno v pokladně (máme ID operace) |
| `jiz_odecteno` | pokladna už výdej provedla dřív, jen propojeno |
| `rucne_dolozeno` | člověk to provedl nebo ověřil v pokladně sám, s důvodem. **Není to automatické ověření.** |
| `nepodporovano` | pokladna to přes API neumí. Návrh je podklad pro ruční zpracování |
| `chyba` | pokladna požadavek prokazatelně neprovedla, lze zkusit znovu |
| `nutna_kontrola` | nelze zjistit, jestli už odečteno |
| `opraveno` | k provedenému výdeji je zapsaná korekce |

**Otisk a změna (po kontrole 17. 10.).** `otisk` = sha256 jen z věcné
podstaty výdeje: pokladna, provozovna a seřazené dvojice „produkt v pokladně
+ součet množství“. Přejmenování položky nebo jiné označení záznamu otisk
nemění. `zmena` = sha256(otisk + blokace): když po odeslání přibude
nejasná skladová položka, návrh se nahradí, i když se otisk nezměnil.
Název v obsahu výdeje se bere z katalogu pokladny, ne z prohlížeče.
Ve stavu „schváleno“ i „předáno k ručnímu odpisu“ (`nepodporovano`) nejde
uložit změnu, která mění otisk, ani přidat nejasnou skladovou položku
(`zmena`) — schvalovatel může právě odepisovat v pokladně. Uvolní to jen
„Zrušit schválení“ (s důvodem), nebo „Ručně doloženo“ k tomu otisku, který
člověk v pokladně odepsal; ruční doložení s nevyřešenou položkou neprojde.
Výdej se neschválí ani nesestaví, když produkt není v katalogu pokladny
(katalog nenačtený, produkt zrušený) nebo když pokladna či provozovna
záznamu už jeho pobočku neobsluhuje (přeřazení v Integracích).

### 3.7 Kontrola proti pokladně (`kontrola_trzby`, `kontrola_skladu`)

`{ vysledek, zdroj, verze, kdy, kdo, detail }`:
- `vysledek` u tržby: `nalezeno` / `nenalezeno` / `pravdepodobne` / `nelze_overit`;
- `vysledek` u skladu: `neodecteno` / `jiz_odecteno` / `nelze_zjistit`;
- `zdroj`: `pos_api` (zapisuje jen server přes service_role) nebo `rucni_prohlaseni` (člověk s příslušným právem a povinným důvodem).

Kontrola platí jen pro **tutéž verzi** záznamu. Musí být čerstvá: tržba
30 min, sklad 15 min. Kontrola skladu se opakuje těsně před schválením
i před provedením, protože pokladna mohla mezitím výdej provést sama.

Denní souhrn z pokladny prodej neověří. „2× pivo“ se ten den prodalo
určitě, otázka je, jestli **tohle**. Bez dohledání účtu je výsledek vždy
`nelze_overit` a rozhoduje ruční prohlášení s důvodem.

### 3.8 `ostatni_trzby`: evidence tržeb mimo pokladnu

`branch_id not null`, `datum` (provozní den), `castka_haleru > 0`, `mena`,
`zdroj` (`jine_platby`), `zaznam_id`, `zapocitat`, `kategorie`,
`pos_pripojeni_id`, `pos_prodej_id`, `faktura_cislo`, `stav`
(`platna`/`stornovana`), `storno_duvod`, `stornoval`, `stornovano`,
`nahrazuje` (oprava = storno + nový řádek, historie se nepřepisuje),
`potvrdil`, `potvrzeno`.

- `check (not (zapocitat and pos_prodej_id is not null))`: **prodej známý
  v pokladně se nikdy nezapočítá podruhé.**
- Unikáty: jedna platná tržba na záznam, jedna platná na prodej v pokladně.
- Kategorie je jen popisek, celkový součet nemění.
- Různé měny se nesčítají.

### 3.9 `jine_platby_historie`

Jen přidávat: `zaznam_id`, `kdy`, `kdo`, `udalost`, `detail jsonb` (bez
tajemství a bez fotek). Slouží obrazovce. Ústřední audit jde navíc přes
`app.audit` a spouště `app.audit_zmenu`.

---

## 4. Oprávnění (modul `finance`)

| klíč | popisek | citlivé |
|---|---|---|
| `jine_platby.zadat` | Jiné platby: vytvořit záznam a nahrát doklad | ne |
| `jine_platby.upravit` | Jiné platby: upravit návrh (položky, ceny, mapování) | ne |
| `jine_platby.sklad_odeslat` | Jiné platby: odeslat skladový návrh ke schválení | ne |
| `jine_platby.trzba` | Jiné platby: potvrdit zápis do Ostatních tržeb | ano |
| `jine_platby.vydej_pos` | Jiné platby: Potvrdit výdej do POS | ano |
| `jine_platby.faktura` | Jiné platby: vystavit nebo propojit fakturu a evidovat úhradu | ano |
| `jine_platby.oprava` | Jiné platby: oprava a storno | ano |

- Každé právo platí na pobočkách členství (`app.has_access(tenant, právo, branch_id záznamu)`).
- Vidět záznamy pobočky smí, kdo má na pobočce kterékoli z těchto práv nebo `finance.read`.
- **Právo na tržbu neumožňuje odečíst sklad** a naopak, jsou to oddělené funkce.
- Každá zapisovací funkce si právo ověří sama, schované tlačítko nestačí.

Existující firmy práva nedostanou automaticky (kromě majitele, ten má
vše). Přidělují se v Nastavení → Oprávnění.

---

## 5. Databázové funkce (jediná cesta k zápisu)

Vzor: `public.<funkce>` je `security definer`, `search_path = ''`, firmu
a pobočku bere z řádku záznamu (ne od volajícího) a právo ověřuje přes
`app.has_access` na pobočce záznamu. Sdílené kroky jsou pomocné funkce
`app.jp_*` (načtení se zámkem, verze, důvod, historie, sestavení výdeje,
možné duplicity), které `authenticated` volat nesmí.
Granty: `revoke all … from public, anon` a pak `grant execute … to
authenticated`, případně jen `service_role`.

Přihlášený (`authenticated`):

| funkce | právo | co dělá |
|---|---|---|
| `jine_platby_zalozit(p_tenant, p_branch, p_pripojeni, p_oznaceni, p_klient_id) → uuid` | zadat | založí záznam; pokladna musí patřit firmě a obsluhovat pobočku |
| `jine_platby_ulozit_navrh(p_zaznam, p_verze, p_hlavicka, p_polozky) → integer` | upravit | hlavička + celé položky, kontrola verze, zneplatnění schválení; v hlavičce volitelně `upozorneni_dokladu` a `rozpoznani_id` (jen úspěšné čtení téhož záznamu) |
| `jine_platby_oznacit_zkontrolovano(p_zaznam, p_verze, p_duvod_rozdilu, p_upozorneni_provereno)` | upravit | jen bez otevřených příznaků a s částkou, měnou a datem; když součet položek (cena celkem, jinak množství × jednotková cena) nesedí s celkem (CZK víc než 50 hal.), chce důvod; upozornění AI k dokladu chtějí výslovné „prověřeno“ |
| `jine_platby_prohlasit(p_zaznam, p_verze, p_druh, p_vysledek, p_duvod, p_pos_prodej_id, p_prepsat_pokladnu)` | trzba / vydej_pos | ruční doložení stavu v pokladně s důvodem; poslední výsledek z pokladny (`pokladna_trzby` / `pokladna_skladu`, píše je jen `jine_platby_zapsat_kontrolu`; bez ohledu na verzi) přepíše opačné prohlášení jen s `p_prepsat_pokladnu`: „pravděpodobně“ ze shody jen částky (`detail.shoda = 'castka'`) kdokoli, konkrétní prodej, shoda čísla účtu (i bez uvedené shody) a „už odečteno“ jen s právem na opravy (`app.jp_nalez_pokladny`); přepsaný výsledek celý v historii, ve výsledku pokladny značka „prepsano“; „neodečteno“ po zrušeném nedohledaném požadavku jen s právem na opravy (od 20261021100000) |
| `jine_platby_potvrdit_trzbu(p_zaznam, p_verze, p_rezim, p_duplicita_duvod, p_duvod_propojeni) → uuid` | trzba | zápis nebo propojení v `ostatni_trzby`; propojení bez konkrétního prodeje chce důvod; potvrzení jedné firmy jdou za sebou (zámek); nová tržba ne proti konkrétnímu nálezu pokladny tohoto ani jiného záznamu téhož dokladu nebo prodeje (`app.jp_souvisejici`), ten jen s právem na opravy |
| `jine_platby_sestavit_vydej(p_zaznam) → jsonb` | čtení | náhled obsahu, otisku, blokací a varování |
| `jine_platby_odeslat_sklad(p_zaznam, p_verze) → uuid` | sklad_odeslat | návrh ke schválení |
| `jine_platby_rozhodnout_vydej(p_navrh, p_otisk, p_schvalit, p_duvod, p_bez_surovin) → uuid` | vydej_pos | schválení (→ operace `pripraveno`) nebo zamítnutí; schválit jde jen zkontrolovaný záznam bez blokací, možná duplicita výdeje chce důvod, pokrm + kusové zboží potvrzení `p_bez_surovin`; ne proti nálezu „už odečteno“ ani nedohledanému požadavku jiného záznamu téhož dokladu nebo prodeje (jen s právem na opravy) |
| `jine_platby_propojit_vydej(p_zaznam, p_verze, p_externi_id, p_doklad, p_duvod)` | vydej_pos | pokladna už odečetla, jen propojit |
| `jine_platby_rucne_dolozit_vydej(p_zaznam, p_otisk, p_doklad, p_duvod)` | vydej_pos | provedeno ručně v pokladně; u záznamu s pokladnou jen k návrhu s tímto otiskem; nejasný výsledek až po platnosti operace (+ 2 min); blokuje jen nevyřešená položka, ne změna katalogu |
| `jine_platby_zrusit_schvaleni(p_zaznam, p_duvod)` | vydej_pos | uvolní schválený nebo „předaný k ručnímu odpisu“ výdej (nic se v pokladně neodepsalo); nejasný výsledek až po platnosti operace (+ 2 min); ne u provedeného; zrušený požadavek s nejasným výsledkem zapíše do `nedohledana_operace` |
| `jine_platby_faktura(p_zaznam, p_akce, p_data)` | faktura | podklady / propojit / odpojit |
| `jine_platby_evidovat_uhradu(p_zaznam, p_transakce, p_castka_haleru)` | faktura + finance.read k účtu | jen příchozí nestornovaná transakce **z banky** (`fio_api`, `bankovni_agregator`, `csv_banka` — `ZDROJE_UHRADY`) téže firmy a měny; storno platby po napárování úhradu zruší (spoušť `trg_storno_platby_jine_platby`); ne na zrušený záznam; firemní účet chce finanční přehled za celou firmu; zbytek platby počítá i z potvrzených plateb faktur (stejný zámek jako faktury) |
| `jine_platby_opravit_trzbu(p_zaznam, p_verze, p_nova_castka_haleru, p_duvod, p_doklad_opravy)` | oprava | storno + nový řádek; `null` = jen storno (zruší i `pos_prodej_id`) |
| `jine_platby_korekce_vydeje(p_zaznam, p_doklad, p_duvod)` | oprava + vydej_pos | korekce provedeného výdeje (ručně doložená) |
| `jine_platby_zrusit(p_zaznam, p_duvod)` | oprava (autor rozpracovaného: zadat) | jen bez zapsané tržby, faktury a úhrady, bez zahájeného výdeje, mimo schválený výdej a ruční odpis; soubory zůstanou v historii, ale doklad jde připojit znovu; s konkrétním nálezem pokladny nebo `nedohledana_operace` jen s právem na opravy |
| `jine_platby_ulozit_mapovani(p_zaznam, p_alias, p_pos_produkt_id)` | upravit na pobočce záznamu | ověřený alias pro pokladnu záznamu; katalog musí být načtený a produkt v něm |
| `jine_platby_pokladny(p_tenant, p_branch)` | vidí pobočku | pokladny obsluhující pobočku (bez čtení `integrace_pripojeni`) |

Server (`service_role`), volá ho jen serverová akce po ověření práva:

| funkce | co dělá |
|---|---|
| `jine_platby_zapsat_rozpoznani(…)` | pokus (`bezi`) před voláním AI a výsledek po něm |
| `jine_platby_zapsat_kontrolu(p_zaznam, p_verze, p_druh, p_vysledek, p_detail)` | výsledek dohledání v pokladně (`zdroj = pos_api`); jen přes pokladnu, která pobočku záznamu pořád obsluhuje; „nenalezeno/neodečteno“ jen u uzavřeného prodeje a ruční spotřeby (sjetina ani otevřený účet nepřítomnost neprokážou); konkrétní nález v `pokladna_*` slabší výsledek nepřepíše; do historie celý výsledek; jasný výsledek skladu vymaže `nedohledana_operace` |
| `jine_platby_pripojit_soubor(p_zaznam, p_cesta, p_otisk, p_nahral) → uuid` | připojí soubor z úložiště: nahrál ho `p_nahral`, povolený typ a velikost, otisk spočítal server ze stažených bajtů |
| `pos_operace_zahajit(p_operace, p_platnost_do) → jsonb` | zabere operaci (`pripraveno`/`chyba` → `odesila_se`); souběžné druhé volání dostane „obsazeno“ |
| `pos_operace_dokoncit(p_operace, p_stav, p_externi_id, p_doklad, p_vysledek, p_chyba)` | ukončí operaci a přenese stav na záznam |
| `pos_katalog_nahradit(p_pripojeni, p_produkty)` | uloží katalog z pokladny |

### 5.1 Přesné podpisy (všechny v `public`, obal nad `app.*`)

```text
-- authenticated
jine_platby_zalozit(p_tenant uuid, p_branch uuid, p_pripojeni uuid, p_oznaceni text, p_klient_id uuid) returns uuid
jine_platby_ulozit_navrh(p_zaznam uuid, p_verze integer, p_hlavicka jsonb, p_polozky jsonb) returns integer
jine_platby_oznacit_zkontrolovano(p_zaznam uuid, p_verze integer, p_duvod_rozdilu text default null, p_upozorneni_provereno boolean default false) returns void
jine_platby_prohlasit(p_zaznam uuid, p_verze integer, p_druh text, p_vysledek text, p_duvod text, p_pos_prodej_id text default null, p_prepsat_pokladnu boolean default false) returns void
jine_platby_potvrdit_trzbu(p_zaznam uuid, p_verze integer, p_rezim text, p_duplicita_duvod text default null, p_duvod_propojeni text default null) returns uuid
jine_platby_sestavit_vydej(p_zaznam uuid) returns jsonb   -- {obsah, otisk, zmena, polozek, blokace:[{poradi, nazev, duvod}], varovani:[text]}
jine_platby_odeslat_sklad(p_zaznam uuid, p_verze integer) returns uuid          -- null = sklad se netýká (stav 'nevyzaduje')
jine_platby_rozhodnout_vydej(p_navrh uuid, p_otisk text, p_schvalit boolean, p_duvod text default null, p_bez_surovin boolean default false) returns uuid  -- id operace při schválení
jine_platby_vydej_znovu(p_zaznam uuid) returns uuid                               -- nová operace po prokázané chybě
jine_platby_propojit_vydej(p_zaznam uuid, p_verze integer, p_externi_id text, p_doklad text, p_duvod text) returns void
jine_platby_rucne_dolozit_vydej(p_zaznam uuid, p_otisk text, p_doklad text, p_duvod text) returns void   -- p_otisk null jen u záznamu bez pokladny
jine_platby_zrusit_schvaleni(p_zaznam uuid, p_duvod text) returns void
jine_platby_faktura(p_zaznam uuid, p_akce text, p_data jsonb) returns void      -- 'podklady' {podklady, kontakt_id} | 'propojit' {cislo, zdroj, castka_haleru} | 'odpojit' {}
jine_platby_evidovat_uhradu(p_zaznam uuid, p_transakce uuid, p_castka_haleru integer) returns void
jine_platby_opravit_trzbu(p_zaznam uuid, p_verze integer, p_nova_castka_haleru integer, p_duvod text, p_doklad_opravy text default null) returns uuid
jine_platby_korekce_vydeje(p_zaznam uuid, p_doklad text, p_duvod text) returns uuid
jine_platby_zrusit(p_zaznam uuid, p_duvod text) returns void
jine_platby_ulozit_mapovani(p_zaznam uuid, p_alias text, p_pos_produkt_id text) returns void
jine_platby_pokladny(p_tenant uuid, p_branch uuid) returns table(id uuid, nazev text, poskytovatel text, stav text, pos_provozovna text, provozovna_nazev text)
jine_platby_spotreba(p_tenant uuid, p_branch uuid, p_od date, p_do date) returns table(datum date, branch_id uuid, pos_produkt_id text, nazev text, mnozstvi numeric, druh text)

-- service_role
jine_platby_zahajit_rozpoznani(p_zaznam uuid, p_spustil uuid, p_verze integer default null) returns uuid   -- verze a schválený/provedený výdej před započtením; denní strop pod zámkem firmy
jine_platby_pripojit_soubor(p_zaznam uuid, p_cesta text, p_otisk text, p_nahral uuid) returns uuid
jine_platby_dokoncit_rozpoznani(p_rozpoznani uuid, p_stav text, p_model text, p_verze_zadani text, p_vysledek jsonb, p_text text, p_duvod text) returns void
jine_platby_zapsat_kontrolu(p_zaznam uuid, p_verze integer, p_druh text, p_vysledek text, p_detail jsonb, p_kdo uuid) returns void
pos_operace_zahajit(p_operace uuid, p_platnost_do timestamptz) returns jsonb    -- {stav:'ok'|'obsazeno'|'nelze', duvod?, operace?}
pos_operace_dokoncit(p_operace uuid, p_stav text, p_externi_id text, p_doklad text, p_vysledek jsonb, p_chyba text) returns void
pos_katalog_nahradit(p_pripojeni uuid, p_produkty jsonb) returns integer
```

Chyby funkcí: `42501` = bez práva, `23514` (check_violation) = obchodní
pravidlo s českou hláškou (aplikace ji smí ukázat), `40001` = verze
nesedí („mezitím upravil někdo jiný“), `23505` = duplicita (soubor,
prodej), `P0002` = záznam nenalezen nebo cizí.

---

## 6. Aplikace

| soubor | co |
|---|---|
| `lib/jine-platby-pristup.ts` | `zkusPristupJinymPlatbam(tenantId, rozsah)` → `Pristup` + `prava` (která práva agendy platí v rozsahu) |
| `lib/jine-platby-castky.ts` | peníze bez desetinných čísel (text → haléře, množství × cena) |
| `lib/jine-platby-kontrola.ts` | kontrola rozpoznaného dokladu (celkem / k úhradě / zaplaceno / vráceno / zbývá, součet položek, slevy, zaokrouhlení) |
| `lib/jine-platby-mapovani.ts` | návrhy mapování na katalog, převod jednotek jen z dat pokladny |
| `lib/jine-platby-stav.ts` | popisky stavů, kroky průvodce, dostupné akce podle stavu a práv (síť testů přes 49 280 kombinací); `prohlaseniProtiPokladne` (výsledek pokladny z `pokladnaTrzby` / `pokladnaSkladu`, který ruční prohlášení bez potvrzení nepřepíše; `chceOpravu` u všeho kromě shody jen částky), `moznaDvakrat`, `moznaNikde` (jen propojení s konkrétním prodejem), východ z nejasné operace po platnosti + 2 min |
| `lib/jine-platby-duplicity.ts` | možné duplicity (otisk, účet, pobočka + den + částka + měna) |
| `lib/jine-platby-faktura.ts` | podklady pro fakturu, chybějící údaje |
| `lib/jine-platby-pos-operace.ts` | provedení a obnova operace v pokladně (idempotence, souběh, timeout) |
| `lib/jine-platby-ai-jadro.ts` | schéma, zadání a převod odpovědi AI (bez `server-only`, testuje CI) |
| `lib/jine-platby-ai.ts` | volání modelu (`server-only`) |
| `lib/pokladna-dotykacka-sklad.ts` | Dotykačka: katalog, účty, dohledání podle klíče, (vypnutý) výdej |
| `app/[rozsah]/finance/trzby/jine-platby/**` | přehled, nový záznam, detail s průvodcem, akce |
| `app/api/jine-platby/soubor/[id]/route.ts` | originál: právo + RLS + podepsaný odkaz na 120 s |

Fotky jdou z prohlížeče **přímo do úložiště** (serverová akce má strop
1 MB). Server pak soubor stáhne, ověří typ podle obsahu (magic bytes),
spočítá otisk a teprve potom ho připojí (klientem služby, `p_nahral`).

**Rozpoznání AI (po kontrole 19. 10.):**
- Levné kontroly před placeným čtením: verze formuláře, zapsaná tržba, typ a velikost podkladu, počet stran PDF (nejvýš 20 na PDF a 30 dohromady; stránky se počítají z bajtů souboru včetně komprimovaných proudů). Až potom se pokus započítá do denního stropu (200 za firmu, pod zámkem firmy).
- Volání `messages.create` se strukturovaným výstupem; nejdřív se kontroluje `stop_reason` (`max_tokens` / `model_context_window_exceeded` → „doklad je na jedno čtení moc dlouhý“, `refusal` → „model doklad odmítl“), teprve pak `JSON.parse` a schéma. Dřív `messages.parse` hodil chybu dřív, než se k `stop_reason` dostal.
- Časový rozpočet se měří od začátku akce: konec = start + (maxDuration 120 s − rezerva na uložení); volání dostane nejvýš 100 s a nejméně 15 s, jinak se nečte vůbec. `max_tokens` se odvozuje z času (min(16000, max(4000, limit v s × 50))). Vypršení času je trvalá chyba s radou „Doklad je na jedno čtení moc dlouhý — rozdělte ho, nebo zadejte položky ručně.“ (ne „zkuste znovu“, každé opakování by se zaplatilo a započítalo). Test hlídá, že `maxDuration` stránky sedí s délkou akce.
- Rozpoznání jde i po zápisu tržby (položky pro sklad): akce pak pošle uloženou částku, měnu a datum (u propojené faktury i částku) a rozdíl proti přečteným hodnotám zapíše do upozornění. Se schváleným nebo provedeným výdejem akce i databáze čtení odmítnou dřív, než se zaplatí.
- Uložený návrh nese `rozpoznani_id` čtení, ze kterého je; panel „Částky na dokladu“ čte tenhle řádek a zvlášť ukáže novější neúspěšný nebo neuložený pokus a ruční úpravu po čtení.
- Schéma (verze zadání `jine-platby-v3`) má volitelné `cas` (čas tisku účtenky, jen když je čitelný). Když je čas tisku dřív než začátek provozního dne pobočky, datum prodeje se posune o den zpět a přidá se upozornění. Při opakovaném čtení zůstane uložené datum a rozdíl je upozornění. Když čas na dokladu není a pobočka nezačíná den o půlnoci, přibude upozornění „Datum z dokladu je kalendářní den tisku — ověřte provozní den“.
- Zadání pro AI rozlišuje typy přísněji: vytištěný nezaplacený účet stolu (předúčet) je `otevreny_ucet`, i když vypadá jako sjetina; `informativni_sjetina` je jen report z pokladny, který není účtem stolu; při pochybnosti `nezjisteno`. Z dotazu do pokladny dostane „v pokladně není“ jen uzavřený prodej a ruční spotřeba (aplikace i databáze).
- Do `upozorneni_dokladu` patří jen věci k celému dokladu: nízká jistota dokladu, upozornění modelu (víc dokladů, pokyn v textu…), K úhradě / zaplaceno / zbývá nesedí s celkem, posun data. Řádkové důvody zůstávají na řádcích. Nejvýš 20 upozornění po 300 znacích.

---

## 7. Pokladna: nezávislá vrstva a Dotykačka

Kontrakt `lib/pos-provider-contract.ts` dostává **nepovinné** schopnosti:
- `katalog()`, `ucty(…)` a `ucetPodleKlice(klic)` ke čtení;
- `skladovyVydej(…)` k zápisu;
- `schopnosti.skladovyVydej`: `'api' | 'rucne' | 'nepodporovano'`.

Kód agendy se ptá jen kontraktu, Dotykačku nezná. Další pokladna dodá
svůj adaptér a agenda se nemění.

**Dotykačka dnes:** katalog a dohledání účtů jsou napsané podle oficiální
dokumentace a otestované na podvržených odpovědích. Živě ověřené nejsou.
`skladovyVydej` je `'rucne'`. Funkce pro výdej přes POS akci (účet
zaplacený způsobem „Odpis“, který neovlivní tržby, a dohledání podle
externího ID) existuje, ale **není připojená k adaptéru**. Postup
připojení je v `docs/jine-platby-pos-operace.md` a smí se provést až po:
1. ověření na testovacím cloudu Dotykačky (odpis se neobjeví v tržbách ani v platbách appky, suroviny se odečtou podle receptury);
2. výslovném pokynu Šéfíka.

Pravidla operace (`lib/jine-platby-pos-operace.ts`):
- zabrání v databázi (souběh) → odeslání → **ověření dohledáním** → teprve pak `uspech`;
- timeout nebo nejasná odpověď = `nejasny_vysledek`, nikdy nové odeslání;
- obnova = dohledat podle klíče:
  - nalezeno → `uspech`;
  - nenalezeno po vypršení platnosti požadavku → `chyba` (pokladna ho už neprovede, smí se zkusit znovu);
  - jinak čekat.

---

## 8. Co se schválně NEDĚLÁ

- Žádný zápis do `pokladna_prodeje_denni`, `transakce`, `predpisy_plateb` ani do DB Faktur.
- Žádná skladová karta, zásoba ani pohyb v appce.
- Žádný fiktivní hotovostní nebo karetní prodej v pokladně kvůli výdeji.
- Foodcost se nemění, dokud se neověří, jestli odpis v pokladně neleze do jejích prodejů (otázka 53). Potvrzená spotřeba je zatím dohledatelná přes `jine_platby_spotreba`.
- AI nikdy nezapisuje tržbu ani výdej a nic nedomýšlí. Chybějící údaj = prázdno + příznak ke kontrole.

## 9. Kiosek na telefonu pobočky (22. 10. 2026)

Zadání: „kiosek do telefonu jako je na docházku… obsluha nemá přístup
k modulu finance“, upřesnění „nepotřebujeme se přihlásit pinem“.
Migrace `20261022100000_jine_platby_kiosek`, stránka `/kiosek/doklady`.

- **Zařízení:** telefon je `branch_devices` s účelem `doklady` (párování kódem přes `registrovat_zarizeni_doklady`, klíč v `localStorage` pod `foodtab-kiosek-doklady-klic`). Kiosek Jiných plateb se zapíná zvlášť: řádek v `jine_platby_kiosky`, píše ho jen `jine_platby_kiosek_zapnout` (správce nastavení pobočky, firma s Financemi, audit).
- **Ověření při každém volání** (`app.jp_kiosek_zarizeni`): zařízení podle otisku klíče (aktivní, neodvolané, účel `doklady`), zapnutý kiosek, aktivní pobočka, modul `finance` firmy. Neznámé nebo odvolané zařízení dostane stejnou hlášku jako kiosek Docházky (`42501`). Vypnutý kiosek, neaktivní pobočka a firma bez Financí mají vlastní hlášky.
- **Záznam z kiosku:** `zdroj = 'kiosek'`, `zarizeni_id`, `zarizeni_nazev` (opis názvu, Finance zařízení číst nesmí), `vytvoril` prázdné. Soubor: `jine_platby_soubory.zarizeni_id`, `nahral` prázdné. Historie: `kdo` prázdné, `detail.zdroj = 'kiosek'` a název zařízení.

| Funkce | Kdo | Co |
|---|---|---|
| `jine_platby_kiosek_stav(p_klic) → jsonb` | service_role | jen `{pobocka, zarizeni}` |
| `jine_platby_kiosek_overit_zaznam(p_klic, p_zaznam) → jsonb` | service_role | před JAKÝMKOLI stažením: klíč, záznam téhož zařízení, rozpracovaný, do 2 h; vrací `{zaznam, tenant, branch}` pro kontrolu cesty (kontrola 24. 10.) |
| `jine_platby_kiosek_muze_uklidit(p_klic, p_zaznam, p_cesta) → boolean` | service_role | server smaže soubor JEN při `true`: záznam téhož zařízení, cesta toho záznamu, `owner is null`, žádný řádek v `jine_platby_soubory` |
| `registrovat_zarizeni_doklady(p_kod)` | anon, authenticated | spárování telefonu na doklady: `registrovat_zarizeni` + účel `doklady` |
| `jine_platby_kiosek_dnes(p_klic) → jsonb` | service_role | doklady TOHOTO zařízení za dnešní provozní den pobočky (`app.business_date`), od nejnovějšího, nejvýš 50; každý jen `{cas, fotek, oznaceni, stav}`, stav `prijato`/`bez_fotky`/`zkontrolovano`/`zpracovano`/`zruseno` (rozhodnutí 24. 10., otázka 69) |
| `jine_platby_kiosek_zalozit(p_klic, p_oznaceni, p_klient_id) → jsonb` | service_role | záznam na pobočce zařízení; týž `klient_id` z téhož zařízení = týž záznam; strop 20/h a 60/24 h na zařízení (otázka 66); pokladna jen když je jediná (otázka 68); vrací `{zaznam, tenant, branch}` |
| `jine_platby_kiosek_pripojit_soubor(p_klic, p_zaznam, p_cesta, p_otisk) → uuid` | service_role | jen záznam téhož zařízení, nejvýš 2 hodiny starý, `rozpracovano`; cesta záznamu; soubor bez vlastníka (podepsaná adresa od serveru); typ a velikost jako `jine_platby_pripojit_soubor`; stejný otisk neprojde a hláška neprozradí cizí záznam |
| `jine_platby_kiosek_zapnout(p_tenant, p_zarizeni, p_zapnout)` | authenticated | `settings.manage` na pobočce zařízení; zapnout jen aktivní zařízení firmy s Financemi; vypnutí platí hned |

- **Aplikace:**
  - `app/kiosek/doklady/akce.ts` jsou serverové akce bez přihlášení. Všechno rozhoduje klíč zařízení v databázi.
  - `lib/jine-platby-kiosek-server.ts` řídí odeslání: podepsané adresy pro cesty z firmy a pobočky od databáze; po nahrání stažení, magic bytes, velikost ze stažených bajtů, otisk sha256, a když něco selže, smazání souboru.
  - Telefon (`kiosek-doklady.tsx`) mluví jen anon klientem bez sezení (registrace, nahrání na podepsanou adresu).
- **Co telefon nesmí:** číst cokoli z Jiných plateb nebo Financí, kromě přehledu svých dnešních dokladů bez částek (otázka 69, rozhodnutí 24. 10.). Spouštět AI nesmí taky (otázka 67).
- **Víc telefonů na pobočce** (rozhodnutí 24. 10.): `jine_platby_kiosky` má klíč jen `zarizeni_id`, nic jako „jedno na pobočku“. Strop i autor jsou na zařízení.
- **Účel zařízení** (kontrola 24. 10.): `branch_devices.ucel` je `dochazka` (výchozí, tablety) nebo `doklady` (telefon z `registrovat_zarizeni_doklady`). `app.zarizeni_podle_klice` (všechny funkce kiosku Docházky) a `pobocka_ma_kiosek` berou jen `dochazka`, `app.jp_kiosek_zarizeni` jen `doklady`. Účel jde jen zúžit (spoušť). Klíč telefonu je v prohlížeči pod `foodtab-kiosek-doklady-klic`, ne pod klíčem Docházky.
- **Opakované odeslání** (kontrola 24. 10.): `zalozit(…, p_souboru)` vrátí týž záznam jen rozpracovaný, do 2 h a pod stropem 20 vydaných adres (`kiosek_vydano`); jinak „odeslání je uzavřené“ a telefon začne nový doklad. Zámek je před opakováním.
- **Mazání** (kontrola 24. 10.): server dřív stáhl soubor z cesty od prohlížeče a po chybě ho smazal klientem služby, ještě než databáze ověřila klíč. Kdokoli tak mohl smazat i originál ve Financích. Teď nejdřív `overit_zaznam` a mazání jen přes `muze_uklidit`.
