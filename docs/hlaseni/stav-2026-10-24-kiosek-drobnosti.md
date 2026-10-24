# Stav k 24. 10. 2026 — Kiosek Jiných plateb: drobnosti po nasazení (PR, nic nenasazeno)

Kiosek (#151) je sloučený a nasazený (main 01d841c, db push
20261022100000 proběhl 24. 10.). Tohle jsou čtyři zbylé nízké nálezy
z posledního ověření (674659b). Větev `kiosek-drobnosti` z aktuálního
main, nová migrace `20261024100000_jine_platby_kiosek_drobnosti`.

## Nejdřív to podstatné

- **Nic není nasazené.** Nic jsem nesloučil a `db push` jsem nespustil.
- **Po sloučení je potřeba `db push`** (jedna migrace). Než proběhne:
  - telefon funguje jako dnes;
  - přehled u zrušeného dokladu ukáže „fotka neodešla“;
  - úloha úklidu skončí chybou 500, protože funkce v databázi ještě není. Workflow pak pošle e-mail.
- **Před `db push` ověřte duplicity v ostrých datech.** K ostré databázi jsem se nedostal (MCP: „nemáte oprávnění“). Migrace má pojistku: při duplicitě spadne srozumitelnou hláškou dřív, než zkusí index. Dotaz (jen čtení):

  ```sql
  select tenant_id, branch_id, lower(btrim(nazev)) as nazev, count(*)
    from public.branch_devices
   where stav = 'active' and ucel = 'doklady'
   group by 1, 2, 3 having count(*) > 1;
  ```

  Prázdný výsledek znamená, že migrace projde.
- **Úloha úklidu potřebuje secrets** `APP_URL` a `CRON_SECRET` v GitHubu. Jsou tam už pro ostatní úlohy. Na pg_cron nic nestojí.

## Co je hotové

1. **Změna obsahu po neúspěšném odeslání = nový doklad.** Když obsluha po chybě nebo po „Zrušit odesílání“ změní poznámku, přidá nebo odebere fotku, dostane nový klíč odeslání. Pošlou se jen fotky, které ještě neodešly.
   - Opakování **beze změny** jde dál do téhož záznamu, takže nevznikne druhý.
   - Rozhoduje čistá funkce `poZmeneObsahu` s testem chováním. Pokus se zapíše těsně před založením dokladu.
   - Ověřeno i prohlížečovým harnessem nad skutečnou komponentou:
     - S6: změna poznámky dá nový klíč a novou poznámku;
     - S7: opakování beze změny nechá týž klíč;
     - S8: odebrání jedné ze dvou fotek dá nový klíč a pošle jen zbylou fotku;
     - S9: přidání fotky po částečném úspěchu dá nový klíč bez už odeslané fotky.
   - Nad kopií, kde změna nový klíč nedá, harness spadne (S6, S8, S9).
2. **Žádné „0 fotek“ v přehledu.**
   - Zrušení ve Financích fotky deaktivuje (`jine_platby_zrusit`). Přehled teď u zrušeného dokladu počítá fotky, které telefon poslal, a ukáže „Zrušeno ve Financích“.
   - Doklad, ke kterému nic nedošlo, napíše „fotka neodešla“ (`popisFotek`) a „Doklad bez fotky — pošlete ho znovu“.
3. **Jedinečný název telefonu hlídá databáze.** Unikátní index `branch_devices_telefon_nazev` na `(tenant_id, branch_id, lower(btrim(nazev)))` kde `stav = 'active' and ucel = 'doklady'`.
   - Zavře souběh dvou spárování i přejmenování přímým zápisem.
   - **Tablety Docházky se schválně nehlídají:** tablet, který ztratí klíč, se dnes páruje znovu pod stejným názvem bez odvolání starého, a to by index zastavil. Odvolané telefony se taky nehlídají.
   - Pojistka v migraci je ověřená jednorázovým během: s duplicitou migrace spadne hláškou a index nezaloží, bez duplicity projde.
4. **Úklid nepřipojených souborů z kiosku.**
   - Úloha `/api/uloha/kiosek-uklid` (vzor ostatních úloh: CRON_SECRET, zámek `uzBezi`, `klientUlohy`) a workflow `kiosek-uklid.yml`: denně ve 03:35 UTC, dá se spustit i ručně (Run workflow), dávky po 500 dokud je co mazat.
   - **Které soubory, rozhoduje databáze** (`jine_platby_kiosek_sirotci`, jen service_role). Musí platit všechno:
     - soubor nemá vlastníka;
     - leží pod záznamem z kiosku;
     - soubor i záznam jsou starší než 3 h (připojit jde jen do 2 h od založení, takže ho už nikdo nepřipojí);
     - žádný řádek v `jine_platby_soubory` na něj neukazuje.
   - Maže se přes Storage API. Mimochodem se uklidí den staré náhrobky bez souboru.
   - **Na pg_cron nic nestojí.** Úloha je zapsaná i v `app.planovac_ulohy`, aby po případném zapnutí pg_cronu plán seděl. `planovac.test` teď čte vložení úloh ze všech migrací, ne jen z 20261014120000. krok96 má počty úloh 10 (dřív 9) a v cronu 11.

## Čísla

| Co | Výsledek |
|---|---|
| krok101 (nový scénář) | 16 kontrol |
| krok96 | 54 kontrol |
| krok100 | 90 kontrol |
| Celý řetěz PGlite | 4 047 kontrol, nic nespadlo |
| **Nová migrace pod ne-superuživatelem** | role `mig_vlastnik`, napodobí vlastníka migrací na Supabase s výchozími právy; nad ní etapa0, krok96, krok100 a krok101: 199 kontrol bez pádu |
| Test `jine-platby-kiosek` | 105 kontrol, i úloha úklidu chováním: smaže přesně cesty z databáze, při chybě nic, uvolní zámek, plná dávka pokračuje, špatné tajemství 401 |
| `planovac.test` | prošel, nová úloha je v něm automaticky (tajemství, zámek, smyčka, shoda plánu) |
| Celá sada `aplikace.yml` | 93 z 93 |
| `tsc`, `eslint` | čisté |

- **Schválná rozbití:**
  - 16 v nové migraci proti krok101 (index, přehled, výběr sirotků, náhrobky, strop dávky, granty, plán);
  - 10 rozbití přehledu `dnes` v nové definici proti krok100;
  - 10 v aplikaci proti testu kiosku.
  - Všechna spadla na své kontrole. Dřívější aplikační sady (k7–k10) prošly znovu. Překonané jsou L10, G12 a G15: skloňování a nahrazený kód teď hlídají K3 a I1–I5.
- Celý řetěz běží jako superuživatel. Granty proto hlídá i krok101 přes `has_function_privilege` a běh pod ne-superuživatelem.

## Na co jsem narazil

- **#145 (hlídač plánovače, nesloučeno) přidává do `planovac.test` tabulku očekávaných mezer** pro každou úlohu z plánu. Po sloučení obou PR jí bude chybět řádek `'kiosek-uklid': 1440`. Kdo bude slučovat druhý, doplní ho.
- **Vercel cron se nepoužívá.** Úloha jde přes GitHub Actions jako ostatní a GitHub ji může spustit opožděně. U denního úklidu to nevadí.
- **Po změně obsahu po částečném úspěchu** zůstanou už odeslané fotky u prvního záznamu s původní poznámkou. Telefon poznámku existujícího záznamu měnit nesmí, to je záměr.

## Nenasazoval jsem

- `db push`: **ne.** Migrace `20261024100000` není v ostré databázi.
- Sloučení PR: **ne.**
- Zápis do pokladny, proměnné ve Vercelu, n8n, Salt Edge: **beze změny.**
