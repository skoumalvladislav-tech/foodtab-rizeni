# Rychlost aplikace a co vidí řadový zaměstnanec

Měřeno 5. 9. 2026 na nasazené aplikaci, přihlášeným účtem, ne z kódu.

---

# ČÁST 1 — Proč je aplikace pomalá

## Naměřené hodnoty

Časy v milisekundách, z `performance.getEntriesByType('navigation')`:

| stránka | první bajt | celá odpověď | DOM hotový |
|---|---|---|---|
| `/cerna-perla/dochazka` | **33** | **5 566** | 5 936 |
| `/firma` | 118 | 2 905 | 3 502 |
| `/firma/smeny` | 43 | 3 146 | 3 251 |
| `/cerna-perla/dochazka` (2×) | 32 | 4 154 | 4 233 |

**První bajt přijde za 33 ms, ale celá odpověď trvá pět a půl vteřiny.**
To je celý příběh: síť je rychlá, přenášená data jsou malá (11 kB HTML),
prohlížeč nezdržuje. Zdržuje **server, který čeká na databázi**.

Na telefonu je to stejné, jen se k tomu přidá pomalejší zpracování —
proto ti to tam připadá horší.

## Příčina: server běží v Americe, databáze ve Frankfurtu

Z hlavičky odpovědi:

```
x-vercel-id: fra1::iad1::xjz97-...
```

- `fra1` — okraj sítě, který požadavek přijal. Frankfurt, kousek od tebe.
- `iad1` — **kde se stránka doopravdy poskládala. Washington, USA.**

Takže: požadavek z Tábora doletí do Frankfurtu za pár milisekund, pak
se pošle do Virginie, a **odtamtud se aplikace ptá databáze zpátky do
Frankfurtu** — a takhle jednou za každý dotaz. Jedna cesta tam a zpět
přes Atlantik je zhruba **90 ms**.

Stránka Docházky jich pošle **dvacet šest za sebou** (napočítáno
v `app/[rozsah]/dochazka/page.tsx`, řádky 133–551). 26 × 90 ms je
**2,3 vteřiny čistého čekání na kabel**, ke kterému se přičte práce
samotné databáze. To sedí s naměřenými čtyřmi až pěti vteřinami.

## Oprava 1 — přesunout server do Frankfurtu (5 minut, největší efekt)

Vercel → projekt `foodtab-rizeni` → **Settings → Functions** →
**Function Region** → vybrat **Frankfurt (fra1)** → uložit → **Redeploy**.

Tím se z každé cesty tam a zpět stane místo ~90 ms zhruba **1–5 ms**.
Stejných 26 dotazů pak nestojí 2,3 vteřiny, ale zlomek.

Je to i v souladu s tím, co už máme rozhodnuté: databáze Frankfurt,
cílový hosting Hetzner v Německu. Server v Americe tam nepatří — jen
si toho zatím nikdo nevšiml, protože se to nikdy nezměřilo.

**Tohle udělej dřív, než začneš cokoli přepisovat v kódu.** Je to
jedno nastavení a spraví to většinu problému.

### HOTOVO — a takhle to dopadlo

Přepnuto 5. 9. v 18:05 na Šéfíkův pokyn a nasazeno znovu. Hlavička
teď hlásí `fra1::fra1` místo `fra1::iad1`. Změřeno na téže stránce,
stejným postupem:

| stránka | celá odpověď před | po | DOM před | po |
|---|---|---|---|---|
| `/cerna-perla/dochazka` | 5 566 | **754** | 5 936 | **827** |
| `/firma/smeny` | 3 146 | **811** | 3 251 | **864** |

**Sedmkrát rychleji, aniž by se změnil jediný řádek kódu.** První
načtení po nasazení bylo 2 724 ms — to je studený start funkce, ne
běžný stav; druhé už bylo 1 289 a třetí 754.

## Oprava 2 — nečekat na dotazy jeden po druhém (práce pro Codea)

I ve Frankfurtu platí, že 26 dotazů za sebou je 26 čekání. Většina
z nich na sobě **nezávisí** — kdo jsem, jaká je pobočka, jaké mám
záznamy, jaký je výdělek, kdo je dnes v práci. Ty se dají poslat naráz
přes `Promise.all` a čekat jen na ten nejpomalejší.

Zadání pro Codea:

1. V `app/[rozsah]/dochazka/page.tsx` **rozděl dotazy na dvě vlny**:
   co se musí zjistit první (uživatel, tenant, rozsah, práva), a
   všechno ostatní, co na tom stojí — a tu druhou vlnu pusť naráz.
2. **Nezačínej optimalizovat naslepo.** Nejdřív změř: kolem každého
   dotazu `console.time`, jednou to načti a napiš, který trvá nejdél.
   Může se ukázat, že jeden dotaz stojí za polovinou času a zbytek je
   šum.
3. Totéž pak na `smeny` a na rozcestníku, ne dřív.

## Co zatím NEDĚLAT

- **Necachovat.** Docházka a rozpis jsou data, která se mění každou
  minutu a lidé podle nich píchají. Cache tady znamená „ukázal jsem ti
  včerejšek" a to je horší než čekat.
- **Nepředělávat na klientské načítání.** Přesunulo by to čekání
  z „bílá stránka" na „stránka s kolečky", ne pryč.

---

# ČÁST 2 — Co vidí řadový zaměstnanec a nemá

Role **Servis** má šest práv, takže číšník uvidí ve spodní liště
Směny, Docházku, Úkoly, Zprávy a Více. To je dobře zvolené. Problém je
v tom, co se k tomu přidává navíc.

## 1. Řádka modulů, které si firma nekoupila

Nahoře svítí **Tvorba menu, Finance a účetnictví, Marketing,
Objednávky** — přeškrtnuté a zašedlé. Je to nabídka toho, co si může
firma přikoupit.

**Číšníkovi to nepatří.** Jeho to nezajímá, nemůže s tím nic udělat
a bere to místo na obrazovce, kterého je na telefonu nejmíň.

Vypnuté moduly ať se kreslí jen tomu, kdo má `settings.manage`. Pro
ostatní ať v řádce zůstane jen to, do čeho můžou vejít. Když zbude
jediný modul, ať řádka zmizí úplně.

## 2. Tři obrazovky, které „Připravujeme"

Na rozcestníku má číšník **Receptury, Jídelní lístky a Motivaci**
označené jako připravované. Otevřít je nemůže.

Slib nepatří na denní nástroj. Zaměstnanec má vidět **to, co dnes
funguje** — čtyři položky, ne čtyři a tři přísliby. Nechte je vidět
tomu, kdo firmu řídí a rozhoduje o rozvoji.

## 3. Gastro AI, které neexistuje

Servis, Bar i Kuchyně mají zaškrtnuté právo „Používat Gastro AI".
Přitom je to vypnuté pole v horní liště, které nic nedělá.

Odškrtnout u všech tří rolí, dokud modul nebude. A pole na telefonu
nekreslit vůbec (už je v `docs/mobil-a-dokonceni-2026-09-04.md`).

## 4. Cedule „čeká na právníka"

Nad Nástěnkou visí:

> **Informace o zpracování osobních údajů** — Text zatím není hotový,
> čeká na právníka.

Tohle uvidí každý pozvaný. Zaměstnanci tím říkáš, že firma vede jeho
docházku, mzdu a telefon, ale co s tím dělá, ještě nemá sepsané.
Přitom je to jediný dokument, na který má ze zákona nárok.

Buď ten text doplň, nebo ceduli **do té doby nezobrazuj**. Rozdělaná
věc vystavená na očích je horší než věc, o které lidé nevědí.

## 5. Zkušební data

Na Nástěnce je zpráva **„ssds"** z 26. srpna. Smaž ji dřív, než
rozešleš pozvánky. První obrazovka nové aplikace nemá vypadat jako
cizí rozdělaná práce.

## 6. Zaměstnanec pořád přistává na Nástěnce

Obrazovka „Dnes" (`docs/dnes-obrazovka-zadani.md`) je pořád
nezačatá. Do té doby první, co číšník po přihlášení uvidí, je cedule
o osobních údajích a zpráva „ssds" — místo toho, kdy mu začíná směna
a jestli má píchnuto.

**Ze všeho v téhle části má tohle největší dopad.** Body 1–5 jsou
úklid; tohle je ta obrazovka samotná.

---

## Pořadí

1. **Region Vercelu na Frankfurt.** Pět minut, největší zrychlení.
2. Úklid pohledu zaměstnance — body 1, 2, 3, 5. Je to skrývání, ne
   nová práce.
3. Text o osobních údajích (bod 4) — rozhodnutí pro Šéfíka.
4. Obrazovka „Dnes".
5. Dotazy naráz místo za sebou — až po bodu 1, ať je vidět, co
   z toho zbylo.
