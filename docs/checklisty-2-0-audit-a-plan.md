# Checklisty 2.0 — současný stav a návrh minimálního rozsahu

Zdroj zadání: Šéfíkův prompt „FOODTAB — CHECKLISTY 2.0" (52 bodů) + mockup
obrazovky, 23. 9. 2026. Tenhle dokument je krok 1 a 2 z toho zadání
(„CHECKLIST CURRENT STATE" a „MINIMUM REQUIRED CHANGES") — teprve po něm
jde implementace.

Zjištěno čtyřmi nezávislými audity (databáze, práva/RLS, obrazovky,
notifikace/vazba na úkoly), každé tvrzení má citaci `soubor:řádek`.

---

## 1. CHECKLIST CURRENT STATE

### 1.1 Datový model

Čtyři tabulky, založené `20260823130000_provoz.sql`, od té doby jen
drobně upravené (`usek_id` přidán `20260906030000_useky.sql`, granty
`20260917000000_granty_provoz_uklid.sql`, vazba na úkoly
`20260922100000_checklist_ukol.sql` — ta ale nemění checklist tabulky,
jen `tasks`).

- **`checklist_templates`** = šablona: `name`, `usek_id` (živé),
  `department` (mrtvé, jen kvůli starému seedu), `schedule` (text
  `'opening'/'closing'/'haccp'/'weekly'`, **nevynucený `check`**),
  `active`, `branch_id` (nullable = firemní úroveň).
- **`checklist_items`** = položky šablony: `label`, `requires_value`,
  `value_type` (`number`/`text`/`photo`), `value_unit`, `min_value`,
  `max_value`, `position`.
- **`checklist_runs`** = instance na konkrétní `(template_id, branch_id,
  business_date)` — `unique`, takže druhé spuštění nevyrobí duplicitu.
  `status` jen `'open'`/`'done'`. Žádné `completed_by` (jen
  `finished_at`, bez „kým").
- **`checklist_entries`** = zápis k položce v rámci běhu:
  `checked`, `value_number`, `value_text`, `employee_id`, `recorded_at`.
  `unique(run_id, item_id)`.

**Template vs. instance** — přesně jak zadání předpokládá, potvrzeno.

**Co v modelu NENÍ**: `shift_id` (vazba na směnu), `required` nezávislé
na `requires_value`, sekce/skupiny položek, verze šablony,
`completed_by`, stav „hotovo s výhradou". Poslední bod je **vědomé
rozhodnutí**, ne mezera — komentář u migrace úkolů z checklistu to řeší
výslovně: problém je akce člověka (vznikne úkol), ne nový sloupec.

### 1.2 Práva a RLS

Živě ověřeno v databázi (`pg_policies`), sedí s migrací:

- Šablony a položky: číst `tasks.read`, **psát `tasks.manage`**.
- Běhy a zápisy položek: číst i **psát stačí `tasks.read`** — odškrtnout
  položku nebo spustit/zavřít běh smí kdokoli, kdo na pobočku vidí,
  záměrně („je to běžná práce směny, ne správcovský úkon").
- `employee_id`/`recorded_at` u zápisu položky jde jen ze serverové
  session, nedá se podvrhnout z formuláře — ověřeno přesně v kódu.
- Souběžnost: jen `unique` klíč (žádná duplicita), **žádná ochrana proti
  přepsání** — dva lidé na stejné položce ve stejnou chvíli = vyhrává
  poslední zápis, beze zprávy.

### 1.3 Obrazovky

- `/ukoly` (sekce Checklisty): seznam šablon pro pobočku + dnešní běh.
  **Žádné filtry, žádný souhrn** (na rozdíl od sekce Úkoly vedle, která
  souhrn má).
- `/ukoly/[beh]`: vyplňování. `number`/`text` fungují, `photo` ukáže
  jen větu „nahrávání zatím není hotové" (na klientu i na serveru).
  Uzavření = tlačítko „Uzavřít checklist", jen když jsou hotové úplně
  všechny položky.
- `/ukoly/[beh]/problem`: nahlásit problém → úkol. Předvyplní se **jen
  název** (z položky, pokud je vybraná) a pobočka. Poznámka, adresát,
  termín, foto — nic z toho se nedědí, člověk vyplňuje ručně.
- `/ukoly/sablona/nova` (vzniklo včera): založení šablony i s položkami.
- **„Dnes" checklisty vůbec nemá** — vědomé rozhodnutí, komentář to říká
  („na jednu KPI kartu nesbalíš smysluplně").
- **Žádná mobilní verze** — čistě responzivní CSS, stejný kód.
- **Žádná historie** — jediná cesta na starý běh je znát přímo jeho id
  (např. z odkazu v detailu úkolu).
- Komunikace (`/vzkazy`) na checklisty **záměrně** neodkazuje — dvakrát
  psaný komentář v kódu: „mezi konverzací a checklistem žádná vazba
  neexistuje a sekce s vymyšlenými daty by lhala."

### 1.4 Notifikace, realtime, úložiště fotek

- **Notifikace**: nulová vazba na Notification Service. Úkol vzniklý
  z problému dostane běžné upozornění „přidělen úkol" (obecný
  mechanismus pro všechny úkoly), ale checklist samotný (přiřazení,
  blížící se termín, po termínu) žádné upozornění nikdy nevyvolá.
- **Realtime**: žádné. Jediná tabulka v realtime publikaci je
  `notifications`.
- **Foto**: žádný Storage bucket pro checklisty neexistuje. Typ
  položky `photo` je jen hodnota v databázi a text v UI, který rovnou
  říká, že nahrávání není hotové.

---

## 2. MINIMUM REQUIRED CHANGES — návrh rozsahu na tenhle průchod

52 bodů zadání je víckadenní práce (šablonový editor, sekce, verzování,
auto-přiřazení podle směny, dvojí kontrola, realtime, foto, notifikační
eventy, plné E2E...). Snažit se to všechno najednou by znamenalo dělat
každou část napůl. Navrhuju tenhle rozsah — **REUSE/ADAPT**, ne přepis:

### Uděláno v tomhle průchodu

1. **Vzhled podle mockupu** — kompaktní karty, barvy stavu (zelená
   hotovo / amber probíhá / červená po termínu / šedá nezahájeno),
   skutečný souhrn nahoře (Dnes/Probíhá/Po termínu/Hotovo — dopočítané
   z opravdových dat, ne vymyšlené), filtry Pobočka/Úsek/Stav.
2. **Nová záložka „Historie"** — dosud neexistuje vůbec. Minulé běhy,
   filtrovatelné podle data/pobočky/stavu.
3. **Detail běhu podle mockupu** — kompaktní hlavička, progress bar,
   karta odpovědnosti (viz bod 4).
4. **Lehká odpovědnost** (jen tohle si žádá malou, doplňkovou migraci):
   `checklist_runs` dostane dva nové nepovinné sloupce —
   `assigned_employee_id` (kdo běh dělá) a `due_at` (do kdy). Nastaví
   se nepovinně při spuštění běhu. Bez nich karta „Odpovědný" z mockupu
   nejde vyplnit poctivě — dnes se to nedá vůbec zjistit, ne že by se
   to jen nezobrazovalo.
5. Scénář (mutačně otestovaný) pro nové sloupce a jejich čtení/zápis.

### Vědomě NEuděláno teď — a proč

- **Editor šablony** (úprava/mazání existující, přeřazení položek,
  sekce) — dnes jde jen založit novou. Sám o sobě další kus práce.
- **Auto-přiřazení podle směny** — zadání samo říká „nevytvářej fake
  assignment, pokud Schedule model neposkytuje dost informací" — a
  neposkytuje (`checklist_templates` nemá vazbu na `shift_id` vůbec).
- **Fotky u položek** — potřebuje nový Storage bucket + politiky +
  upload UI (obdoba `konverzace_prilohy` u zpráv). Formulář to dnes
  aspoň řekne rovnou, nepředstírá to.
- **Notifikační eventy** (přiřazeno/blíží se termín/po termínu) —
  navázalo by se to na `app.notifikovat`, ale je to samostatný kus
  práce, ne rozšíření dnešního.
- **Realtime** aktualizace při rozdělané práci víc lidí najednou.
- **Dvojí kontrola** (zaměstnanec + potvrzení vedoucího).
- **Verzování šablon.**
- **Sekce/skupiny položek** uvnitř jednoho checklistu.
- **Vazba do Komunikace** (systémová událost po dokončení, sdílení v
  chatu) — zůstává záměrně mimo, ze stejného důvodu, jaký už je
  zapsaný v kódu (žádná vymyšlená vazba).
- **Plné E2E** (12 scénářů ze zadání) — přidávám jen SQL scénář pro
  novou migraci; Playwright proti přihlášené appce v projektu dosud
  není zavedený vůbec (ne jen u checklistů).

### Co se NEMĚNÍ (a proč je to v pořádku)

- Práva zůstávají, jak jsou (`tasks.read` na běh/zápis,
  `tasks.manage` na šablonu) — bodu 41–42 zadání (bezpečnost, RLS) to
  už dnes odpovídá, žádná díra se v auditu nenašla.
- Souběžný zápis zůstává „poslední vyhrává" — reálné riziko jen při
  doslova současném kliknutí dvou lidí na tutéž položku, nízká sázka
  (přepíše se hodnota, ne že by zmizela historie/účetnictví).

---

## Otázka, než začnu stavět

Sedí vám tenhle rozsah (body 1–5 výš), nebo chcete jinak — třeba
upřednostnit fotky/notifikace před odpovědností, nebo rovnou i editor
šablony? Řeknu rovnou: cokoli navíc jde přidat později stejným
způsobem, tohle není poslední průchod.
