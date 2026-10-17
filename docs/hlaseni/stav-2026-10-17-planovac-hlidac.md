# Stav k 17. 10. 2026 — hlídač plánovače: bez něj nejde vypnout GitHub

## Nejdřív to podstatné

- **Nevím, jestli plánovač v databázi běží.** Od 15. 10. je #135 sloučený
  a nasazený, zapnutí v Supabase (rozšíření, Vault, `naplanovat_ulohy`)
  dělá Šéfík. Ověřit to odsud nejde: Supabase nástroj odmítá i čtení
  („You do not have permission"), Vercel logy taky (403). GitHub běhy nic
  neprozradí — chodí v náhodné časy a se zámkem se nepotkají.
- **Proto jsem ještě nevypnul `schedule` na GitHubu.** Kdyby pg_cron
  neběžel, zastavily by se všechny úlohy a nikdo by to nepoznal: pg_cron
  na rozdíl od GitHubu nikomu nepíše.
- **Hotový je hlídač** (PR níž): workflow, které se několikrát denně zeptá
  aplikace, jestli databáze volá všech 9 úloh a jestli dostávají 200.
  Když ne, zčervená a GitHub pošle e-mail. Je to zároveň ten důkaz, že
  plánovač běží — a podmínka pro vypnutí `schedule`.

## Co je hotové

| Co | Commit | Čeká na db push |
|---|---|---|
| `public.planovac_zdravi()` = `app.planovac_stav()` pro service_role | `211ecea` | ano |
| `/api/planovac/hlidac` + `lib/planovac-hlidac.ts` (co je problém) | `211ecea` | adresa do db push odpovídá 503 „čeká na migraci" |
| Workflow `planovac-hlidac.yml` (každé 3 h + ručně) | `211ecea` | — |
| Kontroly: `scripts/planovac.test.mjs` +41, scénář `krok97` | `211ecea` | — |
| Oprava kontroly workflow (větev `503)`) | (commit před hlášením) | — |
| Návod `docs/planovac-pg-cron.md`, oddíl 7, a úprava kroků 7–8 | (commit s hlášením) | — |

Hlídač je schválně mimo `/api/uloha` a není v `app.planovac_ulohy` —
nesmí záviset na tom, co hlídá.

## Čísla — a z čeho jsou

- `scripts/planovac.test.mjs`: **190 kontrol** (149 + 41 nových), všechny
  prošly. Nové: nejdelší mezera v plánu u všech 9 úloh proti ručně
  spočítaným hodnotám (ne proti druhé implementaci) a u nerovnoměrných
  plánů; co je a není problém (hranice 60 + 10 min, 401, 500, vypršení,
  síťová chyba bez textu z pg_net, volání ještě běží); skutečný `route.ts`
  hlídače se 7 špatnými tajemstvími → 401 a nesáhne na nic; zdravý
  stav → 200; jedna stará úloha → 503 a jmenuje ji; nenasazená migrace →
  503 (ne zeleně); workflow se ptá hlídače a při 503 skončí `exit 1`.
- `krok96` + `krok97` nad PGlite: **63 kontrol** (54 + 9), všechny
  prošly. `krok97` ověřuje, že `planovac_zdravi` vrací PŘESNĚ to co
  `app.planovac_stav()` (bez cronu i s napodobeninami `cron`/`net`), že
  service_role stav přečte jen přes ni a práva. PGlite **neověří RLS ani
  sloupcové granty**; rozhoduje workflow Databáze proti PostgreSQL 16 na PR.
- `tsc --noEmit` a eslint nad novými soubory bez chyb.

**Schválná rozbití (11, po opravě každé spadlo):**

| Rozbití | Spadla kontrola |
|---|---|
| hlídač: ověření tajemství vypnuté | 7× „→ 401, na nic nesáhl" |
| hlídač nehlídá stáří volání | „volání o minutu později" + „jedna úloha nevolaná 3 h → 503" |
| mezera počítaná od nekonečna (vždy nejmenší) | mezery u všech 9 úloh |
| mezera přes `Math.min` (nejkratší místo nejdelší) | jen nerovnoměrné plány (0,50 a 1,23) |
| hlídač vrací 200 i s problémy | „nevolaná 3 h → 503", „žádné úlohy → 503" |
| nenasazená migrace = zeleně | „migrace nenasazená → 503" |
| síťová chyba s textem z pg_net | „síťová chyba → problém BEZ textu" |
| workflow: větev 503 bez `exit 1` | „… a 503 končí exit 1" (**až po opravě kontroly**, viz níž) |
| `planovac_zdravi` bez `revoke` | „nesmí anon ani authenticated" |
| `planovac_zdravi` s vlastní logikou (chybějící kód = 200) | „… a je to přesně app.planovac_stav()" |
| `planovac_zdravi` bez SECURITY DEFINER | scénář spadl na „service_role stav přečte" (permission denied) |

Mezeru jsem rozbil dvakrát schválně: u všech 9 dnešních plánů je nejkratší
a nejdelší mezera stejná, takže záměna min/max by na nich prošla — chytí
ji jen nerovnoměrné plány, které jsem kvůli tomu přidal.

## Co čeká na Šéfíka

1. **Je plánovač v Supabase zapnutý?** (kroky 3–6 v `docs/planovac-pg-cron.md`).
   Nejrychlejší odpověď: `select * from app.planovac_stav();` v SQL Editoru
   — `v_cronu` true a `posledni_kod` 200 u všech 9.
2. Review a sloučení PR hlídače, pak **db push** migrace
   `20261017100000_planovac_hlidac`.
3. Actions → **Plánovač — hlídač** → *Run workflow*. Zelená = plánovač
   běží. Červená vypíše, co chybí.
4. Až bude hlídač pár dní zelený: PR, který z workflow úloh vyndá
   `schedule` (připravím na pokyn — je to malá změna, ale bez zeleného
   hlídače ji nechci mít ani rozpracovanou, ať ji nikdo nesloučí dřív).

## Otázky

Žádné nové.

## Na co jsem narazil a nešlo to

- **Kontrola workflow hlídače byla zelená i nad rozbitým workflow.**
  Hledala `exit 1` kdekoli za `503)` a našla ho v další větvi. Workflow
  bez `exit 1` u 503 by hlídal naoko: chyby by vypsal, ale zůstal zelený
  a e-mail by nepřišel. Opraveno v samostatném commitu — kontrola čte jen
  větev `503)` po její `;;`.
- **Jedno moje rozbití nic nerozbilo**: „vlastní logika" v
  `planovac_zdravi` přes `where s.v_cronu or s.uloha <> ''` je podmínka,
  která platí vždycky. Zopakoval jsem to skutečným rozbitím (chybějící kód
  odpovědi = 200, tedy přesně to, co by problém schovalo) a to kontrola
  chytila.

- **Bez přístupu k databázi a logům** jsem nemohl zjistit, jestli pg_cron
  po 15. 10. volá. Zkoušel jsem: Supabase `list_extensions`, `query_logs`
  (obojí „permission denied"), Vercel `get_runtime_logs` (403), Vercel CLI
  tu není. Z GitHub běhů (6 posledních u pokladen, všechny 200, žádné
  „běží jinde") se to poznat nedá.
- **Hlídač bude červený, dokud plánovač nezapneš** — u všech 9 úloh
  „není naplánovaná v pg_cronu". Je to správně, ale bude chodit e-mail.
  Kdyby se zapnutí odkládalo, workflow jde dočasně vypnout (návod, oddíl 7).
- **Hlídač vidí jen 6 hodin zpátky** — tak dlouho drží pg_net odpovědi
  a `app.planovac_stav()` počítá volání. Úloha s nejdelší mezerou (banka,
  4 h) se do okna vejde.
- **Hlídač sám běží na GitHubu**, tedy nepravidelně (~4× denně). Na
  hlídání stačí: zastavený plánovač se pozná nejpozději za pár hodin, ne
  za týden. Spolehlivější by byl externí monitoring adresy — nedělal jsem,
  nový dodavatel.

## Kde jsem skončil a co zbývá

Hlídač je celý (migrace, adresa, workflow, kontroly, návod). Vypnutí
`schedule` na GitHubu čeká na zelený hlídač.

## Nenasazoval jsem

Žádný db push, žádná změna tajemství ani proměnných, nic sloučeno.
