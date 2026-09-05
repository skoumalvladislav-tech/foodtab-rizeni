# Jak zrychlit naši práci

Sepsáno 5. 9. 2026 na Šéfíkovu otázku, proč je postup pomalý a co s tím.

Nejdřív poctivě: **zdržuje nás pět věcí a ani jedna z nich není
„chybí nám AI agent".** Řadím je podle toho, kolik času každá bere.

---

## 1. Šéfík je drát mezi mnou a Codem

Dnešní cesta jednoho dokumentu:

```
já napíšu  →  soubor se pošle Šéfíkovi  →  Šéfík ho commitne
           →  Šéfík ho pushne  →  Code si ho přečte
```

A zpátky totéž: Code napíše hlášení do chatu → Šéfík ho zkopíruje →
vloží mně. **Každý přenos čeká, až bude Šéfík u počítače.** To je
dneska největší zdržení ze všech a nemá to nic společného s tím, jak
rychle kdo z nás pracuje.

### Oprava A — dát téhle relaci přístup do repozitáře

Já dnes umím z repozitáře **číst** (`git fetch` chodí), ale ne do něj
**psát**: proxy odmítá vydat přihlašovací údaj s hláškou *„not in this
session's authorized repository set"*.

Dvě místa, kde se to spraví:

1. Na [claude.ai/code](https://claude.ai/code) je pod polem pro zprávu
   **výběr repozitáře**. `foodtab-rizeni` v něm musí být vybraný —
   relace má přístup jen k tomu, co je v něm zaškrtnuté.
2. Na GitHubu **Settings → Applications → Claude → Configure** ověřit,
   že je `foodtab-rizeni` mezi povolenými repozitáři.

Až to půjde, odpadne z každého dokumentu půlka cesty: napíšu, commitnu,
pushnu, Code si to přečte. Šéfík se o tom dozví, ale nemusí u toho být.

*(Nevím jistě, jestli to jde doplnit do už běžící úlohy, nebo se musí
založit nová s tím repozitářem vybraným. Zkus první variantu; když se
to tam nedá přepnout, poznáme to hned.)*

### Oprava B — Code píše hlášení do repozitáře, ne do chatu

Místo dlouhého textu do chatu ať Code zapíše
`docs/hlaseni/RRRR-MM-DD-tema.md` a pushne ho. Já si ho přečtu z gitu
**spolu s kódem, kterého se týká** — což je mimochodem ta hlavní věc,
která dnes chybí. Dnešní hlášení o hlavičce jsem četl jako slova,
protože v `main` po `0dd88b8` z té práce nebylo nic.

Šéfík tím přestane být kurýr v obou směrech.

---

## 2. Zelené CI, které nic neznamená

Workflow **Databáze** má běžet při každém pushi a pustit celou zkoušku
proti opravdovému PostgreSQL. Dnes je červené — ale kvůli něčemu
jinému: `marketing1_scenar.sql` z druhé relace neexistuje pod tím
jménem. Takže se na tu červenou nikdo nedívá.

Křížek, na který se nikdo nedívá, je horší než žádný: tváří se jako
hlídač.

**Co s tím:**

1. Marketingová relace přejmenuje `krok18_scenar.sql` na
   `marketing1_scenar.sql` (pravidlo 3 z „Dvě relace v jednom
   repozitáři"). Jeden příkaz.
2. Do téhož workflow přidat to, co už v repozitáři leží a dnes se pouští
   ručně, když si někdo vzpomene:

   ```yaml
   - run: node scripts/scenare.test.mjs
   - run: node scripts/barvy.js
   - run: node --experimental-strip-types scripts/cas.test.mjs
   - run: node --experimental-strip-types scripts/rozpis.test.mjs
   # a zbytek scripts/*.test.mjs
   ```

Tím se zadarmo získá tohle: **Code už nemůže ohlásit číslo z PGlite
jako pravdu.** Buď je zelená z opravdové databáze, nebo není. Přestanu
kvůli tomu pouštět zkoušku ručně u sebe a Šéfík přestane věřit číslu,
které nikdo neviděl vzniknout.

---

## 3. Chyby se nacházejí v ostrém provozu

Mobilní lišta, přetečení do strany, dvojí příchod — všechno se našlo
až na nasazené aplikaci, ve které pracují lidé.

Chybí **náhled na větev**: Vercel umí ke každé větvi vyrobit vlastní
adresu. Pak se obrazovka zkontroluje, **než** se slije do `main`.

Jenže tady je past, kterou je potřeba vyřešit dřív: **ostrá data leží
v projektu `foodtab-test`.** Náhled by na ně sahal taky, a to je
horší než pomalý postup.

Takže v tomhle pořadí:

1. Založit **`foodtab-prod`** a přestěhovat do něj ostrý provoz.
   `foodtab-test` se stane tím, čím se jmenuje. (Je to už na seznamu
   „před ostrým provozem" v `CLAUDE.md`, jen se to odkládá.)
2. Náhledy na větvích ať míří na **test**, nikdy na prod.

Tohle je zdaleka nejdůležitější bod celého dokumentu a chci, aby bylo
jasné proč: **jsme pomalí hlavně proto, že je každý krok nebezpečný.**
Code se musí ptát před každou migrací, já nesmím píchnout ani zkušební
příchod, Šéfík nasazuje ručně. Jakmile bude existovat prostředí, kde se
smí rozbíjet, zrychlí se všechno ostatní samo.

---

## 4. Špatné nastavení mlčí

Proměnná `cron_secret` má být `CRON_SECRET`. Aplikace na to odpovídala
401 od 4. 9. a **ohlásilo se to až po třiceti dvou spadlých bězích**,
protože nikdo nekoukal.

Levná pojistka: krok v CI, který po nasazení zavolá adresu úlohy
s tajemstvím a **čeká 200**. Chybný název proměnné by se ukázal za
minutu, ne za den. Stejně tak by šlo hlídat, že existují všechny
povinné proměnné prostředí.

---

## 5. Nastavení Codea

`CLAUDE.md` je hlavní páka a je napsaný dobře — to nechávám. Co k tomu
přidat:

**Hooky** (`.claude/settings.json`, klíč `hooks`). Šéfík už jeden
globální má, takže princip zná.

- `Stop` — nepustit Codea „hotovo", dokud neproběhl
  `node scripts/scenare.test.mjs` a dokud nejsou věci commitnuté
  a **pushnuté**. Přesně to dnes selhalo.
- `PostToolUse` na úpravu `supabase/migrations/**` — připomenout
  pravidlo o sloupcových grantech.

**Podřízený agent** (`.claude/agents/kontrolor.md`). Krátký soubor
s hlavičkou `name`, `description`, `tools`. Úkol: **než Code ohlásí
hotovo, přečte si zadání znovu a projde bod po bodu, co z něj opravdu
udělal.** Dnes by chytil, že „Dnes" nezačala a že nic není pushnuté.

**Práva** v `.claude/settings.json` už jsou nastavená rozumně
(`git push`, `npm run` bez ptaní, `rm` a `db reset` zakázané). Sem bych
nesahal.

---

## 6. A teď k tomu agentovi

Šéfík se ptá na agenta, který by zadával úkoly Codeovi a pushoval.
Takové věci existují — jmenují se **Routines**, běží na
Anthropicově infrastruktuře i když je počítač vypnutý, umí spustit
práci podle času nebo podle události na GitHubu (pull request, vydání)
a zakládají si vlastní větve.

**Ale nedoporučuju s tím začínat.** Zadání úkolu je jedno vložení do
chatu; to není to, co nás brzdí. Brzdí nás, že hotová práce není
v repozitáři a že nikdo nezávisle neověřuje, jestli je hotová.
Automatizovat zadávání nad neověřeným postupem znamená jen dostávat
špatnou práci rychleji.

Pořadí, které dává smysl:

1. Přístup do repozitáře pro mě (bod 1).
2. Hlášení jako soubory (bod 1B).
3. CI, které opravdu měří (bod 2).
4. Oddělit ostrý provoz od testu (bod 3).
5. **Teprve pak** naplánovaná úloha, která ráno pustí celou zkoušku,
   projde nasazené obrazovky a napíše, co je rozbité.

Ten pátý krok umím nastavit já a je to práce na deset minut — jenom
je zbytečný, dokud body 1 až 4 neplatí. Nad rozbitým CI by ráno psal
„červená" každý den a nikdo by se nedíval, přesně jako teď.

---

## Co udělat dnes

Tři věci, každá pod deset minut, a všechny tři má v ruce Šéfík:

1. Přidat `foodtab-rizeni` mezi zdroje téhle relace.
2. Říct marketingové relaci, ať přejmenuje `krok18_scenar.sql`
   na `marketing1_scenar.sql`.
3. Přejmenovat `cron_secret` na `CRON_SECRET` a nasadit znovu.

Zbytek je práce na příští týden, ne na dnešní večer.
