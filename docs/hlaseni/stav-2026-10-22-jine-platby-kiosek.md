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
- **Jak to funguje:** telefon na provozovně je **zařízení pobočky**, stejně jako tablet Docházky. Spáruje se kódem z Nastavení → Zařízení a pak se mu tamtéž zapne **Kiosek Jiných plateb**. Kdo je u telefonu, vyfotí účet (klidně na víc fotek), nepovinně připíše poznámku a odešle. Žádné přihlášení ani PIN.
- **Doklad přijde do Finance → Tržby → Jiné platby** pobočky jako rozpracovaný záznam. Jako autor je uvedené zařízení („kiosek Telefon u baru“), ne člověk. Kontrolu, AI, tržbu, sklad i fakturu dělají ve Financích lidé s právy Jiných plateb.
- **Telefon nevidí nic z Financí.** Po odeslání ukáže „Doklad (3 fotky) odešel v 14:05“ a pod tím **přehled dokladů odeslaných z tohoto telefonu dnes**: čas, počet fotek, poznámka a stav. Žádné částky, nic z jiných telefonů ani dnů (rozhodnutí 24. 10.).
- **Telefonů pro doklady může mít pobočka víc.** Každý se páruje a zapíná zvlášť, strop i autor jsou na telefon (rozhodnutí 24. 10.).
- **Po sloučení je potřeba `db push`** (jedna migrace). Bez něj Nastavení → Zařízení přepínač neukáže a telefon napíše, že kiosek nejde použít.

## Jak je to zabezpečené

Všechno stojí na zařízení:
- **Výslovné zapnutí.** Kiosek Jiných plateb se zařízení musí zapnout (tabulka `jine_platby_kiosky`, jen správce nastavení pobočky, s auditem). Tablet Docházky tu schopnost nedostal potichu.
- **Každé volání znovu ověří klíč zařízení.** Musí být spárované a neodvolané, mít zapnutý kiosek, aktivní pobočku a firmu s Financemi. **Odvolání nebo vypnutí platí hned.**
- **Funkce kiosku smí volat jen server** (`service_role`). Telefon nemá přes databázi přímý přístup k ničemu kromě registrace, stejně jako tablet Docházky.
- **Zařízení umí jen tři věci.** Založit záznam na **své** pobočce, připojit k němu fotky (jen k dokladu, který samo založilo, nejvýš 2 hodiny starému a pořád rozpracovanému) a přečíst **přehled svých dnešních dokladů**.
- **Přehled dnes** (`jine_platby_kiosek_dnes`, jen `service_role`): jen záznamy **tohoto zařízení** za **dnešní provozní den pobočky** (`app.business_date`), od nejnovějšího, nejvýš 50. Každý řádek jen `{cas, fotek, oznaceni, stav}`. Stav je jedno z: přijato, bez fotky, zkontrolováno, zpracováno (tržba zapsaná nebo propojená), zrušeno. Důvod zrušení ani částka se nevrací. Odvolané nebo vypnuté zařízení dostane chybu a telefon přehled schová.
- **Nahrávání:**
  - server vydá podepsané adresy jen pro cesty nového záznamu (firmu a pobočku dává databáze, ne telefon);
  - po nahrání soubor stáhne a typ pozná z obsahu (magic bytes);
  - velikost bere ze stažených bajtů (fotka do 5 MB, PDF do 10 MB) a otisk spočítá sám;
  - soubor s vlastníkem (nahraný přihlášeným) kiosek nepřipojí;
  - stejná fotka podruhé neprojde a hláška neprozradí, ke kterému záznamu patří;
  - cokoli selže → soubor se z úložiště smaže.
- **Strop:** 20 dokladů za hodinu a 60 za 24 hodin z jednoho zařízení (otázka 66). Při víc telefonech na pobočce platí na každý zvlášť.
- **Žádné tajné údaje** pokladny ani firmy do telefonu. Telefon dostane jen název pobočky a zařízení.
- **Žádné `set vlastni.parametr` v definici funkce.** Lekce z 22. 10.: Supabase to vlastníkovi migrací nedovolí (42501). Hlídá to test.

## Rozhodnutí v otázkách (appka jede podle nejopatrnější varianty)

- **66** Strop dokladů na telefon: 20/h, 60/24 h.
- **67** AI se z kiosku samo nespouští (rozpoznání spustí ten, kdo doklad kontroluje).
- **68** Pokladnu doplní appka sama jen tehdy, když ji pobočka má jedinou.
- **69 — ROZHODNUTÍ ŠÉFÍKA 24. 10.: ano.** Přehled dnešních dokladů z **tohoto** telefonu (čas, počet fotek, poznámka, stav), bez částek. Zbývá rozhodnout: přehled celé pobočky místo telefonu a jestli u zrušených ukazovat důvod.
- **70 — ROZHODNUTÍ ŠÉFÍKA 24. 10.: zařízení může být několik.** Appka to uměla od začátku (kiosky mají klíč jen zařízení), teď to hlídá i scénář. Spárování samo doklady nepovolí, kiosek se zapíná zvlášť a každé zařízení pobočky dál umí kiosek Docházky (s PINem).

## Čísla

- **krok100 (nový scénář):** 51 kontrol (24. 10. přibyl přehled dnes a dva telefony téže pobočky). krok98 s upraveným počtem funkcí: 255. Celý řetěz na PGlite: 3 992 kontrol, nic nespadlo.
- Běželo na **PGlite**, ne na PostgreSQL. RLS ani granty to neověří, proto granty hlídají i textové kontroly migrace. Rozhodne „Migrace a scénáře“ v PR.
- **Testy aplikace:**
  - nová sada `jine-platby-kiosek` (60 kontrol) pouští skutečné serverové akce s podvrženým klientem služby a vykresluje skutečnou obrazovku telefonu;
  - celá sada z `aplikace.yml` 93 z 93 sad;
  - `tsc` čistý, `eslint` bez nových nálezů (jedno staré varování z `main`).
- **Schválná rozbití 24. 10.:** 10 v migraci (přehled i cizích zařízení / i jiných dnů / s údajem navíc / bez ověření kiosku / pro anon, chybějící stavy zpracováno, zrušeno a bez fotky, denní strop na pobočku místo zařízení, autor = první zařízení pobočky) a 13 v aplikaci (převzetí pustí celý řádek nebo neznámý stav, bez stropu 50, čas v UTC, server pošle data rovnou, chyba = prázdný přehled, bez kontroly klíče, nenačtený přehled jako prázdný, pořadí, „1 fotky“, starý přehled po chybě, bez obnovy po odeslání, částka na obrazovce). Všechna spadla na své kontrole. Strop na pobočku nejdřív spadl holou hláškou při plnění. Teď plnění řekne proč. Původní sady (21 + 16) znovu prošly.
- **Schválná rozbití 22. 10.:** 21 v migraci (proti krok100) a 16 v aplikaci (proti nové sadě), všechna spadla na své kontrole. Dvěma způsoby: granty funkcí kiosku (založení pro přihlášené / stav pro anon) a fotka k záznamu, kam nepatří (jiné zařízení / zkontrolovaný / starší než dvě hodiny).
- **Snímky přehledu dnes (375 px, světlý i tmavý, 24. 10.):** `docs/hlaseni/snimky-jine-platby/2026-10-24-kiosek-prehled-375*.png` — focení s přehledem, přehled pod potvrzením a prázdný den.
- **Snímky telefonu (375 px, světlý i tmavý):** `docs/hlaseni/snimky-jine-platby/2026-10-22-kiosek-375*.png`. Jde o statické vykreslení skutečné obrazovky. Nic nepřetéká do šířky a žádné tlačítko není menší než 44 px.

## Na co jsem narazil

- **Docházka nemá u zařízení žádný „účel“.** Každé spárované zařízení pobočky umí kiosek Docházky. Kiosek Jiných plateb je proto zvlášť zapínaný (otázka 70).
- **Nahrávání bez přihlášení:** serverová akce má strop těla 1 MB a Vercel kolem 4,5 MB, fotka může mít 5 MB. Proto podepsané adresy přímo do úložiště.
  - **Neověřeno naživo:** že soubor nahraný přes podepsanou adresu vydanou serverem nemá v úložišti vlastníka (`owner` prázdné, servisní klíč nemá `sub`). Databáze to vyžaduje. Kdyby Supabase vlastníka vyplnil, připojení fotky spadne s „Soubor nahrál někdo jiný“ — první skutečné odeslání to ukáže hned.
- **Pobočky scénáře se uklízí označením** (`deleted_at`), ne výmazem. Audit na ně ukazuje, stejně jako v krok24.
- **Mimo zadání, ale vážné (z průzkumu kiosku Docházky):** otisky PINů a klíčů zařízení jsou možná čitelné. Sloupcové granty v produkci nejspíš nefungují kvůli výchozím právům Supabase a audit kopíruje celé řádky PINů do `audit_log`. Čtyř- až šestimístný PIN jde z otisku dopočítat. Navrhuji to jako samostatnou práci, v tomhle PR jsem na Docházku nesahal.

## Nenasazoval jsem

- `db push`: **ne.** Migrace `20261022100000` není v ostré databázi.
- Sloučení PR: **ne.**
- Zápis do pokladny, proměnné ve Vercelu, n8n, Salt Edge: **beze změny.**
