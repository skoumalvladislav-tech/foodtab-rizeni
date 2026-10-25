# Stav k 25. 10. 2026 — Provoz → Rezervace a kalendář akcí

## Nejdřív to podstatné

- V Provozu je nová položka **Rezervace a akce**: kalendář (den, týden,
  měsíc), detail dne s **poznámkami a dokumenty ke dni**, detail rezervace
  nebo akce s **poznámkami, „dalšími informacemi“ (nadpis + text)
  a dokumenty**, formulář nové rezervace i akce.
- Sekce je **připravená na napojení rezervačního systému**: registr
  připojení umí oblast „rezervace“, databáze umí převzít rezervace podle
  čísla ze zdroje bez zdvojení a s jasným pravidlem, čí je který údaj.
  **Živé napojení zatím žádné není** — připojení je „čeká na připojení“
  a rezervace jdou zapsat ručně nebo načíst ze souboru CSV.
- **Sloučeno a nasazeno 25. 10. 2026 večer** na Šéfíkův pokyn „sluč 158“:
  PR #158 → `main` (`0e25daf`), `db push` pustil `20261025100000` ze záloh
  (PR #156, nenasazená, Šéfík: „nasadit obě“) a `20261027100000`
  Rezervací. Ověřeno v ostré databázi — oddíl „Nasazení“ na konci.
- **Po nasazení vidí Rezervace jen majitel**, dokud práva nepřidáte
  v Nastavení → Zařazení (otázka 76).

Průzkum podobných aplikací a celý návrh: `docs/rezervace-navrh.md`.

## Co je hotové

| Co | Commit | Nasazeno |
|---|---|---|
| Migrace `20261027100000_rezervace_akce.sql` (4 tabulky, kbelík `rezervace`, 2 práva, oblast `rezervace` v registru, funkce zápisu a importu) + scénář `krok103` + čisté knihovny | `8c35357`, `d701302` | **ano**, `db push` 25. 10. |
| Obrazovky, serverové akce, přílohy, import CSV, Napojení a import, `scripts/rezervace.test.mjs` | `e61ea42` | ano (Vercel z `main`) |
| Kreslení oddělené od dat, průzkum a návrh, otázky 76–80 | `74c2ee6` | — |
| Drobné úpravy vzhledu po snímcích, toto hlášení | `cd18544` | — |
| Sloučení PR #158 | `0e25daf` | — |

Finance → Integrace: karta „Rezervace a objednávky — připravujeme“ je teď
odkaz „Rezervace“ do Napojení a importu.

## Čísla — a z čeho jsou

- **`krok103_scenar.sql`: 131 kontrol** v PGlite (samostatně po
  `etapa0`). PGlite běží jako superuživatel — RLS a granty tam neplatí
  všude, proto kontroly čtení po právech mají vedle sebe i kontrolu textu
  politiky. **Rozhoduje workflow Databáze proti PostgreSQL 16.**
- **Celý řetěz PGlite** (všechny scénáře v jedné databázi, jako CI): **4165 kontrol prošlo**, `krok103` v řetězu 131.
  Spadl jen `krok101` (zálohy z main) — PGlite runner nesundá uvozovky z `\set`, skutečné psql v CI ano; s touhle prací nesouvisí (navazující oprava runneru).
- **`scripts/rezervace.test.mjs`: 95 kontrol**; celá sada `scripts/`
  z workflow Aplikace prošla (dvě starší kontroly jsem upravil, protože
  počítaly přesně to, co se změnilo: čtvrtá karta v Integracích a druhá
  položka nabídky se seznamem práv).
- **Migrace pod vlastníkem, který není superuživatel** (napodobenina
  Supabase): prošla, a scénář `krok103` nad ní taky. Zkouška umí spadnout
  — s přidaným `set vlastni.parametr` v definici funkce spadla na
  `42501 permission denied to set parameter`, přesně jako ostrý `db push`
  22. 10.
- `tsc` i `eslint` čisté.

### Schválná rozbití

**25 rozbití, každé zvlášť, všechna chycená**:

- databáze (14): kontakt čte i čtenář; importovaná rezervace jde měnit
  celá; starší data přebijí novější; import přepíše prostor; „připojeno“
  bez testu; čas bez pásma pobočky; spoušť nehlídá pobočku poznámky;
  číslo odeslání nehlídá; typ souboru z prohlížeče; nahrát smí čtenář
  (dvakrát: místo zápisu a vedle zápisu); rezervace vidí každý; čtenář
  importuje; neověřené připojení přijme data;
- aplikace (11): neznámý stav se hádá; údaje zdroje se rozejdou
  s databází; formulář pošle i údaje zdroje; `pripojeno` natvrdo;
  stránka a akce sáhnou na data před přístupem; „zpět“ ven z modulu;
  kontakt každému; zrušené se počítají do hostů; strop příloh se rozejde
  s databází; Rezervace vytlačí Vzkazy ze spodní lišty.

Dvě spadla na sousední kontrole, ne na té, na kterou mířila: čas bez
pásma spadl na **letní** rezervaci, ne na zimní — PGlite má sezení
v pásmu, které zimní čas náhodou trefí; v CI (UTC) spadne i zimní. Proto
jsou v sadě obě. A „nahrát smí čtenář“ v první podobě vzalo právo i té,
kdo zapisuje — proto druhé rozbití „vedle zápisu“, které spadlo na
„čtenář nenahraje nic“.

## Co čeká na Šéfíka

1. ~~„sluč N“ a pak `db push`~~ — hotovo 25. 10. (oddíl „Nasazení“).
2. **Práva**: v Nastavení → Zařazení zaškrtnout „Vidět rezervace…“
   a „Zapisovat rezervace…“ tam, kde mají být (otázka 76).
3. **Který rezervační systém používáte** (otázka 78) — podle toho první
   adaptér; doporučuji Dotykačku.
4. **Zálohy (PR #156):** ochrana proti dvojímu zápisu je nasazená; zbývá
   stornovat zálohy, které už zdvojené jsou (dotaz v
   `docs/hlaseni/stav-2026-10-25-zalohy-dvakrat.md`).
5. **Otevřené PR s migrací starší než `20261027100000`** — #153
   (`20261024100000`), #157 (`20261025230000`) a #145 (`20261019120000`) —
   potřebují před svým `db push` nové razítko (novější než
   `20261027100000`); CLI starší migraci za novější nepustí (jako #145 už dřív).

## Otázky

76 (kdo co vidí), 77 (čí je pravda), 78 (který systém), 79 (jaké
dokumenty), 80 (záloha od hosta). Ke každé je zvolená nejopatrnější
varianta, nic nečeká.

## Na co jsem narazil a nešlo to

- **Číslo odeslání hlídaly dvě cesty** (dotaz předem a `on conflict`).
  Při plánování rozbití se ukázalo, že kontrola nad jednou z nich nejde
  shodit — nechal jsem jen `on conflict`, který drží i dvě odeslání naráz.
- **Úprava jen e-mailu by smazala telefon** — našel scénář, opraveno
  dřív, než se to dostalo dál.
- **PGlite a psql čtou `\set` s uvozovkami různě**; proměnné ve scénáři
  jsou proto bez uvozovek nebo přes `\gset`.
- **Obrazovky jsem viděl jen v náhledu s ukázkovými daty**
  (`app/nahled/**`, mimo git), ne přihlášený proti databázi — migrace
  v testovací databázi není. Snímky (počítač, telefon, tmavý režim):
  sdílená složka relací, `rezervace-snimky/`. Na 390 i 1536 px nic
  nepřetéká, nadpisy patkové, cizí SVG ani emoji žádné.
- **Co jsem schválně nedělal**: živý adaptér, příjem webhooku, plánek
  stolů, zápis zpět do rezervačního systému, platby záloh, Word/Excel
  přílohy, kartu rezervací na obrazovce Dnes (viz návrh, oddíl 7 a 9).

## Kde jsem skončil a co zbývá

Hotový celý první krok. Další (návrh, oddíl 9): odpověď na otázku 78 →
první adaptér; karta rezervací na Dnes; po adaptéru webhook a pravidelná
synchronizace.

## Nasazení (25. 10. 2026 večer)

Na pokyn „sluč 158“ a „nasadit obě“. Z pracovní kopie `foodtab-nasazeni` (main `0e25daf`).

1. **Napojený projekt:** `supabase/.temp/linked-project.json` → `spekntcsuroqhehmjssv` / `foodtab-test` ✓.
2. **`migration list --linked` před:** nenasazené dvě — `20261025100000` (zálohy, PR #156) a `20261027100000` (Rezervace). Pořadí na sobě nezávisí.
3. **`db push --yes`** (doslova):

   ```
   Applying migration 20261025100000_zalohy_jedno_odeslani.sql...
   Applying migration 20261027100000_rezervace_akce.sql...
   {"upToDate":false,"dryRun":false,"migrations":["20261025100000_zalohy_jedno_odeslani.sql","20261027100000_rezervace_akce.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
   ```

4. **Ověření v ostré databázi** (jen čtení, `supabase db query --linked`):
   - obě verze v `supabase_migrations.schema_migrations`;
   - RLS zapnuté na `rezervace`, `rezervace_kontakty`, `rezervace_poznamky`, `rezervace_prilohy`;
   - **`authenticated` má jen `select`** (insert a truncate ne), `anon` nic — `revoke` tedy zabral i proti výchozím právům Supabase, která lokální testy nemají;
   - práva `rezervace.read` (provoz, necitlivé) a `rezervace.manage` (provoz, citlivé);
   - kbelík `rezervace` soukromý, 10 MB, fotky a PDF; 3 politiky úložiště, 4 politiky tabulek;
   - v registru `integrace_pripojeni` nová kontrola oblasti a dvě pojistky rezervací;
   - 9 funkcí pro přihlášené (anonym ne), `rezervace_importovat_zdroj` přihlášený volat nesmí;
   - **pod rolí `authenticated`** jdou přečíst všechny sloupce, které obrazovky čtou, bez `42501` (0 řádků — bez přihlášeného člověka nic nevidí);
   - zálohy: `advances.klic_odeslani` existuje, `vyplatit_zalohu` má `p_klic`.
5. **Aplikace:** Vercel nasadil `0e25daf` („Deployment has completed“); na `main` prošly workflow Migrace a scénáře (PostgreSQL 16, včetně `krok103`), Testy aplikace a Migrace jen přibývají. Ostré `/firma/rezervace` a `/firma/rezervace/napojeni` bez přihlášení přesměrují na přihlášení, `/api/rezervace/soubor/…` vrátí 404 bez detailu.

Rezervací je v databázi 0 — první zapíše ten, komu se přidá právo (otázka 76).

## Večer: univerzální příjmové API a dokumenty ve formuláři (nová PR, NENASAZENO)

> **ROZHODNUTÍ ŠÉFÍKA (25. 10.):** „mám Choice, ale připravil bych
> univerzální možnost, dále do položky na přidání rezervace přidej
> možnost přidání souboru pdf, jpg atd.“

| Co | Commit | Čeká na db push |
|---|---|---|
| Migrace `20261028100000_rezervace_prijem.sql`: `rezervace_prijmout` (jen server; „připojeno“ až po úspěšné dávce, v téže transakci) a `rezervace_napojeni` s časem, počtem a poslední chybou (jen pro správce napojení) + scénář `krok104` | `4e42316` | **ano** |
| Adresa `POST /api/rezervace/prijem` s klíčem `ftrez_…`, vydání a výměna klíče v Napojení a importu, Choice v seznamu systémů, návod `docs/rezervace-api.md` | `4e42316`, `6db8d66` | potřebuje migraci |
| Formulář nové rezervace/akce: „Přidat dokument“ (fotky, PDF) — nahrají se do úložiště a po založení se připojí | `4e42316` | ne (stávající tabulky) |

**Čísla:** `krok104` 22 kontrol, `krok103` dál 131 (PGlite); `scripts/rezervace.test.mjs` 122 kontrol. Obě migrace (`20261027…` i `20261028…`) prošly i pod vlastníkem, který není superuživatel. **15 schválných rozbití** (7 databáze, 8 aplikace), všechna spadla na své kontrole — mimo jiné: spolknutá chyba zápisu by nastavila „připojeno“ bez dat; příjem přes připojení adaptéru nebo pokladny; chybu napojení by viděl každý; adresa bez porovnání klíče; čas bez pásma; soubory přes serverovou akci; cizí cesta k dokumentu; klíč vydá kdokoli; „připojeno“ nastavené adresou.

Při plánování rozbití jsem vyhodil dvě slabá místa: dvojí kontrolu pásma (jedna by nešla shodit) a textovou kontrolu pořadí v migraci (pořadí uvnitř jedné transakce nic neznamená; že spadlá dávka nic nepřepne, hlídá `krok104` spuštěním).

**Co čeká na Šéfíka:** „sluč N“ a `db push` (migrace `20261028100000`); pak vydat klíč pro Perlu a v Choice (webhook) nebo v n8n/Make nastavit posílání podle `docs/rezervace-api.md`.

**Pozor na PR #157** (výdej ze skladu): má taky `krok103_scenar.sql` a migraci `20261025230000`, starší než nasazená — potřebuje přečíslovat a nové razítko. Relaci, která ji má, jsem dal vědět.
