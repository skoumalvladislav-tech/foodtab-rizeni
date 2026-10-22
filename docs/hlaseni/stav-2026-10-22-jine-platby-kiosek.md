# Stav k 22. 10. 2026 — Jiné platby: kiosek na telefonu pobočky (PR, nic nenasazeno)

Zadání Šéfíka 22. 10.: „u jiných plateb potřebuji vytvořit kiosek do
telefonu jako je na docházku. účty je potřeba vyfotit přes telefon,
a obsluha nemá přístup k modulu finance.“ Upřesnění: „nepotřebujeme se
přihlásit pinem“.

Větev `jine-platby-kiosek`, PR @@PR@@. Nová migrace
`20261022100000_jine_platby_kiosek` (novější než všechny v `main`).

## Nejdřív to podstatné

- **Nic není nasazené.** Nic jsem nesloučil, `db push` jsem nespustil a do pokladny jsem nic nezapsal.
- **Jak to funguje:** telefon na provozovně je **zařízení pobočky**, stejně jako tablet Docházky. Spáruje se kódem z Nastavení → Zařízení a pak se mu tamtéž zapne **Kiosek Jiných plateb**. Kdo je u telefonu, vyfotí účet (klidně na víc fotek), nepovinně připíše poznámku a odešle. Žádné přihlášení ani PIN.
- **Doklad přijde do Finance → Tržby → Jiné platby** pobočky jako rozpracovaný záznam. Jako autor je uvedené zařízení („kiosek Telefon u baru“), ne člověk. Kontrolu, AI, tržbu, sklad i fakturu dělají ve Financích lidé s právy Jiných plateb.
- **Telefon nic nevidí:** žádná finanční data ani záznamy. Po odeslání ukáže jen „Doklad (3 fotky) odešel v 14:05“.
- **Po sloučení je potřeba `db push`** (jedna migrace). Bez něj Nastavení → Zařízení přepínač neukáže a telefon napíše, že kiosek nejde použít.

## Jak je to zabezpečené

Všechno stojí na zařízení:
- **Výslovné zapnutí.** Kiosek Jiných plateb se zařízení musí zapnout (tabulka `jine_platby_kiosky`, jen správce nastavení pobočky, s auditem). Tablet Docházky tu schopnost nedostal potichu.
- **Každé volání znovu ověří klíč zařízení.** Musí být spárované a neodvolané, mít zapnutý kiosek, aktivní pobočku a firmu s Financemi. **Odvolání nebo vypnutí platí hned.**
- **Funkce kiosku smí volat jen server** (`service_role`). Telefon nemá přes databázi přímý přístup k ničemu kromě registrace, stejně jako tablet Docházky.
- **Zařízení umí jen dvě věci.** Založit záznam na **své** pobočce a připojit k němu fotky, a to jen k dokladu, který samo založilo, nejvýš 2 hodiny starému a pořád rozpracovanému.
- **Nahrávání:**
  - server vydá podepsané adresy jen pro cesty nového záznamu (firmu a pobočku dává databáze, ne telefon);
  - po nahrání soubor stáhne a typ pozná z obsahu (magic bytes);
  - velikost bere ze stažených bajtů (fotka do 5 MB, PDF do 10 MB) a otisk spočítá sám;
  - soubor s vlastníkem (nahraný přihlášeným) kiosek nepřipojí;
  - stejná fotka podruhé neprojde a hláška neprozradí, ke kterému záznamu patří;
  - cokoli selže → soubor se z úložiště smaže.
- **Strop:** 20 dokladů za hodinu a 60 za 24 hodin z jednoho zařízení (otázka 66).
- **Žádné tajné údaje** pokladny ani firmy do telefonu. Telefon dostane jen název pobočky a zařízení.
- **Žádné `set vlastni.parametr` v definici funkce.** Lekce z 22. 10.: Supabase to vlastníkovi migrací nedovolí (42501). Hlídá to test.

## Rozhodnutí v otázkách (appka jede podle nejopatrnější varianty)

- **66** Strop dokladů na telefon: 20/h, 60/24 h.
- **67** AI se z kiosku samo nespouští (rozpoznání spustí ten, kdo doklad kontroluje).
- **68** Pokladnu doplní appka sama jen tehdy, když ji pobočka má jedinou.
- **69** Telefon neukazuje dnešní odeslané doklady, jen potvrzení po odeslání.
- **70** Spárování samo doklady nepovolí. Kiosek se zapíná zvlášť a každé zařízení pobočky dál umí kiosek Docházky (s PINem).

## Čísla

- **krok100 (nový scénář):** 39 kontrol. krok98 s upraveným počtem funkcí: 255. Celý řetěz na PGlite: 3 980 kontrol, nic nespadlo.
- Běželo na **PGlite**, ne na PostgreSQL. RLS ani granty to neověří, proto granty hlídají i textové kontroly migrace. Rozhodne „Migrace a scénáře“ v PR.
- **Testy aplikace:**
  - nová sada `jine-platby-kiosek` (46 kontrol) pouští skutečné serverové akce s podvrženým klientem služby a vykresluje skutečnou obrazovku telefonu;
  - celá sada z `aplikace.yml` 93 z 93 sad;
  - `tsc` i `eslint` čisté.
- **Schválná rozbití:** 21 v migraci (proti krok100) a 16 v aplikaci (proti nové sadě), všechna spadla na své kontrole. Dvěma způsoby: granty funkcí kiosku (založení pro přihlášené / stav pro anon) a fotka k záznamu, kam nepatří (jiné zařízení / zkontrolovaný / starší než dvě hodiny).
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
