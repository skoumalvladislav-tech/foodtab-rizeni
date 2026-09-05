# Zadání pro Codea — modul Marketing, první krok

Plné zadání je v `docs/marketing-zadani.md` (schválil Šéfík 3. 9. 2026).
Tenhle soubor říká, co už je napsané, co s tím udělat a kde se zastavit.

**Nejdřív si přečti v `CLAUDE.md` oddíl „Dvě relace v jednom repozitáři".**
Na projektu teď souběžně pracuje i relace provoz a dvakrát se to 3. 9. 2026
už srazilo. Platí z toho pro tebe hlavně: pracuješ na větvi `marketing`
(ne `main`), scénáře se jmenují `marketingN_scenar.sql` (vlastní číselná
řada, ne `krokN`), `create table` je bez `if not exists`, a **do cizího
modulu (provoz) nesahej** — najdeš-li tam chybu, jen ji ohlas.

Modul `marketing` a jeho tři oprávnění (`marketing.read`, `marketing.manage`,
`marketing.publish`) existují od úplného začátku
(`supabase/migrations/20260823120100_catalog.sql`). Chyběly k nim tabulky
a obrazovka — první krok podle oddílu 7 zadání je teď napsaný, ale
**nasazený ani spuštěný proti databázi ještě nebyl.** Psal to Claude
(Cowork) přes vzdálený přístup k souborům, bez shellu na tomhle počítači —
proto to teď potřebuje projít tebou.

---

## Co už leží v repozitáři

Tři nové soubory a dvě drobné úpravy, všechno už na disku (ne v gitu):

- `supabase/migrations/20260903040000_marketing_tabulky.sql` — pět tabulek:
  `marketing_settings` (branding a tón hlasu firmy, 1 řádek na firmu),
  `marketing_integrations` (zaměnitelné konektory — zdroj menu / fotky /
  sociální síť, viz oddíl 8.2–8.3 zadání), `marketing_photos` (trvalá
  fotobanka pobočky), `marketing_templates` (grafické šablony firmy,
  brand-agnostic), `marketing_posts` (návrh → schváleno/zamítnuto →
  publikováno). Každá má `tenant_id`, zapnuté RLS a granty vyjmenované
  po sloupcích (žádné `grant on all tables`). Na `marketing_posts` navíc
  spoušť `app.strez_prechod_marketing_postu` — hlídá, že do stavu
  `publikovano` smí příspěvek posunout **jen** `marketing.publish`,
  nikdy samotné `marketing.manage`.
- `app/[rozsah]/marketing/page.tsx` — prázdná obrazovka podle vzoru
  `app/[rozsah]/menu/page.tsx`, kontroluje `marketing.read`.
- `app/[rozsah]/nabidka.ts` — položka Marketing přepnutá na `hotovo: true`.
- `supabase/tests/marketing1_scenar.sql` — scénář, ve vlastní smyčce
  v `supabase/tests/run.sh` (ne ve sdílené řadě `krokN`). Přejmenovaný
  z `krok18_scenar.sql`; ten už v repozitáři není.

Migrace se drží stejného rozhodnutí, na jakém stojí `modul_menu`: žádná
nová oprávnění se nezakládají (ta tři už jsou), u stávajících firem
zůstává modul vypnutý, nikomu se nic nebere. **Až budeš někdy přidávat
další oprávnění modulu Marketing, dej mu klíč začínající `marketing.`**
— ať se jmenný prostor nesrazí s provozními právy.

---

## Nejdřív, než na tom začneš dělat

Tohle udělám já (Šéfík), ne ty — PowerShell si dělám sám:

1. Založit/přepnout na větev `marketing` (podle „Dvě relace" v
   `CLAUDE.md` — provoz je na `main`, marketing na vlastní větvi).
2. `git add` na nové a upravené soubory (migrace, `app/[rozsah]/marketing`,
   `app/[rozsah]/nabidka.ts`, `supabase/tests/marketing1_scenar.sql`,
   `supabase/tests/run.sh`, `docs/marketing-zadani.md`,
   `docs/zadani-marketing-pro-codea.md`) a commit na větvi `marketing`.
3. `supabase/tests/run.sh` — lokální běh proti PostgreSQL, ať se ukáže,
   jestli scénář `marketing1_scenar` vůbec projde.
4. `supabase db push` **jen z `main`** — teprve až se větev `marketing`
   slije do `main` a testy tam projdou znovu. Migrace z rozdělané větve
   se nenasazují (`run.sh` staví databázi jen z migrací, které v té
   větvi leží — na větvi jich je jen půlka, testy by ověřovaly něco
   jiného, než co poběží v provozu).
5. `supabase migration list` — ověřit, že `20260903040000` je na obou
   stranách.

**Než ti napíšu, že tohle proběhlo, na kódu marketingu nezačínej** —
stavěl bys na tabulkách, které v databázi ještě nejsou, a scénář, který
jsem sám neměl jak spustit.

---

## Tvrdá omezení

- **`supabase db push` NE.** To dělám já, a jen z `main`.
- **Ostrá data neměň — a to platí i pro zapnutí modulu.** Řádek do
  `tenant_modules` v ostré databázi je zásah do ostrých dat stejně jako
  cokoli jiného. Modul `marketing` NEZAPÍNEJ, ani migrací, ani přímým
  zápisem, ani při „ověření naostro". Zapne si ho Šéfík sám, až bude
  marketing chtít vidět — je to jeho rozhodnutí a jedno kliknutí, ne
  krok týhle etapy.
- **Do cizího modulu (provoz) nesahej.** Sdílené soubory (`run.sh`,
  `CLAUDE.md`) uprav jen v částech, které patří marketingu — moji úpravu
  `run.sh` (vlastní smyčka pro `marketingN_scenar`) nech, jak je, o
  zbytek (`krokN` smyčka, robustnost běhu) se stará provoz.
- Nový scénář jsem psal bez možnosti si ho ověřit — **počítej s tím, že
  v něm bude drobná chyba** (špatný název sloupce, jiná signatura funkce
  apod.). Najdi ji přes chybovou hlášku z `run.sh`, oprav přímo v
  `marketing1_scenar.sql`, nepřepisuj kvůli tomu tabulky v migraci, pokud
  tabulky samotné nejsou špatně.
- **Každá případná další tabulka:** `tenant_id`, zapnuté RLS, politika,
  granty vyjmenované po sloupcích — stejně jako u těch pěti hotových.
- **Nedomýšlej si.** Skutečné navrhování příspěvků agentem, vykreslení
  grafiky (Bannerbear/budoucí renderer) a REST API pro n8n **nejsou**
  součástí týhle etapy — viz „Co zatím nedělat" níže. Otevřené otázky
  jsou vyjmenované v oddíle 6 `docs/marketing-zadani.md`.
- **Commituj po dokončeném kroku.**

---

## Co udělat

### 1. Oprav, co spadne v `run.sh`

Spustím ho já a pošlu ti výstup. Pokud selže `marketing1_scenar`, over
nejdřív, jestli je chyba ve scénáři (název sloupce/funkce), nebo ve
skutečné chybě v migraci (chybějící politika, špatná podmínka ve
spoušti). Oprav a napiš mi, co bylo špatně, ať to doplním do zadání.

### 2. Projdi migraci proti CLAUDE.md

Zvlášť se podívej na:

- Granty po sloupcích u všech pěti tabulek (pravidlo z `CLAUDE.md` o
  jediném místě rozhodování — tady jde o to, aby se nikam necitlivě
  neprosáklo víc, než má).
- RLS politiky `marketing_posts_insert`/`_update` — čte se v nich
  `app.has_access(tenant_id, 'marketing.manage', branch_id)`, ověř, že
  `app.has_access` a `app.can_read_scoped` mají přesně tuhle signaturu
  v aktuální verzi `authz.sql` (nemusí sedět, pokud se mezitím něco
  změnilo).
- Spoušť `app.strez_prechod_marketing_postu` — je `before update`,
  security definer, volá `app.has_access` se `new.tenant_id`/
  `new.branch_id`. Ověř, že `errcode = 'insufficient_privilege'` je
  totéž, na co se v testu odchytává `exception when insufficient_privilege`.

**Zastav se tady a napiš zprávu.**

### Poznámka: ověření naostro NENÍ tvůj krok

V dřívější verzi tohohle zadání stálo „zapnout modul na Černé Perle" —
to je ve sporu s pravidlem výš („ostrá data neměň") a navíc to bylo
formulované nepřesně (moduly se zapínají za celou firmu, ne za pobočku
— `tenant_modules` má klíč `(tenant_id, module_key)`, sloupec pro
pobočku neexistuje, a je to závazné rozhodnutí v `CLAUDE.md`; kdyby
Šéfík chtěl zapínání po pobočkách, je to změna základu, ne detail
zadání, a musí se probrat zvlášť).

**Platí ostrá data neměň — modul nezapínej.** Ověření, že záložka
Marketing vede na hlášku „Připravujeme" a že vypnutý modul odmítne
i přímé volání adresy `/[rozsah]/marketing` (pravidlo 5), uděláš proti
lokální databázi, kterou staví `supabase/tests/run.sh` — ne v ostré.
Šéfík si modul v ostré databázi zapne sám, až bude chtít marketing
v appce vidět.

---

## Co zatím NEDĚLAT

- Skutečné navrhování příspěvků (agent, který čte jídelníček a fotky
  a zakládá řádek do `marketing_posts`).
- Vykreslení grafiky — napojení na Bannerbear nebo budoucí renderer.
- REST API, přes které by se dal napojit n8n workflow Černé Perly.
- Obrazovku pro nastavení brandingu/integrací — zatím jen tabulky,
  žádné UI k nim.

Tohle všechno čeká na samostatné zadání, až bude tenhle základ nasazený
a odzkoušený.

**Dopředu k n8n a skutečnému navrhování** (až přijde na řadu): pravidlo 8
zakazuje posílat do jazykového modelu mzdy, docházku, kontakty a zálohy.
U marketingu bude podstatné hlavně slovo **kontakty** — jakmile se bude
pracovat s hosty/zákazníky (ne jen s jídelníčkem a fotkami interiéru),
je to jednak tohle pravidlo, jednak souhlasy podle GDPR. Nenavrhuj tu
část tak, aby se to muselo později pracně rozplétat — žádná osobní data
hostů se nemají dostat k modelu bez explicitního souhlasu a bez zvlášť
rozmyšleného, zdokumentovaného postupu.

---

## Ranní zpráva

- co je hotové a commitnuté
- co jsi opravil ve scénáři (pokud něco) a proč
- co jsi našel při kontrole migrace proti `CLAUDE.md` (bod 2)
- na čem ses zastavil
