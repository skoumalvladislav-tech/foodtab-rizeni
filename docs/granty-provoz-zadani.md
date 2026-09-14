# Zadání: odebrat `truncate` a granty pro `anon` na provozních tabulkách

Zadal Šéfík 14. 9. 2026 slovy „zadej tu opravu na relaci provoz",
poté co se to našlo při nasazení marketingu. Nález je popsaný
v `docs/hlaseni/stav-2026-09-14.md`, oddíl „Co jsem našel a neopravil".

**Tohle je zásah do oprávnění.** Platí pro něj všechno, co k tomu
říká `CLAUDE.md`: necommitovat půlku, nenasazovat, a nedá se skončit
uprostřed.

---

## Co se stalo

Při nasazení čtyř migrací marketingu do `foodtab-test` vyšlo najevo,
že nové tabulky mají plné granty pro `anon` i `authenticated`, ačkoli
jim to migrace nedaly. Dostaly je výchozími právy projektu Supabase.

Modul marketing je od té chvíle uklizený
(`20260914190000_marketing_granty_uklid2.sql`). **Provozní tabulky
ne** — a mají totéž.

---

## Co dnes nesedí

Měřeno v ostré databázi `foodtab-test` 14. 9. 2026. Čísla platí
k tomu dni; **ověř si je znovu**, mezitím mohla přibýt tabulka.

**51 provozních tabulek** v `public` (mimo `marketing_*`) má pro roli
`authenticated` grant `TRUNCATE`, `REFERENCES` a `TRIGGER`. Týchž
51 má granty i pro `anon`.

```sql
-- tohle si pusť jako první, dá to dnešní stav
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
   and table_name not like 'marketing%'
 group by 1,2 order by 1,2;
```

Jeden pohled (`relkind = 'v'`) má `TRUNCATE` taky. Na pohled ho
spustit nejde, takže je neškodný — ale ať tě nepřekvapí, že ti dotaz
vrátí 52 řádků a tabulek je 51. **Moje původní hlášení mluvilo o 52
tabulkách; byla to 51 tabulka a jeden pohled.**

### Proč `truncate` vadí doopravdy

**`truncate` se Row Level Security neřídí.** `delete` musí projít přes
politiku — `truncate` ne. Přihlášený člověk s tím grantem vysype
celou tabulku **napříč všemi firmami** a žádná politika ho nezastaví.

Je to jediná věc z celého nálezu, která není „jen chybějící druhá
linie". Tohle je otevřená cesta k nevratné ztrátě dat.

Ověřit se to dá takhle (v ostré databázi to **nepouštěj na tabulku,
o kterou stojíš** — pusť to na kopii nebo na čisté databázi z `run.sh`
s doplněnými granty):

```sql
set local role authenticated;
truncate public.shifts;   -- dnes projde. Po opravě má skončit na 42501.
```

### Proč vadí granty pro `anon`

Tady data neutekla a neutečou: ověřil jsem, že **žádná politika
v `public` necílí na roli `anon`** (0 z 0), takže RLS ji nepustí ani
na řádek. Je to chybějící první obranná linie, ne díra —
`CLAUDE.md`, pravidlo 3.

---

## Nejdřív `audit_log` — a proč je jiná než ostatních 50

Je mezi těmi 51 tabulkami, ale nepatří do řady. Neměnnost auditu
hlídají pravidla `audit_log_no_update` a `audit_log_no_delete` — jenže
**pravidla `truncate` nezachytí, RLS taky ne**, a grant `TRUNCATE`
na ní `authenticated` i `anon` mají (ověřeno 14. 9. odpoledne). Jedním
příkazem zmizí auditní stopa všech firem, včetně záznamu o tom, že
zmizela.

Takže:

- **`audit_log` dej do migrace jako první řádek** a v hlavičce ji
  jmenuj zvlášť.
- Odeber jí i `insert` a `update` pro obě role — do auditu píše jen
  `app.audit()` jako `security definer`, nikdo jiný. `delete` odeber
  taky; kaskáda při zániku firmy jde jinou cestou a grant na ni
  nepotřebuje. **Ověř to ale scénářem, který firmu opravdu založí
  a smaže** (`krok21` to umí), ne úvahou.
- `select` nech — obrazovka Nastavení audit čte a politika
  `audit_select` ho hlídá.

## Co udělat

### Krok 1 — ověř, že veřejné obrazovky na tabulky přímo nesahají

**Tohle udělej dřív než cokoli jiného.** Na tom celé zadání stojí:
kdyby nějaká veřejná obrazovka četla tabulku přímo anon klientem,
odebrání grantu ji položí chybou `42501` a spadne celá stránka, ne
jen ten dotaz.

Ověřil jsem to 14. 9. a vyšlo to dobře — Kiosek, Pozvánka i přihlášení
z QR jdou **výhradně přes `rpc(...)`**, tedy přes funkce, ne na
tabulky:

| Funkce | `security definer` | `anon` smí spustit |
|---|---|---|
| `kiosk_stav` | ano | ano |
| `kiosk_zalohy` | ano | ano |
| `pichnout_pinem` | ano | ano |
| `potvrdit_zalohu_pinem` | ano | ano |
| `pozvanka_info` | ano | ano |
| `registrovat_zarizeni` | ano | ano |
| `prijmout_moji_pozvanku` | ano | **ne** |
| `accept_invitation` | **ne** | **ne** |

`accept_invitation` je jediná, která `security definer` není. `anon`
na ni nemá `execute`, takže veřejné cesty se jí netýkají — **ale zjisti,
odkud se volá.** Buď je mrtvá (pak pryč, ale samostatným krokem,
ne v téhle migraci), nebo ji volá přihlášený a je potřeba vědět,
na které tabulky uvnitř sahá.

Zopakuj to měření sám, nespoléhej na tu tabulku výš:

```sql
select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
```

**Když najdeš veřejnou cestu, která sahá na tabulku přímo, na tu
jednu tabulku grant pro `anon` NEODEBÍREJ** — napiš to do hlášení
a nech ji být. Nepřepisuj kvůli tomu tu obrazovku na `rpc`, to je
samostatná práce.

### Krok 2 — migrace

Nová migrace v `supabase/migrations/`, razítko podle konvence.
Předloha je `20260914190000_marketing_granty_uklid2.sql` — okopíruj
z ní stavbu i způsob, jak je to vysvětlené.

Pro každou provozní tabulku:

```sql
revoke all on public.<tabulka> from anon;
revoke truncate, references, trigger on public.<tabulka> from authenticated;
```

**Vypiš tabulky jmenovitě, ne `all tables in schema public`.** Dva
důvody: hromadný příkaz by sáhl i na marketing (cizí modul) a hlavně
by v migraci nebylo vidět, čeho se to týkalo v den, kdy vznikla.

`select`, `insert`, `update` a `delete` nikde neruš — o těch pořád
rozhoduje RLS.

### Krok 3 — kontrola, která umí spadnout

Po vzoru `scripts/marketing-granty.test.mjs`. **Přečti si ho celý,
včetně hlavičky** — je tam vysvětlené, proč čte soubory migrací
a ne databázi, a to je pro tebe to podstatné.

Zopakuju to, protože je to nejdůležitější věc v tomhle zadání:
**kontrolu proti databázi nepiš.** Čistá databáze, kterou staví
`supabase/tests/run.sh`, výchozí práva Supabase nemá, takže by
kontrola „na tu tabulku není grant" procházela lokálně vždycky
a spadla až v ostré databázi. To je kontrola, která nemůže spadnout —
a ta je horší než žádná, protože se tváří jako důkaz.

Kontrola má:

- projít **všechny** tabulky zakládané v `supabase/migrations`, ne
  jmenovitý seznam. Jmenovitý seznam u příští tabulky selže přesně
  tak jako člověk — proto to vlastně celé vzniklo;
- ignorovat komentáře, aby se netrefila do vlastního vysvětlení;
- vynechat tabulky, které jiná migrace zase zahazuje;
- řešit provozní i marketingové tabulky, ať jsou kontroly dvě, nebo
  se ta stávající rozšíří. **Když ji rozšíříš, nesmí přestat platit
  pro marketing** — pusť si ji po úpravě a ať projde i na něm.

### Krok 4 — hlášení

Do `docs/hlaseni/`. Kolik tabulek, co se z toho nedalo (krok 1 může
něco vyloučit) a doslovný výpis kontroly.

---

## Co teď NEdělat

- **Nenasazuj.** `db push` ani nasucho. Nasazuje Šéfík — a u zásahu
  do oprávnění to platí dvojnásob.
- **Nesahej na `marketing_*`.** Je uklizené. Když tam najdeš chybu,
  ohlas ji.
- **Neměň výchozí práva projektu** (`alter default privileges`). Je to
  nastavení celé databáze, sahá i na cizí moduly a na roli
  `service_role`, kterou potřebují úlohy na serveru. Ta cesta vypadá
  jako elegantní řešení „jednou provždy" a právě proto ji tady
  zakazuju: rozbila by víc, než opraví.
- **Neruš granty `select/insert/update/delete`**, ani když ti u některé
  tabulky přijdou zbytečné. To je jiná práce a jiné riziko.
- **Nepřepisuj obrazovky z přímých dotazů na `rpc`**, kdyby krok 1
  nějakou takovou našel. Ohlas ji.

---

## Zkoušky

```bash
node scripts/scenare.test.mjs          # dají se soubory vůbec přečíst
node scripts/<nová-kontrola>.test.mjs
supabase/tests/run.sh                  # celá sada proti čisté databázi
```

**U každé nové kontroly rozbij schválně to, co má hlídat, a přesvědč
se, že spadne.** Napsat kontrolu a nechat ji projít neznamená nic.

U téhle to znamená aspoň tohle, a každé zvlášť:

1. nová tabulka bez `revoke` → musí spadnout,
2. `revoke` schovaný v řádkovém komentáři (`--`) → musí spadnout,
3. totéž v blokovém (`/* */`) → musí spadnout,
4. chybějící `revoke` od `anon` u jedné konkrétní tabulky → musí spadnout,
5. chybějící `revoke truncate` u jedné konkrétní tabulky → musí spadnout,
6. `revoke` od jiné role (`service_role`) místo od `anon` → musí spadnout,
7. **a po vrácení všech souborů zpátky musí zase projít** — jinak jsi
   jen rozbil kontrolu, ne ověřil ji.

Když hlásíš, kolik kontrol prošlo, **řekni z čeho to číslo je.**

`krok31_scenar.sql` padá už teď a není to tímhle: přepsaný komentář
u `zapomenute_odchody` po migraci z 13. 9. Je to tvůj modul, takže
si ho můžeš vzít — ale samostatně, ne v téhle migraci.

---

## Pořadí a kde se dá skončit

Kroky jdou za sebou a **skončit se dá jen po celém kroku 3.**

Migrace bez kontroly znamená, že se to potřetí stane zase — už podruhé
se to stalo navzdory pravidlu, které bylo napsané. Kontrola bez
migrace zase hlásí červenou nad kódem, se kterým se nic nedělá, a na
tu si lidi zvyknou.

Krok 1 sám o sobě odevzdatelný je: když z něj vyjde, že nějaká veřejná
obrazovka sahá na tabulku přímo, **zastav se a napiš to.** To je nález,
který mění zadání, ne překážka, kterou máš obejít.
