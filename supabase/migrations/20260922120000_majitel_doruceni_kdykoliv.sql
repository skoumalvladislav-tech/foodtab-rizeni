-- Majiteli chodí upozornění kdykoliv, ne až po (nikdy nenastalém) příchodu.
--
-- Zadání: „když odešlu zprávu vedení, tak mi žádné upozornění nepřijde,
-- nastav že vedení (majiteli) přijde zpráva kdykoliv." Rozsah potvrzený
-- Šéfíkem 22. 9.: platí pro VŠECHNA upozornění majiteli, ne jen pro vzkazy
-- vedení — viz níž, proč užší oprava jen tu samou díru přesune jinam.
--
-- ---------------------------------------------------------------------
-- SKUTEČNÁ PŘÍČINA
--
-- app.zaradit_doruceni (20260921100000_notifikacni_sluzba.sql) posílá
-- NEnaléhavé upozornění hned, jen když je člověk PRÁVĚ na směně
-- (app.smena_ted — otevřený příchod). Jinak čeká ve frontě
-- (ceka_na_smenu) na app.uvolnit_cekajici, která ho pustí AŽ PO příchodu.
--
-- Majitel typicky nepíchá docházku vůbec — nemá směny, nemá příchod.
-- „Čeká na směnu" je proto pro majitele čekání, které nikdy neskončí:
-- ne dokud nepřijde nejbližší směna (ta u majitele není), ale navěky.
-- Jediný, kdo dnes obchází frontu, je NALÉHAVÁ zpráva (p_nalehava).
--
-- ---------------------------------------------------------------------
-- PROČ NE JEN PRO VZKAZY VEDENÍ
--
-- Stejná fronta (notifikace_doruceni) se používá pro každé upozornění,
-- ne jen pro vzkazy — nástěnka, směny, cokoli budoucího. Kdyby se
-- majiteli udělala výjimka jen v triggeru na vzkazy, díra by zůstala
-- otevřená přesně tam, kde ji dnes nikdo nehledá — třeba u oznámení na
-- nástěnce adresovaného majiteli. Oprava proto sedí na JEDNOM místě,
-- kde se o frontě rozhoduje (app.zaradit_doruceni), ne na producentovi.
--
-- ---------------------------------------------------------------------
-- JAK
--
-- app.doruci_se(p_na_smene, p_konv_branch, p_nalehava) už dneska umí
-- „pošli hned bez ohledu na směnu" — přesně to, co naléhavá zpráva
-- dělá přes třetí parametr. Majitel se do TÉHOŽ parametru přidává jako
-- druhý důvod k obejití fronty — žádná nová větev, žádný nový stav.
create or replace function app.zaradit_doruceni(p_notification uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_n       record;
  v_emp     uuid;
  v_majitel boolean;
  v_smena   uuid;
begin
  select n.id, n.tenant_id, n.user_id, n.priorita, n.telo
    into v_n
    from public.notifications n
   where n.id = p_notification;

  if not found or v_n.priorita = 'low' then
    return;
  end if;

  if not exists (
    select 1 from public.push_odbery o
     where o.user_id = v_n.user_id and o.vypnuto_kdy is null
  ) then
    return;
  end if;

  select e.id, e.je_majitel
    into v_emp, v_majitel
    from public.employees e
   where e.tenant_id  = v_n.tenant_id
     and e.user_id    = v_n.user_id
     and e.deleted_at is null
   limit 1;

  v_smena := app.smena_ted(v_n.tenant_id, v_emp);

  insert into public.notifikace_doruceni
    (tenant_id, user_id, notification_id, typ, pocet, kanal, stav)
  values (
    v_n.tenant_id,
    v_n.user_id,
    v_n.id,
    'jedna',
    greatest(coalesce((v_n.telo->>'pocet')::integer, 1), 1),
    'push',
    case
      -- Pobočka se nepředává: pro rušení telefonem je rozhodující, že je
      -- člověk v práci, ne kde (kanál pobočky se čte jen na té pobočce,
      -- to řeší čtení, ne oznámení). Majitel obchází frontu stejnou
      -- cestou jako naléhavá zpráva — nemá směnu, na kterou by čekal.
      when app.doruci_se(v_smena, null, v_n.priorita = 'urgent' or coalesce(v_majitel, false))
        then 'k_odeslani'
      else 'ceka_na_smenu'
    end
  );
end $$;

comment on function app.zaradit_doruceni(uuid) is
  'Rozhoduje o externím kanálu (push): hned, nebo do fronty na příchod. '
  'Naléhavá zpráva a upozornění majiteli frontu obchází stejně — majitel '
  'nemá směnu, na kterou by čekal.';
