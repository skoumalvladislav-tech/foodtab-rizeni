-- =====================================================================
-- Foodtab — Finance: rozpočty, plan-to-control a provozní controlling
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 5):
-- „Plan to control: rozpočet a plán prodejů → plán nákupu, výroby a
-- směn → skutečné náklady a tržby → odchylky → schválené nápravné
-- úkoly." + „Provozní controlling: výsledovka podle firmy, pobočky,
-- střediska a zakázky, rozpočty a forecast, skutečné versus plánované
-- náklady, variabilní/fixní náklady, příspěvek na úhradu, bod zvratu
-- s uvedenými předpoklady, produktivita práce a prime cost."
--
-- BEZ FYZICKÉHO SKLADU: „plán výroby" se nestaví (vyžaduje fyzické
-- pohyby zásob — mantinel). Nápravný úkol = existující `tasks`
-- (Vzkazy a úkoly), NE nová tabulka — appka jen nabídne tlačítko
-- "Založit úkol" u odchylky nad práh, založení dělá `zadat_ukol`.
--
-- PRIME COST JE APROXIMACE, NE ÚČETNÍ COGS: „srovnatelná spotřeba F&B"
-- (zadání, oddíl 7) se tu počítá z PENĖŽNÍCH výdajů za suroviny
-- v daném období (transakce.kategorie='suroviny'), ne z teoretické
-- spotřeby vázané na prodané porce — tu appka dnes nemá k dispozici
-- bez POS napojení (Dotykačka adaptér, samostatný kus práce). Nákup
-- v lednu a spotřeba v únoru se proto NESHODUJÍ přesně — appka to
-- vždy popisuje jako „odhad z výdajů", ne jako přesný foodcost.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KATEGORIE TRANSAKCE — aditivní sloupec, nepovinný (staré řádky null).
-- Sdílený výčet s `rozpocty.kategorie` níž, aby šlo plán/skutečnost
-- porovnat na stejné ose.
-- ---------------------------------------------------------------------

alter table public.transakce
  add column if not exists kategorie text
  check (kategorie is null or kategorie in
    ('trzby', 'suroviny', 'mzdy', 'najem', 'energie', 'marketing', 'ostatni'));

comment on column public.transakce.kategorie is
  'Nepovinné zařazení pro rozpočty/controlling (app.vysledovka,
   app.rozpocet_prehled). Prázdné (null) = appka to počítá jako
   nezařazené, ne jako "ostatni" tiše.';


-- ---------------------------------------------------------------------
-- ROZPOČTY — jedna řádka = jedna kategorie na jeden měsíc.
-- ---------------------------------------------------------------------

create table public.rozpocty (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete cascade,
  kategorie     text not null check (kategorie in
                  ('trzby', 'suroviny', 'mzdy', 'najem', 'energie', 'marketing', 'ostatni')),
  smer          text not null check (smer in ('prijem', 'vydaj')),
  rok           integer not null,
  mesic         smallint not null check (mesic between 1 and 12),
  castka_haleru integer not null check (castka_haleru > 0),
  -- Pro bod zvratu (zadání: "variabilní/fixní náklady... s uvedenými
  -- předpoklady") — rozhoduje ten, kdo rozpočet zapisuje, appka
  -- nehádá podle kategorie automaticky.
  je_fixni      boolean not null default false,
  poznamka      text not null default '',
  created_by    uuid references public.profiles(user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- NULLS NOT DISTINCT (ne coalesce): appka ukládá přes supabase-js
-- `.upsert(..., {onConflict: 'tenant_id,branch_id,...'})`, který cílí
-- ON CONFLICT přesně na sloupce — funkční index s coalesce() by se
-- s tím textově neshodl (stejná třída nálezu jako u importovat_transakce:
-- PostgREST/supabase-js neumí mířit na výraz, jen na holé sloupce).
create unique index rozpocty_tenant_obdobi on public.rozpocty
  (tenant_id, branch_id, kategorie, smer, rok, mesic) nulls not distinct;
create index rozpocty_tenant_rok_mesic on public.rozpocty (tenant_id, rok, mesic);

alter table public.rozpocty enable row level security;

revoke all on public.rozpocty from anon;
revoke truncate, references, trigger on public.rozpocty from authenticated;
grant select, insert, update, delete on public.rozpocty to authenticated;

create policy rozpocty_read on public.rozpocty for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));
create policy rozpocty_write on public.rozpocty for all to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id))
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

drop trigger if exists trg_audit_rozpocty on public.rozpocty;
create trigger trg_audit_rozpocty
  after insert or update or delete on public.rozpocty
  for each row execute function app.audit_zmenu('rozpocet');


-- ---------------------------------------------------------------------
-- VÝSLEDOVKA — skutečnost (z transakce) po kategorii a směru, pro
-- dané období. Firemní úroveň i pobočková (p_branch null = JEN účty
-- bez pobočky, stejný vzor jako cashflow_prehled_firma — NE celá
-- firma sečtená, to by zdvojilo součty napříč pobočkami).
-- ---------------------------------------------------------------------

create or replace function app.vysledovka(p_tenant uuid, p_branch uuid, p_od date, p_do date)
returns table (
  kategorie     text,
  smer          text,
  castka_haleru bigint
)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(x.kategorie, 'nezarazeno'),
    x.smer,
    sum(x.castka_haleru)::bigint
  from public.transakce x
  join public.platebni_ucty u on u.id = x.ucet_id
  where u.tenant_id = p_tenant
    and (
      (p_branch is null and u.branch_id is null)
      or (p_branch is not null and u.branch_id = p_branch)
    )
    and x.datum between p_od and p_do
    and x.smer in ('prijem', 'vydaj')
    and app.has_access(p_tenant, 'finance.read', p_branch)
  group by coalesce(x.kategorie, 'nezarazeno'), x.smer;
$$;

comment on function app.vysledovka(uuid, uuid, date, date) is
  'Skutečné příjmy/výdaje po kategorii a směru za období — základ pro
   výsledovku a controlling. p_branch null = jen firemní účty (stejný
   vzor jako cashflow_prehled_firma), ne celá firma sečtená.';

revoke all on function app.vysledovka(uuid, uuid, date, date) from public, anon;
grant execute on function app.vysledovka(uuid, uuid, date, date) to authenticated;

create or replace function public.vysledovka(p_tenant uuid, p_branch uuid, p_od date, p_do date)
returns table (kategorie text, smer text, castka_haleru bigint)
language sql stable security invoker set search_path = ''
as $$
  select * from app.vysledovka(p_tenant, p_branch, p_od, p_do);
$$;

revoke all on function public.vysledovka(uuid, uuid, date, date) from public, anon;
grant execute on function public.vysledovka(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- ROZPOČET VS. SKUTEČNOST — jeden měsíc, jedna pobočka (nebo firma).
-- ---------------------------------------------------------------------

create or replace function app.rozpocet_prehled(p_tenant uuid, p_branch uuid, p_rok integer, p_mesic integer)
returns table (
  kategorie        text,
  smer             text,
  plan_haleru      bigint,
  skutecnost_haleru bigint,
  odchylka_haleru  bigint
)
language sql stable security definer set search_path = ''
as $$
  with obdobi as (
    select make_date(p_rok, p_mesic, 1) as od,
           (make_date(p_rok, p_mesic, 1) + interval '1 month - 1 day')::date as do_
  ),
  plan as (
    select r.kategorie, r.smer, sum(r.castka_haleru)::bigint as castka
    from public.rozpocty r
    where r.tenant_id = p_tenant
      and coalesce(r.branch_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_branch, '00000000-0000-0000-0000-000000000000')
      and r.rok = p_rok and r.mesic = p_mesic
      and app.has_access(p_tenant, 'finance.read', p_branch)
    group by r.kategorie, r.smer
  ),
  skutecnost as (
    select v.kategorie, v.smer, v.castka_haleru as castka
    from obdobi, app.vysledovka(p_tenant, p_branch, obdobi.od, obdobi.do_) v
  )
  select
    coalesce(p.kategorie, s.kategorie),
    coalesce(p.smer, s.smer),
    coalesce(p.castka, 0),
    coalesce(s.castka, 0),
    coalesce(s.castka, 0) - coalesce(p.castka, 0)
  from plan p
  full outer join skutecnost s on s.kategorie = p.kategorie and s.smer = p.smer;
$$;

comment on function app.rozpocet_prehled(uuid, uuid, integer, integer) is
  'Plán (rozpocty) vs. skutečnost (app.vysledovka) pro jeden měsíc.
   FULL OUTER JOIN — kategorie se skutečností bez plánu (nebo naopak)
   se taky ukáže, ne tiše zmizí.';

revoke all on function app.rozpocet_prehled(uuid, uuid, integer, integer) from public, anon;
grant execute on function app.rozpocet_prehled(uuid, uuid, integer, integer) to authenticated;

create or replace function public.rozpocet_prehled(p_tenant uuid, p_branch uuid, p_rok integer, p_mesic integer)
returns table (kategorie text, smer text, plan_haleru bigint, skutecnost_haleru bigint, odchylka_haleru bigint)
language sql stable security invoker set search_path = ''
as $$
  select * from app.rozpocet_prehled(p_tenant, p_branch, p_rok, p_mesic);
$$;

revoke all on function public.rozpocet_prehled(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.rozpocet_prehled(uuid, uuid, integer, integer) to authenticated;
