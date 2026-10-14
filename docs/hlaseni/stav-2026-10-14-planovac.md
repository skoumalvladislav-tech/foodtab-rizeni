# Stav k 14. 10. 2026 — plánovač úloh: GitHub úlohy vynechává, připravený náhradník v databázi

## Nejdřív to podstatné

- **GitHub naplánované úlohy skoro nespouští.** Za posledních 7 dní
  proběhla každá úloha zhruba **4× denně, ať měla v plánu cokoli** —
  5–17 % plánovaných běhů, mezery až 12 hodin. Pokladny (plán každou
  hodinu) proběhly od 11. 10. desetkrát z 61. Mírnější plán nepomůže:
  čtyřhodinová banka dopadla stejně jako patnáctiminutový push.
- **Doporučuji plánovač v Supabase** (`pg_cron` + `pg_net`, tajemství ve
  Vaultu). Zdarma, bez nového dodavatele, na minutu přesně, plán v repu.
  Vyžaduje tvoje „ano" k výjimce z pravidla o rozšířeních Postgresu —
  [otázka 47](otazky.md).
- **PR je připravený, nic není zapnuté ani nasazené.** Migrace sama nic
  nenaplánuje; zapnutí je 6 ručních kroků v `docs/planovac-pg-cron.md`.
  GitHub zůstává jako záloha.
- **Nově zámek proti dvojímu spuštění ve všech 9 úlohách.** Při souběžném
  volání (GitHub + databáze) by jinak přišly dva pushe „Čekají na vás
  zprávy" a dva koncepty marketingového příspěvku. Příjem faktur zámek
  po doběhnutí uvolní, protože ho GitHub volá ve smyčce až 15× za sebou.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| Měření plán × skutečnost pro 9 workflow (`gh run list`, 7 dní) | — (čísla v `docs/planovac-pg-cron.md`) | — |
| Srovnání variant a doporučení | `ac29a80` (`docs/planovac-pg-cron.md`) | — |
| Migrace plánovače: tabulka úloh, `app.naplanovat_ulohy`, `app.zrusit_planovac`, `app.planovac_stav`, `app.spustit_ulohu`, úklid | `ac29a80` | ano — a pak ruční zapnutí |
| Zámek `public.uloha_zabrat` + `uzBezi` ve všech `app/api/uloha/*` | `ac29a80` | zámek ano; kód do té doby běží bez něj jako dnes |
| Uvolnění zámku `public.uloha_uvolnit` u faktur (smyčka v GitHub workflow) | `3157668` | ano |
| Kontrola `scripts/planovac.test.mjs` (zapsaná v workflow Aplikace) | `ac29a80`, `3157668` | — |
| Scénář `krok96` (zapsaný v `run.sh` a workflow Databáze) | `ac29a80`, `3157668` | — |
| Návod pro Šéfíka, otázka 47, tohle hlášení | (commit s hlášením) | — |

## Čísla — a z čeho jsou

**Měření GitHubu** (`gh run list --event schedule`, 7. 10. 09:20 –
14. 10. 09:20 UTC; u pokladen od prvního běhu 11. 10.):

| Úloha | Plánováno | Proběhlo |
|---|---:|---:|
| banka-synchronizace | 41 | 22 |
| checklisty-naplanovat | 162 | 28 |
| checklisty-terminy | 647 | 30 |
| faktury-z-emailu | 235 | 22 |
| marketing-automatizace | 162 | 28 |
| marketing-fronta | 657 | 30 |
| notifikace-push | 665 | 31 |
| pokladna-synchronizace | 61 | 10 |
| zapomenuty-odchod | 163 | 28 |

Žádný z běhů, které proběhly, neskončil chybou.

**Kontroly:**

- `scripts/planovac.test.mjs`: **149 kontrol**, všechny prošly. Spouští
  skutečný `route.ts` všech 9 úloh; podstrčená je jen databáze a knihovny
  pod nimi. Na každou úlohu: 7 špatných podob tajemství + 2 stavy
  chybějícího/prázdného `CRON_SECRET` → 401 a **nesáhne na nic, ani na
  zámek**; kontrolní běh se správným tajemstvím; zámek drží jiný → 200
  „běží jinde"; zámek čeká na migraci → běží bez něj; porucha zámku →
  500 bez detailu. Plus úloha volaná ve smyčce zámek uvolní (faktury),
  shoda jmen a plánů migrace × úlohy × GitHub a limity.
- `krok96` nad PGlite: **54 kontrol**, všechny prošly. PGlite **neověří RLS ani sloupcové granty** a role tam nejsou
  skutečné — kontroly práv tu čtou jen katalog (`has_function_privilege`).
  Rozhoduje workflow Databáze proti PostgreSQL 16 (poběží na PR).
  `cron`, `net` a `vault` jsou ve scénáři napodobeniny se stejnými
  podpisy — skutečné pg_cron/pg_net se lokálně neověří vůbec.

- `npx tsc --noEmit` a `eslint` nad změněnými soubory: bez chyb.

**Schválná rozbití — aplikace (7, každé spadlo):**

| Rozbití | Spadlo |
|---|---|
| pokladna: ověření tajemství vypnuté | 9× — všech 9 neplatných tajemství u pokladny |
| `tajemstviSedi` pustí každého | 81× — 9 × 9 úloh |
| zapomenutý odchod: zámek PŘED tajemstvím | 9× — neplatné tajemství sáhlo na zámek |
| checklisty-terminy: zámek pod cizím jménem (chyba kopírování) | 4× — kontroly zámku |
| `uzBezi` pustí úlohu dál při jakékoli chybě zámku | 9× — porucha zámku ve všech úlohách |
| marketing-fronta: výsledek zámku se nevyhodnotí | 2× — „běží jinde" a porucha |
| faktury: zámek se po doběhnutí neuvolní | 2× — kontrola workflow se smyčkou i skutečný průchod |

Zámek a tajemství jsem rozbil víc způsoby schválně: „vypnuté ověření"
a „zámek před ověřením" jsou dvě různé chyby, které by obě prošly, kdyby
kontrola hlídala jen kód odpovědi 401 a ne to, na co se sáhlo.

**Schválná rozbití — databáze (9, každé spadlo; `krok96` nad PGlite):**

| Rozbití | Spadla kontrola |
|---|---|
| `uloha_zabrat` bez `revoke` pro anon/authenticated | „uloha_zabrat nesmí anon ani authenticated" |
| zámek bez podmínky na vypršení | „druhé zabrání téže úlohy → false" |
| adresa bez kontroly https | „http:// → odmítnuto" |
| naplánování bez předchozího ověření Vaultu | „naplánování bez tajemství → odmítnuto" |
| tajemství v textu úlohy cronu (u všech úloh) | „text úlohy volá app.spustit_ulohu jménem" |
| tajemství v textu úlohy cronu (u všech kromě jedné) | „ŽÁDNÁ úloha v cronu neobsahuje tajemství ani adresu" |
| `spustit_ulohu` nezapíše volání | „volání zapsané pod číslem požadavku" |
| `uloha_uvolnit` přepíše i vypršený zámek | „uvolnění sáhne jen na platný zámek" |
| `uloha_uvolnit` bez `revoke` | „uloha_uvolnit nesmí anon ani authenticated" |

Tajemství v cronu jsem rozbil dvakrát schválně: první rozbití chytila
přísnější kontrola o řádek dřív a o té samotné („žádné tajemství
v cronu") neřeklo nic. Druhé rozbití nechalo jednu úlohu čistou, aby
přísnější kontrola prošla a musela spadnout ta správná.

## Co čeká na Šéfíka

1. **Rozhodnout otázku 47** — výjimka pro pg_cron a pg_net.
2. Review a **sloučení PR** (na pokyn). Po sloučení úlohy běží jako dnes
   (zámek ve Vercel logu hlásí „čeká na migraci").
3. **db push** (skill `nasazeni`) — vznikne zámek a funkce plánovače.
4. Když „ano": kroky 3–7 v `docs/planovac-pg-cron.md` — zapnout dvě
   rozšíření, zkontrolovat, že `net` a `vault` nejsou vystavené v API,
   dvě tajemství do Vaultu (přes Vault, **ne přes SQL Editor**), jeden
   příkaz, kontrola stavu za 20 minut.
5. Za 2–3 dny provozu: samostatný PR, který z GitHub workflow vyndá
   `schedule`.

## Otázky

- [47. Plánovač úloh v databázi — výjimka pro pg_cron a pg_net?](otazky.md)

## Na co jsem narazil a nešlo to

- **CLAUDE.md pg_cron výslovně neschvaluje** — pravidlo o rozšířeních
  a dvě starší migrace („jedno místo, které rozhoduje o čase"). Proto
  migrace `create extension` nemá a nic nenaplánuje sama; zapnutí je
  vědomý ruční krok. Varianta „naplánovat v migraci, jen když pg_cron
  existuje" jsem zahodil: db push před zapnutím rozšíření by tiše
  nenaplánoval nic.
- **Nemohl jsem se podívat do ostré databáze.** Dotaz na dostupná
  rozšíření (jen čtení) přes Supabase nástroj skončil „You do not have
  permission". Nevím tedy, jestli už pg_cron/pg_net nejsou zapnuté, ani
  které schéma je vystavené v API — proto je kontrola „Exposed schemas"
  v návodu jako ruční krok.
- **Tajemství v pg_net nejde schovat úplně.** Než požadavek odejde, leží
  i s hlavičkou ve frontě `net.http_request_queue` a vidí ho každá role,
  která se umí přihlásit do databáze (dokumentace Supabase). anon
  a authenticated ne. Kdo má heslo k databázi, má víc než CRON_SECRET,
  takže to beru jako přijatelné — ale je to kompromis, ne „úplně bezpečné".
- **pg_cron nikomu nepíše, když úloha padá.** GitHub posílá e-mail při
  chybě; databáze ne. Dokud GitHub běží jako záloha, ten e-mail chodí.
  Hlídání po vypnutí GitHubu (např. denní workflow nad
  `app.planovac_stav()`) jsem **nedodal** — patří k tomu kroku, ne sem.
- **Dvojí spuštění: zámky v `synchronizace_behy` fungují** (zastaralý
  zámek 10 min, úlohy smí běžet 60 s), ale chrání jen připojení bank,
  pokladen a schránek. Souběh dvou plánovačů by zdvojil push-souhrn
  (`app.uvolnit_cekajici`) a koncepty marketingové automatizace. Opravit
  ty dvě funkce zvlášť by byl hlubší zásah do cizího kódu; místo toho je
  jeden zámek na úrovni úlohy. Ty dvě vnitřní slabiny (počítání bez
  zámku v `app.uvolnit_cekajici`, nekontrolovaný zápis běhu
  v marketing-automatizace) **zůstávají** — zámek je jen přestane
  vystavovat souběhu.
- **Příjem faktur ze dvou schránek naráz** (stejná faktura ve dvou
  schránkách, dva souběžné běhy) by mohl založit duplicitní fakturu —
  dnes jeden běh schránky prochází po řadě, a zámek úlohy to tak drží
  i nadále.
- **Vlastní chyba v první verzi zámku**: zámek se neuvolňoval nikde,
  a faktury-z-emailu.yml volá úlohu ve smyčce, dokud `pokracovat` —
  druhé kolo by narazilo na zámek z prvního a dohánění schránek by se
  zastavilo po jednom kole. Našel jsem to při kontrole, jak workflow
  čtou odpovědi; opraveno v `3157668` (`uloha_uvolnit`) i s kontrolou,
  která chytí každé další workflow se smyčkou.
- **Faktury po vypnutí GitHubu**: pg_cron je zavolá jednou za 30 minut,
  jedno kolo. Při velkém dohánění to bude pomalejší než GitHubových
  až 15 kol najednou. Plán faktur jsem neměnil (drží se dnešního).
- **Vercel dostane víc volání** — kolik bylo vždycky v plánu, ~440 denně
  místo dnešních ~40. Spotřebu na tarifu Hobby jsem neověřoval.
- Nic se nevykresluje, takže žádné obrazovky; nic jsem neviděl běžet
  proti skutečnému pg_cron/pg_net.

## Kde jsem skončil a co zbývá

PR je celý: migrace, zámek, kontroly, návod. Zbývá jen to, co je
na Šéfíkovi (výš), a po zkoušce vypnout `schedule` na GitHubu.

## Nenasazoval jsem

Žádný db push, žádná změna proměnných na Vercelu, tajemství na GitHubu
ani ve Vaultu, nic sloučeno. V repu není žádná hodnota tajemství.
