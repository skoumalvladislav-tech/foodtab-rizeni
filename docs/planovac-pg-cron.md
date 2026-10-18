# Plánovač úloh v databázi (pg_cron) — návrh a návod

14. 10. 2026. Migrace `supabase/migrations/20261014120000_planovac_pg_cron.sql`,
scénář `krok96`, kontrola `scripts/planovac.test.mjs`.

**Stav: připravené, nic nezapnuté.** Migrace není nasazená (žádný db push),
v Supabase ani na Vercelu se nic nezměnilo. Zapnutí je ruční a je popsané
níž — dělá ho Šéfík.

---

## 1. Proč — GitHub úlohy vynechává

Všechny naplánované úlohy (pokladny, banky, faktury ze schránek, push,
checklisty, zapomenuté odchody, marketing) spouští GitHub Actions podle
`schedule`. Měření přes `gh run list`, 7.–14. 10. 2026:

| Úloha | Plán (UTC) | Plánováno | Proběhlo | Nejdelší mezera |
|---|---|---:|---:|---:|
| banka-synchronizace | každé 4 h, :15 | 41 | 22 (54 %) | 11,9 h |
| checklisty-naplanovat | každou hodinu, :17 | 162 | 28 (17 %) | 10,6 h |
| checklisty-terminy | každých 15 min | 647 | 30 (5 %) | 9,7 h |
| faktury-z-emailu | každých 30 min | 235 | 22 (9 %) | 10,0 h |
| marketing-automatizace | každou hodinu, :19 | 162 | 28 (17 %) | 10,6 h |
| marketing-fronta | každých 15 min | 657 | 30 (5 %) | 9,7 h |
| notifikace-push | každých 15 min | 665 | 31 (5 %) | 9,7 h |
| pokladna-synchronizace | každou hodinu, :40 | 61 (od 11. 10.) | 10 (16 %) | 10,2 h |
| zapomenuty-odchod | každou hodinu, :05 | 163 | 28 (17 %) | 9,9 h |

Každá úloha proběhla **zhruba 4× denně, ať měla v plánu cokoli** —
i ta čtyřhodinová. Když už běh přišel, byl o desítky minut později, než
měl. Všechny běhy, které proběhly, skončily úspěšně; problém není v úlohách,
ale v tom, že je GitHub nespouští.

Z toho plyne i to, že **mírnější plán na GitHubu nepomůže** — čtyřhodinová
banka dopadla stejně jako patnáctiminutový push.

## 2. Možnosti

| | **pg_cron + pg_net + Vault** (doporučeno) | Externí plánovač | GitHub s mírnějším plánem |
|---|---|---|---|
| **Spolehlivost** | Spouští databáze, na minutu přesně. Běží, dokud běží databáze — a bez ní nefunguje ani aplikace. | Dobrá. cron-job.org: po minutách, ale požadavek utne po **30 s** (pokladny, banky a faktury běží až 60 s → hlásilo by to chyby). Upstash QStash: opakuje neúspěšná volání, ale zdarma jen **1 000 zpráv denně** (my potřebujeme ~440 + opakování). | **Nefunguje** — viz měření, ~4 běhy denně bez ohledu na plán. |
| **Tajemství** | Ve Vaultu Supabase (šifrované), čte se až při volání. Nikde v repu ani v textu úlohy. Vidí ho jen ten, kdo se umí přihlásit přímo do databáze — a ten má stejně víc. | U **třetí firmy** — klíč, který otevírá úlohy běžící s plnými právy k databázi. | GitHub Secrets (dobré). |
| **Co nastavit ručně** | Zapnout 2 rozšíření, uložit 2 tajemství do Vaultu, jeden příkaz v SQL Editoru (návod níž). Plán je v repu, v migraci. | Založit účet, ručně naklikat 9 úloh s hlavičkou. Plán **mimo repo** — nikdo neuvidí, co se změnilo. | Nic. |
| **Cena** | Zdarma (součást Supabase i na Free). | cron-job.org zdarma; QStash zdarma do limitu. | Zdarma. |
| **Upozornění na chybu** | Samo nepošle nic. Stav ukáže `app.planovac_stav()`; GitHub zůstává zatím jako záloha a ten při chybě e-mail posílá. | cron-job.org posílá e-mail. | E-mail při chybě. |

Vercel Cron je zamítnutý (tarif Hobby umí jen jednou denně); Vercel Pro
($20 měsíčně) by to vyřešil taky, ale stojí peníze a nic dalšího nepřináší.

**Doporučení: pg_cron + pg_net + Vault.** Žádný nový dodavatel, tajemství
zůstane u nás, plán je v repu a přesný na minutu.

### Výjimka z pravidla — rozhoduje Šéfík

CLAUDE.md říká *„Rozšíření Postgresu — nepoužívej je… Když opravdu nejde
jinak, zeptej se"*. Tohle je přesně ten případ. Důvod pravidla (Supabase
dává rozšíření do jiného schématu než lokální databáze, takže kód funguje
jen na jednom z nich) se pg_cron, pg_net a Vaultu netýká — mají vlastní
pevná schémata `cron`, `net` a `vault`. Migrace proto `create extension`
neobsahuje: rozšíření zapíná Šéfík sám v Dashboardu, a tím výjimku schvaluje.

Starší migrace (`20260914140000_marketing_kampane.sql`,
`20261007120000_integrace_interval_synchronizace.sql`) pg_cron odmítly
s argumentem *„jedno místo, které rozhoduje o čase"*. To zůstává: o čase
dál rozhoduje jedno místo — jen se stěhuje z GitHubu do databáze. Po dobu
zkoušky volají dvě místa, proto je v každé úloze zámek (oddíl 4).

## 3. Co je v tomhle PR

- **Migrace** (nenasazená): tabulka úloh s plánem, funkce
  `app.naplanovat_ulohy()`, `app.zrusit_planovac()`, `app.planovac_stav()`,
  `app.spustit_ulohu()`, úklid historie a zámek `public.uloha_zabrat()`.
  Sama nic nenaplánuje ani nespustí.
- **Zámek v každé úloze** (`lib/supabase/uloha.ts`, `uzBezi`): dva řádky
  v každé z 9 adres `app/api/uloha/*`, hned za ověřením tajemství.
  Dokud migrace není nasazená, úlohy běží přesně jako dnes.
- **Kontroly**: `scripts/planovac.test.mjs` (neplatné tajemství → 401 a na
  nic se nesáhne, ve všech 9 úlohách; zámek; shoda jmen a plánů mezi
  migrací, úlohami a GitHubem) a scénář `krok96` (Vault, pg_net, pg_cron,
  práva, zámek).
- GitHub workflow **beze změny** — zůstávají jako záloha.

## 4. Dvojí spuštění

Dokud běží GitHub i pg_cron, přijde tatáž úloha dvakrát. Ověřeno 14. 10.:

- **Bezpečné samo od sebe**: zapomenuté odchody, plánování checklistů,
  pokladny, příjem faktur (zámek na schránku v `synchronizace_behy`),
  marketingová fronta (`for update skip locked`), banky (nové transakce
  se neduplikují). Zámky v `synchronizace_behy` fungují: druhý souběžný
  běh spadne na unikátní index, zaseknutý běh se uvolní po 10 minutách
  a úlohy smí běžet nejvýš 60 s.
- **Zdvojilo by se při souběžném volání**: dva pushe „Čekají na vás
  zprávy" (notifikace-push), dva koncepty téhož marketingového příspěvku
  (marketing-automatizace), falešné „vyžaduje pozornost" u Fio (Fio na
  druhé volání do 30 s odpoví 409), u KB zbytečné placené volání.

Proto **zámek úlohy**: první volání úlohu zabere na její limit (90 s, nebo
5 min u úloh bez vlastního limitu), každé další v té době dostane
„běží jinde" a neudělá nic. Zámek vyprší sám; nejkratší rozestup v plánu je
15 minut, takže příští plánovaný běh nikdy nezablokuje.

Výjimka: **příjem faktur** zámek po doběhnutí uvolní. GitHub ho volá ve
smyčce (až 15 kol za sebou, dokud zbývá dohánět schránky) a druhé kolo
by jinak narazilo na zámek z prvního. pg_cron volá faktury jednou za
30 minut, jedno kolo — při velkém dohánění bude po vypnutí GitHubu
pomalejší (jedno kolo za 30 min místo až 15 kol najednou); kdyby to
vadilo, stačí faktury plánovat častěji.

## 5. Postup zapnutí (Šéfík)

Každý krok jen na tvůj pokyn. Kroky 1–2 jsou běžné nasazení, kroky 3–6 jsou
nové.

1. **Sloučit PR.** Vercel nasadí kód. Úlohy dál běží z GitHubu jako dnes —
   zámek čeká na migraci (ve Vercel logu je varování „zámek úlohy čeká na
   migraci").
2. **db push** z `main` podle skillu `nasazeni`. Tím vznikne zámek a funkce
   plánovače. Nic se ještě nespouští.
3. **Zapnout rozšíření.** Supabase Dashboard → projekt *foodtab-test* →
   **Database → Extensions** → vyhledat `pg_cron` → zapnout. Totéž pro
   `pg_net`.
4. **Zkontrolovat, že `net` a `vault` nejsou vystavené v API.**
   Project Settings → **Data API → Exposed schemas**: má tam být jen
   `public` a `graphql_public`. Kdyby tam bylo `net`, mohl by kdokoli číst
   čekající požadavky i s tajemstvím.
5. **Uložit dvě tajemství do Vaultu.** Dashboard → **Integrations → Vault**
   (ve starším rozhraní Database → Vault) → *Add new secret*:
   - Name `foodtab_app_url`, Secret = adresa aplikace, např.
     `https://foodtab.vercel.app` — stejná jako GitHub secret `APP_URL`.
     Musí začínat `https://`, bez cesty.
   - Name `foodtab_cron_secret`, Secret = **stejná hodnota jako
     `CRON_SECRET` na Vercelu**. Bez mezery a nového řádku na konci.

   Tajemství **nepiš do SQL Editoru** — ten si dotazy ukládá do historie.
   Když hodnotu `CRON_SECRET` na Vercelu nevidíš (je označená jako
   Sensitive), vytvoř novou dlouhou náhodnou hodnotu a nastav ji **na třech
   místech stejně**: Vercel (Production, pak Redeploy), GitHub → Settings →
   Secrets → `CRON_SECRET`, Vault `foodtab_cron_secret`.
6. **Naplánovat.** SQL Editor:

   ```sql
   select * from app.naplanovat_ulohy();
   ```

   Vrátí 9 řádků s úlohami a plánem. Když něco chybí (rozšíření, tajemství,
   špatná adresa), vrátí chybu s tím, co chybí, a **nenaplánuje nic**.
   Příkaz jde pustit znovu kdykoli — nic nezdvojí.
7. **Za 20 minut zkontrolovat:**

   ```sql
   select * from app.planovac_stav();
   ```

   | Sloupec | Co má být |
   |---|---|
   | `v_cronu` | `true` u všech 9 |
   | `posledni_volani` | čas posledního volání z databáze — za 20 minut ho mají jen úlohy, které už přišly na řadu (po 15 a 30 minutách); hodinové do hodiny, **banka až do 4 hodin** |
   | `posledni_kod` | `200`. **`401` = tajemství ve Vaultu nesedí s Vercelem.** |
   | `posledni_chyba` | prázdné |
   | `posledni_zacatek` | kdy úloha naposledy opravdu začala (z databáze i z GitHubu) |
   | `volani_6h`, `chyb_6h` | počty za 6 h (déle si pg_net odpovědi nedrží) |

   **Hlídač (oddíl 7) pusť až zhruba 4,5 hodiny po `naplanovat_ulohy()`**
   — teprve pak má každá úloha za sebou první volání. Dřív bude červený
   s textem „databáze ji za posledních 6 h nezavolala — hned po zapnutí
   plánovače je to normální…": to není porucha, ani e-mail od plánovaného
   běhu hlídače z téhle doby. Potom: GitHub → Actions → **Plánovač —
   hlídač** → *Run workflow*. Zelená = všech 9 úloh volaných včas,
   s odpovědí 200, nejvýš jednou chybou za 6 h a úloha v aplikaci opravdu
   začíná.

8. **Za 2–3 dny**, když je hlídač zelený **a** `chyb_6h` je 0 u všech
   úloh (`select * from app.planovac_stav();`): samostatný PR, který
   z GitHub workflow úloh odstraní `schedule` (ruční `workflow_dispatch`
   zůstane). Pak rozhoduje o čase jen databáze. Kontrola
   `scripts/planovac.test.mjs` v tu chvíli potřebuje upravit (dnes hlídá,
   že GitHub plánuje totéž). **Bez hlídače (oddíl 7) to nedělat** —
   zastavený plánovač by nikdo nepoznal. A počítat s tím, že i s hlídačem
   se zastavení pozná až za několik hodin, v nejhorším případě zhruba za
   12 (oddíl 7).

**Vypnutí** kdykoli, bez db push:

```sql
select app.zrusit_planovac();
```

Úlohy pak dál volá jen GitHub, jako dnes.

**Výměna tajemství** (`CRON_SECRET`): na všech třech místech — Vercel
(+ Redeploy), GitHub Secrets, Vault (*Edit* u `foodtab_cron_secret`).

## 6. Na co dát pozor

- **Vercel bude dostávat víc volání** — přesně tolik, kolik bylo vždycky
  v plánu: ~440 denně místo dnešních ~40. Na Hobby by to mělo stačit, ale
  první týden se podívat do Vercel → Usage.
- **pg_cron nikomu nepíše.** Proto hlídač (oddíl 7): jeho e-maily od
  GitHubu jsou jediné upozornění, že plánovač stojí. Nevypínat ho.
- **Prefix `foodtab-`** v názvech úloh v pg_cronu patří plánovači:
  `app.zrusit_planovac()` smaže vše, co tak začíná. Jiné úlohy tak
  nepojmenovávat.
- **Úprava plánu** = nová migrace, která změní řádek v `app.planovac_ulohy`,
  a pak znovu `select * from app.naplanovat_ulohy();`. Dokud běží GitHub,
  změnit plán i v příslušném workflow (hlídá to `scripts/planovac.test.mjs`).

## 7. Hlídač plánovače

Migrace `20261017100000_planovac_hlidac.sql`, adresa `/api/planovac/hlidac`,
workflow `.github/workflows/planovac-hlidac.yml`, rozhodování
v `lib/planovac-hlidac.ts`, scénář `krok97`.

Plán má každé 3 h a jde pustit ručně: Actions → **Plánovač — hlídač** →
*Run workflow*. Zeptá se aplikace a ta databáze (`public.planovac_zdravi()`
= totéž co `app.planovac_stav()`, jen pro service_role).

**Jak rychle se zastavení pozná:** hlídač sám běží na GitHubu, a ten ho
podle vlastního měření (oddíl 1) pustí jen asi 4× denně s mezerami **až
~12 hodin**. V nejhorším případě se tedy zastavený plánovač pozná zhruba
za 12 hodin — ne za pár. S tím se počítá i při vypnutí `schedule` u úloh
(krok 8). Rychlejší by byl externí monitoring adresy hlídače (služba,
která ji volá třeba každých 15 minut a pošle e-mail při 503) — znamená
ale nového dodavatele a CRON_SECRET u něj, proto zatím ne.

**Zčervená a GitHub pošle e-mail**, když u některé úlohy:

- není naplánovaná v pg_cronu (nikdo nespustil `app.naplanovat_ulohy()`),
- databáze ji nezavolala déle, než je nejdelší mezera v jejím plánu
  + 10 minut (třeba hodinová úloha víc než 70 minut), nebo za 6 h vůbec
  (hned po zapnutí normální, viz krok 7),
- poslední odpověď nebyla 200 — **401 znamená, že tajemství ve Vaultu
  nesedí s `CRON_SECRET` na Vercelu**,
- poslední volání vypršelo nebo spadlo na síti, **nebo je bez odpovědi
  déle než 15 minut** — pg_net musí odpovědět do 5 minut; starší volání
  bez odpovědi znamená, že pg_net požadavky neodesílá (v SQL Editoru
  `select net.check_worker_is_up();`, oprava `select net.worker_restart();`),
- za 6 h vrátila **2 a víc chyb**, i když poslední volání vyšlo,
- volání chodí, ale úloha v aplikaci naposledy **začala** déle, než je
  mezera v plánu + 10 minut (zaseknutý zámek, adresa vede jinam),

a taky když migrace hlídače ještě není nasazená nebo adresa nemůže stav
přečíst (důvod je v logu). V logu běhu je u každého problému řádek
s jménem úlohy a důvodem (jen jména, kódy, počty a minuty — repozitář je
veřejný). Podrobnosti pak `select * from app.planovac_stav();`.

**Dokud plánovač v Supabase nezapneš, bude hlídač červený** („není
naplánovaná v pg_cronu" u všech 9 úloh). To je správně — říká přesně to,
co chybí. Kdyby se zapnutí mělo odložit, jde workflow dočasně vypnout:
Actions → Plánovač — hlídač → ⋯ → *Disable workflow*.

Hlídač schválně není úloha pg_cronu: nesmí záviset na tom, co hlídá.
