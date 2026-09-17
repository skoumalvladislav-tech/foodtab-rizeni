-- =====================================================================
-- Foodtab — potvrzení změny směny (acknowledgement)
--
-- Zadání: noční prompt „KOMUNIKACE, VZKAZY A NOTIFIKAČNÍ CENTRUM",
-- oddíl 10 a 12. Příklad ze zadání:
--
--   ZMĚNA SMĚNY
--   Pátek 18. září
--   Původně: 18:00–22:00
--   Nově:    16:00–22:00
--   [Potvrdit změnu]
--
-- Rozliší SENT/DELIVERED/READ/ACKNOWLEDGED — `notifications` už měla
-- READ (`read_at`), tahle migrace přidává ACKNOWLEDGED
-- (`acknowledged_at`). SENT/DELIVERED se nerozlišují zvlášť: zápis do
-- `notifications` je synchronní a ve stejné transakci jako událost
-- (viz app.upozornit_smenu), takže „sent" a „delivered" splývají —
-- řádek buď existuje, nebo neexistuje.
--
-- ---------------------------------------------------------------------
-- CO TATO MIGRACE NEŘEŠÍ
--
-- Zadání (oddíl 12) ukazuje i pohled VEDOUCÍHO — „Anna potvrzeno
-- 18:42, Petr čeká, Karel nedoručeno". Ten pohled potřebuje vědět, KTERÉ
-- notifikace patří ke KTERÉ směně napříč lidmi — a `notifications` dnes
-- nemá `shift_id`, jen `telo->>'den'` (datum, ne odkaz na řádek). Přidat
-- `shift_id` je další krok, ne tahle migrace — zůstává v hlášení jako
-- otevřený bod. Tahle migrace řeší jen stranu ZAMĚSTNANCE: potvrdit
-- vlastní změnu.
--
-- ---------------------------------------------------------------------
-- PROČ JEN smena.zmenena A smena.zrusena
--
-- Zadání příkladem mluví o ZMĚNĚ existující směny, ne o nové:
-- „Pokud někdo změní JIŽ EXISTUJÍCÍ směnu zaměstnance". Nová směna
-- (`smena.nova`) i odebraná (`smena.odebrana`, člověk už na ni
-- nepočítá) nejsou totéž jako „změnili vám něco, co jste čekali" —
-- potvrzení u nich nemá stejný smysl. Rozšířit lze později, ale ne bez
-- rozhodnutí, že se to má stejně.
-- =====================================================================

alter table public.notifications
  add column if not exists acknowledged_at timestamptz;

comment on column public.notifications.acknowledged_at is
  'Kdy zaměstnanec výslovně potvrdil, že o změně/zrušení směny ví '
  '(tlačítko „Potvrdit", ne jen otevření stránky). NULL = nepotvrzeno. '
  'Jen pro druh smena.zmenena a smena.zrusena — pravidlo, který druh '
  'potvrzení vyžaduje, je v lib/upozorneni-text.ts (vyzadujePotvrzeni), '
  'ne tady: potvrzování jde přes stejný přímý update jako read_at '
  '(politika notifications_update, viz 20260901130000), ne přes '
  'samostatný průzor.';
