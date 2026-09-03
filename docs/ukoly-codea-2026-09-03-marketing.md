# Úkoly pro Codea — 3. 9. 2026, modul Marketing

Zadání je schválené (`docs/marketing-zadani.md`) a první krok podle
oddílu 7 je napsaný, ale **nic z toho není nasazené ani odzkoušené** —
psal jsem to přes vzdálený přístup k souborům, bez shellu na tomhle
počítači. Přesně proto to teď patří tobě.

Tři nové/upravené soubory:

- `supabase/migrations/20260903040000_marketing_tabulky.sql` — pět
  tabulek (`marketing_settings`, `marketing_integrations`,
  `marketing_photos`, `marketing_templates`, `marketing_posts`),
  `tenant_id` + RLS na každé. Modul a tři oprávnění (`marketing.read/
  manage/publish`) už existovaly, tahle migrace jim jen staví tabulky.
- `app/[rozsah]/marketing/page.tsx` — prázdná obrazovka podle vzoru
  `menu/page.tsx`. `nabidka.ts` má záložku přepnutou na `hotovo: true`.
- `supabase/tests/krok18_scenar.sql`, přidaný i do `run.sh`.

---

## 1. Nasadit a ověřit migraci

- `supabase db push`.
- `supabase migration list` — ověřit, že `20260903040000` je na obou
  stranách, stejně jako se to dělalo u předchozích kroků.

## 2. Spustit testy

`supabase/tests/run.sh` — hlavně `krok18_scenar`, ale spusť to celé,
ať se nic starého nerozbilo. Nejdůležitější kontrola v novém scénáři:
že **`marketing.manage` samo o sobě nesmí posunout příspěvek do
`publikovano`** — to hlídá spoušť `app.strez_prechod_marketing_postu`,
ne aplikace. Kdyby tahle kontrola spadla, je to vážné — znamenalo by
to, že jde publikovat bez `marketing.publish`.

Napsal jsem ten scénář bez možnosti si ho sám spustit proti databázi,
takže není vyloučené, že narazíš na drobnost (chybějící sloupec,
špatný název funkce). Klidně oprav a napiš mi, co bylo špatně, ať to
mám i v zadání.

## 3. Zkontrolovat naostro na Černé Perle

Až migrace projde:

- Zapnout modul `marketing` pro tenanta Černé Perly (řádek do
  `tenant_modules`, stejně jako se to dělalo u `menu`).
- Ověřit, že se v horní liště objeví záložka Marketing a vede na
  hlášku „Připravujeme" — a že bez zapnutého modulu / bez
  `marketing.read` appka místo toho ukáže „Marketing není zapnutý".

---

## Co zatím NEDĚLAT

Skutečné navrhování příspěvků, napojení na Bannerbear/render a REST
API pro n8n (oddíl 5 a bod 7, krok 4 zadání) jsou samostatný, pozdější
krok — čekají, až tenhle základ projde testem a naostro.
