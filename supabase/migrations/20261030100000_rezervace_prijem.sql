-- =====================================================================
-- Foodtab — Rezervace: univerzální příjmové API
--
-- Šéfík 25. 10. 2026 večer: „mám Choice, ale připravil bych univerzální
-- možnost". Choice veřejné API pro rezervace nemá (průzkum,
-- docs/rezervace-navrh.md), takže místo adaptéru jednoho systému dostane
-- Foodtab vlastní adresu, na kterou rezervace pošle KDOKOLI: rezervační
-- systém webhookem, nebo prostředník (n8n, Make, Zapier). Stejný vzor
-- jako „Jiná pokladna" u pokladen (POST /api/pokladna/prodeje).
-- Popis pro integrátora: docs/rezervace-api.md.
--
-- ---------------------------------------------------------------------
-- CO SE TU DĚLÁ
--
--   * `public.rezervace_prijmout(připojení, systém, řádky)` — jen pro
--     service_role (adresa /api/rezervace/prijem, kde klíč nahrazuje
--     přihlášení). Klíč ověřuje adresa (zašifrovaný v integrace_tajemstvi,
--     porovnání v konstantním čase); funkce věří, že volající to udělal.
--   * Zapisuje přes `app.rezervace_zapsat_radky` (20261027100000) — stejná
--     pravidla jako import ze souboru i ze zdroje: párování podle čísla
--     ze zdroje, údaje zdroje × údaje Foodtabu, starší data nepřebijí
--     novější, dávka celá nebo nic.
--   * Připojení se přepne na „připojeno" (s `posledni_test_ok`) teprve
--     PO úspěšně zapsané dávce, v TÉŽE transakci. Když zápis spadne,
--     neplatí ani to přepnutí — „připojeno" nikdy natvrdo předem.
--
-- `p_system`: krátké jméno systému, ze kterého data jsou (např. `choice`).
-- Páruje se podle (pobočka, systém, číslo rezervace) — rezervace, které
-- přijdou z Choice přes API, se tak spárují i s těmi, které se dřív
-- načetly z CSV exportu Choice pod stejným jménem. Bez jména `obecne`.
--
-- CO SE SCHVÁLNĚ NEDĚLÁ
--   * Žádná nová tabulka ani sloupec. Připojení i klíč jsou v registru
--     integrace_pripojeni / integrace_tajemstvi jako u pokladny.
--   * Mazání přes API ne — zrušení je stav „zrusena" (jako jinde).
-- =====================================================================

create function public.rezervace_prijmout(p_pripojeni uuid, p_system text, p_radky jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_c        public.integrace_pripojeni;
  v_system   text := coalesce(nullif(btrim(p_system), ''), 'obecne');
  v_vysledek jsonb;
begin
  select * into v_c from public.integrace_pripojeni
   where id = p_pripojeni
     and oblast = 'rezervace'
     and poskytovatel = 'obecne'
     and odpojeno_kdy is null
     for update;
  if not found then
    raise exception 'Připojení příjmového API rezervací neexistuje nebo je odpojené.'
      using errcode = 'no_data_found';
  end if;

  if v_system !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'Jméno systému musí být krátké (malá písmena, číslice, pomlčka): %', v_system
      using errcode = 'check_violation';
  end if;

  v_vysledek := app.rezervace_zapsat_radky(v_c.tenant_id, v_c.branch_id, 'externi', v_system, v_c.id, p_radky);

  -- Dávka se zapsala: klíč sedí a data prošla. Teprve teď „připojeno".
  update public.integrace_pripojeni
     set stav = 'pripojeno',
         posledni_test_ok = true,
         posledni_test_kdy = now(),
         posledni_sync_kdy = now(),
         posledni_sync_pocet_radku = jsonb_array_length(p_radky),
         posledni_chyba = null,
         zmeneno_kdy = now()
   where id = v_c.id;

  return v_vysledek;
end $$;

comment on function public.rezervace_prijmout(uuid, text, jsonb) is
  'Příjmové API rezervací: zapíše dávku z připojení `obecne` (oblast rezervace) '
  'a teprve po úspěšném zápisu ho označí jako připojené. Jen service_role.';

revoke all on function public.rezervace_prijmout(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.rezervace_prijmout(uuid, text, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- Stav napojení pro obrazovku: navíc kdy a kolik přišlo naposled
-- a poslední chyba. Chybu vidí jen správce napojení (`integrace.manage`)
-- — je v ní důvod odmítnutí dávky, ten patří tomu, kdo napojení ladí.
-- Mění se výstup funkce, proto drop + create (create or replace typ
-- výstupu změnit neumí). Obrazovka ji volá se stejným parametrem.
-- ---------------------------------------------------------------------

drop function public.rezervace_napojeni(uuid);

create function public.rezervace_napojeni(p_tenant uuid)
returns table (
  id                        uuid,
  branch_id                 uuid,
  poskytovatel              text,
  stav                      text,
  nazev                     text,
  posledni_test_kdy         timestamptz,
  posledni_sync_kdy         timestamptz,
  posledni_sync_pocet_radku integer,
  posledni_chyba            text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.branch_id, c.poskytovatel, c.stav, c.nazev, c.posledni_test_kdy,
         c.posledni_sync_kdy, c.posledni_sync_pocet_radku,
         case when app.has_access(c.tenant_id, 'integrace.manage', c.branch_id) then c.posledni_chyba end
    from public.integrace_pripojeni c
   where c.tenant_id = p_tenant
     and c.oblast = 'rezervace'
     and c.odpojeno_kdy is null
     and (app.has_access(c.tenant_id, 'rezervace.read', c.branch_id)
          or app.has_access(c.tenant_id, 'rezervace.manage', c.branch_id)
          or app.has_access(c.tenant_id, 'integrace.manage', c.branch_id))
   order by c.vytvoreno_kdy;
$$;

revoke all on function public.rezervace_napojeni(uuid) from public, anon;
grant execute on function public.rezervace_napojeni(uuid) to authenticated;
