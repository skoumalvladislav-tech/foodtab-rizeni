# Doplnění noční práce — po první zkoušce přihlášení na telefonu

Čti spolu s `docs/nocni-prace-2026-09-07.md`. Tohle má **přednost**
před kroky 2 a 3 v něm; „Dnes" zůstává první.

Šéfík se 6. 9. večer poprvé přihlásil z telefonu. **Funguje to** —
a pamatuje si ho i po restartu telefonu, takže sezení drží a cookie
zakládá server. To byla ta hlavní neznámá a je zodpovězená.

Zbyly tři věci.

---

## 1. Kód nejde vložit — a autovyplnění nefunguje

> Kód se automaticky nevyplnil a když jsem chtěl vložit zkopírovaný,
> nešlo to — hláška „Vložit" se objevila jen na několik milisekund.

Jsou to **dvě různé věci** a jedna z nich je moje chyba v zadání.

### Vložení: to bliknutí je příznak, ne náhoda

Bublina „Vložit" na iOS zmizí ve chvíli, kdy pole ztratí označení —
tedy při každém překreslení. A přesně to jsem ti do zadání předepsal:
**odpočet „Poslat znovu" na 60 vteřin.** Když ten odpočet tiká po
vteřinách a překresluje s sebou i políčko na kód, bublina se zavře
dřív, než na ni člověk stihne ťuknout.

**Odděl odpočet od pole.** Ať tikání překresluje jenom ten text
u tlačítka, ne políčko. A přitom projdi i ostatní důvody, proč se
vložení láme:

- **pole se nesmí znovu připojovat** (žádné `key`, které se mění),
- **žádné opakované `focus()`** po prvním vykreslení,
- **`type="number"` ne** — používej `type="text"` s `inputMode="numeric"`,
- **filtr znaků musí přežít vložení celého kódu naráz.** Když
  `onChange` odstraňuje nečíslice, ověř, že šest číslic vložených
  najednou projde. Ošetři i mezery a nezlomitelnou mezeru — lidé
  kopírují kód i s nimi.

**A přidej tlačítko „Vložit kód"**, které si ho vezme ze schránky
samo (`navigator.clipboard.readText()`, v `try/catch` — na některých
prohlížečích to nejde a pak ať tlačítko není vidět vůbec). Jedno
ťuknutí místo podržení prstu a trefování se do bubliny. V provozu,
kde má člověk mokré ruce a spěchá, je to rozdíl mezi „jde to" a „nejde
to".

**Zkoušku napiš na to, co se rozbilo:** vlož do pole šest číslic
jedním vložením (ne po znacích) a ověř, že tam zůstanou všechny.

### Autovyplnění: očekávání je špatně, ne kód

`autocomplete="one-time-code"` je napsané správně a **nech ho tam**.
Jenže iPhone nabízí kód sám jen ze **Zpráv (SMS)** a z **Apple Mailu**.
Šéfík čte poštu v **Gmailu**, odkud iOS kód nenabídne.

Takže: **kód nikde neslibuj.** Do rozhraní nepiš „kód se vyplní sám" —
napiš neutrálně „Opište kód z e-mailu". Až přibude přihlášení přes
SMS, autovyplnění začne fungovat samo a nebude se muset nic měnit.

---

## 2. Odhlásit se — je to tam, ale nikdo to nenajde

Tlačítko **existuje** a je udělané dobře, včetně vysvětlující věty.
Ověřil jsem si to na nasazené aplikaci.

Problém je, **kde** je: na konci Mých údajů, až pod souhlasy,
kontaktem a stahováním dat. Cesta k němu vede přes Více → Moje údaje →
sjet úplně dolů. Šéfík ho nenašel — a on ví, že tam je.

**Přidej ho i na rozcestník**, dolů, oddělené čarou od ostatního. Ten
je pod „Více" a je to místo, kam člověk jde, když hledá „něco
ostatního". Na Mých údajích ho **nech taky** — tam patří k výdeji dat
a k souhlasům.

Do horní lišty ne. Omylem ťuknuté odhlášení uprostřed směny je horší
než o jedno ťuknutí delší cesta.

---

## 3. Vzkazy: sloučit Nástěnku a Rozhovory pod jednu položku

Rozhodl Šéfík 6. 9. Nahrazuje oddíl 4
v `docs/nastenka-dokumenty-a-strediska.md`, zbytek toho souboru platí.

**„Rozhovory" se přejmenují na „Vzkazy"** a Nástěnka se do nich sloučí.
Jedna položka v nabídce, uvnitř **dvě záložky**:

**1. Vzkazy** — rozhovor, odpovídá se:
- od majitele konkrétnímu člověku,
- mezi zaměstnanci navzájem,
- mezi pobočkami,
- mezi úseky.

**2. Nástěnka** — sdělení, neodpovídá se:
- dokumenty k rozkliknutí (provozní pokyny, řády, podklady k akcím),
- dlouhodobá upozornění,
- informace pro všechny, že se něco děje.

**Zůstávají to dva různé tvary**, jak bylo popsané dřív: u Nástěnky se
eviduje, kdo to vzal na vědomí, a neodpovídá se na ni; ve Vzkazech je
to naopak. **Slučuje se vchod, ne obsah.**

Nepřečtené z obou záložek se sčítají do **jednoho čísla** u ikony.

*(Drobnost k rozhodnutí, ne teď: položka v nabídce se bude jmenovat
„Vzkazy" a jedna ze záložek uvnitř taky. Až to Šéfík uvidí na
obrazovce, ať řekne, jestli mu to nevadí — případně se vrchní položka
přejmenuje na „Zprávy". Kód kvůli tomu měnit nemusíš, je to jedno
slovo.)*

---

## Pořadí po tomhle doplnění

1. **Krok 0** z původního souboru — push, `krok28`, pravidlo do
   `CLAUDE.md`. *(Hotovo 6. 9. večer.)*
2. **Obrazovka „Dnes"** — pořád první a největší.
3. **Vložení kódu a odhlášení** (oddíly 1 a 2 tady). Krátké a Šéfík na
   to naráží pokaždé, když aplikaci otevře.
4. **Vzkazy: sloučení a přejmenování** (oddíl 3).
5. Úklid pohledu zaměstnance a dokumenty na Nástěnce — kroky 2 a 3
   z původního souboru.
