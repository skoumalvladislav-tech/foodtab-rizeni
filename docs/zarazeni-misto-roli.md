# Zařazení místo rolí — jedna věc, ne dvě

Rozhodl Šéfík 8. 9. 2026. **Má přednost před kroky 2–4
v `docs/nocni-prace-2026-09-08.md`.** Oprava docházky (krok 1) zůstává
první — je to chyba v ostrém provozu.

---

## 1. Co dnes nesedí

V aplikaci jsou **dvě oddělené věci**, které Šéfík vnímá jako jednu:

| | co to je | kde se zadává | nese oprávnění? |
|---|---|---|---|
| **Pozice** | Číšník, Kuchař, Pomocná síla | u zaměstnance | **ne** |
| **Role** | Majitel, Provozní, Vedoucí směny, **Kuchyně, Servis, Bar**, Účetní | až s pozvánkou | **ano** |

Z toho plynou obě Šéfíkovy výtky:

**a) Oprávnění visí na úsecích, ne na zařazení.** Výchozí role jsou
z poloviny pojmenované po úsecích provozovny (Kuchyně, Servis, Bar).
Jenže v kuchyni stojí kuchař i pomocná síla a každý má mít jiná práva.
Úsek říká *kde* člověk pracuje, ne *co* smí.

**b) Oprávnění nejde zadat u zaměstnance.** Na obrazovce lidí stojí
natvrdo napsané:

> „Oprávnění se přiděluje přihlášenému člověku — nejdřív mu pošlete
> pozvánku."

Šéfík zakládá člověka, chce mu rovnou nastavit, co smí, a musí to
odložit. U brigádníka bez účtu to nejde vůbec.

---

## 2. Co Šéfík rozhodl

**Jedno zařazení, ne pozice + role.** Seznam zařazení (Číšník, Barman,
Pomocná síla, Kuchař, Vedoucí směny…) a **každé nese svá oprávnění**.
Role Kuchyně, Servis a Bar zanikají.

**U člověka jde udělat výjimka.** Číšník, který zaskakuje jako vedoucí
směny, dostane právo navíc, aniž by se kvůli němu zakládalo zařazení.

**Změna u zařazení platí hned pro všechny, kdo ho mají.** Přidá se
právo Číšníkovi a mají ho všichni číšníci. **Osobní výjimky zůstávají**
— ty se změnou zařazení nepřepisují.

**Oprávnění se zadává u zaměstnance**, ve stejném formuláři jako jméno,
pobočka a typ poměru. Ne až s pozvánkou.

---

## 3. Jedna věc, kterou Šéfíkovi musíš říct rovnou

**U člověka bez účtu se oprávnění dá nastavit, ale nic nedělá.**
Oprávnění se ověřuje u přihlášeného uživatele — dokud se brigádník
nepřihlásí, není komu ta práva dát.

Co se tím mění: **zadané dřív, účinné později.** Volba se uloží
u zaměstnance a v okamžiku, kdy přijme pozvánku, začne platit. Šéfík se
k tomu už nevrací.

**Do rozhraní to napiš.** U člověka bez účtu ať u oprávnění stojí věta
typu *„Uloží se a začne platit, jakmile se přihlásí."* Bez ní to bude
vypadat jako chyba — nastavím práva a nic se nestane.

---

## 4. Proč to nerozkope celou aplikaci

Protože se od začátku drželo pravidlo 2 z `CLAUDE.md`: **o přístupu
rozhoduje jediné místo.** Prošel jsem to — všech 31 souborů s
politikami se ptá přes `app.has_access` nebo `app.has_permission`
a **žádná politika si nesahá na `role_permissions` sama.**

Odkud se oprávnění berou, je proto napsané ve **dvou funkcích**, ne
v padesáti politikách. To je celý rozsah zásahu do bezpečnosti.

Ber to jako důkaz, že to pravidlo stálo za to — a jako důvod ho
neporušit ani teď.

---

## 5. Databáze

### 5.1 Nové tabulky

```sql
-- Práva zařazení. Živé pravidlo: změna platí pro všechny, kdo ho mají.
create table public.position_permissions (
  position_id    uuid not null references public.positions(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (position_id, permission_key)
);

-- Výjimka u jednoho člověka. Přebíjí zařazení oběma směry.
create table public.employee_permissions (
  employee_id    uuid not null references public.employees(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  -- true = navíc oproti zařazení, false = odebráno navzdory zařazení
  granted        boolean not null,
  primary key (employee_id, permission_key)
);
```

Obě dostanou `tenant_id`, zapnuté RLS a politiku — **pravidlo 3, bez
výjimky.** Měnit je smí ten, kdo má `settings.manage`; číst svoje smí
každý.

### 5.2 Majitel

Majitel dnes visí na roli (`roles.is_owner`). **Přesouvá se na
člověka**, ne na zařazení — majitel je osoba, ne pracovní zařazení,
a Šéfík může být v rozpisu vedený jako provozní.

```sql
alter table public.employees add column je_majitel boolean not null default false;

create unique index employees_jediny_majitel
  on public.employees (tenant_id) where je_majitel and deleted_at is null;
```

Majitel dostává všechno, co spadá do zapnutých modulů — jako dnes.
**Jinak by ho šlo odebráním práv zamknout z vlastní firmy ven.**
Kontrola „poslední majitel" se přesune sem.

### 5.3 Dvě funkce, které se mění

`app.has_permission` a `app.has_access` přestanou chodit přes
`memberships → roles → role_permissions` a půjdou přes:

```
auth.uid() → employees (tenant, deleted_at is null, active)
           → position_permissions   (co dává zařazení)
           → employee_permissions   (co se u člověka přidalo/ubralo)
```

Pravidlo skládání, napiš ho do komentáře funkce:

> **Výjimka u člověka rozhoduje. Když u něj záznam není, rozhoduje
> zařazení. Majitel dostává vše.**

**Rozsah (firma / pobočka) zůstává na členství** — `memberships.scope`
a `membership_branches` se nemění. Rozsah bez účtu nedává smysl a
pravidlo 4 platí dál: `branch_id` z prohlížeče je návrh, ne oprávnění.

`memberships.role_id` a `invitations.role_id` **nechej být, jen zruš
`not null`.** Nemazat: pravidlo o nasazených migracích. Přestanou
rozhodovat, to stačí.

### 5.4 Převod dat — tady se nesmí nic ztratit

**Závazné pravidlo převodu:**

> Po převodu musí mít **každý člověk přesně ta práva, která má dnes.**
> Nikdo nesmí získat právo navíc a nikdo nesmí o žádné přijít.

Postup, který to splní a je jednoznačný:

1. Pro každé **zařazení** vezmi lidi, kteří ho dnes mají, a spočítej
   **průnik** jejich dnešních práv (z role u členství). Ten se zapíše
   do `position_permissions`.
2. Co má člověk **navíc** oproti tomu průniku, zapiš mu jako výjimku
   `granted = true`.
3. Kdo dnes **žádné zařazení nemá**, dostane všechna svá práva jako
   výjimky. Zařazení mu přiřadí Šéfík ručně.
4. Majiteli nastav `je_majitel = true` podle dnešní role s `is_owner`.

**Zařazení nikomu nepřepisuj.** `employees.position_id` se používá
v rozpisu směn — přepsat ho podle role by rozházelo plánování.

**Ke každému kroku napiš do migrace komentář, proč to tak je.** Za rok
to nikdo neodvodí z SQL.

### 5.5 Nepřiděluj víc, než máš sám

Pravidlo z `20260901110000_neprideluj_vic.sql` platí dál a **musí
platit na obojí** — na práva zařazení i na osobní výjimky. Jinak si
vedoucí směny přes výjimku přidá právo, které sám nemá, a obejde to.

---

## 6. Obrazovky

### 6.1 Nastavení → Role se stává Nastavení → Zařazení

Tatáž obrazovka, jiný zdroj dat: místo `roles` a `role_permissions`
čte `positions` a `position_permissions`. Zaškrtávátka oprávnění
zůstávají, jak jsou.

Nastavení → Pozice **zaniká jako samostatná položka** a slévá se sem.
Dva seznamy pro jednu věc jsou přesně to, na co si Šéfík stěžuje.

Zachovej u zařazení text, kolik lidí ho má. Když se mění práva
zařazení, má být na obrazovce vidět, **kolika lidí se to týká.**

### 6.2 Formulář zaměstnance

Pole **Pozice** se přejmenuje na **Zařazení** a přibude pod ním
oprávnění:

```
ZAŘAZENÍ:  [ Číšník            ▾ ]  [ + Nové zařazení… ]

OPRÁVNĚNÍ                            (ze zařazení Číšník)
  [x] Vidět rozpis směn
  [x] Píchat docházku
  [ ] Upravovat docházku            ← odškrtnuté = výjimka
  [x] Zadávat úkoly                 ← zaškrtnuté navíc = výjimka
      ↳ výjimka  ·  vrátit na zařazení
```

- Zaškrtávátka se **předvyplní ze zařazení.**
- Co Šéfík změní, uloží se jako **výjimka** a je u toho vidět, že to
  výjimka je, plus odkaz **vrátit na zařazení.**
- Když se přepne zařazení, zaškrtávátka se přepočítají — ale
  **výjimky se ptají, jestli je zachovat.** Tiché smazání výjimky je
  horší než otázka navíc.
- U člověka **bez účtu** ta věta z oddílu 3.

Zakládání nového zařazení přímo z formuláře už funguje
(`pole-pozice.tsx`) — **nech to tak a jen přejmenuj.** Šéfík zakládá
lidi rychle a odchod na jinou obrazovku ho zdrží.

### 6.3 Co zmizí

Hláška *„Oprávnění se přiděluje přihlášenému člověku — nejdřív mu
pošlete pozvánku"* (`nastaveni/lide/page.tsx`, kolem řádku 663).
Panel oprávnění se přestane schovávat za členství; zůstane za ním
**už jen rozsah** (firma/pobočka), a to i s vysvětlením proč.

### 6.4 Pryč s pruhem o osobních údajích

Zadal Šéfík 8. 9. Pruh **„Informace o zpracování osobních údajů"**
(`app/[rozsah]/pruh-informace.tsx`, vkládá ho `layout.tsx`) se kreslí
nad obsahem na **každé obrazovce**, dokud ho člověk neodklikne — a
dnes u něj navíc stojí, že text čeká na právníka. Číšník ho vidí po
každém přihlášení nad docházkou.

**Odeber `<PruhInformace>` z rámu aplikace.** Komponentu ani tabulky
`privacy_notices` a `privacy_acknowledgements` **nemaž** — až bude text
od právníka hotový, bude se hodit.

**Ale samotnou informaci nezahazuj.** Povinnost informovat
zaměstnance, co o nich firma vede, zůstává bez ohledu na to, jestli je
o tom v aplikaci pruh. Celý text už je na **Moje údaje** (řádek 425
v `app/moje-udaje/page.tsx`) a **tam ať zůstane** — se stejným odkazem
`#informace`, aby fungovaly staré odkazy.

Mizí tedy upomínka, ne informace.

### 6.5 Pozvánka

Pozvánka přestane nést roli. Bere práva **ze zaměstnance**, kterému se
posílá. Když se posílá někomu bez záznamu zaměstnance, ať se ten
záznam založí — jinak by člověk přišel do firmy bez zařazení a bez
práv a nikdo by nevěděl proč.

---

### 6.6 Odhlásit se na základní obrazovku

Zadal Šéfík 8. 9.: *„ikonu odhlásit dát na základní obrazovku třeba
vlevo dolů, teď je schovaná."*

Má pravdu a je to moje chyba v dřívějším zadání — schoval jsem ji do
Mých údajů a on ji nenašel, přestože ví, že tam je.

**Na rozcestník** (`app/[rozsah]/page.tsx`), **vlevo dole**, oddělené
čarou od dlaždic. Ikona a slovo **Odhlásit se** — samotná ikona se dá
splést s čímkoli.

Na Mých údajích ji **nech taky.** Tam patří k výdeji dat a souhlasům.

**Jedna podmínka: ať se to zeptá.** Ťuknutí navíc uprostřed směny je
levnější než přihlašování se znovu na telefonu s mokrýma rukama —
a přesně proto jsem ji předtím schovával. Krátký dotaz *„Odhlásit
se?"* s tlačítky **Odhlásit** a **Zpět** ten důvod odstraní a Šéfíkovi
zůstane, co chce.

**Na kiosku ne.** Tam se odhlašuje samo po nečinnosti.

---

## 7. Úsek místo napevno psaného `department` *(až nakonec)*

`positions.department` má v kódu pevný výčet
`('kuchyne','bar','servis','provoz','vedeni')`. To je porušení
pravidla 1 — provoz nepatří do kódu. Tabulka `useky`
(`20260906030000`) už existuje a v komentáři má napsané, že tohle
nahrazuje.

Přidej `positions.usek_id` s odkazem na `useky` a `department` přestaň
používat. **Nemazat**, jen opustit.

**Tenhle krok udělej poslední a klidně ho vynech**, když dojde čas.
Se Šéfíkovou stížností souvisí jen volně a nic neblokuje.

---

## 8. Zkoušky

Do `supabase/tests/` přidej scénář a **u každé kontroly schválně rozbij
to, co má hlídat, a přesvědč se, že spadne** (pravidlo z `CLAUDE.md`).

Kontroly, které musí projít:

1. Člověk se zařazením **Číšník** má práva Číšníka.
2. **Výjimka `granted = true`** dá právo, které zařazení nedává.
3. **Výjimka `granted = false`** sebere právo, které zařazení dává —
   i když ho zařazení má.
4. **Změna práv zařazení se projeví hned všem**, kdo ho mají.
5. **Změna práv zařazení nepřepíše osobní výjimky.**
6. **Majitel má všechno**, i když mu zařazení nedává nic.
7. **Poslední majitel** nejde zbavit majitelství.
8. Člověk **bez zařazení a bez výjimek nemá nic** — ani čtení.
9. **Cizí firma** se přes zařazení ani výjimku nedostane nikam
   (pravidlo 3).
10. **Vypnutý modul** zneúčinní právo i tehdy, když ho zařazení dává
    (pravidlo 5).
11. **Rozsah pobočky platí dál:** kdo má právo jen na pobočce A, na
    pobočce B ho nemá — ani přes výjimku.
12. Kdo **sám nemá právo**, nemůže ho přidělit — ani zařazení,
    ani výjimkou.
13. Člověk **bez účtu** může mít uložená oprávnění a nic to neotevře.
14. **Zaměstnanec označený smazaný** (`deleted_at`) nemá nic.

A jedna kontrola navíc, na převod dat — **napiš ji tak, aby porovnala
stav před a po**: pro každého člověka spočítej sadu práv ze starého
modelu a z nového a **musí se rovnat.** Bez ní se převod nedá věřit.

---

## 9. Pořadí a kde se dá skončit

1. **Oprava docházky** z `docs/nocni-prace-2026-09-08.md`, krok 1.
   Pořád první — je to chyba v provozu.
2. **Dvě drobnosti, každá na pár minut:** pryč s pruhem o osobních
   údajích (6.4) a odhlášení na rozcestník (6.6). Šéfík na obojí naráží
   pokaždé, když aplikaci otevře, a nic to neblokuje.
3. **Databáze** (oddíl 5) — jedna migrace včetně převodu. Nejde
   rozdělit: dvě funkce a data musí přepnout naráz.
4. **Obrazovka Zařazení** (6.1).
5. **Formulář zaměstnance** (6.2, 6.3).
6. **Pozvánka** (6.5).
7. **Úsek místo `department`** (7) — volitelně.

Na hranici každého bodu se dá skončit. Po bodu 2 aplikace funguje se
starými obrazovkami; ty jen zatím ukazují role, které už o ničem
nerozhodují.

---

## 10. Než se to nasadí

**Tohle je zásah do jádra oprávnění.** Do produkce to nesmí dřív, než
scénář projde **proti opravdovému PostgreSQL** — v PGlite běžíš jako
superuživatel a RLS ani sloupcová práva se tam neprojeví. Napiš do
hlášení, kolik kontrol prošlo a z čeho, a já to proti PostgreSQL
prověřím.

Nasazuje Šéfík. `db push` nespouštěj.
