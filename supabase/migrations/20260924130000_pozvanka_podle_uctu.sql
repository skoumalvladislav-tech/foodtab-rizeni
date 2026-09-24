-- =====================================================================
-- Foodtab — pozvánka se páruje s ověřenou adresou ÚČTU, ne s profilem
--
-- Nález 24. 9. 2026 (ověřeno čtením ostré databáze, návrh opravy
-- „Oprava: pozvánku jde přivlastnit přepsáním e-mailu v profilu").
--
-- ---------------------------------------------------------------------
-- CO BYLO ŠPATNĚ
--
-- `authenticated` měl na `public.profiles` UPDATE na CELOU tabulku —
-- z plošného grantu v 20260823120200_authz.sql (a v ostré databázi
-- navíc z výchozích práv Supabase). Politika `profiles_update_self`
-- hlídá jen to, že jde o vlastní řádek; sloupce neomezuje. Sloupcový
-- grant na `upozorneni_emailem` z 20260902070000 tedy nic nezužoval —
-- širší právo na tabulku ho přebilo.
--
-- A přesně `profiles.email` a `profiles.phone` rozhodovaly, čí je
-- pozvánka: `moje_cekajici_pozvanky` i `app.prijmout_pozvanku` je
-- porovnávaly s kontaktem na pozvánce. Kdokoli s účtem — i bez členství
-- v jakékoli firmě — si tak veřejným klíčem mohl:
--
--   update profiles set email = '<adresa pozvaného>' where user_id = auth.uid();
--
-- a pak cizí pozvánku najít v `moje_cekajici_pozvanky` a přijmout ji
-- přes `prijmout_moji_pozvanku`. Členství v cizí firmě bez jediného
-- tokenu. Navíc by pozvaný pak nedostal účet: `profiles.email` je
-- unikátní a `app.handle_new_user` by na obsazené adrese spadl.
--
-- ---------------------------------------------------------------------
-- CO SE MĚNÍ
--
-- 1. Na profilu smí přihlášený měnit jen `upozorneni_emailem`. Jiný
--    sloupec aplikace z klienta nemění (e-mail a telefon pro firmu jdou
--    přes `set_my_contact` do `employees`, jméno přes funkce s právy
--    vlastníka). Profil zakládá `app.handle_new_user` a maže ho kaskáda
--    z `auth.users` — přihlášený ho nezakládá ani nemaže.
--
-- 2. Pozvánka se páruje s adresou a číslem z `auth.users`, a jen když
--    jsou OVĚŘENÉ (`email_confirmed_at`, `phone_confirmed_at`). Tu
--    adresu člověk sám nepřepíše: změnu e-mailu nebo telefonu v účtu
--    Supabase provede až po potvrzení odkazem nebo kódem — ALE JEN při
--    nastavení Auth z oddílu „NA ČEM TO STOJÍ“ níž.
--
--    Oprava č. 1 by díru zavřela sama. Druhá je tu proto, aby o tom,
--    komu pozvánka patří, nerozhodoval sloupec, který se dá jedním
--    grantem zase otevřít — a `profiles.email` se navíc od adresy účtu
--    může rozejít (spoušť ho plní jen při založení účtu).
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ — NASTAVENÍ SUPABASE AUTH
--
-- Párovat pozvánku podle `auth.users` je bezpečné JEN tehdy, když
-- v Supabase (Authentication → Sign In / Providers) platí všechno tohle:
--
--   * „Confirm email“ ZAPNUTÉ. Vypnuté = GoTrue adresy potvrzuje sám:
--     `email_confirmed_at` se vyplní bez kliknutí na odkaz, a když si
--     přihlášený změní e-mail (`auth.updateUser({ email })`), GoTrue ho
--     přepíše HNED — bez odkazu na novou adresu — a `email_confirmed_at`
--     zůstane vyplněné. To je přesně díra, kterou tahle migrace zavírá,
--     jen o patro výš: místo `profiles.email` by se přepsal `auth.users.email`.
--   * „Secure email change“ (`double_confirm_changes`) ZAPNUTÉ. Změnu
--     adresy pak musí potvrdit i STARÁ adresa, ne jen nová — ukradené
--     sezení samo účet na jinou adresu nepřevede.
--   * „Allow new users to sign up“ VYPNUTÉ. Do Foodtabu se vstupuje jen
--     na pozvánku; účet pozvanému zakládá server (`poslatPrvniKod`
--     v app/pozvanka/[token]/akce.ts, od PR #73) a jen pro adresu z pozvánky
--     v databázi. Ten účet má `email_confirm: true`, tedy adresu ověřenou
--     bez kliknutí — nevadí to, přihlásit se do něj jde jen kódem, který
--     přijde na tu adresu.
--   * U SMS „Confirm phone“ ZAPNUTÉ. Vypnuté = `phone_confirmed_at`
--     vyplní GoTrue bez kódu (i při změně čísla) a SMS pozvánka jde
--     přivlastnit stejně jako e-mailová.
--
-- Z databáze se tohle ověřit nedá — nastavení Auth v Postgresu není
-- a scénář ho jen předpokládá (harness zakládá účty rovnou ověřené).
-- Před nasazením, a kdykoli se v Auth něco mění, se musí zkontrolovat
-- ručně v Supabase Dashboardu. Vypnuté „Confirm email“ nebo „Confirm
-- phone“ otevírá cizí pozvánky rovnou komukoli s účtem; „Secure email
-- change“ a zavřená registrace jsou druhá linie (ukradené sezení, účty
-- mimo pozvánku) — a bez nich to bezpečné není taky.
--
-- ---------------------------------------------------------------------
-- TELEFON
--
-- `invitations.phone` je v tvaru E.164 s „+“ (hlídá to `create_invitation`
-- i omezení na tabulce). Supabase Auth ukládá `auth.users.phone` podle
-- všeho bez „+“ (`420601234567`) — proti ostré databázi to ověřené
-- není. Proto se „+“ doplní, když chybí, a sedí oba tvary: je to totéž
-- číslo, jen jinak zapsané, a ověřené je tak jako tak kódem na to číslo.
--
-- `app.handle_new_user` bere číslo jen s `btrim`. Tvar bez „+“ by
-- v profilu neprošel omezením `profiles.phone` a založení účtu by
-- spadlo — to je samostatná věc a tady se neřeší.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
-- * `profiles.email`/`phone` se nemažou ani nepřepisují. Čte je víc
--   míst (jméno v upozornění, komu poslat e-mail o přijetí) a o pozvánce
--   už nerozhodují.
-- * `public.prijmout_moji_pozvanku` a `app.accept_invitation` se
--   nemění — kontakt samy neporovnávají, jen najdou pozvánku a předají
--   ji `app.prijmout_pozvanku`. Na jednom místě se rozhoduje dál.
-- * Hlášky zůstávají slovo od slova. Obrazovka pozvánky podle
--   „vystavena na jin…“ nabízí přihlášení správnou adresou
--   (app/pozvanka/[token]/akce.ts) — změněná věta by ji tiše vypnula.
-- * Čtení profilu (`select`) se nemění — o tom rozhodují politiky
--   `profiles_select_self` a `profiles_select_colleagues`.
--
-- Scénář: supabase/tests/krok56_scenar.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PROFIL: PŘIHLÁŠENÝ MĚNÍ JEN VOLBU E-MAILŮ
--
-- Pořadí je podstatné: dokud platí UPDATE na celou tabulku, sloupcový
-- grant se neprojeví. `revoke` na tabulce smaže i sloupcové granty, proto
-- se ten jeden vrací hned za ním.
-- ---------------------------------------------------------------------

revoke insert, update, delete on public.profiles from authenticated;

grant update (upozorneni_emailem) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 2. OVĚŘENÉ KONTAKTY PŘIHLÁŠENÉHO ÚČTU
--
-- Jediné místo, odkud se bere, komu pozvánka patří. Neověřená adresa
-- vrací NULL, ne adresu — účet založený odkazem, na který nikdo
-- neklikl, se za pozvaného vydávat nesmí.
--
-- Tvar stejný jako na pozvánce: e-mail malými písmeny bez mezer
-- (`create_invitation`, `handle_new_user`), telefon s „+“ (viz hlavička).
-- ---------------------------------------------------------------------

create or replace function app.moje_overene_kontakty()
returns table (email text, phone text)
language sql stable security definer set search_path = ''
as $$
  select
    case when u.email_confirmed_at is not null
      then nullif(btrim(lower(u.email)), '')
    end,
    case when u.phone_confirmed_at is not null and nullif(btrim(u.phone), '') is not null
      then '+' || ltrim(btrim(u.phone), '+')
    end
  from auth.users u
  where u.id = (select auth.uid());
$$;

comment on function app.moje_overene_kontakty() is
  'Ověřený e-mail a telefon přihlášeného účtu z auth.users. Podle toho, '
  'ne podle profilu, se pozná, komu patří pozvánka.';

revoke all on function app.moje_overene_kontakty() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. SPOLEČNÉ TĚLO PŘIJETÍ
--
-- Z poslední definice (20260902070000_upozorneni_na_prijeti.sql).
-- Mění se jen to, s čím se porovnává kontakt; profil se už jen hledá —
-- členství na něj odkazuje, o totožnosti nerozhoduje.
-- ---------------------------------------------------------------------

create or replace function app.prijmout_pozvanku(p_inv public.invitations)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_email  text;
  v_phone  text;
  v_member uuid;
  v_bid    uuid;
begin
  if v_user is null then
    raise exception 'Nejdřív se přihlaste.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Účet nemá profil.' using errcode = 'insufficient_privilege';
  end if;

  if p_inv.id is null then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.revoked_at is not null then
    raise exception 'Pozvánka byla zrušena.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.accepted_at is not null then
    raise exception 'Pozvánka už byla použita.' using errcode = 'invalid_parameter_value';
  end if;
  if p_inv.expires_at <= now() then
    raise exception 'Pozvánce vypršela platnost. Požádejte o novou.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Pozvánku nelze použít pod jiným kontaktem, než na jaký byla
  -- vystavena. Tohle je jediné, čím se ověří, že odkaz použil ten, komu
  -- byl poslaný — přeposlaný e-mail by jinak pustil do firmy kohokoli.
  --
  -- Kontakt je ten OVĚŘENÝ z účtu, ne z profilu. Profil si člověk dřív
  -- mohl přepsat sám (20260924130000, hlavička).
  select k.email, k.phone into v_email, v_phone from app.moje_overene_kontakty() k;

  if p_inv.channel = 'email' and v_email is distinct from p_inv.email then
    raise exception 'Pozvánka byla vystavena na jinou e-mailovou adresu.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_inv.channel = 'sms' and v_phone is distinct from p_inv.phone then
    raise exception 'Pozvánka byla vystavena na jiné telefonní číslo.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (p_inv.tenant_id, v_user, p_inv.role_id, 'active', p_inv.scope)
  on conflict (tenant_id, user_id) do update
    set role_id = coalesce(excluded.role_id, public.memberships.role_id),
        status  = 'active',
        scope   = excluded.scope
  returning id into v_member;

  delete from public.membership_branches where membership_id = v_member;
  foreach v_bid in array coalesce(p_inv.branch_ids, '{}') loop
    insert into public.membership_branches (membership_id, branch_id)
    values (v_member, v_bid) on conflict do nothing;
  end loop;

  -- Zaměstnanecký záznam už mohl existovat bez účtu (brigádník, kterého
  -- se nakonec rozhodli pustit do aplikace). Teď se propojí.
  if p_inv.employee_id is not null then
    update public.employees
      set user_id = v_user
      where id = p_inv.employee_id and tenant_id = p_inv.tenant_id and user_id is null;
  end if;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
    where id = p_inv.id;

  perform app.audit(p_inv.tenant_id, 'invitation.accept', 'membership', v_member::text);

  /*
    Upozornění až úplně nakonec a ve vlastním bloku. Kdyby spadlo,
    členství už je zapsané a přijetí projde — o tom, jestli se člověk
    dostane do firmy, nesmí rozhodovat zvoneček.
  */
  begin
    perform app.upozorni_na_prijeti(p_inv.tenant_id, v_user);
  exception when others then
    null;
  end;

  return p_inv.tenant_id;
end;
$$;

revoke all on function app.prijmout_pozvanku(public.invitations) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. CO NA MĚ ČEKÁ
--
-- Z poslední definice (20260902020000_cekajici_pozvanka.sql). Komentář
-- u ní sliboval „podle adresy přihlášeného účtu“ — teď to platí.
--
-- Spojení s `profiles` odpadá: sloužilo jen k tomu, odkud vzít kontakt.
-- Kdo by profil neměl, pozvánku sice uvidí, ale přijetí ho zastaví
-- hláškou „Účet nemá profil.“ — rozhoduje se tam, ne tady.
-- ---------------------------------------------------------------------

create or replace function public.moje_cekajici_pozvanky()
returns table (
  invitation_id uuid,
  tenant_id     uuid,
  firma         text,
  kanal         text,
  expires_at    timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.tenant_id, t.name, i.channel, i.expires_at
  from public.invitations i
  join public.tenants t on t.id = i.tenant_id
  cross join app.moje_overene_kontakty() k
  where i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and t.deleted_at is null
    and (
      (i.channel = 'email' and i.email = k.email)
      or (i.channel = 'sms' and i.phone = k.phone)
    )
  order by i.created_at desc;
$$;

revoke all on function public.moje_cekajici_pozvanky() from public, anon;
grant execute on function public.moje_cekajici_pozvanky() to authenticated;
