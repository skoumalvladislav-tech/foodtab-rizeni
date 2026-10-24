# Stav k 22. 10. 2026 (doplněno 24. 10.) — Jiné platby: kiosek na telefonu pobočky (PR, nic nenasazeno)

Zadání Šéfíka 22. 10.: „u jiných plateb potřebuji vytvořit kiosek do
telefonu jako je na docházku. účty je potřeba vyfotit přes telefon,
a obsluha nemá přístup k modulu finance.“ Upřesnění: „nepotřebujeme se
přihlásit pinem“. Rozhodnutí 24. 10.: „ok otázka 69, ukazovat přehled
odeslaných dokladů za dnešek - ano. zařízení může být několik“.

Větev `jine-platby-kiosek`, PR #151. Nová migrace
`20261022100000_jine_platby_kiosek` (novější než všechny v `main`).

## Nejdřív to podstatné

- **Nic není nasazené.** Nic jsem nesloučil, `db push` jsem nespustil a do pokladny jsem nic nezapsal.
- **Jak to funguje:** telefon na provozovně je **zařízení pobočky** s účelem „doklady“. Spáruje se kódem z Nastavení → Zařízení na adrese `/kiosek/doklady` a pak se mu tamtéž zapne **Kiosek Jiných plateb**. Kiosek Docházky na něm nefunguje (oprava po kontrole 24. 10.). Kdo je u telefonu, vyfotí účet (klidně na víc fotek), nepovinně připíše poznámku a odešle. Žádné přihlášení ani PIN.
- **Doklad přijde do Finance → Tržby → Jiné platby** pobočky jako rozpracovaný záznam. Jako autor je uvedené zařízení („kiosek Telefon u baru“), ne člověk. Kontrolu, AI, tržbu, sklad i fakturu dělají ve Financích lidé s právy Jiných plateb.
- **Telefon nevidí nic z Financí.** Po odeslání ukáže „Doklad (3 fotky) odešel v 14:05“ a pod tím **přehled dokladů odeslaných z tohoto telefonu dnes**: čas, počet fotek, poznámka a stav. Žádné částky, nic z jiných telefonů ani dnů (rozhodnutí 24. 10.).
- **Telefonů pro doklady může mít pobočka víc.** Každý se páruje a zapíná zvlášť, strop i autor jsou na telefon (rozhodnutí 24. 10.).
- **Po sloučení je potřeba `db push`** (jedna migrace). Bez něj Nastavení → Zařízení přepínač neukáže a telefon napíše, že kiosek nejde použít. Finance → Jiné platby a Nastavení → Zařízení do té doby čtou bez nových sloupců. Dřív by mezi sloučením a `db push` celé Jiné platby spadly (nález kontroly).
- **Nezávislá kontrola 24. 10. (14 platných nálezů, 3 vysoké) je opravená celá.** Podrobně v oddílu „Opravy po kontrole“ níž.

## Jak je to zabezpečené

Všechno stojí na zařízení:
- **Výslovné zapnutí.** Kiosek Jiných plateb se zařízení musí zapnout (tabulka `jine_platby_kiosky`, jen správce nastavení pobočky, s auditem). Tablet Docházky tu schopnost nedostal potichu.
- **Každé volání znovu ověří klíč zařízení.** Musí být spárované a neodvolané, mít zapnutý kiosek, aktivní pobočku a firmu s Financemi. **Odvolání nebo vypnutí platí hned.**
- **Funkce kiosku smí volat jen server** (`service_role`). Telefon nemá přes databázi přímý přístup k ničemu kromě registrace, stejně jako tablet Docházky.
- **Účel zařízení.** Telefon spárovaný na `/kiosek/doklady` má účel „doklady“. Funkce kiosku Docházky (zálohy se jmény a částkami, rozpis směn, kód k píchnutí) ho nevezmou a do „má pobočka tablet“ se nepočítá. Tablet Docházky zase doklady neposílá. Účel jde jen zúžit, hlídá to spoušť.
- **Zařízení umí jen tři věci.** Založit záznam na **své** pobočce, připojit k němu fotky (jen k dokladu, který samo založilo, nejvýš 2 hodiny starému a pořád rozpracovanému) a přečíst **přehled svých dnešních dokladů**.
- **Přehled dnes** (`jine_platby_kiosek_dnes`, jen `service_role`): jen záznamy **tohoto zařízení** za **dnešní provozní den pobočky** (`app.business_date`), od nejnovějšího, nejvýš 50. Každý řádek jen `{cas, fotek, oznaceni, stav}`. Stav je jedno z: přijato, bez fotky, zkontrolováno, zpracováno (tržba zapsaná nebo propojená), zrušeno. Důvod zrušení ani částka se nevrací. Odvolané nebo vypnuté zařízení dostane chybu a telefon přehled schová.
- **Nahrávání:**
  - server vydá podepsané adresy jen pro cesty nového záznamu (firmu a pobočku dává databáze, ne telefon);
  - po nahrání soubor stáhne a typ pozná z obsahu (magic bytes);
  - velikost bere ze stažených bajtů (fotka do 5 MB, PDF do 10 MB) a otisk spočítá sám;
  - soubor s vlastníkem (nahraný přihlášeným) kiosek nepřipojí;
  - **než server cokoli stáhne, databáze ověří klíč a záznam** (`jine_platby_kiosek_overit_zaznam`) a vrátí firmu a pobočku, podle kterých se kontroluje cesta;
  - stejná fotka podruhé neprojde a hláška neprozradí, ke kterému záznamu patří; tatáž fotka u téhož záznamu (ztracená odpověď) vrátí tentýž soubor;
  - když něco selže, server smaže **jen** soubor, o kterém databáze řekne, že je to nepřipojený soubor téhož zařízení bez vlastníka (`jine_platby_kiosek_muze_uklidit`). Originál ve Financích ani cizí soubor smazat nejde.
- **Strop:** 20 dokladů za hodinu a 60 za 24 hodin z jednoho zařízení (otázka 66). Při víc telefonech na pobočce platí na každý zvlášť. Opakované odeslání vrátí týž záznam jen rozpracovaný, do dvou hodin a pod stropem 20 vydaných adres pro nahrání. Jinak je „uzavřené“ a telefon zbylé fotky pošle jako nový doklad.
- **Žádné tajné údaje** pokladny ani firmy do telefonu. Telefon dostane jen název pobočky a zařízení.
- **Žádné `set vlastni.parametr` v definici funkce.** Lekce z 22. 10.: Supabase to vlastníkovi migrací nedovolí (42501). Hlídá to test.

## Rozhodnutí v otázkách (appka jede podle nejopatrnější varianty)

- **66** Strop dokladů na telefon: 20/h, 60/24 h.
- **67** AI se z kiosku samo nespouští (rozpoznání spustí ten, kdo doklad kontroluje).
- **68** Pokladnu doplní appka sama jen tehdy, když ji pobočka má jedinou.
- **69 — ROZHODNUTÍ ŠÉFÍKA 24. 10.: ano.** Přehled dnešních dokladů z **tohoto** telefonu (čas, počet fotek, poznámka, stav), bez částek. Zbývá rozhodnout: přehled celé pobočky místo telefonu a jestli u zrušených ukazovat důvod.
- **70 — ROZHODNUTÍ ŠÉFÍKA 24. 10.: zařízení může být několik.** Appka to uměla od začátku (kiosky mají klíč jen zařízení), teď to hlídá i scénář. Spárování samo doklady nepovolí, kiosek se zapíná zvlášť. **Po kontrole:** telefon na doklady už kiosek Docházky neumí. Otázka 70 to říká Šéfíkovi i s tím, co telefon dřív viděl.

## Čísla

- **krok100 (nový scénář):** 90 kontrol. 24. 10. přibyly:
  - přehled dnes a dva telefony téže pobočky;
  - opravy po kontrole: účel zařízení a Docházka, RLS tabulky kiosků, ověření záznamu, úklid, strop adres, uzavřené odeslání;
  - po ověření: přehled bez údajů Financí, náhrobek úklidu, neměnný účel chováním, jedinečný název telefonu.
- **krok98** s upraveným počtem funkcí: 255. **Celý řetěz na PGlite:** 4 031 kontrol, nic nespadlo.
- Běželo na **PGlite**, ne na PostgreSQL. RLS ani granty to neověří, proto granty hlídají i textové kontroly migrace. Rozhodne „Migrace a scénáře“ v PR.
- **Testy aplikace:**
  - nová sada `jine-platby-kiosek` (92 kontrol) pouští skutečné serverové akce s podvrženým klientem služby (i útok z kontroly: klíč ze samých nul a cesta cizího originálu) a vykresluje skutečnou obrazovku telefonu;
  - celá sada z `aplikace.yml` 93 z 93 sad. Při posledním běhu jednou spadl `web-push`, který se ho netýká a sám projde. Padá náhodně: náhodný klíč VAPID s nulovým prvním bajtem vyjde o bajt kratší;
  - `tsc` i `eslint` čisté. Staré varování z `main` (nepoužitý import v Nastavení → Zařízení) zmizelo, protože se ten soubor měnil.
- **Schválná rozbití po ověření 59ec803:** 11 v migraci (přehled čte označení / všechny soubory / soubory Financí / neaktivní, úklid bez náhrobku, připojení náhrobek nečte, účel jde zúžit, bez spouště, název nemusí být jedinečný, jedinečnost citlivá na velikost, spárování vždy jako Docházka) a 9 v aplikaci (prázdný seznam nový doklad nezačne, nový doklad i se zbylými fotkami, kontejner se starou podmínkou, náhledy uvolní všechny, efekt náhledů s úklidem, nahrávání po limitu běží dál, přehled se neobnoví, odvolání přehled nevyprázdní, dlouhé slovo). Všechna spadla na své kontrole.
  - Dřívější sady prošly znovu: v migraci 20 + 21 + 10, v aplikaci 20 + 16 + 13.
  - Vyřadil jsem překonaná rozbití: G12/G15 (kód je nahrazený, hlídají ho I1–I5) a F3g (grant na účel; účel drží spoušť, hlídají ji H7/H8).
  - L12 odhalila slabou kontrolu obnovy přehledu po odeslání; kontrola je teď přísnější.
- **Schválná rozbití oprav po kontrole:** 21 v migraci proti krok100 a 22 v aplikaci proti testu kiosku, všechna spadla na své kontrole. Klíčové věci jsou rozbité dvěma způsoby:
  - úklid: databáze dovolí smazat připojený soubor / soubor jiného zařízení; server maže bez dovolení databáze;
  - ověření: databáze ověří cizí / uzavřený záznam; server stahuje bez ověření / bere firmu z cesty;
  - účel: Docházka bere i telefon / „má tablet“ počítá telefon / spárování bez účelu / bez spouště; telefon se páruje jako tablet / sdílí klíč s Docházkou;
  - strop adres: opakování i k uzavřenému / bez stropu / bez počítání; počet fotek do databáze nejde;
  - RLS kiosků: `using (true)` / bez pobočky.
- **Schválná rozbití přehledu dnes (24. 10.):** 10 v migraci (přehled i cizích zařízení / i jiných dnů / s údajem navíc / bez ověření kiosku / pro anon, chybějící stavy zpracováno, zrušeno a bez fotky, denní strop na pobočku místo zařízení, autor = první zařízení pobočky) a 13 v aplikaci (převzetí pustí celý řádek nebo neznámý stav, bez stropu 50, čas v UTC, server pošle data rovnou, chyba = prázdný přehled, bez kontroly klíče, nenačtený přehled jako prázdný, pořadí, „1 fotky“, starý přehled po chybě, bez obnovy po odeslání, částka na obrazovce). Všechna spadla na své kontrole. Strop na pobočku nejdřív spadl holou hláškou při plnění. Teď plnění řekne proč. Původní sady (21 + 16) znovu prošly.
- **Schválná rozbití 22. 10.:** 21 v migraci (proti krok100) a 16 v aplikaci (proti nové sadě), všechna spadla na své kontrole. Dvěma způsoby: granty funkcí kiosku (založení pro přihlášené / stav pro anon) a fotka k záznamu, kam nepatří (jiné zařízení / zkontrolovaný / starší než dvě hodiny).
- **Snímky přehledu dnes (375 px, světlý i tmavý, 24. 10.):** `docs/hlaseni/snimky-jine-platby/2026-10-24-kiosek-prehled-375*.png` — focení s přehledem. Překreslené po opravách.
- **Snímek dlouhé poznámky v přehledu (375 px, po ověření):** `docs/hlaseni/snimky-jine-platby/2026-10-24-kiosek-dlouha-poznamka-375.png`. Šířka stránky je 375 px, slovo se zalomí.
- **Snímky odesílání (375 px, světlý i tmavý, po kontrole 24. 10.):** `docs/hlaseni/snimky-jine-platby/2026-10-24-kiosek-odesilani-375*.png` — tlačítko „Zrušit odesílání“ a „Hotovo — vyfotit další doklad“. Nic nepřetéká do šířky a žádné tlačítko není menší než 44 px.
- **Snímky telefonu (375 px, světlý i tmavý):** `docs/hlaseni/snimky-jine-platby/2026-10-22-kiosek-375*.png`. Jde o statické vykreslení skutečné obrazovky. Nic nepřetéká do šířky a žádné tlačítko není menší než 44 px.

## Na co jsem narazil

- **Docházka neměla u zařízení žádný „účel“.** Původně jsem psal, že na telefonu jde jen píchnout PINem. Kontrola ukázala, že telefon otevřel celý kiosek Docházky: zálohy se jmény a částkami, rozpis směn i živý kód. Teď má zařízení účel (viz výš).
- **Nepřipojené fotky z kiosku nikdo průběžně neuklízí.** Vzniknou, když telefon nahraje fotku a pak vypadne (nedojde na dokončení). Server je smaže jen během dokončení. Počet drží stropy (20 dokladů za hodinu, 20 adres na doklad, soubor do 10 MB) a kbelík je soukromý. Úklidová úloha (soubory bez vlastníka, bez řádku v `jine_platby_soubory`, starší než pár hodin) je další práce. pg_cron v ostré databázi zatím neběží.
- **Časový limit a Zrušit:** telefon po 45 s (akce) / 90 s (jedna fotka) napíše „Spojení je pomalé“ a odesílání jde zrušit. Fotky zůstanou jen v paměti prohlížeče. Když systém prohlížeč po fotoaparátu ukončí, je potřeba fotit znovu. Ukládání do telefonu (IndexedDB) jsem nedělal.
- **Nahrávání bez přihlášení:** serverová akce má strop těla 1 MB a Vercel kolem 4,5 MB, fotka může mít 5 MB. Proto podepsané adresy přímo do úložiště.
  - **Neověřeno naživo:** že soubor nahraný přes podepsanou adresu vydanou serverem nemá v úložišti vlastníka (`owner` prázdné, servisní klíč nemá `sub`). Databáze to vyžaduje. Kdyby Supabase vlastníka vyplnil, připojení fotky spadne s „Soubor nahrál někdo jiný“ — první skutečné odeslání to ukáže hned.
- **Pobočky scénáře se uklízí označením** (`deleted_at`), ne výmazem. Audit na ně ukazuje, stejně jako v krok24.
- **Mimo zadání, ale vážné (z průzkumu kiosku Docházky):** otisky PINů a klíčů zařízení jsou možná čitelné. Sloupcové granty v produkci nejspíš nefungují kvůli výchozím právům Supabase a audit kopíruje celé řádky PINů do `audit_log`. Čtyř- až šestimístný PIN jde z otisku dopočítat. Navrhuji to jako samostatnou práci, v tomhle PR jsem na Docházku nesahal.

## Opravy po kontrole (24. 10.)

Nezávislá kontrola #151 (stav e50e6e9) našla 14 platných nálezů. Opravené jsou všechny:

- **VYSOKÉ — mazání cizích souborů.** Dřív server stáhl soubor z cesty od prohlížeče a po jakékoli chybě ho smazal klientem služby, ještě než databáze ověřila klíč. Kdokoli bez klíče tak mohl smazat i připojený originál ve Financích, i cizí firmy. Teď nejdřív `jine_platby_kiosek_overit_zaznam` (klíč, záznam téhož zařízení, otevřený) a firmu a pobočku pro kontrolu cesty dává databáze. Smazat jde jen přes `jine_platby_kiosek_muze_uklidit` (záznam téhož zařízení, jeho cesta, bez vlastníka, nepřipojený).
- **VYSOKÉ — telefon jako kiosek Docházky.** Zařízení má účel. Telefon na doklady Docházku neumí, má vlastní klíč v prohlížeči a do „má pobočka tablet“ se nepočítá.
- **STŘEDNÍ — opakovaný klíč odeslání obcházel strop** a vydával adresy pro nahrání bez konce. Teď opakování jen k otevřenému záznamu do dvou hodin a nejvýš 20 adres na doklad (databáze je počítá).
- **STŘEDNÍ — Finance mezi sloučením a `db push`.** Výpis, detail i akce čtou se zálohou bez nových sloupců (`cistSeZalohou`). Totéž Nastavení → Zařízení.
- **STŘEDNÍ — kiosek se zasekl na starém záznamu.** Po „odeslání je uzavřené“ telefon vezme nový klíč odeslání a zbylé fotky pošle jako nový doklad. Tatáž fotka po ztracené odpovědi skončí na „Odesláno“. K už odeslaným fotkám se další přidávají jako nový doklad. Když všechno odešlo, obrazovka nabídne „Hotovo — vyfotit další doklad“.
- **NÍZKÉ:**
  - krok100 teď sahá na RLS tabulky kiosků;
  - odesílání má časový limit a tlačítko „Zrušit odesílání“;
  - náhledy fotek se ruší jen u fotek, které ze seznamu zmizely.

## Po ověření 59ec803 (24. 10. večer)

Ověření potvrdilo obě vysoké opravy: útoky U1–U14 nic nestáhly ani nesmazaly, telefon Docházku neodemkne a stávající tablety po `db push` dál fungují. Zbylé nálezy:

- **STŘEDNÍ — přehled ukazoval údaje z Financí.** Vracel aktuální `oznaceni`, které Finance přepisují (i s částkou), a počítal i soubory připojené ve Financích.
  - Teď vrací `kiosek_oznaceni`. Zapíše ji jen založení z telefonu a nic ji nemění.
  - Počítá jen aktivní fotky tohoto telefonu.
- **STŘEDNÍ — další účet do starého záznamu.** Po nezdařeném nebo zrušeném odeslání a vyprázdnění seznamu šel další účet pod starým klíčem odeslání do starého záznamu i se starým označením.
  - Teď rozhoduje čistá funkce `zacinaNovyDoklad`: prázdný seznam nebo všechno odeslané znamená nový klíč, otestováno chováním.
  - Po „Zrušit odesílání“ se klíč nemění, dokud v seznamu zůstanou neodeslané fotky. Opakované odeslání téhož účtu tak nezaloží druhý, prázdný záznam. Jiný účet znamená fotky odebrat a pak už platí prázdný seznam, tedy nový klíč.
- **NÍZKÉ:**
  - **Souběh úklidu a připojení:** `muze_uklidit` rozhoduje pod zámkem řádku záznamu (stejným jako připojení) a „ano“ zapíše jako náhrobek cesty (`jine_platby_kiosek_uklid`). Připojení náhrobek odmítne.
  - **Účel zařízení:** nastaví se při spárování a potom se nemění vůbec, ani zúžit. Hlídá to spoušť, protože sloupcové granty v produkci nedrží. krok100 to zkouší chováním (přímý zápis v obou směrech, i jako vlastník databáze), ne grantem.
  - **Jedinečný název telefonu:** dva aktivní telefony téže pobočky se stejným názvem spárovat nejde (velikost písmen a mezery nerozhodují). Nepovedené spárování kód nespotřebuje. Tablety Docházky se nekontrolují, opětovné spárování tabletu bez odvolání starého by jinak přestalo jít.
  - **Přehled se obnovuje sám:** každou minutu a po návratu na obrazovku. Odvolané nebo vypnuté zařízení ho vyprázdní.
  - **375 px:** dlouhé slovo v poznámce přehledu se zalomí.
  - **Limit:** po vypršení limitu nebo chybě se nahrávání opravdu přeruší (abort).
- **Ověřeno i chováním:** prohlížečový harness ověřovatele nad skutečnou komponentou (headless Chrome, podvržené jen serverové akce a úložiště). Prošlo všech 7 scénářů:
  - S1: vyprázdněný seznam dá nový klíč;
  - S2 / S2c: uzavřeno;
  - S2b: výpadek klíč nechá;
  - S3: náhledy;
  - S4: Zrušit;
  - S5: po limitu jsou obě nahrávání přerušená.
  Harness neběží v CI (chce Chrome). Do repa jsem dal čisté funkce s testem chováním a kontroly zapojení.

**Zbývá (navazující práce nebo rozhodnutí):**
- **Úklid nepřipojených fotek z kiosku** (soubory bez vlastníka, starší než 2 h, bez řádku v `jine_platby_soubory`). Musí běžet pod service_role přes Storage API, pg_cron v ostré DB zatím neběží. Strop je asi 1 200 nahrání po 10 MB denně na telefon.
- **Účel už v registračním kódu:** dnes ho určuje adresa, na které se kód opíše. Kód „pro telefon“ opsaný na `/kiosek` dá tablet Docházky; správce to pozná podle štítku v Nastavení. Pevně by to drželo jen uložení účelu do `device_registrations` při vystavení kódu. To mění formulář kódu i registraci Docházky, proto zvlášť.
- **Serverové akce pouští Next jednu po druhé.** Když serverová akce visí, další volání (i přehled) čekají ve frontě. Limit telefonu jen přestane čekat. Opravou by bylo volat kiosek přes route handler s `AbortSignal`.
- **Fotky během odesílání jen v paměti** (bez IndexedDB).

## Nenasazoval jsem

- `db push`: **ne.** Migrace `20261022100000` není v ostré databázi.
- Sloučení PR: **ne.**
- Zápis do pokladny, proměnné ve Vercelu, n8n, Salt Edge: **beze změny.**
