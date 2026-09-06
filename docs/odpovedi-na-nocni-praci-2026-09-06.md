# Odpovědi na noční práci — 6. 9. 2026

Odpovídá Šéfík (body 1 a 4 vybral sám), zbytek je moje rozhodnutí
s jeho vědomím. Kde píšu „doporučuju", může to Šéfík přebít.

---

## Nejdřív: ověřil jsem to proti opravdovému PostgreSQL

Commity nejsou pushnuté, takže jsem si soubory vzal z disku a pustil
celou zkoušku u sebe, ne v PGlite:

```
VŠECHNY KONTROLY PROŠLY
Kontrol celkem: 875
```

Tvých 873 v PGlite a mých 875 v PostgreSQL sedí (rozdíl jsou dvě
kontroly seedu). **Nic nespadlo** — ani RLS, ani sloupcové granty,
ani nic, co PGlite neumí.

### Ten únik do auditu jsem si ověřil sám

Nespoléhal jsem na tvoji kontrolu. Zeptal jsem se databáze napřímo:

```
zprav_s_textem | z_toho_v_auditu
             15 |               0
```

Patnáct různých textů zpráv v databázi, **ani jeden se nedá najít
v auditu** — ani v `before`, ani v `after`. Audit ví, že zpráva
vznikla (16 zápisů plus jedna naléhavá), ale ne co v ní bylo.

**Tohle je nejlepší věc, která se dnes v noci stala.** Nebyla zadaná,
našel jsi ji sám, a byla to opravdová díra: majitel má
`settings.manage`, takže by si přes audit přečetl každou stížnost
napsanou na sebe. RLS nad konverzacemi by bránila jen zdánlivě.

Za to, že sis nevěřil a šel se podívat o řádek vedle, si to zaslouží
být napsané nahlas.

---

## Odpovědi na šest otázek

### 1. Zapomenutý odchod — doručuje se jen v ten provozní den

**Rozhodl Šéfík.** Zprávy chodí jen dokud trvá provozní den, ve kterém
se píchl příchod. Pak se člověk bere jako mimo směnu, i když záznam
zůstává nedokončený.

Důvod: zapomenutý odchod by jinak obcházel celé pravidlo a aplikace by
zvonila ve tři ráno — přesně tomu má bránit. Nedokončený záznam je věc
pro vedoucího, ne důvod držet člověka „ve službě".

**Do komentáře u funkce napiš proč**, ať to za rok nikdo
„nezjednoduší" zpátky.

### 2. Vzkaz vedení — adresu vybírá odesílatel, ne domovská pobočka

Odvozovat ji z domovské pobočky nestačí: člověk, který dělá na dvou
pobočkách, si stěžuje na to, co zažil **tam, kde zrovna byl**, a vzkaz
by přistál u vedoucího druhé provozovny.

Udělej to takhle:

- Kdo patří k **jedné** pobočce, se na nic neptá.
- Kdo patří k **víc než jedné**, vybere ji v tom formuláři.
- **Na obrazovce ať je napsané, kdo to uvidí.** To je u vzkazu vedení
  důležitější než u čehokoli jiného — člověk se musí rozhodnout dřív,
  než začne psát (`docs/komunikace-zadani.md`, oddíl 2).

### 3. Úkol na úsek smí splnit každý, kdo ho vidí

Stejné pravidlo jako u jmenovitého přiřazení: **štítek, ne zámek.**
Kdo úkol vidí, smí ho zavřít; `done_by` zapíše, kdo to byl.

Úkol na úsek, který smí zavřít jen někdo, zůstane v pátek večer
nesplněný, protože ten někdo zrovna marodí.

### 4. Zůstává `useky` — a opraví se pravidlo

**Rozhodl Šéfík.** Tabulka zůstane `useky`. Zadání
`docs/nocni-prace-2026-09-03.md` mluvilo o `sections`, ale to je
překonané.

Zároveň to znamená, že **pravidlo v `CLAUDE.md` neodpovídá skutečnosti**
už dávno: `konverzace`, `konverzace_zpravy`, `zalohy`,
`zapomenute_odchody` jsou česky. Uprav ten řádek v oddílu Konvence na:

> - **Základní schéma** (`tenants`, `branches`, `employees`, `roles`,
>   `permissions`, `memberships`, `audit_log`) je anglicky — je
>   společné pro všechny moduly a nemění se.
> - **Provozní moduly** (docházka, zálohy, komunikace, úseky) jsou
>   česky. Vzniklo to tak a přejmenovávat půlku schématu kvůli názvu
>   je riziko bez užitku.
> - **Uvnitř jednoho modulu se jazyky nemíchají.**

Vývojář, který to po nás přebere, potřebuje popis **pravdivý**, ne
hezký. Pravidlo, které se nedodržuje, je horší než pravidlo, které
připouští výjimku.

### 5. Kanál pozice se teď nedělá

Odkládá se. Dva důvody: znamená to změnu omezení na tabulce, kterou už
krok A používá, a hlavně **nikdo si ho zatím nevyžádal**. Až bude
potřeba, vlastní kanál dostanou **jen ty pozice, které si firma
vybere** — ne každá automaticky. Deset pozic znamená deset mrtvých
kanálů.

### 6. Kiosek: počet lidí ano, víc ne

Tvoje řešení je správné, nech ho. Počet lidí, kterým něco leží, bez
jmen a bez počtu zpráv.

*„Tři lidé mají zprávy"* nikoho neprozradí a má smysl — číšník ví, že
se má po píchnutí podívat. Počet zpráv u jednoho člověka už prozrazuje,
že se o něm hodně píše.

---

## Dvě zaparkované věci: obě odblokovávám

### Krok E — dopiš tu funkci do výčtu v `krok19`

**Zachoval ses správně a teď to dokonči.** Ta kontrola říká „když
někdo přidá další funkci s PINem, zastav se a někdo ať se podívá".
Zastavil ses. Někdo se podíval — já.

Ověřil jsem `public.kiosk_zpravy_pinem(p_klic text, p_pin text)`:
vrací `ok`, `jmeno`, `do_kdy`, `zpravy`. **PIN ani jeho otisk nevrací
nikde**, ověřuje ho přes `app.pin_overit` — stejně jako
`pichnout_pinem` a `potvrdit_zalohu_pinem`, které ve výčtu jsou.

Do výčtu tedy patří. **To není obcházení kontroly, to je její
splnění** — kontrola má vynutit pohled člověka, ne zakázat nové
funkce. Dopiš ji tam a **do komentáře napiš kdo a kdy to ověřil**,
ať je za rok vidět, že to nikdo neproklouzl.

Že jsi odmítl funkci přejmenovat, aby na vzor nesedla, bylo správné
rozhodnutí. To by byla obezlička.

### „Štítek, ne zámek" — přepiš obojí najednou

Pravidlo se mění, takže se s ním mění i kontrola, která to staré
pravidlo popisuje. Uprav `complete_task` **i** tu kontrolu
v `krok3_scenar` v jednom commitu, a v obou místech napiš proč.

Zákaz sahat na cizí scénáře platí proto, aby se do nich nešahalo
**potají**. Změna pravidla, o které se ví, je něco jiného.

A oprav i `krok27`, ať popisuje nový stav — dnes popisuje ten starý.

---

## Co dál, v tomhle pořadí

1. **Pushnout těch šest commitů.** Dokud nejsou na GitHubu, neexistují
   a CI je nevidí.
2. **Doplnit E a „štítek, ne zámek"** podle výše.
3. **Šéfík nasadí migrace** (`db push`) — dnes jich čeká šest:
   `20260905010000`, `20260905020000` a čtyři dnešní.
4. **Až budou nasazené, podívat se na obrazovky.** Neviděls je
   vykreslené a je to poctivě napsané v hlášení. Seznam čtyř věcí máš
   ve svém hlášení.
5. **Pak přihlašování** — je to jediná věc, která brání tomu, aby
   aplikaci mohl používat kdokoli kromě Šéfíka.
