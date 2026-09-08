# Zařazení místo rolí — co se našlo, než se začalo psát

Sepsáno 8. 9. 2026 před zásahem do jádra oprávnění. Je to doplněk
k `docs/zarazeni-misto-roli.md`, ne jeho náhrada: zadání platí, mění se
jen to, co je tady vyjmenované.

**Proč tenhle soubor existuje.** Zadání dává krok E podmínku, která
nepřipouští výklad: *„Buď je databázová část hotová celá a scénář
prochází, nebo v repozitáři neleží nic."* Průzkum ukázal, že „celá" je
podstatně víc, než zadání předpokládá — a hlavně, že **hranice, na
které zadání dovoluje skončit, ve skutečnosti neexistuje.** Napsat
polovinu a commitnout ji by porušilo tu podmínku; napsat to celé
naslepo a bez proběhlé zkoušky taky.

**Nic z kroku E proto dnes v repozitáři neleží.** Leží tady důvody.

---

## 1. Jedna věc, kterou musí rozhodnout Šéfík

**Kolik má mít firma majitelů?** Zadání (oddíl 5.2) chce:

```sql
create unique index employees_jediny_majitel
  on public.employees (tenant_id) where je_majitel and deleted_at is null;
```

Tedy **jednoho**. Jenže:

- `docs/vlastniku-muze-byt-vic.md`, ř. 7–11 říká opak,
- `20260902010000_posledni_majitel.sql`, ř. 6–7 na tom staví:
  *„Majitelů může být víc: firma má jednu roli Majitel, ale členství
  k ní může mít libovolně mnoho lidí,"*
- **a ostrá firma má dva** (`docs/co-jeste-chybi-2026-09-05.md`,
  ř. 12–18).

Ten index by na ostrých datech **spadl uprostřed migrace** a firma by
zůstala s novými funkcemi a starými daty. Dnešní unikát je na ROLI
(`20260823120000_foundation.sql`, ř. 174–175), ne na člověku — to je
něco jiného.

**Co jsem vybral (podle pravidla „nejopatrnější varianta"):** index
vynechat a zachovat víc majitelů. Odebrat majitelství se dá vždycky;
migrace, která spadne v půlce, se opravuje hůř. Otázka je v
`docs/hlaseni/otazky.md`.

---

## 2. Hranice, na které se dá skončit, tam není

Zadání (oddíl 9) tvrdí: *„Po bodu 2 aplikace funguje se starými
obrazovkami; ty jen zatím ukazují role, které už o ničem
nerozhodují."*

**Po bodu 2 to platí.** Body 6.4 (pruh o osobních údajích) a 6.6
(odhlášení na rozcestník) s oprávněními nesouvisejí vůbec — **jsou
hotové a nasazené dnes.**

**Po bodu 3 — samotné databázi — to neplatí.** Kdyby se udělala jen
databáze, aplikace přestane fungovat všem:

| kde | co se stane |
|---|---|
| `app/page.tsx:63` a `app/[rozsah]/layout.tsx:93` — `if (!ctx.role) redirect("/zatim-bez-opravneni")` | Až `my_context` přestane plnit `role`, skončí **každý včetně majitele** natrvalo na stránce „nikdo vám nepřidělil oprávnění". Není to smyčka — `app/zatim-bez-opravneni/page.tsx:44` posílá zpět jen toho, kdo roli má —, je to slepá ulice. |
| `app.visible_branch_ids` má dvakrát `m.role_id is not null` (`20260901200000_pozvanka_bez_role.sql:77, :88`) | Člověk s právy ze zařazení a prázdným `role_id` neuvidí ani jednu pobočku a `resolveScope` ho vyhodí — bez jediného slova o oprávněních. |
| `public.cekaji_na_opravneni` (`20260902070000:271`) má natvrdo `and m.role_id is null`, a volá ji rám aplikace (`app/[rozsah]/layout.tsx:214`) | Okno „čeká na oprávnění" začne hlásit **každého správně nastaveného člověka, napořád.** |
| `app/[rozsah]/nastaveni/lide/page.tsx:235-243` | „Kdo je majitel" se počítá z `roles.is_owner` + `memberships.role_id`. Vrátí **false pro každého**: zmizí „(jediný)" a odemkne se Smazat u posledního majitele. |

**Nejlevnější způsob, jak bod 3 udělat samostatně bezpečným** (návrh,
ne nález): nechat v `my_context` klíč `role` a plnit ho ze zařazení —
`{id: position_id, key, label, isOwner: je_majitel}` — a vyplnit ho
vždy, když má člověk cokoli: zařazení, `je_majitel`, nebo výjimku. Pak
`lib/authz.ts:486`, `lib/prideleni.ts:29`, obě obrazovky Mých údajů
i všechna tři přesměrování fungují beze změny. **Pozor:** majitel bez
zařazení by při naivní verzi vypadl.

---

## 3. „Dvě funkce" platí jen pro politiky

Zadání (oddíl 4) tvrdí, že odkud se oprávnění berou, je napsané ve dvou
funkcích. **Pro politiky RLS to sedí** — ověřeno, žádná politika si na
`role_permissions` nesahá sama, a je to dobrá zpráva.

Mimo politiky si ale na starý model sahá **dalších devět míst**, každé
bez `has_access`. Kdo přepíše jen `has_permission` a `has_access`, nechá
je běžet nad tabulkou, která už nikoho neřídí — a **build zůstane
zelený**:

| funkce | soubor:řádek | co se stane |
|---|---|---|
| `app.kdo_ma_pravo` | `20260902070000:67, :69` | upozornění na přijetí pozvánky chodí podle mrtvého modelu |
| `app.kdo_ma_pravo_na_pobocce` | `20260902080000:100, :102` | hlášení o zapomenutých odchodech chodí komu nemá |
| `app.adresati_vzkazu` | `20260906080000:83, :86, :88` | majitel si začne číst vzkazy adresované vedoucím |
| `app.smi_pridelit` + `app.ziva_prava_role` | `20260901110000:68, :95, :103` | **strop se stane dekorací** — viz níž |
| citlivá SMS v `app.create_invitation` | `20260901200000:293-296` | citlivé právo projde SMS pozvánkou a nic to neohlásí |
| `app.pocet_majitelu` | `20260902010000:57` | hlídač posledního majitele počítá podle mrtvé tabulky |
| `public.my_tenants` | `20260901200000:120` | rozcestník firem vrací `is_owner` z rolí — lže |
| `app.create_tenant` | `20260901160000:136-137, :140, :147` | **nová firma vznikne bez majitele a bez zařazení** |
| `app.upozorni_na_clenstvi` | `20260902030000:48, :54` | „bylo vám přiděleno oprávnění" přestane chodit |

**Ten strop si zaslouží vlastní odstavec.** `app.smi_pridelit(tenant,
role_id, scope)` s prázdným `role_id`: `ziva_prava_role` nevrátí nic,
`not exists (…)` je pravda, **projde všechno.** Pět politik
(`20260901110000:153, :160, :165, :192, :200`) tím přestane chránit —
a nic nespadne. Pravidlo „nikdo nepřidělí víc, než má sám" by zůstalo
napsané a přestalo platit.

---

## 4. Granty a audit — dvě tiché pasti

**`employees` nemá celotabulkový `select`.** Od
`20260901120000_osobni_udaje.sql:78` jsou granty **po sloupcích** (a je
to schválně, kvůli telefonu a e-mailu). Nový sloupec `je_majitel` tedy
**musí** dostat `grant select (je_majitel) … to authenticated`, jinak
dotaz spadne na `42501` **dřív, než se dostane na řádky** — nespadne
sloupec, spadne celá obrazovka. Přesně tohle udělalo `employees.color`
3. 9. uprostřed ostrého testu (CLAUDE.md to má zapsané).

Ze stejného soudku: `employees.zalohy_pozastaveny`
(`20260902040000:44-45`) grant nikdy nedostal. Jakmile ho nový formulář
zaměstnance přidá do selectu, spadne formulář.

**A nikdy nepsat nový plošný `grant`** — smazal by ty sloupcové výjimky
u `employees` i u `invitations.token_hash`.

**Audit zmlkne tiše.** `app.audit_zmenu`
(`20260831020000_audit_lidi_a_roli.sql:33`) dohledává firmu jen přes
`tenant_id` nebo `role_id`; u tabulky, která nemá ani jedno, vyjde
`v_tenant` NULL a funkce udělá `return null` — **bez chyby**. Nové
tabulky proto potřebují `tenant_id`, a k tomu vlastní `id`, protože
klíč řádku se skládá jako `id` (ř. 70–74). Bez toho se zásah do
oprávnění neuloží nikam.

---

## 5. Převod dat — čtyři díry v zadaném postupu

Postup ze zadání (5.4) je správný v principu. Co v něm chybí:

1. **Majitel nemá v `role_permissions` ani jeden řádek.** Prochází
   zkratkou `is_owner`. Kdo převádí řádek po řádku, převede majitele
   jako člověka bez práv. Je to napsané nezávisle na třech místech
   (`zalohy.sql:63-64`, `komunikace_zaklad.sql:62-63`,
   `ai_use_pryc.sql:28-29`) — a stejně se to snadno přehlédne.
2. **Průnik v ostrých datech nejspíš vyjde prázdný.** K 3. 9. měl
   zařazení jediný člověk (`docs/kontrola-pred-testem-2026-09-03.md`,
   ř. 78–79). Formálně by pravidlo 5.4 bylo splněné, ale vznikl by
   model, kde `position_permissions` je prázdné, všechno visí na
   výjimkách a živé pravidlo „změna zařazení platí hned všem" je mrtvé
   v den nasazení. **Kolik lidí dnes zařazení má, se ze souborů zjistit
   nedá** — musí se to spočítat dotazem nad ostrou databází dřív, než
   se migrace napíše.
3. **Kdo má členství a nemá řádek v `employees`, přijde o všechno.**
   Dnes to jde snadno vyrobit: `app.prijmout_pozvanku` propojí
   zaměstnance jen když ho pozvánka nese. `app.pocet_majitelu` s tím
   výslovně počítá („Majitel bez zaměstnance je pořád majitel").
   Zadání to řeší až pro budoucí pozvánky, ne pro stávající členy.
4. **`memberships.role_id` má `on delete restrict`**
   (`foundation.sql:216`, jediný `restrict` v základním schématu).
   Zánik rolí Kuchyně/Servis/Bar spadne, dokud se u členství `role_id`
   nevynuluje.

**A jedna věc o kontrole „před a po", kterou zadání 7.1 vyžaduje:
nejde napsat uvnitř migrace.** `app.has_access` se ptá `auth.uid()`
a v migraci běží servisní role, takže sadu cizího člověka nespočítá.
Kdo ji opíše ručně, dostane kontrolu, která projde i nad rozbitým
převodem — přesně ten druh, na který má tenhle repozitář dvakrát
zapsanou vlastní zkušenost.

**Jediné místo, kde ta kontrola opravdu sáhne na výstup, je scénář:**
harness přepisuje `auth.uid()` z `test.user_id`
(`supabase/tests/00_harness.sql:19-22`), takže se dá pro každého
uživatele zavolat skutečná `public.has_access` před migrací i po ní.
Vzor „spusť migraci uvnitř scénáře přes `\ir`" je hotový
v `krok29_scenar.sql`.

---

## 6. Rozsah zkoušek

Sada má **987 kontrol a zhruba 200–240 z nich je na úpravu**: 104
jmenuje `role_permissions`, `memberships.role_id` nebo `roles.is_owner`
přímo v tvrzení, dalších ~140 běží pod hercem, který má práva z role
a **nemá zaměstnanecký záznam** — takže po přechodu nemá odkud práva
vzít. Sedm takových herců, nejhustší jsou `krok7` (44/44) a `krok9`
(23/23).

**Nebezpečnější než kontroly, které spadnou, jsou ty, které zůstanou
zelené a přestanou měřit:**

- `etapa0:202-211` „firma má právě jednoho vlastníka" — stojí na
  indexu nad `roles`, který se nemaže,
- `krok4:201-205` (unikát `roles (tenant_id, key)`) — obdoba pro
  `positions` v sadě **není**,
- `krok29:267-345` (`ai.use` nemá nikdo) — začne hlídat mrtvou
  tabulku, zatímco `ai.use` může sedět v `position_permissions`.

Počet „X kontrol prošlo" se přitom nezmění. Kontrola, která přestane
měřit, drží číslo stejné.

---

## 7. Co jde bezpečně odložit — a co ani na chvíli

**Odložit jde:** oddíl 7 (`positions.usek_id` místo `department`, sám
si říká o volitelnost), sloučení obrazovek Pozice + Oprávnění do jedné
(ergonomie, ne správnost — ale obrazovka Oprávnění nad **rolemi** se
nesmí nechat stát, po přepnutí lže), zaškrtávátka výjimek ve formuláři
zaměstnance (tabulka vzniknout musí, ruční zadávání ne), a pozvánka
bez role — **kromě** zákazu SMS u citlivého práva, ten se musí přepsat
hned, jinak vznikne díra.

**Odložit nejde:** těch devět opsaných kopií, strop a jeho pět politik,
`visible_branch_ids`, spoušť na `je_majitel`, `my_context` /
`my_tenants` / `cekaji_na_opravneni`, `create_tenant`, granty, audit,
a v aplikaci `lide/page.tsx:235-243` plus hláška „Oprávnění se
přiděluje přihlášenému člověku", která je na **dvou** místech
(`:663-666` a `:963`) — zadání 6.3 ukazuje jen na to první, druhé živí
`akce.ts:499-501`. Smazat jen JSX znamená, že se hláška vrátí po
odeslání formuláře.

Každé z nich je místo, kde po vynechání zůstane **zelený build nad
rozbitým pravidlem.**

---

## 7b. UVNITŘ AUTORIZAČNÍCH FUNKCÍ ŽÁDNÉ RLS NENÍ

Ověřeno Šéfíkem 8. 9. 2026 na produkci i pokusem: nové tělo
`has_permission`, které čte `employees` i `position_permissions`,
proběhlo pod skutečným přihlášeným člověkem a vrátilo 56 řádků —
**a prošlo i se zapnutým `force row level security`.**

**Nestojí to na tom příznaku.** Autorizační funkce jsou
`security definer` a vlastní je role `postgres`, která má v Supabase
`rolbypassrls = true`. Uvnitř nich se RLS neuplatní **vůbec**, bez
ohledu na to, jestli je FORCE zapnuté.

Dobrá zpráva: **zacyklení přes politiku `employees_select` nehrozí**,
i když ta politika volá `has_permission` a nové tělo bude číst
`employees`. Politika se dovnitř funkce nedostane.

**A teď to podstatné, protože je to horší než ta dobrá zpráva.**

Pravidlo 3 z `CLAUDE.md` mluví o dvou obranných liniích — kontrola
v aplikaci **a** RLS v databázi. **Uvnitř definer funkce ta druhá linie
neexistuje.** Není zeslabená, není opatrnější: není tam.

Z toho plyne jediné, ale platí bez výjimky:

> **Nové tělo si musí VŠECHNO odfiltrovat samo.**

Chybějící `and e.tenant_id = p_tenant` znamená, že se právo najde
u člověka z **cizí firmy** — a nic to nechytí. Žádná politika, žádný
grant. Ta chyba se neprojeví chybovou hláškou, projeví se tím, že
někdo vidí cizí data.

**Povinně tedy v novém těle `has_permission` i `has_access`:**

| filtr | proč |
|---|---|
| `e.tenant_id = p_tenant` | jinak právo z cizí firmy |
| `e.deleted_at is null` | jinak práva označeného smazaného |
| `m.status = 'active'` u členství | jinak práva zrušeného členství |

**A na každý z těch tří filtrů vlastní kontrola s cizí firmou, kterou
je potřeba schválně rozbít** — postupně vyndat jeden filtr po druhém
a přesvědčit se, že spadne právě ta kontrola, která na něj míří. Jedno
společné „cizí firma nevidí nic" nestačí: shodí ho první chybějící
filtr a o zbylých dvou neřekne nic. Je to tentýž případ jako u převodu,
kde jedno rozbití neřeklo nic o souhrnné kontrole.

---

## 8. Doporučené pořadí pro příště

1. **Změřit ostrá data** třemi dotazy, dřív než se napíše řádek
   migrace: kolik firem má víc majitelů, kolik majitelů nemá
   zaměstnanecký záznam, kolik lidí má zařazení. Bez toho se nedá
   rozhodnout ani o indexu, ani o tom, jestli má průnik smysl.
2. **Rozhodnout otázku majitelů** (oddíl 1 tohohle souboru).
3. **Napsat kontrolu „před a po" do scénáře** — dřív než převod.
   Tak to chce zadání 7.1 a je to jediné pořadí, ve kterém se převodu
   dá věřit.
4. Teprve pak migrace: tabulky a granty → audit → převod → jádro →
   devět opsaných kopií → aplikace.

**Body 1–3 jsou hotové a bod 4 je hotový až po převod včetně**
(migrace `20260908090000_zarazeni_prava`, nasazená 8. 9.). Zbývá
**jádro → devět opsaných kopií → aplikace** — a u jádra platí
oddíl 7b, který není doporučení.

Je to jeden soustředěný den, ne odpoledne mezi ostatním. A jde to
udělat naráz právě proto, že se od začátku drželo pravidlo 2
z `CLAUDE.md` — o přístupu rozhoduje jediné místo. To pravidlo se
tímhle vyplatilo a je to důvod ho neporušit ani teď.
