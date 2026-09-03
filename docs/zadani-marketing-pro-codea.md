# Zadání pro Codea — modul Marketing, první krok

Plné zadání je v `docs/marketing-zadani.md` (schválil Šéfík 3. 9. 2026).
Tenhle soubor říká, co už je napsané, co s tím udělat a kde se zastavit.

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
- `supabase/tests/krok18_scenar.sql` — scénář, přidaný i do seznamu
  v `supabase/tests/run.sh`.

Migrace se drží stejného rozhodnutí, na jakém stojí `modul_menu`: žádná
nová oprávnění se nezakládají (ta tři už jsou), u stávajících firem
zůstává modul vypnutý, nikomu se nic nebere.

---

## Nejdřív, než na tom začneš dělat

Tohle udělám já (Šéfík), ne ty — PowerShell si dělám sám:

1. `git add supabase/migrations/20260903040000_marketing_tabulky.sql app/[rozsah]/marketing app/[rozsah]/nabidka.ts supabase/tests/krok18_scenar.sql supabase/tests/run.sh docs/marketing-zadani.md docs/ukoly-codea-2026-09-03-marketing.md` a commit.
2. `supabase/tests/run.sh` — lokální běh proti PGlite/PostgreSQL, ať se
   ukáže, jestli scénář `krok18_scenar` vůbec projde.
3. `supabase db push` — teprve když run.sh projde.
4. `supabase migration list` — ověřit, že `20260903040000` je na obou
   stranách.

**Než ti napíšu, že tohle proběhlo, na kódu marketingu nezačínej** —
stavěl bys na tabulkách, které v databázi ještě nejsou, a scénář, který
jsem sám neměl jak spustit.

---

## Tvrdá omezení

- **`supabase db push` NE.** To dělám já.
- **Ostrá data neměň.**
- Nový scénář jsem psal bez možnosti si ho ověřit — **počítej s tím, že
  v něm bude drobná chyba** (špatný název sloupce, jiná signatura funkce
  apod.). Najdi ji přes chybovou hlášku z `run.sh`, oprav přímo v
  `krok18_scenar.sql`, nepřepisuj kvůli tomu tabulky v migraci, pokud
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

Spustím ho já a pošlu ti výstup. Pokud selže `krok18_scenar`, over nejdřív,
jestli je chyba ve scénáři (název sloupce/funkce), nebo ve skutečné
chybě v migraci (chybějící politika, špatná podmínka ve spoušti). Oprav
a napiš mi, co bylo špatně, ať to doplním do zadání.

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

### 3. Naostro na Černé Perle

Až migrace projde a testy jsou zelené:

- Zapnout modul `marketing` pro tenanta Černé Perly (řádek do
  `tenant_modules`, stejně jako se to dělalo u `menu`).
- Ověřit v prohlížeči: záložka Marketing se objeví, vede na hlášku
  „Připravujeme". Bez zapnutého modulu / bez `marketing.read` appka
  místo toho ukáže „Marketing není zapnutý".

**Zastav se tady a napiš zprávu.**

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

---

## Ranní zpráva

- co je hotové a commitnuté
- co jsi opravil ve scénáři (pokud něco) a proč
- výsledek kontroly naostro na Černé Perle
- na čem ses zastavil
