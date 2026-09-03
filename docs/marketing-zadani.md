# Návrh: modul Marketing

Napsal Claude 3. 9. 2026, na základě týdne práce na automatizaci Černé Perly
(samostatný n8n workflow) a Šéfíkova zadání „přemýšlejme globálně, tuhle
workflow budu chtít implementovat do RSA appky". **Tohle je návrh, ne
zadání ani závazné rozhodnutí** — čeká na Šéfíkovo schválení/úpravy, stejně
jako `docs/modul-menu-zadani.md` čekalo na svou první verzi.

Modul `marketing` a jeho tři oprávnění (`marketing.read`, `marketing.manage`,
`marketing.publish`) už existují v `supabase/migrations/20260823120100_catalog.sql`
— založené hned na začátku (etapa 0), ale zatím nezastavěné žádnou obrazovkou
ani tabulkou. Tenhle dokument navrhuje, co do nich patří.

> **Šéfík tenhle návrh 3. 9. 2026 schválil ("ok to sedí, tak se do toho
> pusť").** První krok z oddílu 7 je hotový v kódu:
>
> - `supabase/migrations/20260903040000_marketing_tabulky.sql` — pět tabulek
>   (`marketing_settings`, `marketing_integrations`, `marketing_photos`,
>   `marketing_templates`, `marketing_posts`), každá s `tenant_id` a RLS.
>   Oddíl 4 navrhoval `marketing_photo_sources` jako samostatnou tabulku
>   vedle `marketing_integrations` z oddílu 8.3 — migrace je nezakládá obě,
>   protože by řešily totéž; `marketing_integrations` dělá práci obecněji
>   (viz komentář v hlavičce migrace).
> - `app/[rozsah]/marketing/page.tsx` — prázdná obrazovka podle vzoru
>   `menu/page.tsx`, kontroluje `marketing.read`. Položka v `nabidka.ts`
>   přepnutá na `hotovo: true`.
> - `supabase/tests/marketing1_scenar.sql` — scénář: pravidlo 5 (vypnutý
>   modul odmítne i přímé volání), a hlavně že **`marketing.publish` je
>   jediné oprávnění, které smí posunout příspěvek do `publikovano`** —
>   ověřeno vlastní rolí jen s `marketing.manage`, které to spoušť
>   databáze odmítne.
>
> **3. 9. 2026 večer:** v `CLAUDE.md` přibyl oddíl „Dvě relace v jednom
> repozitáři" — provoz a marketing píšou do téhož repozitáře souběžně.
> Podle něj se scénář přejmenoval z `krok18_scenar.sql` na
> `marketing1_scenar.sql` (vlastní číselná řada) a marketing od teď patří
> na větev `marketing`, ne na `main` — nasazuje se výhradně z `main`.
>
> Zadání pro Codea navíc obsahovalo spor: „ostrá data neměň" proti
> „zapnout modul naostro na Černé Perle" — zapnutí modulu v ostré
> databázi JE zásah do ostrých dat. Opraveno: modul `marketing` v ostré
> databázi nezapíná Code, zapíná si ho výhradně Šéfík sám, až bude
> marketing chtít vidět. Zároveň bylo to původní znění nepřesné i
> věcně — moduly se zapínají za celou firmu, ne za pobočku
> (`tenant_modules` klíč `(tenant_id, module_key)`, žádný sloupec pro
> pobočku; zapínání po pobočkách by byla změna základu, ne detail).
> Podrobnosti a co z toho plyne pro implementaci jsou v
> `docs/zadani-marketing-pro-codea.md`.
>
> **Migrace ještě NENÍ nasazená** — Claude nemá na tomhle počítači k
> dispozici shell, takže `supabase db push` a `supabase/tests/run.sh` musí
> spustit Šéfík (nebo Code) ručně. Skutečné navrhování a publikování
> příspěvků (bod 7, krok 4 — REST API pro n8n) zůstává samostatný,
> pozdější krok.

---


## 1. Co ten modul je a co není

Stejné rozlišení jako u Tvorby menu, jen o úroveň dál v řetězci:

| | kde | co to je |
|---|---|---|
| **Jídelní lístky** | Provoz, beze změny | Co dnes restaurace skutečně nabízí. Zdroj pravdy |
| **Tvorba menu** | modul `menu` | Dílna, která navrhuje SLOŽENÍ lístku |
| **Marketing** | modul `marketing`, tento návrh | Dílna, která ze SCHVÁLENÉHO lístku navrhuje, jak se o něm dozví zákazníci |

**Marketing je nástroj, který propaguje. Není to místo, kde se pořizuje
grafika ručně, ani sociální síť sama.** Agent navrhne denní příspěvek
(text + grafiku) z toho, co je dnes na jídelníčku; člověk s
`marketing.publish` ho buď pustí ven, nebo ne. Nikdy automaticky.

Vztah k Tvorbě menu je jednosměrný a volitelný: pokud firma Tvorbu menu
používá, Marketing čte její VÝSLEDEK (schválený lístek), ne její návrhy.
Pokud firma Tvorbu menu nepoužívá (lístek zadává ručně, jako dnes Černá
Perla), Marketing čte přímo `Jídelní lístky`. V obou případech Marketing
nikdy nerozhoduje o tom, co se vaří — jen o tom, jak se to řekne ven.

---

## 1a. Kdo vlastní grafiku (doplněno 3. 9. 2026 večer, reakce na dotaz)

Šéfík se ptal, komu svěřit grafickou část menu, ať se nedělá dvakrát —
Tvorbě menu (interně „AI agent denního menu", viz `docs/modul-menu-zadani.md`)
i Marketingu by se totiž teoreticky mohlo hodit vykreslit hezký obrázek.

**Odpověď: grafika patří výhradně Marketingu. Tvorba menu zůstává čistě
textová/datová a nevlastní žádný render.** Důvod je stejný jako u Receptur/
Jídelních lístků výše — jde o to, co je ČÍ zodpovědnost, ne o to, kde je to
technicky pohodlnější:

- **Tvorba menu rozhoduje O JÍDLE** — co se vaří, za kolik, v jakém počtu
  chodů, jak často se smí opakovat. To je gastronomické a obchodní
  rozhodnutí, které dělá hostinský/kuchař. Vlastní zadání to takhle přesně
  popisuje (oddíl 1: „Dílna... navrhuje denní menu i stálý lístek za
  předem zadaných podmínek") — o vzhledu, barvách ani šablonách tam není
  ani zmínka, a je to tak správně.
- **Marketing rozhoduje O TOM, JAK TO VYPADÁ VEŘEJNĚ** — branding, barvy,
  font, logo, grafické šablony (bod 3 níže) jsou svou podstatou značková/
  marketingová věc, ne kuchařská. I kdyby Tvorba menu chtěla někdy tištěný/
  vizuální výstup lístku (cedule na dveře, QR displej), NEMÁ si stavět
  vlastní renderer — zavolá STEJNOU render kapacitu, kterou vlastní
  Marketing (stejné šablony, stejné brand parametry z `marketing_settings`),
  jen s jiným typem šablony („lístek k vyvěšení" místo „sociální příspěvek").
  Přesně tak se nedělá práce dvakrát.
- Praktický tok dat je tedy jednosměrný a čistý: **Tvorba menu vyprodukuje
  DATA (jídla, ceny, popisy) → Marketing k nim přidá SVOJE (branding,
  šablonu, text příspěvku, fotku) → zavolá render.** Kdyby Tvorba menu
  posílala do renderu i vlastní rozhodnutí o vzhledu, vznikly by dvě různá
  místa, která by si mohla časem odporovat (přesně proti duchu pravidla
  „o přístupu rozhoduje jediné místo" z `CLAUDE.md` — stejný princip platí
  i na rozhodování o vzhledu).

Prakticky to pro modul Marketing nic nemění oproti bodu 5 níže — jen to
potvrzuje, že `marketing_templates`/`marketing_settings` (branding, sada
šablon) mají zůstat tam, kde je v tomhle návrhu mám (bod 4), a NE se
přesouvat nebo duplikovat do modulu `menu`.

---

## 2. Co jsme se naučili na Černé Perle a co z toho platí obecně

Černá Perla běžela celý týden jako `n8n` workflow mimo Foodtab, natvrdo
napsaný pro jednu restauraci. Opravovali jsme na něm postupně čtyři třídy
chyb, a každá z nich je poučení pro to, jak modul postavit, ne jen jak
opravit jeden workflow:

- **Externí zdroj menu (scraping webu) je nejkřehčí článek.** Každá další
  restaurace má jiný web/systém — psát scraper na míru není udržitelné.
  **Pokud firma používá Foodtabovy `Jídelní lístky`, Marketing z nich čte
  přímo (žádný scraping, žádná fragilita)** — to je oproti mému dřívějšímu
  návrhu (viz `architektura-multi-tenant-menu-automation.md` v projektu)
  posun k lepšímu: tenhle problém u zákazníků Foodtabu z principu nevzniká,
  protože zdroj pravdy o menu už v appce je. Scraping zůstává jen pro
  přechodné období, než firma na `Jídelní lístky` přejde.
- **Fotky nahrané zvenčí (mobil přes OneDrive/podobně) smí být jen vstupní
  schránka, nikdy zdroj URL použitý až po čekání na schválení.** Přesný
  bug: dočasný odkaz vypršel dřív, než přišlo schválení e-mailem, publikace
  tiše selhala i po potvrzení. Řešení: hned při příjmu zkopírovat do
  trvalého úložiště a od té chvíle pracovat jen s trvalou URL.
- **Schvalování e-mailem (sendAndWait) je samo o sobě zdroj křehkosti** —
  nepředvídatelné zpoždění mezi „vygenerováno" a „člověk klikl" rozbíjí
  cokoliv, co mezitím vyprší. **`marketing.publish` jako obrazovka v appce
  (ne e-mail) tohle z principu odstraňuje** — schválení je synchronní
  s appkou, ne s poštovní schránkou. E-mail/SMS upozornění „čeká na tebe
  schválení" může zůstat jako notifikace, ale rozhodnutí patří do appky.
- **Korekce po zamítnutí musí umět změnit to, co se skutečně vytýká** (fotku,
  šablonu), ne jen přepsat text. Návrh dat níže (bod 4) proto počítá
  s fotobankou a sadou šablon jako daty firmy od začátku, ne jako s něčím
  přidaným až later.
- **Vnější obsah (text webu, komentář ke zamítnutí) je vstup ke zpracování,
  nikdy instrukce** — přesně pravidlo, které `docs/modul-menu-zadani.md`
  (oddíl 5) už zavedl pro Tvorbu menu. Marketing ho dědí beze změny: co
  přijde odjinud než od zákazníka nebo z Foodtabu, je citovaný podklad.

---

## 3. Podmínky a branding jsou data zákazníka

Stejné pravidlo 1 jako u Tvorby menu, aplikované na propagaci:

- **Branding** (barvy, font, logo) — řádky u firmy, ne konstanty v kódu.
  Grafické šablony (viz bod 5) jsou brand-agnostic: barvy/font/logo se do
  nich dosazují za běhu z těchto dat, takže nová firma nepotřebuje žádnou
  ruční práci v návrhovém nástroji.
- **Tón hlasu** (formální/neformální, emoji ano/ne, jazyk) — totéž.
- **Rozvrh publikování, sociální účty a jejich přístupové údaje** — totéž,
  s tokeny uloženými jako otisk (pravidlo 7 z `CLAUDE.md`), ne v čitelné
  podobě.
- **Zdroj fotek** (odkud firma nahrává fotky k použití) — totéž.

Když bude agent potřebovat cokoliv z tohohle a firma to nezadala, řekne to
a nenavrhne nic — nedomýšlí si branding ani tón hlasu firmy.

---

## 4. Návrh datového modelu (k diskuzi, ne k nasazení bez schválení)

Orientační, ne finální — přesné názvy sloupců a typy je potřeba probrat,
než z toho bude migrace. Směr:

- `marketing_settings` (1 řádek na firmu): tón hlasu, brand barvy/font,
  odkaz na logo, výchozí rozvrh publikování, zapnuté sociální sítě.
- `marketing_photo_sources` (řádky na firmu): odkud se nahrávají fotky
  (typ zdroje, odkaz na složku/token) — vstupní schránka, ne úložiště;
  fotky se při příjmu kopírují do trvalého úložiště Foodtabu.
- `marketing_photos`: trvale uložené fotky firmy, s volitelným AI tagem
  (interiér/teras/jídlo X), aby korekční agent uměl vyhledat podle popisu.
- `marketing_templates`: sada grafických šablon firmy (brand-agnostic,
  barvy/font/logo se dosazují za běhu) — víc než jedna, aby bylo z čeho
  rotovat.
- `marketing_posts`: jednotlivé navržené příspěvky — den, text, grafika,
  zdrojová data (ze kterého lístku vznikl, jaké podmínky platily — stejný
  požadavek na dohledatelnost jako u návrhů Tvorby menu), stav (navrženo /
  schváleno / zamítnuto s připomínkou / publikováno), kdo a kdy rozhodl.

`marketing.read` vidí `marketing_posts` a `marketing_settings`.
`marketing.manage` je může měnit (a spouštět nový návrh, `marketing.manage`
∼ obdoba `menu_ai.use`/`menu_ai.manage`). `marketing.publish` (citlivé,
už tak označené v katalogu) je jediné oprávnění, které smí posunout
příspěvek ze „schváleno" do „publikováno" — přesně `approvals.decide`
princip z Tvorby menu, jen vlastním oprávněním modulu, protože jde
o nevratnou veřejnou akci (zveřejnění na sociální síti), ne jen
o schválení interního návrhu.

---

## 5. Kde zůstává hranice s n8n (a jestli vůbec)

Tohle je otevřená otázka (viz bod 6), ale můj doporučený směr: **Foodtab
vlastní data a rozhodnutí (config, schvalování, historie); samotné
generování grafiky (Bannerbear nebo budoucí HTML/CSS renderer) zůstává
mimo appku**, volané přes REST API stejně, jako dnes n8n volá Bannerbear.
Duvod: přestavět Bannerbearův render engine v TypeScriptu by byl měsíce
práce navíc bez obchodní hodnoty — appka nemusí sama kreslit obrázky,
potřebuje jen vlastnit pravdu o tom, CO se má vykreslit a KDO to schválil.

n8n (nebo jeho nástupce) by pak byl `agents.manage`-scoped „interní
zaměstnanec" appky: čte `marketing_settings`/`marketing_photos`/aktuální
lístek přes API, generuje návrh, zapisuje ho zpět jako `marketing_posts`
řádek ve stavu „navrženo". Appka feed zobrazí, člověk schválí nebo zamítne
s připomínkou (přímo v appce, ne e-mailem) → n8n na to zareaguje (dokoná
render, případně přegeneruje podle připomínky — přesně logika, kterou jsme
tento týden stavěli pro Černou Perlu) → appka dostane zpátky „publikováno".

---

## 6. Co ještě nevím a musím se zeptat

Přesně v duchu oddílu 7 zadání Tvorby menu — tohle se nedomýšlí:

- Má se n8n workflow Černé Perly stát tím prvním „zaměstnancem", který
  volá nové Foodtab API, jakmile API vznikne? Nebo se má logika (scraping/
  generování/render) přepsat přímo do appky a n8n opustit úplně?
- Který kanál řízení se má postavit první — schvalování v appce (nahradí
  e-mail), nebo tenant konfigurace (branding/fotobanka/šablony)? Obojí je
  potřeba, ale dá se dělat postupně.
- Má Marketing číst `Jídelní lístky` už teď (i když je zatím používá jen
  interně Foodtab), nebo se má nejdřív ověřit na Černé Perle se scrapingem,
  a přechod na `Jídelní lístky` řešit až jako druhý krok?
- Sociální sítě kromě Instagramu (Facebook je u Černé Perly záměrně
  odložený) — má to platit obecně pro modul, nebo je to jen dočasná
  vlastnost prvního zákazníka?
- Šéfík zmínil Canvu jako místo, kde by se navrhoval branding/šablony —
  ověřil jsem, že Canva API neumí automatické vyplnění šablony daty (jen
  ruční Bulk Create v UI), takže Canva může být nanejvýš návrhový nástroj
  pro to, jak šablony vypadají v Bannerbear, ne živá součást appky. Souhlasí
  Šéfík s touhle rolí, nebo si představoval něco jiného?
- **Zapínají se moduly i po pobočkách, nebo jen za celou firmu?** (Dotaz
  vzešel 3. 9. 2026 z kontroly implementace.) Dnes `tenant_modules` má
  klíč `(tenant_id, module_key)` — modul jde zapnout jen za celou firmu,
  ne pro jednu pobočku zvlášť. Pro Marketing by to mohlo vadit u firmy
  s víc pobočkami, která chce sítě řešit jen na jedné z nich — ale
  rozšíření na pobočkovou úroveň je změna základu (`tenant_modules`),
  ne detail modulu Marketing. Nedomýšlí se, dokud to Šéfík nepotvrdí.
- **Kontakty hostů a pravidlo 8.** Až přijde skutečné navrhování s
  informacemi o hostech/zákaznících (ne jen jídelníček a fotky
  interiéru), platí totéž, co pravidlo 8 už zakazuje u mezd a docházky
  — kontakty do jazykového modelu nejdou. U hostů navíc přibývá GDPR
  souhlas. Návrh datového modelu (oddíl 4) s tím zatím nepočítá vůbec
  (žádná tabulka s kontaktem hosta) a než taková tabulka/funkce vznikne,
  potřebuje vlastní zadání — postup souhlasu, co smí a nesmí k modelu,
  jak dlouho se co uchovává.

---

## 7. Co udělat jako první krok (návrh, čeká na potvrzení)

Stejně minimalisticky jako u Tvorby menu — jen tolik, aby vzniklo pevné
místo, na které se dá stavět dál, ne rovnou celá funkce:

1. Probrat a doladit datový model (bod 4) — pak migrace: čtyři nové tabulky,
   `tenant_id` a RLS na každé (pravidlo 3), žádné nové oprávnění (ta tři
   už existují).
2. Prázdná obrazovka modulu (`app/[rozsah]/marketing/...`) — stejný vzor
   jako `app/[rozsah]/menu/page.tsx`: ověří `marketing.read`/`manage`
   přes `zkusPristup`, zatím jen „připravujeme".
3. Kontrola v testech (`supabase/tests/etapa0_scenar.sql` nebo nový
   scénář): vypnutý modul / chybějící oprávnění odmítne přímé volání
   (pravidlo 5), stejně jako se to ověřilo u Tvorby menu.
4. Teprve POTOM (samostatný krok, ne součást tohohle) — první REST API
   endpoint, na který by se dal napojit n8n workflow Černé Perly jako
   testovací první tenant.

Nic z bodu 7 jsem ještě nenapsal do kódu ani do migrace — čekám na to,
až tenhle návrh (hlavně body 4–6) projdeš a řekneš, co sedí a co ne.

---

## 8. Obecný přístup: zaměnitelné integrace, ne natvrdo zadrátované nástroje

Doplněno 3. 9. 2026 na Šéfíkovu žádost — prošel jsem web (podobné produkty,
API pro sociální sítě, API pro grafiku) a promyslel, jak modul postavit
tak, aby fungoval pro každého zákazníka od nuly, bez ohledu na to, jaké
nástroje už má (Canva/nic, OneDrive/Google Drive/nic).

### 8.1 Co jsem zjistil na trhu

Podobné produkty existují a potvrzují směr, který už tenhle návrh má:

- **[PostMyPlatter](https://postmyplatter.com/)** — nejbližší přímé srovnání.
  Restaurace nahraje fotku jídla, vybere šablonu a barevnou paletu, doplní
  název/cenu, AI dopíše popisek. Přesně princip „brand-agnostic šablona +
  data zákazníka" z bodu 3 tohoto návrhu. Placené ($10–15/měsíc), branding
  (logo, název, adresa, telefon) je předvyplněný z účtu — tj. jsou to data
  firmy, ne konstanty, stejně jako navrhuju v bodě 3.
- **[Malou](https://www.malou.io/)** — širší francouzská platforma pro
  marketing/reputaci restaurací, řeší i automatizaci příspěvků. Zajímavá
  jako inspirace pro rozsah (víc než jen denní příspěvek), ne jako přímý
  vzor pro tuhle první verzi.
- **Popmenu, Apaya a podobné** — širší „udělej to za mě" platformy, často
  za cenu ztráty kontroly nad vzhledem/tónem (viz zjištění z dřívějšího
  výzkumu v projektu — prodejně uzavřené, netransparentní ceny). Přesně
  proti tomu, co Šéfík chce („chci mít vliv na vzhled a výstupy").

Žádný z nich neřeší vícenájemnost (jeden dodavatel, mnoho různě vybavených
zákazníků) — jsou to buď nástroje pro JEDNU restauraci, nebo agenturní
nástroje s ručním nastavením pro každého klienta zvlášť. To je přesně
mezera, do které Foodtab modul Marketing míří.

### 8.2 Princip: kategorie integrace, ne konkrétní nástroj

Aby platilo „data jdou od nuly, každý zákazník má jiné vstupy", nesmí se
nikam v kódu ani v datovém modelu objevit natvrdo „OneDrive" nebo „Canva".
Místo toho každá potřeba modulu je **kategorie**, pro kterou existuje jeden
vestavěný Foodtab výchozí způsob (funguje pro každého, nulové nastavení) a
volitelně jeden nebo víc **konektorů** — pro zákazníky, kteří chtějí použít
to, co už mají.

| Kategorie | Vestavěný výchozí způsob (funguje vždy) | Volitelný konektor (zapíná si zákazník sám) |
|---|---|---|
| **Zdroj menu** | Ruční/AI-asistovaný vstup v appce, nebo přímo `Jídelní lístky` (bod 1) | Scraping konkrétního webu — jen jako přechodné řešení |
| **Fotky** | Nahrání přímo v appce (mobil, fotoaparát/galerie) — stejně jako to dělá PostMyPlatter | OneDrive, Google Drive, Dropbox, WhatsApp — automatický import do stejného trvalého úložiště |
| **Vzhled/branding** | Barvy, font, logo zadané v appce (color picker, upload) | Canva jako READ-ONLY vizuální reference pro člověka, který šablony navrhuje — nikdy runtime závislost (potvrzeno: Canva API neumí automatický render, viz bod 0 z 3. 9.) |
| **Vykreslení grafiky** | Interní volba Foodtabu (dnes Bannerbear) — zákazník o tom vůbec neví | — (tohle NENÍ zákaznický konektor, je to Foodtabova infrastruktura, viz 8.3) |
| **Publikování na sítě** | Sjednocené API (viz 8.4) — funguje pro každého bez čekání na schválení od Meta | Přímé napojení vlastním Meta/TikTok/Google účtem vývojáře — later, až bude objem |
| **Text/AI obsah** | Interní volba Foodtabu (dnes OpenAI) — zákazník o tom neví | — (totéž jako vykreslení, Foodtabova infrastruktura) |

Poslední dva řádky jsou důležité rozlišení: **ne všechno je zákaznický
konektor.** Vykreslení grafiky a AI generování textu jsou věci, které
zákazník nevidí a nevybírá — Foodtab je může kdykoliv v budoucnu vyměnit
(dnešní Bannerbear za HTML/CSS renderer, dnešní OpenAI za jiný model),
aniž by se cokoliv u zákazníka změnilo. Naopak fotky, branding a sociální
účty jsou VŽDY zákazníkova data/identita — tam nejde vybrat za něj.

### 8.3 Praktický dopad na datový model (rozšíření bodu 4)

Jedna nová tabulka navíc k bodu 4: `marketing_integrations` (nebo obecněji
`tenant_integrations`, pokud by se to mělo hodit i jiným modulům) — řádek
na firmu + kategorii (`fotky`, `zdroj_menu`, `socialni_site`), typ
zvoleného konektoru (`nativni`, `onedrive`, `google_drive`, ...) a
přístupové údaje jako otisk (pravidlo 7). Kód se na konkrétní konektor ptá
přes jedno rozhraní („dej mi novou fotku ze zdroje firmy X") — přidání
podpory pro Dropbox pak znamená napsat jeden nový adaptér podle existujícího
tvaru, ne přepisovat zbytek modulu. Přesně stejný princip, jaký `CLAUDE.md`
už vyžaduje pro přístupová práva („o přístupu rozhoduje jediné místo") —
tady jde o zdroj dat, princip je stejný.

### 8.4 Publikování na sítě — proč nejít hned napřímo na Meta

Zjištění, které mění doporučení oproti mému prvnímu návrhu (bod 5): přímé
napojení na Instagram/Facebook Graph API (jak to dnes dělá Černá Perla)
funguje pro JEDNOHO zákazníka snadno, ale pro víc different-firem najednou
vyžaduje, aby Foodtab prošel Metovým **App Review na „Advanced Access"**
— ověření firmy, zveřejněné zásady ochrany údajů, adresu pro smazání dat,
zdůvodnění každého oprávnění a ukázkové video pro každé z nich. Není to
nepřekonatelné, ale je to jednorázová administrativní zátěž navíc k vývoji.

**Doporučení pro první verzi: použít sjednocené API pro publikování
(např. [Ayrshare](https://www.ayrshare.com/) — cílené přímo na „multi-tenant
products", řeší OAuth, obnovu tokenů i oddělení nájemců za vás, pokrývá
Instagram, Facebook, TikTok, Google Business Profile a další jedním
rozhraním).** Je to placená služba (řádově desítky dolarů/měsíc + podle
objemu), ale ušetří přesně tu administrativní zátěž a zrychlí start na
druhém a třetím zákazníkovi. Vlastní přímé napojení (a tedy i vlastní
Metovo schválení) dává smysl až ve chvíli, kdy poplatky za zprostředkování
překročí náklad na to schválení si udělat sám — to je otázka objemu
zákazníků, ne architektury, a dá se to vyměnit později za stejným principem
jako u fotek/renderu (kategorie s vyměnitelným poskytovatelem).

### 8.5 Co to znamená pro bod 7 (první krok)

Bod 7.4 („první REST API endpoint pro n8n") bych doplnil o krok 7.5:
**vyzkoušet Ayrshare (nebo ekvivalent) na testovacím Instagram účtu ještě
předtím, než se cokoliv staví v appce** — je to nejrizikovější neznámá
(cena, podporované funkce, spolehlivost) a je levné si to ověřit dřív, než
na tom závisí datový model `marketing_integrations`.

