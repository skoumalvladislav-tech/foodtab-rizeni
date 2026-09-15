---
name: foodtab-db-security
description: Databázová bezpečnost Foodtabu — RLS, SECURITY DEFINER bez druhé linie, sloupcové granty, výchozí práva Supabase pro anon/authenticated, TRUNCATE. Použij při psaní nebo review migrace, jakékoli SECURITY DEFINER funkce, nebo kdykoli se řeší „kdo smí co v databázi vidět či měnit". Doplňuje skill migrace (JAK napsat migraci krok za krokem) o to, PROČ tahle pravidla existují a jaké konkrétní nehody je vynutila — ať se neopakují.
---

# Bezpečnost databáze

Postup psaní migrace krok za krokem je ve skillu `migrace`. Tenhle
skill je vysvětlení a historie za pravidly, která tam jen odkazuje.

## Dvě obranné linie — a kde jedna z nich NENÍ

Pravidlo 3 z CLAUDE.md: kontrola v aplikaci **a** RLS v databázi,
nikdy jen jedna s tím, že to hlídá druhá.

**Uvnitř SECURITY DEFINER funkcí druhá linie neplatí vůbec.**
Autorizační funkce (`app.has_access` a další) jsou `security definer`
a vlastní je role s `rolbypassrls` — **RLS se tam neuplatní**, bez
ohledu na `force row level security`. Podrobný rozbor →
`docs/zarazeni-misto-roli-nalezy.md`, oddíl 7b.

Tělo takové funkce si proto musí odfiltrovat úplně všechno samo:

```sql
tenant_id = p_tenant       -- jinak se řádek najde u CIZÍ FIRMY
deleted_at is null         -- jinak práva označeného smazaného
status = 'active'          -- jinak práva zrušeného členství
```

**Každý filtr napiš jen jednou.** Podmínka zapsaná „pro jistotu"
dvakrát drží i po vyndání jedné kopie — kontrola nad ní je pak zelená
napořád, ať je v těle cokoli (viz `20260909100000_zarazeni_jadro.sql`).
Na každý filtr patří vlastní kontrola s cizí firmou.

## Sloupcové granty — nový sloupec se sám nepřidá

`employees` a `branches` nemají celotabulkový `select` — granty jsou
po sloupcích (`20260901120000_osobni_udaje.sql`), aby telefon
a e-mail šly číst jen průzorem. `alter table … add column` nový
sloupec do výčtu **nepřidá**, a dotaz, který si o něj řekne, dostane
`42501 permission denied` dřív, než se dostane na řádky —
**nespadne sloupec, spadne celá stránka.**

Stalo se 3. 9. 2026 s `employees.color`, uprostřed ostrého testu,
a kontrola to nechytila (běžela jako superuživatel). Oprava:

```sql
grant select (novy_sloupec) on public.employees to authenticated;
```

**Ověřuje se čtením pod rolí `authenticated`**, ne úvahou.
`employees.zalohy_pozastaveny` grant k dnešnímu dni nemá — pozor, až
ho někdo přidá do selectu.

## Výchozí práva Supabase — nová tabulka je čitelná, i když jí to nikdo nedal

Supabase má v projektu `alter default privileges … grant all on
tables to anon, authenticated, service_role`. `create table` proto
udělí `anon`/`authenticated` práva **automaticky**, i když je migrace
schválně vynechá — vynechání grantu samo o sobě nic nechrání, brání
pak jen RLS (jedna linie místo dvou).

**Tabulka, ke které se přihlášený nemá dostat vůbec, potřebuje
výslovné**
```sql
revoke all on public.tabulka from anon, authenticated;
```

Přišlo se na to 13. 9. 2026: `marketing_tajemstvi` se zašifrovanými
klíči k Instagramu měla granty pro obě role, ačkoli je migrace nedala.
Data neunikla (RLS bez politiky nepustí řádek), ale první linie
chyběla. Oprava: `20260913180000_marketing_granty_uklid.sql`.

**Lokální testy (PGlite) tohle nechytí** — čistá databáze z `run.sh`
výchozí práva Supabase nemá. Hlídá se to nad TEXTEM migrací:
`scripts/marketing-granty.test.mjs` projde všechny `marketing_*`
tabulky a ptá se, jestli k nim někde je `revoke`. Pro provozní
tabulky taková kontrola zatím **neexistuje**.

## TRUNCATE obchází RLS — a výchozí práva ho dávají taky

`delete` musí projít politikou, `truncate` ne. Přihlášený s tímhle
grantem vysype celou tabulku napříč firmami a nic ho nezastaví. Ke
každému `revoke … from anon` proto patří i
```sql
revoke truncate, references, trigger … from authenticated;
```

Zjištěno 14. 9. 2026 při nasazení marketingu. Modul marketing je
uklizený (`20260914190000_marketing_granty_uklid2.sql`).

**Otevřený stav k 14. 9. 2026: provozní tabulky uklizené NEJSOU.**
51 tabulek v `public` (mimo `marketing_*`) má pro `authenticated`
grant `TRUNCATE`, `REFERENCES`, `TRIGGER`, a totéž pro `anon` — mezi
nimi `audit_log`, kde pravidla proti `update`/`delete` `truncate`
nezastaví. Zadání pro opravu: `docs/granty-provoz-zadani.md`. Než se
to opraví, **nespoléhej, že provozní tabulky mají jen to, co jim dala
migrace** — ověř to dotazem, ne čtením migračních souborů.

## Rozšíření Postgresu — nepoužívej je

Supabase dává rozšíření do schématu `extensions`, lokální PostgreSQL
do `public`. Funkce se `search_path = ''` proto spadnou vždy na jednom
z těch dvou prostředí. Řešení není qualifikovat schéma, ale rozšíření
nepotřebovat:

| Místo | Použij |
|---|---|
| `pgcrypto` `digest()` | vestavěná `sha256(convert_to(x,'UTF8'))` |
| `pgcrypto` `gen_random_bytes()` | dvě `gen_random_uuid()` bez pomlček |
| `citext` | `text` + ukládat malými písmeny + podmínka na sloupci |

Když opravdu nejde jinak, zeptej se — nepřidávej `create extension`
sám.

## Než cokoli z tohohle nasadíš

`db push` spouští Šéfík, ne relace sama — postup a kontrolní seznam
je ve skillu `nasazeni`.
