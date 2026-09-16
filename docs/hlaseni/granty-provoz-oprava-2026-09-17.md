# Hlášení: úklid grantů na provozních tabulkách (TRUNCATE, anon)

Zadání: `docs/granty-provoz-zadani.md` (Šéfík, 14. 9. 2026). Relace Provoz,
17. 9. 2026, v noci.

## Krok 1 — ověření, že žádná veřejná obrazovka nesahá na tabulku přímo

Zopakováno přímým dotazem do `foodtab-test` (17. 9. 2026, ne spoléháno na
číslo z 14. 9.):

```sql
select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
```

Výsledek: **9 funkcí smí spustit `anon`, všech 9 je `security definer`**:
`kiosk_stav`, `kiosk_zalohy`, `kiosk_zpravy_pinem`, `kiosk_zpravy_pocet`,
`marketing_prejit`, `pichnout_pinem`, `potvrdit_zalohu_pinem`,
`pozvanka_info`, `registrovat_zarizeni`. Žádná veřejná cesta nesahá na
tabulku přímo — bezpečné pokračovat krokem 2.

(Přibyly `kiosk_zpravy_pinem`/`kiosk_zpravy_pocet` a `marketing_prejit`
oproti nálezu z 14. 9. — obojí `security definer`, nález se tím nemění.)

## Krok 2 — migrace

`supabase/migrations/20260917000000_granty_provoz_uklid.sql`.

- **52 tabulek/pohledů** (měřeno živě, `foodtab-test`, 17. 9. 2026):
  `revoke all … from anon` + `revoke truncate, references, trigger …
  from authenticated`. Jmenovitě, ne `all tables in schema public`.
- **`audit_log` zvlášť**: `revoke insert, update, delete, truncate,
  references, trigger … from anon, authenticated` — do auditu píše jen
  `app.audit()`. `select` zůstává (obrazovka Nastavení → Audit).
- `select/insert/update/delete` se u ostatních 51 NIKDE neruší — o tom
  rozhoduje RLS.
- `marketing_*` nedotčeno (uklizeno samostatně, jiná migrace).
- `zapomenute_odchody` a `employee_rates` už byly uklizené od svých
  vlastních migrací (`20260902080000`, `20260831010000`) — v nové
  migraci se pro ně nic nepíše, kontrola je i tak hlídá (viz krok 3).

## Krok 3 — kontrola

`scripts/provoz-granty.test.mjs`, nová, po vzoru
`scripts/marketing-granty.test.mjs`. Prochází **všechny** tabulky
a pohledy založené v `supabase/migrations`, které nezačínají na
`marketing_` a nebyly zahozené — ne jmenovaný seznam (regex nad textem
migrací, ne dotaz do databáze — stejný důvod jako u marketingu: čistá
testovací databáze výchozí práva Supabase nemá).

**Výsledek: 116 kontrol, VŠECHNY KONTROLY PROŠLY.** `scripts/marketing-
granty.test.mjs` (27 kontrol) beze změny a dál prochází.

### Sabotážní testy — 6 podle zadání, každý zvlášť ověřen a vrácen

1. Nová tabulka bez `revoke` → **spadlo** (2 kontroly).
2. `revoke` schovaný v řádkovém komentáři (`--`) → **spadlo**.
3. Totéž v blokovém komentáři (`/* */`) → **spadlo**.
4. Chybějící `revoke` od `anon` u jedné tabulky → **spadlo**.
5. Chybějící `revoke truncate` u jedné tabulky → **spadlo** (viz níž —
   napoprvé NEspadlo, byl to skutečný nález).
6. `revoke` od jiné role (`service_role` místo `anon`) → **spadlo**.
7. Po vrácení všech souborů zpátky → **prošlo znovu** (ověřeno po každém
   kroku zvlášť, ne až na konci).

### Skutečný nález cestou — regex mohl přeskočit hranici příkazu

Sabotáž č. 5 napoprvé **neselhala**, i když chybějící řádek byl
prokazatelně pryč ze souboru (ověřeno `before/after` na řetězci).
Kontrola „employees odebírá truncate roli authenticated" hlásila OK.

Příčina: `[\s\S]*?` mezi `revoke` a `on public.<tabulka>` nic nebránilo
přeskočit přes `;` — konec SQL příkazu. Regex tak od jednoho `revoke`
(kdekoli v souborech) doběhl až k `on public.employees … from …`
o desítky souborů dál a zabral do zachyceného textu privilegií i rolí
obrovský kus nesouvisejícího SQL, ve kterém se slovo `truncate`
i `authenticated` prostě někde vyskytovalo. Kontrola, která „projde
vždycky", protože splyne s cizím příkazem — přesně to, před čím
CLAUDE.md varuje.

Oprava: `[^;]` místo `[\s\S]` — zápas nemůže přejít přes hranici
příkazu. Po opravě sabotáž 5 selhala správně a všech 6 prošlo znovu od
začátku (viz výš). **`scripts/marketing-granty.test.mjs` má stejný
tvar regexu a nejspíš stejnou chybu** — nefixoval jsem ho (cizí modul,
CLAUDE.md „Dvě relace"), jen nahlašuji. Zatím neselhal naostro
pravděpodobně proto, že jména `marketing_*` tabulek jsou dost
specifická, aby náhodná shoda o desítky souborů dál byla nepravděpodobná
— ale je to shoda okolností, ne pojistka.

## Co teď NEudělal (podle zadání)

- **Nenasazeno.** `db push` nespuštěn, ani nasucho.
- `marketing_*` nedotčeno.
- `select/insert/update/delete` nikde nezrušeno.
- `alter default privileges` nezměněno.
- Žádná obrazovka nepřepsána na `rpc` (krok 1 nenašel důvod).

## Zbývá

- Spustit `supabase/tests/run.sh` (přes CI, ne lokálně — na tomhle stroji
  není `docker`/`psql`) proti skutečné čisté databázi se všemi migracemi
  — ověřit, že migrace 20260917000000 projde bez syntaktické chyby a nic
  nerozbije. **Šéfík: nasadit až po zelené CI.**
