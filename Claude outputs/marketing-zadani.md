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
