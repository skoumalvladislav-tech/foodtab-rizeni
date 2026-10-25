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
- **Nic jsem nesloučil a nenasazoval** (žádný `db push`). PR čeká na
  „sluč N“.
- **Po nasazení vidí Rezervace jen majitel**, dokud práva nepřidáte
  v Nastavení → Zařazení (otázka 76).

Průzkum podobných aplikací a celý návrh: `docs/rezervace-navrh.md`.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| Migrace `20261027100000_rezervace_akce.sql` (4 tabulky, kbelík `rezervace`, 2 práva, oblast `rezervace` v registru, funkce zápisu a importu) + scénář `krok103` + čisté knihovny | `8c35357`, `d701302` | **ano** |
| Obrazovky, serverové akce, přílohy, import CSV, Napojení a import, `scripts/rezervace.test.mjs` | `e61ea42` | potřebují migraci |
| Kreslení oddělené od dat, průzkum a návrh, otázky 76–80 | `74c2ee6` | — |
| Drobné úpravy vzhledu po snímcích, toto hlášení | poslední commit větve | — |

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

1. **„sluč N“** a pak `db push` (migrace je jedna, `20261027100000`).
2. **Práva**: v Nastavení → Zařazení zaškrtnout „Vidět rezervace…“
   a „Zapisovat rezervace…“ tam, kde mají být (otázka 76).
3. **Který rezervační systém používáte** (otázka 78) — podle toho první
   adaptér; doporučuji Dotykačku.

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

## Nenasazoval jsem

Žádný `db push`, žádné sloučení, žádný zásah do ostrých dat.
