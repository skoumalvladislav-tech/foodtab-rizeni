# Přepnutí na zařazení — měření před psaním

Sepsáno 8. 9. 2026 podle `docs/zarazeni-misto-roli-nalezy.md`, oddíl 8,
bod 4: zbývá **jádro → devět opsaných kopií → aplikace**.

**Není to plán, je to měření.** Kód se z tohohle souboru nesmí opsat
a nasadit — u každé části je napsané, jestli je ověřená, nebo ne.

---

## 0. Jak tohle měření dopadlo — čtěte první

Měřilo se pěti liniemi. **Doběhly tři z pěti**, ostatní spadly na limit
relace:

| linie | stav |
|---|---|
| jádro (`has_permission`, `has_access`) | doběhla |
| devět opsaných kopií | doběhla |
| aplikační vrstva | doběhla |
| **scénáře** (kolik kontrol se rozbije) | **spadla** |
| **pořadí nasazení a návrat zpět** | **spadla** |
| **protidůkazy ke všem liniím** | **spadly všechny** |
| **souhrnný plán** | **nevznikl** |

**Nic z toho, co následuje, tedy neprošlo skeptickou kontrolou.** Je to
podklad k ověření, ne k použití.

**A jedna věc, kterou je potřeba vědět:** ty linie sáhly na **ostrou
databázi** — deset volání `execute_sql`. Nezadal jsem jim to; měly
číst soubory, ale konektor na Supabase jim zůstal dostupný. Prošel jsem
všech deset a **jsou to samé `SELECT`y, ani jeden zápis**: katalogová
introspekce (`pg_proc`, `pg_class`) a počty nad členstvími, zaměstnanci
a pozvánkami. Nic se nezměnilo. Čísla v tomhle souboru, která nejsou
v repozitáři, pocházejí odtud.

---

## 1. Dotazy, které musí proběhnout znovu těsně před přepnutím

Všechny jsou čtecí. Čísla u nich jsou z 8. 9., ale **datum tady není
záruka** — mezi měřením a nasazením může kdokoli přijmout pozvánku.

### 1.1 Má každé aktivní členství svůj zaměstnanecký záznam?

**Rozhoduje o tom, jestli přepnutí vůbec smí proběhnout.** Nová cesta
začíná u `auth.uid() → employees`; kdo tam záznam nemá, přijde
o **všechno** a nic to neohlásí — přihlásí se do prázdné aplikace.

```sql
select m.tenant_id, m.user_id, m.status, m.scope
from public.memberships m
where m.status = 'active'
  and not exists (
    select 1 from public.employees e
    where e.tenant_id = m.tenant_id
      and e.user_id = m.user_id
      and e.deleted_at is null
  );
```

*8. 9.: prázdné (0 ze 4 aktivních členství).* **Když vrátí byť jeden
řádek, přepnutí se odkládá,** dokud se tomu člověku záznam nedoplní.

### 1.2 Vyjde přepnutí bez ztráty a bez přírůstku práva?

Tohle je „před a po" **pro nové tělo funkce**, ne pro převod dat.
Porovná staré a nové pravidlo právo po právu, přes všechna aktivní
členství a celý katalog.

```sql
with lide as (
  select m.id as membership_id, m.user_id, m.tenant_id, m.role_id
  from public.memberships m where m.status = 'active'
),
kombinace as (
  select l.*, p.key as perm, p.module_key
  from lide l cross join public.permissions p
),
modul_ok as (
  select k.*, exists (
    select 1 from public.tenant_modules tm
    where tm.tenant_id = k.tenant_id and tm.module_key = k.module_key
      and tm.status in ('active','trial')
      and (tm.valid_until is null or tm.valid_until > now())
  ) as modul from kombinace k
),
stare as (
  select mo.*, (mo.modul and exists (
    select 1 from public.roles r
    where r.id = mo.role_id
      and (r.is_owner or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = r.id and rp.permission_key = mo.perm))
  )) as dnes from modul_ok mo
),
nove as (
  select s.*, (s.modul and exists (
    select 1 from public.employees e
    where e.tenant_id = s.tenant_id and e.user_id = s.user_id
      and e.deleted_at is null
      and (e.je_majitel or coalesce(
            (select ep.granted from public.employee_permissions ep
              where ep.employee_id = e.id and ep.permission_key = s.perm),
            exists (select 1 from public.position_permissions pp
                     where pp.position_id = e.position_id
                       and pp.permission_key = s.perm)))
  )) as potom from stare s
)
select count(*) filter (where dnes and not potom) as ztraceno,
       count(*) filter (where potom and not dnes) as pribylo,
       count(*) filter (where dnes)  as dnes_povoleno,
       count(*) filter (where potom) as potom_povoleno
from nove;
```

*8. 9.: ztraceno 0, přibylo 0, 65 povolení před i po.*

**Tenhle dotaz patří i do scénáře**, ne jen do ruky — je to jediný
důkaz, že nové tělo dělá totéž co staré. Zelená migrace to nedoloží.

### 1.3 Drží předpoklad, na kterém stojí nerekurzivnost?

Podle oddílu 7b nálezů se uvnitř autorizačních funkcí RLS neuplatní,
protože jsou `security definer` a vlastní je `postgres` s `rolbypassrls`.

```sql
select 'funkce' as co, p.proname as jmeno, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as vlastnik, null::boolean as force_rls
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app'
  and p.proname in ('has_permission','has_access','can_read_scoped')
union all
select 'tabulka', c.relname, null, pg_get_userbyid(c.relowner),
       c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('employees','position_permissions','employee_permissions')
order by 1, 2;
```

*8. 9.: `prosecdef = true` a vlastník `postgres` u obou funkcí;
`relforcerowsecurity = false` a vlastník `postgres` u všech tří tabulek.*

**Tohle patří do scénáře jako tvrdé tvrzení, ne jako komentář.** Kdyby
někdo s dobrým úmyslem zapnul FORCE („ať RLS platí i na postgresu"),
změnil funkci na `security invoker` nebo přepsal vlastníka, vznikne
`42P17` a firma přestane fungovat celá.

### 1.4 Patří do nového těla `and e.active`?

```sql
select e.id, e.full_name, e.active, e.deleted_at, m.status as clenstvi
from public.employees e
join public.memberships m
  on m.tenant_id = e.tenant_id and m.user_id = e.user_id
where e.deleted_at is null and e.user_id is not null
  and (not e.active or m.status <> 'active');
```

*8. 9.: 0 řádků.* **Návrh proto na `e.active` záměrně nesahá** — je to
podmínka, která dnes nic neznamená, a přidat ji naslepo by znamenalo
zavést pravidlo, které nikdy neplatilo. Zadání `zarazeni-misto-roli.md`
ji přitom v 5.3 zmiňuje. **Rozhodnutí pro Šéfíka, ne pro funkci.**

### 1.5 Komu se přepnutím opravdu něco změní?

```sql
select 'clenstvi bez role' as co, count(*) from public.memberships
 where status = 'active' and role_id is null
union all
select 'otevrena pozvanka bez role', count(*) from public.invitations
 where accepted_at is null and revoked_at is null
   and expires_at > now() and role_id is null
union all
select 'otevrena pozvanka bez zamestnance', count(*) from public.invitations
 where accepted_at is null and revoked_at is null
   and expires_at > now() and employee_id is null;
```

*8. 9.: 0 členství bez role, ale **1 ze 3 otevřených pozvánek roli
nemá**.*

**Nedá se tedy říct „přepnutí nikomu nic nezmění".** Kdo má členství
bez role, dnes nemá **žádné** právo (vnitřní join na `roles` nevrátí
nic); po přepnutí dostane to, co mu dává zařazení. Je to **záměr** — je
to celý smysl pozvánky bez role — ale musí to zaznít nahlas, jinak to
při ostrém testu vypadá jako chyba.

### 1.6 Ukazuje obrazovka Oprávnění pravdu?

```sql
select p.tenant_id, po.key as zarazeni, p.permission_key,
       pe.module_key, tm.status as stav_modulu, tm.valid_until
from public.position_permissions p
join public.positions po on po.id = p.position_id
left join public.permissions pe on pe.key = p.permission_key
left join public.tenant_modules tm
  on tm.tenant_id = p.tenant_id and tm.module_key = pe.module_key
where pe.key is null
   or tm.tenant_id is null
   or tm.status not in ('active','trial')
   or (tm.valid_until is not null and tm.valid_until <= now())
order by 1, 2, 3;
```

Zaškrtnuté právo k vypnutému modulu **není chyba funkce** — modulová
brána je správně. Je to rozpor mezi tím, co Šéfík na obrazovce vidí,
a tím, co platí. Buď se ty řádky uklidí, nebo je obrazovka musí
ukazovat zašedle.

---

## 2. Nové tělo jádra — NÁVRH, neověřený

Prošel jsem ho proti oddílu 7b nálezů, protože uvnitř definer funkce
neexistuje druhá obranná linie.

**Tři povinné filtry tam jsou:**

| filtr | kde | verdikt |
|---|---|---|
| `e.deleted_at is null` | v joinu na `employees` | **sedí** |
| `m.status = 'active'` | v `where` | **sedí** |
| tenant | `e.tenant_id = m.tenant_id` + `m.tenant_id = p_tenant` | **jen přechodně** |

**Ta třetí se musí přepsat.** Filtr na firmu je splněný jen tím, že se
`e.tenant_id` rovná `m.tenant_id` a to se rovná `p_tenant`. Platí to —
ale kdokoli, kdo ten join upraví, ho tiše zruší, a **uvnitř definer
funkce to nechytí nic**. Do těla patří `and e.tenant_id = p_tenant`
napsané přímo, i když je to formálně nadbytečné. Tady je nadbytečnost
levnější než mlčení.

**Co návrh zachovává správně:** signaturu `(uuid, text, uuid)`,
`security definer`, `set search_path = ''`, join
`permissions → tenant_modules` se stavem `active/trial` a `valid_until`,
a blok rozsahu (`m.scope` / `membership_branches`) doslova. Členství
zůstává — už ale jen jako doklad, že člověk do firmy patří, a jako
nositel rozsahu.

**Ověřené proti ostré databázi:** živá `app.has_permission` se shoduje
se souborem znak po znaku (md5 `422c7ede…`, 852 znaků), `has_access`
taktéž (md5 `b5f5fb86…`, 975 znaků). V repozitáři je od obou **jediná
definice**, žádná mrtvá verze — přepisuje se novou migrací.

---

## 3. Devět opsaných kopií — co z měření vyplynulo

Linie potvrdila devět míst a přidala k nim jedno pozorování, které
stojí za víc než výčet: **skládací pravidlo (majitel → výjimka →
zařazení) se doslova opakuje ve třech z nich.** Vyplatí se ho vytáhnout
do jedné pomocné funkce, ať se neopisuje počtvrté.

**Pozor: taková pomocná funkce je zase `security definer`, takže
oddíl 7b platí i pro ni.**

A jeden nález navíc: starší opis téhož pravidla uvnitř
`public.zalozit_rozhovor` (`20260906010000:419-446`) je **mrtvý** —
`zalozit_rozhovor` přepsala `20260906080000:141`. Opravovat ho je práce
nadarmo.

---

## 4. Co se ještě nezměřilo

Tohle chybí a **bez toho se přepnutí psát nemá:**

1. **Scénáře.** Kolik kontrol se rozbije, kterých a jak. Odhad
   z nálezů je 200–240 z 987, ale podložený není. Zvlášť chybí seznam
   kontrol, které **zůstanou zelené a přestanou měřit** — ty jsou
   nebezpečnější než ty, co spadnou.
2. **Pořadí nasazení.** Migrace jde přes `db push`, aplikace zvlášť.
   Co se stane v okně mezi nimi? A dá se to vrátit?
3. **Protidůkazy.** Nic z tohohle souboru neprošlo skeptickou
   kontrolou. U tvrzení označených „projde tiše" je to ta část, na
   které nejvíc záleží.

---

## 5. Rozhodnutí 8. 9. večer: bod 1 se dnes nezačíná

Doměřeno přímo, ne odhadem:

- scénáře mají **849 kontrol** (`pg_temp.check`),
- herce přes členství **bez záznamu v `employees`** zakládají čtyři
  soubory — krok7 (44 kontrol), krok9 (23), krok10 (22), marketing1
  (18),
- a hlavně: **sdílený provozní `7777…`** vzniká v `krok4_scenar.sql`
  na ř. 514–519 jako `auth.users` + `memberships`, **bez zaměstnaneckého
  záznamu**. Používají ho krok5, 7, 8, 9, 10 i marketing1.

**Dobrá zpráva:** není to 200 přepsaných tvrzení. Ta tvrzení („X smí,
Y nesmí") po přepnutí platí dál — jen jejich herci musí dostat
`employees` řádek a `position_permissions` odpovídající dnešní roli.
Je to oprava **přípravy** v ~7 hercích, ne přepis kontrol.

**Špatná zpráva:** i tak je bod 1 součet sedmnácti funkcí, aplikační
vrstvy, sedmi herců a tří kontrol s cizí firmou, z nichž každá se musí
rozbít zvlášť (oddíl 7b) — **a nesmí se commitnout nedodělaný.** Když
se to nestihne celé, nezůstane po tom nic.

K tomu měření pro bod 1 **není hotové**: chybí linie scénářů, pořadí
nasazení, návrat zpět a všechny protidůkazy (oddíl 4 tohohle souboru).

**Proto se bod 1 dnes nezačíná a jde se na body, které se dají
odevzdat samostatně.** Bod 2 (obrazovky zařazení) na bodu 1 závisí:
kdyby obrazovka Oprávnění začala číst `position_permissions`, zatímco
o přístupu pořád rozhodují role, **ukazovala by práva, která nic
nedělají** — tedy by lhala. Proto se odkládá s ním.
