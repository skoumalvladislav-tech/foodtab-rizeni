# Práce na 4. 9. — mobil zaměstnance, docházka, dotažení

Zadal Šéfík 4. 9. 2026 ráno:

> Dnes už bych potřeboval mít hotovou docházku, rozhraní pro uživatele
> zaměstnance a celkově apku pořádně rozchodit.

K tomu tři fotky z iPhonu 14 Plus. Tohle je z nich vytažené — s tím,
co jsem si ověřil v kódu, a co je naopak potřeba změřit v prohlížeči.

---

## 0. Než začneš: fotky nejsou ze samostatné apky

Na všech třech je nahoře bílý proužek s adresou `foodtab-rizeni.verce…`
a vlevo `◀ Foodtab`. To **není** apka přidaná na plochu — to je Safari
otevřené z apky. Vložka shora se v obou režimech chová jinak.

**Než začneš měřit, ověř si, v čem to vlastně je.** Jinak se dá půl dne
strávit laděním `env(safe-area-inset-top)`, který v tomhle zobrazení ani
nemá co dělat.

Zlomy: iPhone 14 Plus má šířku okna **430 px**, iPhone 13 mini 375 px.
Ověřuj obojí.

---

## 1. Horní lišta na telefonu přetéká

**Co je vidět na fotce:** zleva `Foodtab`, pilulka pobočky s tečkou
a jediným písmenem `l`, velké kolečko lupy s useknutým `H`
z „Hledat…", měsíc, zvoneček s červenou jedničkou — a **ozubené kolo
už jen z poloviny, useknuté pravým okrajem obrazovky**.

**Co jsem našel v kódu.** V `app/[rozsah]/ram.tsx` má `.ft-tools` na
telefonu pět prvků: přepínač pobočky, hledání, přepínač režimu,
zvoneček, nastavení. V `app/globals.css` se pod 1360 px nastavuje
`.ft-tools { flex: 0 1 auto; min-width: 0 }` a zúžit se má **název
pobočky**. To se taky stalo — proto je z „Bernard Bar" jen `l`. Jenže
ani to nestačilo a poslední ikona vypadla z obrazovky.

**Nedolaďuj to o pár pixelů. Uber prvek.** Pět ovládacích prvků
a název pobočky se na 430 px nevejde tak, aby to bylo k něčemu, a na
375 px už vůbec ne.

Návrh — a chci na něj tvůj názor, ne mlčení:

- Na telefonu (≤ 640 px) zůstane v liště **přepínač pobočky
  a zvoneček**. Nic víc.
- **Hledání z lišty na telefonu zmizí.** Dnes je to `disabled` pole,
  které nic nedělá — zabírá 44 px na nejdražším místě aplikace. Až
  hledat půjde, dostane vlastní obrazovku.
- **Režim a nastavení se stěhují pod „Více"** ve spodní liště. Tam už
  je na to místo a člověk je tam hledá.
- **Název pobočky se nesmí zkrátit na jedno písmeno.** Buď se vejde
  čitelný (aspoň ~10 znaků), nebo se ukáže jen barevná tečka bez textu
  a název je v přepínači po rozkliknutí. `l` je nejhorší ze všech
  možností: vypadá to jako chyba a nic to neříká.

**Ať se to pozná, když se to zase pokazí.** Napiš kontrolu, která na
šířce 430 a 375 px projde hlavičku a ověří, že **žádný její prvek
nepřesahuje pravý okraj okna** (`getBoundingClientRect().right <=
window.innerWidth`). A pak ji schválně rozbij — přidej šestou ikonu
a přesvědč se, že spadne. Kontrola, kterou jsi neviděl spadnout,
nehlídá nic.

---

## 2. Stránka „Moje údaje" jde posunout do strany

**Co je vidět na druhé fotce:** `Foodtab` je useknuté **zleva**,
tlačítko „Zpět do aplikace" **zprava**. To znamená jediné: stránka je
širší než okno a je odrolovaná doprava. Nikdo s ní nehnul — otevřela se
tak.

Podezřelý je řádek `Přihlašovací e-mail` — hodnota `vladislavskoum…`
mizí za okrajem. Dlouhý e-mail bez povoleného zalomení roztáhne řádek,
řádek roztáhne stránku a s ní i hlavičku.

**Co s tím:**

- U hodnot v „Co o vás aplikace vede" povol zalomení
  (`overflow-wrap: anywhere`) a na úzké obrazovce dej popisek nad
  hodnotu, ne vedle ní. E-mail se prostě na 430 px vedle popisku
  nevejde.
- **Neřeš to přes `overflow-x: hidden` na `body`.** To přetečení
  neodstraní, jen ho schová — a s ním i to, co z něj vyteklo.
- Přidej kontrolu `document.documentElement.scrollWidth <=
  window.innerWidth` na **každou** obrazovku, kterou umíš v testu
  otevřít, ne jen na tuhle. Tohle je chyba, která se vrátí jinde.

Hlavička téhle stránky je jiná než hlavička aplikace (tmavý pruh
s „Zpět do aplikace"). Ověř, že i ona respektuje vložky po stranách —
na fotce to tak nevypadá.

---

## 3. Co má vidět zaměstnanec

Zadání je hotové ve dvou souborech, nepiš je znovu:

- `docs/analyza-mobil-zamestnanec.md` — co číšník potřebuje a co ne
- `docs/dnes-obrazovka-zadani.md` — obrazovka „Dnes"

**„Dnes" má přednost před vším ostatním v modulu Komunikace.** Dnes
zaměstnanec po přihlášení přistane na Nástěnce se zprávou `ssds`
z 26. srpna a s cedulí o zpracování osobních údajů. To není rozhraní
pro člověka, který jde na směnu — to je administrativa.

Na první obrazovce má být, v tomhle pořadí:

1. **Mám teď píchnuto?** A jedno velké tlačítko Příchod / Odchod.
2. **Kdy mi dnes začíná směna** a kde.
3. **Co mě čeká** — nejbližší směny.
4. Až pod tím zprávy a úkoly.

---

## 4. Docházka — co k „hotovo" chybí

Projdi tenhle seznam a u každého bodu odpověz **hotovo / není** a čím
jsi to ověřil. Ne odhadem z kódu — otevřením obrazovky.

1. Píchnutí přes PIN na tabletu i přes QR v telefonu.
2. Ruční doplnění chybějícího odchodu a **správný přepočet hodin**
   (na tomhle jsme se už jednou spálili — hodiny nesouhlasily).
3. Zapomenutý odchod se ohlásí. **Plánovač dnes padá na 401**, viz níž.
4. Přechod mezi pobočkami během jedné směny.
5. Provozní den: účet ve 2:15 patří do včerejší uzávěrky
   (`branches.day_starts_at` = 05:00).
6. Zálohy: zadání a limit.
7. Přehled odpracovaných hodin za období, které si člověk sám otevře.

---

## 5. Plánovaná úloha padá — a není to chyba kódu

Ruční spuštění „Zapomenutý odchod" (běh #5, commit `08acdcc`) skončilo
**401 — tajemství nesedí**.

Příčinu jsem našel a **není v repozitáři**: na Vercelu se ta proměnná
jmenuje **`cron_secret` malými písmeny**, ale kód čte
`process.env.CRON_SECRET`. Názvy proměnných prostředí jsou
citlivé na velikost písmen, takže aplikace čte prázdno a každé volání
odmítne.

Spraví to Šéfík přejmenováním na Vercelu a novým nasazením. **Do kódu
kvůli tomu nesahej** — nečti obě varianty názvu, to by tu past jen
zakonzervovalo.

---

## 6. Provozní nález, ne chyba

Na třetí fotce svítí: *„Rozpis je vydaný, ale tahle změna se k lidem
nedostala — od vydání se změnilo 7 směn."*

To hlásí aplikace správně. Jen ať to ví Šéfík: **sedm změn čeká na
vydání** a lidé je zatím nevidí.

Zkontroluj jednu věc: ta cedule i tlačítko „Vydat znovu" se smí
kreslit **jen tomu, kdo má právo rozpis vydávat**. Číšníkovi na
Směnách nemá co dělat. A ať to není jen schované — přímé volání to
musí odmítnout taky (pravidlo 4).

---

## 7. Pořadí na dnešek

1. Hlavička na telefonu (oddíl 1) — bez toho se nedá zkoušet nic.
2. Přetečení do strany (oddíl 2) + kontrola na všech obrazovkách.
3. Obrazovka „Dnes" (oddíl 3).
4. Docházka — projít seznam z oddílu 4 a doplnit, co chybí.
5. Teprve pak Komunikace, krok 2.

Když dojde čas, skonči na hranici kroku a napiš, kde jsi. Rozdělaná
hlavička je horší než hlavička nedotčená.
