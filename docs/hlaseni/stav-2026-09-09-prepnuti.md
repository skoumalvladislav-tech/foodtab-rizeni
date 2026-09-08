# Přepnutí oprávnění z rolí na zařazení — hotovo

Psáno 9. 9. 2026. Navazuje na `docs/zarazeni-misto-roli.md`,
`docs/zarazeni-misto-roli-nalezy.md` (hlavně oddíl 7b),
`docs/prepnuti-mereni-2026-09-08.md` a
`docs/zarazeni-cisla-z-ostre-databaze.md`.

**Přepnutí je celé.** Nikde v aplikaci ani v databázi už o přístupu
nerozhoduje role. Slito do `main`.

**Nasazeno není.** `supabase db push` jsem nespouštěl ani nasucho —
nasazuješ Ty, na svůj pokyn.

---

## 1. Co je hotové

### Migrace `20260909100000_zarazeni_jadro.sql`

Jedna migrace, protože se to nedá přepnout po polovinách. Navazuje na
`20260908090000` (tabulky a převod dat, nasazená 8. 9.), která schválně
nic nepřepínala.

**Jádro.** `app.has_permission` a `app.has_access` přestaly chodit přes
`memberships → roles → role_permissions` a chodí přes
`employees → position_permissions + employee_permissions + je_majitel`.

Skládací pravidlo — *výjimka u člověka rozhoduje, jinak zařazení,
majitel dostává vše* — je na jednom místě v `app.ma_pravo_clovek`.
Opisovalo se ve třech dalších funkcích a počtvrté by se rozešlo, a to
tiše.

**Beze změny zůstalo:** signatura `(uuid, text, uuid)`, `security
definer`, `set search_path = ''`, modulová brána (a je AŽ ZA NÍ větev
majitele — majitel dostává vše z *aktivních* modulů, ne vše vůbec)
a celý blok rozsahu. Rozsah se touhle změnou nedotýká vůbec: zůstává
na členství.

### Jedenáct opsaných kopií mimo `has_access`

Nálezy jich vyjmenovaly devět. Našly se dvě další — a obě až prací, ne
výčtem:

| funkce | jak se našla | co by dělala |
|---|---|---|
| `app.is_owner` | `20260823120200_authz.sql:33` | tvrdila by, že majitel není majitel |
| `app.upozorni_na_prijeti` | spadl na ní `krok12_scenar` | každý nový člověk by se hlásil jako „čeká na oprávnění", i ten, komu zařazení dává všechno |

Zbylých devět podle nálezů: `kdo_ma_pravo`,
`kdo_ma_pravo_na_pobocce`, `adresati_vzkazu`, `smi_pridelit`
+ `ziva_prava_role`, citlivá SMS v `create_invitation`,
`pocet_majitelu`, `my_tenants`, `create_tenant`,
`upozorni_na_clenstvi`.

**Ta druhá nalezená kopie je to podstatné na tomhle řádku.** Výčet
z nálezů byl poctivý a stejně nebyl úplný. Poznalo se to jen tím, že
scénáře opravdu běžely.

### Strop „nikdo nepřidělí víc, než má sám"

Tohle bylo z celého přepnutí nejtišší místo. `app.smi_pridelit`
dostávala `role_id`; po přepnutí by jí do něj chodilo prázdno,
`ziva_prava_role` by nevrátila nic, `not exists (…)` by bylo pravda
a **prošlo by všechno.** Pět politik by přestalo chránit a nic by
nespadlo.

Strop teď platí na **čtyřech** místech místo dvou (zadání 5.5 chce
„na obojí"):

| kde | čím se hlídá |
|---|---|
| práva zařazení (`position_permissions`) | politika |
| osobní výjimky (`employee_permissions`), jen `granted = true` | politika |
| přeřazení člověka pod jiné zařazení (`employees.position_id`) | spoušť `trg_strop_zarazeni` |
| rozsah členství | politiky přes `app.smi_pridelit_cloveku` |

**Odebrání se nehlídá nikde.** Kdo právo bere, nikoho nepovyšuje — je
to totéž rozdělení, jaké má dnes `memberships_delete`.

Třetí řádek té tabulky je díra, kterou **otevírá samo přepnutí**:
`employees_write` pouští celý řádek každému, kdo má `people.manage`,
a `position_id` od téhle chvíle nese oprávnění. Bez zábrany by si
vedoucí směny přeřadil sám sebe pod Provozního. Totéž `je_majitel` —
nový sloupec téže tabulky.

### Aplikační vrstva

`my_context` přestala vracet klíč `role` a vrací **`zarazeni`
a `jeMajitel`**. Jsou to dvě různé věci a slepené do jedné by lhaly:
majitel nemusí mít žádné zařazení a zařazení „Majitel/ka" z nikoho
majitele nedělá.

Tři přesměrování se ptala `if (!ctx.role)`. Po přepnutí by to byla
špatná otázka dvakrát — **majitel bez zařazení by skončil natrvalo na
stránce „nikdo vám nepřidělil oprávnění"**, a není to smyčka, je to
slepá ulice. Ptá se proto `maOpravneni()`: má ten člověk aspoň jedno
právo?

Dál: obrazovka **Oprávnění** čte `positions` a `position_permissions`
(a u každého zařazení je vidět, **kolika lidí** se změna týká — mění
se hned všem a nic se nepotvrzuje), počítání majitele v **Lidech** se
bere z `employees.je_majitel`, **obě** hlášky „nejdřív mu pošlete
pozvánku" jsou pryč, pozvánka přestala nést roli a v nabídce se
„Pozice" jmenuje **Zařazení**.

**Panel oprávnění se přestal schovávat za členství.** Zůstává za ním
už jen ROZSAH — a je u něj napsané proč. Zařazení jde nastavit
i člověku bez účtu: uloží se a začne platit, jakmile se přihlásí
(zadání, oddíl 3).

---

## 2. Kolik kontrol prošlo A Z ČEHO

**1002 kontrol** z `node scripts/scenare-pglite.mjs` — všech 33
scénářů, žádný nespadl. Před tímhle úkolem jich bylo **959** z 32
scénářů.

```
etapa0 39 · krok2 25 · krok3 56 · krok4 64 · krok5 41 · krok6 62
krok7 44 · krok8 54 · krok9 22 · krok10 21 · krok11 32 · krok12 25
krok13 26 · krok14 15 · krok15 17 · krok16 11 · krok17 29 · krok19 32
krok20 35 · krok21 26 · krok22 39 · krok23 25 · krok24 63 · krok25 26
krok26 19 · krok27 27 · krok28 19 · krok29 19 · krok30 16 · krok31 8
krok32 7 · krok33 38 · marketing1 20
```

Dál prošlo: `node scripts/scenare.test.mjs` (všechno jde přečíst),
`npx.cmd tsc --noEmit`, `npm.cmd run build`,
`scripts/prideleni.test.mjs`, `tabulka`, `xlsx`, `nahrani-lidi`, `cas`
a `barvy.js`.

### A co to číslo NEZNAMENÁ

**PGlite běží jako superuživatel.** RLS ani sloupcové granty se tam
neuplatní. Je to důkaz, že SQL jde spustit a že logika sedí — **ne že
je hotovo.** Konkrétně:

- kontroly, které stojí na POLITICE, tam projdou i nad rozbitou
  politikou. V `krok33_scenar` je to napsané u každé takové;
- **aplikaci jsem neviděl vykreslenou.** Není kde: přepnutí nikde
  nasazené není a `foodtab-test` má pořád starou podobu `my_context`,
  takže by se aplikace proti němu chovala podle *starého* modelu
  a nic by to nedoložilo. Zelený build není důkaz, že se něco
  vykresluje správně.

**Rozhoduje běh proti opravdovému PostgreSQL** (zadání, oddíl 10).

---

## 3. Oddíl 7b: tři filtry, tři kontroly, tři rozbití

Uvnitř `security definer` funkce vlastněné rolí s `rolbypassrls` se RLS
neuplatní **vůbec**. Druhá obranná linie tam není, takže si tělo musí
odfiltrovat všechno samo:

```
e.tenant_id = p_tenant     jinak právo z CIZÍ FIRMY
e.deleted_at is null       jinak práva označeného smazaného
m.status = 'active'        jinak práva zrušeného členství
```

Na každý míří **vlastní** kontrola v `krok33_scenar`. Každou jsem
schválně rozbil zvlášť — vyndal jeden filtr, pustil celou sadu, vrátil:

| vyndáno | spadla | kontrol prošlo |
|---|---|---|
| `e.tenant_id = p_tenant` | 7b/1 — právo z cizí firmy se do téhle nepřenese | 978 |
| `e.deleted_at is null` | 7b/2 — označený smazaný nemá nic | 981 |
| `m.status = 'active'` | 7b/3 — zrušené členství práva nedává | 983 |

Pokaždé spadla **právě ta jedna**, která na ten filtr míří, a žádná
jiná.

### A při tom se ukázalo tohle

**Filtr na firmu šel rozbít jen v pomocné funkci. V jádře ne.**

Návrh z měření vázal zaměstnance na firmu **dvakrát**: joinem
`e.tenant_id = m.tenant_id` a k tomu podmínkou `e.tenant_id = p_tenant`
napsanou přímo. Měření to samo označilo za „formálně nadbytečné, ale
levnější než mlčení".

Jenže tím se z toho filtru stala podmínka, **kterou nejde shodit**:
vyndá se a nic se nezmění, protože ho drží ta druhá. Kontrola s cizí
firmou by zůstala zelená, ať je v těle napsané cokoli — a to je přesně
ta kontrola, která se tváří jako důkaz a žádný není.

Opravil jsem to obráceně, než měření navrhovalo: zaměstnanec se váže na
firmu **jednou**, přímo přes `p_tenant`. Členství taky jednou, přes
`m.tenant_id = p_tenant`. Obě podmínky teď něco drží a obě jdou shodit
zvlášť.

---

## 4. Herci ve scénářích

Sdílený provozní `7777…` vzniká v `krok4_scenar` jako `auth.users`
+ `memberships` **bez** záznamu v `employees` a používají ho krok5, 7,
8, 9, 10 i marketing1. Po přepnutí by přišel o všechno — a jeho
tvrzení („provozní zálohy vyplácí") by spadla ne proto, že je něco
rozbité, ale **proto, že herec zmizel.**

Doplnil jsem `employees` řádek se zařazením, které odpovídá dnešní
roli, jemu i hercům v krok3, 6, 7, 9, 10, 12, 24, 27 a marketing1.
Zařazení nesou tatáž práva jako role — obojí vzniká ze stejné šablony.

**Tvrzení se nepřepisovala** (až na ta, která mířila přímo na role).

### Kontroly, které přestaly měřit — a co s nimi

Nálezy varovaly, že nebezpečnější než kontroly, které spadnou, jsou ty,
které zůstanou zelené a přestanou měřit. Dvě takové jsem našel a obě
otočil:

- **`krok30`: „o přístupu zatím pořád rozhodují role".** Ta kontrola
  měla přinutit toho, kdo přepne jádro, aby se podíval do nálezů.
  **Splnila to.** Od 9. 9. hlídá opačný směr — že se to nevrátí: kdyby
  někdo `has_permission` přepsal zpátky, přístup by se řídil tabulkou,
  kterou už nikdo neudržuje, a nic by nespadlo.
- **`krok30`: „a nikdo na ně přiřazený není"** (zařazení z role bez
  členů). Od chvíle, kdy krok4 to zařazení používá jako cíl stropu,
  tam jeden člověk je. Ověřuje se pořád totéž — *převod nikomu nemění
  zařazení* —, ale číslo se změří před převodem, ne předpokládá.

### A jedna oprava, která procházela náhodou

Hlídač posledního majitele odmítal smazání celé firmy. **Dosud to
procházelo shodou okolností:** stará podoba hledala `roles.is_owner`
a při kaskádě už role smazané byly, takže vyšla NULL a hlídač se
vrátil dřív. Nová podoba se ptá zaměstnance, a ten při mazání firmy
ještě existovat může. Podmínka „když mizí celá firma, nehlídej" je
proto napsaná nahlas.

---

## 5. Na co jsem narazil

**Cesta ven z majitelství, která dřív neexistovala.** Dokud majitel
visel na roli, nešlo mu majitelství odebrat jinak než přeřazením. Teď
je to sloupec — jeden `update employees set je_majitel = false` by
firmu nechal bez majitele. `krok9` na to má vlastní kontrolu.

**`app.pocet_majitelu` počítá jen ty, kdo se dokážou přihlásit** —
živý zaměstnanec s `je_majitel` a aktivním členstvím. Bez členství
`has_permission` nepustí ani majitele, takže „firma má majitele" by
byla nepravda: měla by ho v tabulce a nikoho, kdo se dostane dovnitř.
Je to opatrnější strana — odebrání se spíš odmítne, než aby firma
zůstala zamčená.

**Nová firma by vznikla bez majitele a bez jediného zařazení.**
`app.create_tenant` teď zakladateli nastaví `je_majitel` a ze šablon
rolí vyrobí i **zařazení** s týmiž právy — je jich šest, ne sedm:
z majitelské šablony se zařazení nedělá.

**Do marketingu jsem sáhl**, a je to porušení pravidla „do cizího
modulu nesahej". `marketing1_scenar` má vlastního herce s rolí
`marketing_editor`; bez zařazení by po přepnutí neměl jediné právo
a scénář by spadl. Změnil jsem **jen přípravu toho herce**, žádné
tvrzení. Kdo marketing píše, ať se na to podívá.

---

## 6. Co zbývá — a proč to nebrání nasazení

Nálezy (oddíl 7) rozdělily práci na „odložit jde" a „odložit nejde".
Všechno z druhé skupiny je hotové. Ze skupiny „odložit jde" zbývá:

1. **Sloučit obrazovky Zařazení + Oprávnění do jedné** (zadání 6.1).
   Je to ergonomie, ne správnost. Obrazovka Oprávnění nad **rolemi**
   stát nezůstala — to bylo to podstatné a je to přepsané.
2. **Zaškrtávátka výjimek ve formuláři zaměstnance** (zadání 6.2).
   Tabulka `employee_permissions` je hotová a jádro ji čte; ruční
   zadávání na obrazovce zatím není. Výjimka se dnes zadá jen zápisem
   do databáze.
3. **`positions.usek_id` místo `department`** (zadání, oddíl 7). Sám si
   říká o volitelnost.
4. **Tři otázky pro Tebe** — 8, 9 a 10 v `docs/hlaseni/otazky.md`.
   Všechny mají v kódu `-- ROZHODNOUT:` a u všech jsem vybral tu
   opatrnější variantu.

---

## 7. Než to nasadíš

**Dvanáct zařazení a některá vypadají jako dvojí pojmenování téhož** —
platí to, co stálo v `docs/zarazeni-cisla-z-ostre-databaze.md`, oddíl 4:
**Barman** *(neaktivní, 2 lidé)* vedle **Bar**, **Číšník**
*(neaktivní)*, **Číšník/servírka** a **Servis**, a **Majitel/ka** vedle
příznaku majitele. **Neslučoval jsem to** — které je které, víš jen Ty,
a sloučit dvě zařazení znamená rozhodnout, kdo bude mít jaká práva.

**Dotazy z `docs/prepnuti-mereni-2026-09-08.md`, oddíl 1, se musí
pustit znovu těsně před nasazením.** Čísla z 8. 9. nejsou záruka: mezi
měřením a nasazením může kdokoli přijmout pozvánku. Rozhoduje hlavně
1.1 — **má každé aktivní členství svůj zaměstnanecký záznam?** Když
vrátí byť jeden řádek, přepnutí se odkládá: ten člověk by se přihlásil
do prázdné aplikace a nic by to neohlásilo.

**A jedna věc musí zaznít nahlas, aby při ostrém testu nevypadala jako
chyba:** kdo má členství **bez role**, dnes nemá žádné právo (vnitřní
join na `roles` mu nevrátí nic). Po přepnutí dostane to, co mu dává
zařazení. Je to **záměr** — je to celý smysl pozvánky bez role. K 8. 9.
byla taková **jedna otevřená pozvánka ze tří.**
