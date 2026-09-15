-- =====================================================================
-- Foodtab — modul Marketing: auditní přehled
--
-- Zadání: master prompt, obrazovka 16 z oddílu 22 („Tým, role
-- a auditní přehled").
--
-- ---------------------------------------------------------------------
-- PROČ FUNKCE, A NE PROSTĚ ČTENÍ Z `audit_log`
--
-- Protože `audit_log` dnes přečte jedině ten, kdo má
-- `settings.manage` nebo `agents.manage` — tedy majitel nebo správce.
-- Politika `audit_select` to říká přesně tak a je to správně: audit je
-- záznam o všem, co se ve firmě děje, včetně mezd a docházky.
--
-- Marketér, který má vidět „kdo schválil ten příspěvek", ta práva
-- nemá a mít je nemá. Kdyby se politika rozšířila o `marketing.read`,
-- otevřel by se mu **celý** audit firmy — tedy i lidi, zálohy
-- a docházka. To je cena, kterou jedna obrazovka nemá stát za to.
--
-- Proto se to obrací: přístup se nerozšiřuje, přidává se **úzké okno**.
-- Funkce vrací jen řádky, jejichž `entity_type` začíná `marketing`,
-- a ptá se na `marketing.manage` u té konkrétní pobočky.
--
-- ---------------------------------------------------------------------
-- SYROVÉ `before` A `after` SE VEN NEVRACÍ. VŮBEC.
--
-- V nich leží celé řádky — u `marketing_verze` třeba celý text
-- příspěvku, u `marketing_ucty` identifikátory profilů. Auditní přehled
-- má odpovědět **kdo, co a kdy**, ne být druhou kopií dat.
--
-- Vrací se proto jen NÁZVY změněných sloupců (`zmeneno`). Kdo chce
-- vědět, co přesně v příspěvku stálo, jde na historii verzí — tam to
-- patří a tam se na to ptá jiné právo.
--
-- Je to i pojistka do budoucna: až někdo pověsí audit na tabulku
-- s citlivým sloupcem, neunikne přes tuhle obrazovku, protože ta
-- hodnoty neposílá. Dnes to hrozí nejmíň — `marketing_tajemstvi`
-- se zašifrovanými klíči k Instagramu **audit spoušť schválně nemá**
-- (`20260909220000_marketing_integrace.sql`).
--
-- ---------------------------------------------------------------------
-- UVNITŘ `security definer` SE RLS NEUPLATNÍ
--
-- Vlastní ji role, která RLS obchází (`docs/zarazeni-misto-roli-nalezy.md`,
-- oddíl 7b). Pravidlo 3 z CLAUDE.md tady tedy neplatí a tělo si musí
-- odfiltrovat všechno samo. Filtry jsou tři a **každý je napsaný jen
-- jednou** — podmínka zapsaná dvakrát „pro jistotu" nejde shodit,
-- takže kontrola, která na ni míří, je zelená vždycky:
--
--   1. `a.tenant_id = p_tenant`     jinak by se četl audit CIZÍ FIRMY
--   2. `entity_type like 'marketing%'`  jinak okno do celého auditu
--   3. `app.has_access(…, branch)`  jinak vedoucí baru vidí druhou pobočku
--
-- Na každý z nich míří vlastní kontrola v `marketing15_scenar.sql`.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * Žádná nová tabulka. Audit už zapsaný je; tohle je jen čtení.
-- * Nesahá se na politiku `audit_select`. Viz výš — rozšířit ji by
--   znamenalo pustit marketéra k mzdám.
-- * Žádné stránkování přes `offset`. Audit roste a `offset` nad
--   rostoucí tabulkou přeskakuje řádky, když mezitím přibude nový.
--   Stránkuje se přes `p_pred_id` — „starší než tenhle záznam".
-- * Nevrací se `ip` ani `user_agent`. K otázce „kdo to schválil" je
--   nepotřebuješ a je to osobní údaj navíc.
-- * Nepřidává se index. Řadí se podle `id` (tedy podle pořadí zápisu),
--   což existující `audit_log_tenant_time` nevyužije — a `like
--   'marketing%'` taky ne. Při dnešních desítkách řádků je to jedno
--   a sahat kvůli marketingu indexem do základní tabulky, kterou
--   sdílí všechny moduly, je horší než pomalý dotaz. **Až bude audit
--   marketingu v tisících, patří sem částečný index** na
--   `(tenant_id, id desc) where entity_type like 'marketing%'`.
-- =====================================================================

create or replace function public.marketing_audit(
  p_tenant   uuid,
  p_branch   uuid default null,
  p_entita   text default null,
  p_pred_id  bigint default null,
  p_limit    integer default 50
)
returns table (
  id          bigint,
  kdy         timestamptz,
  kdo         text,
  druh_kdo    text,
  akce        text,
  entita      text,
  entita_id   text,
  branch_id   uuid,
  zmeneno     text[]
)
language sql stable security definer set search_path = ''
as $$
  select a.id,
         a.occurred_at,
         a.actor_label,
         a.actor_type,
         a.action,
         a.entity_type,
         a.entity_id,
         a.branch_id,
         /*
           Jen u `update` dává výčet smysl. `app.audit_zmenu` tam
           zapisuje POUZE změněné sloupce, takže klíče `after` jsou
           přesně to, co se změnilo.

           U `insert` by to byly všechny sloupce řádku a u `delete`
           taky — to není informace, to je šum.
         */
         case when a.before is not null and a.after is not null
              then (select array_agg(k order by k) from jsonb_object_keys(a.after) k)
         end
    from public.audit_log a
   where a.tenant_id = p_tenant
     and a.entity_type like 'marketing%'
     and app.has_access(p_tenant, 'marketing.manage', a.branch_id)
     and (p_branch  is null or a.branch_id = p_branch)
     and (p_entita  is null or a.entity_type = p_entita)
     and (p_pred_id is null or a.id < p_pred_id)
   order by a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

comment on function public.marketing_audit(uuid, uuid, text, bigint, integer) is
  'Auditní přehled marketingu — kdo, co a kdy. Úzké okno do audit_log '
  'pro entity marketing_*, aby se kvůli jedné obrazovce nemusel '
  'marketérovi otevřít celý audit firmy včetně mezd a docházky. '
  'Syrové before/after nevrací, jen názvy změněných sloupců.';

revoke all on function public.marketing_audit(uuid, uuid, text, bigint, integer)
  from public, anon;
grant execute on function public.marketing_audit(uuid, uuid, text, bigint, integer)
  to authenticated;


-- ---------------------------------------------------------------------
-- KTERÉ DRUHY ZÁZNAMŮ VŮBEC EXISTUJÍ
--
-- Pro rozbalovátko na obrazovce. Kdyby se seznam psal v kódu, rozešel
-- by se s databází v okamžiku, kdy přibude tabulka — a obrazovka by
-- tiše nenabízela filtr na něco, co v datech je.
--
-- Tatáž tři pravidla jako výš, protože i tohle je `security definer`.
-- ---------------------------------------------------------------------

create or replace function public.marketing_audit_druhy(p_tenant uuid)
returns table (entita text, kusu bigint)
language sql stable security definer set search_path = ''
as $$
  select a.entity_type, count(*)
    from public.audit_log a
   where a.tenant_id = p_tenant
     and a.entity_type like 'marketing%'
     and app.has_access(p_tenant, 'marketing.manage', a.branch_id)
   group by a.entity_type
   order by a.entity_type;
$$;

comment on function public.marketing_audit_druhy(uuid) is
  'Druhy auditních záznamů marketingu a jejich počty. Pro filtr na '
  'obrazovce — číselník se čte z dat, ne z kódu.';

revoke all on function public.marketing_audit_druhy(uuid) from public, anon;
grant execute on function public.marketing_audit_druhy(uuid) to authenticated;
