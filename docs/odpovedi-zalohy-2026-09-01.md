# Odpovědi a nálezy z běhu proti PostgreSQL — večer 1. 9. 2026

Pustil jsem `supabase/tests/run.sh` proti **opravdovému PostgreSQL 16**
se všemi 38 migracemi včetně tvých tří nenasazených.

**382 kontrol, všechny procházejí** — ale až po čtyřech opravách.
Jedna z nich je skutečná chyba v migraci, ne v testu.

---

## 1. Chyba v migraci: záloha by spadla u každé firmy bez nastavení

`app.nastaveni()` skládá náhradní řádek **podle pořadí sloupců**:

```sql
(p_tenant, 'odecitat', null, now(), null)::public.tenant_settings
```

Pět hodnot. Jenže migrace `230000` přidala do `tenant_settings` šestý
sloupec `ranni_email_kdy` — a od té chvíle to skončí na

```
ERROR: cannot cast type record to public.tenant_settings
DETAIL: Input has too few columns.
```

**Dopad není teoretický.** `vyplatit_zalohu` se na `app.nastaveni`
ptá na horní mez, takže **první záloha u firmy, která si nastavení
ještě neuložila, spadne.** To je každá firma hned po založení — tedy
i každý nový zákazník.

V PGlite to nevyšlo najevo proto, že sis nastavení nejdřív uložil;
kontrola šla po šťastné cestě, kde už řádek existuje.

Opravil jsem to skládáním **podle jmen**, které přežije i další sloupec:

```sql
jsonb_populate_record(
  null::public.tenant_settings,
  jsonb_build_object('tenant_id', p_tenant,
                     'zalohy_zobrazeni', 'odecitat',
                     'updated_at', now())
)
```

Migrace `220000` **není nasazená**, takže jsem ji opravil rovnou v ní.
Máš ji v repozitáři.

> Stojí to za zapamatování: `(a,b,c)::tabulka` je časovaná nálož.
> Funguje, dokud někdo nepřidá sloupec — a pak spadne jinde, než kde
> je příčina.

---

## 2. Tři opravy v testech

- **`krok3`** — katalog oprávnění neznal `advances.manage`. Kontrola
  udělala přesně to, k čemu je: řekla, že přibylo oprávnění a seznam
  se nedoplnil. (V `lib/authz.ts` ho máš správně, ověřeno.)
- **`krok8`, příprava** — `vytvorit_registracni_kod` volané „pod
  superuživatelem" **kontrolu neobchází**. Ptá se `app.has_access`,
  a ta čte člověka z `test.user_id`, ne z databázové role. Zbyl tam
  člověk z předchozího scénáře a funkce skončila hláškou. Doplnil jsem
  `set_config('test.user_id', …)` na majitele.
- **`krok8`, oddělovač tisíců** — kontrola `not like '%,%'` padala na
  **správně** poskládaném textu: ta věta má čárku i jako interpunkci
  („Odpracováno zatím 0 Kč, po téhle záloze…"). Teď se ptá na to, oč
  jde: `~ '\d \d{3}'` a `!~ '\d,\d'`.

Tvoje `app.koruny` je v pořádku — `900 000 Kč`, mezera, ne čárka.
Ta chyba s `to_char(… 'G')`, kterou jsi našel, byla skutečná a nález
dobrý.

---

## 3. Odpovědi na tvé dvě otázky

### Testovací firma neexistuje — moje chyba ve formulaci

Napsal jsem „na zkoušení je testovací firma" a žádná není. Tenhle účet
patří do jediné firmy a nic jako pískoviště v databázi nemáme.

**Zakládat ji nebudeme.** Zápisové cesty se neověřují klikáním
v aplikaci, ale **kontrolou ve scénáři** — ta si data založí sama,
proběhne pod rolí `authenticated` a nezůstane po ní nic. Přesně proto
tam vydání zálohy, potvrzení PINem i přidělení oprávnění patří.

Takže: **co se nedá ověřit bez zápisu, napiš jako kontrolu do scénáře.
Pouštět ho budu já.** Že u tebe není psql, nevadí; jen z toho neplyne,
že je věc ověřená, když prošla kontrola čitelnosti.

### Strop na pobočku zůstává nedosažitelný — schválně

Rozhodl Šéfík: **rozsah smí přidělit jen správce lidí za celou firmu.**
Je to přísnější, než pravidlo 4 žádá, a u dvou provozoven to nikomu
nevadí — dělá to on sám.

Zapiš to do `docs/pravidlo-neprideluj-vic.md` jako **vědomé rozhodnutí**,
ať se to příště nespraví jako domnělá chyba. Až budou provozovny tři
a víc, otevře se to znovu — a bude to změna bezpečnostní politiky
s vlastními kontrolami, ne úprava mimochodem.

---

## 4. Co dál

Migrace `210000`, `220000` (opravená) a `230000` jsou **připravené
k nasazení** — projely proti čisté databázi.

Ranní e-mail zůstává neodeslatelný, dokud v prostředí nebude
`RESEND_API_KEY`. To je na Šéfíkovi.
