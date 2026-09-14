# Marketing — co je hotové a co zbývá

Stav k **14. 9. 2026**. Měřeno proti původnímu zadání
(`FoodTab Marketing AI — Claude Code prompt v2.1`, 27 oddílů), ne proti
tomu, co se cestou stihlo.

Tenhle soubor je na dvě věci: **přehled pro Šéfíka** (první polovina)
a **zadání pro další relaci** (druhá polovina, oddíl 7 — dá se zkopírovat
a poslat jako prompt).

---

## 1. Jak číst „hotovo"

Rozlišují se tři stavy a ten rozdíl je podstatný:

| Značka | Znamená |
|---|---|
| **hotovo** | Dá se to otevřít, použít a je na to kontrola, o které vím, že umí spadnout |
| **rozestavěné** | Kus toho funguje, kus chybí — je napsané, který |
| **chybí** | Není to. Ani obrazovka, ani tabulka |

„Hotovo" **neznamená odzkoušené v provozu.** Modul zatím nikdo nepoužil
na skutečnou kampaň. To se pozná až u první ostré Černé Perly.

---

## 2. Souhrn podle oddílů zadání

| # | Oddíl zadání | Stav | Poznámka |
|---|---|---|---|
| 1 | Kontext a cíl | **hotovo** | Změnilo se jedno: není to samostatná aplikace, je to **modul Foodtabu**. Rozhodnutí je v `docs/marketing-je-modul.md` |
| 2 | Pracovní postup | **hotovo** | Migrace, scénáře, kontroly se sabotáží |
| 3 | Technologický základ | **hotovo** | Next.js + Supabase, ne vlastní stack |
| 3.1 | **Zákazník si volí nástroje** | **hotovo** (14. 9.) | Obrazovka `marketing/nastroje`, katalog v `lib/marketing-katalog.ts`, zkouška spojení, čtyři režimy. Chybí OAuth a sledování spotřeby — `docs/marketing-nastroje.md`, oddíl 7 |
| 4 | Jazyk, vzhled, ovládání | **hotovo** | Česky, podle `docs/vzhled-predloha.html` |
| 5 | Organizace, provozovny, role | **hotovo** | Přebírá se z Foodtabu — `app.has_access`, žádná druhá kopie |
| 6 | První spuštění a připojení nástrojů | **rozestavěné** | Stránka Integrace a nástroje je (14. 9.). **Průvodce prvním spuštěním** — otázky na priority a z nich doporučená sestava — není |
| 7 | Brand kit provozovny | **hotovo** | Obrazovka **Značka** |
| 8 | Mediální knihovna | **hotovo** | Obrazovka **Fotky**, kbelík s pravidly přístupu, oddělení podle poboček |
| 9 | Knihovna gastro šablon | **hotovo** | 40 šablon, 10 výstupních formátů, doporučování podle podkladů |
| 10 | Import menu | **hotovo** | Čtyři cesty: text, fotka, PDF, ruční oprava. Cena se **nikdy nedomýšlí** |
| 11 | AI marketingový agent | **hotovo** | Návrh textu a storyboardu. Mzdy, docházka ani kontakty do modelu nejdou |
| 12 | Automatická grafika a video | **chybí** | Tabulka `marketing_render_ulohy` stojí, **žádný renderer není napojený**. Shotstack je zmíněný v komentářích, adaptér ne |
| 13 | Editor a náhled | **rozestavěné** | Text, cena, termín a fotky se měnit dají. **Náhled IG a FB vedle sebe, bezpečné zóny, obnovení starší verze a duplikace návrhu chybí** |
| 14 | Schvalování a verzování | **hotovo** | Čtyři oči, otisk verze, nová verze ruší schválení, hromadné schválení, auditní stopa. **Upozornění hotová (14. 9.)** — na žádost, schválení, vrácení i vzdanou publikaci, v aplikaci. E-mail a push zatím ne |
| 15 | Kalendář, kampaně, automatizace | **hotovo** (14. 9.) | Kalendář (měsíc, týden, filtry, pilíře barvou, varování, přesun termínu) a kampaně se sérií pozvánka → připomínka → poslední výzva → poděkování. Automatizace s vypínačem, vlastníkem, příštím během a historií. Úloha `api/uloha/marketing-automatizace` je pouští po hodinách. **Zbývá evergreen (zásoba na prázdné dny) — dnes se přeskakuje** |
| 16 | Publikování na IG a FB | **rozestavěné** | Fronta úloh, opakování, dead-letter, idempotence, „nikdy falešné zveřejněno" — hotové. **Facebook rovnocenně s Instagramem (14. 9.)**: pravidla sítí jako data (`lib/marketing-kanaly.ts`), FB projde i samotným textem, oddělený text a strop znaků pro každou síť, účet pobočky se vyplňuje. **Zbývá n8n workflow pro FB a načítání účtů z Mety** |
| 17 | Inspirace z jiných nástrojů | **rozestavěné** | **Obsahové pilíře** (14. 9., šest, barvou v kalendáři) a **mini-kampaň z akce** (série ke kampani) hotové. Chybí schránka nápadů, checklist podkladů, QR a UTM, týdenní report, chytré znovupoužití staršího obsahu |
| 18 | Analytika a měření | **rozestavěné** (14. 9.) | Měřitelné odkazy s UTM a QR, prokliky se počítají, tabulka metrik s rozlišením „ze sítě / vlastní / odhad“. **Neměřené se nikdy nekreslí jako nula.** Chybí stahování čísel ze sítí — k tomu je potřeba účet s oprávněním číst statistiky |
| 19 | Databázový model | **hotovo** | 19 tabulek, RLS všude, granty prověřené |
| 20 | API a integrace do Foodtabu | **hotovo** | Modul JE uvnitř Foodtabu, takže odpadlo. Ven vedou `api/uloha/marketing-fronta` a `api/uloha/marketing-automatizace` |
| 21 | n8n jako volitelný poskytovatel | **hotovo** | Ale **vypnuté** — viz oddíl 5 níž |
| 22 | Obrazovky MVP | **15 ze 16** | Rozepsané v oddílu 3 |
| 23 | Bezpečnost a provoz | **hotovo** | Klíče šifrované, `service_role` na serveru, dvě obranné linie, audit |
| 24 | Seed data | **chybí** | Ukázková cesta pro nového zákazníka není |
| 25 | Testy a akceptace | **hotovo** | 14 scénářů v databázi (1281 kontrol proti PostgreSQL 16), 20 kontrol v Node. Každá nová kontrola prošla sabotáží |
| 26 | Dokumentace | **rozestavěné** | `marketing-je-modul.md`, `marketing-spusteni.md`, `marketing-nastroje.md`. **Manuál pro obsluhu chybí** |
| 27 | Rozdělení realizace | — | Etapa 1 z velké části hotová, etapa 2 sotva začatá |

---

## 3. Šestnáct obrazovek z oddílu 22

| # | Obrazovka | Stav | Kde je |
|---|---|---|---|
| 1 | Přihlášení | **hotovo** | Foodtab, `/prihlaseni` |
| 2 | Průvodce prvním nastavením | **chybí** | — |
| 3 | Dashboard s přepínačem provozovny | **hotovo** (14. 9.) | `marketing` — velké tlačítko, čekající schválení, dnešní i další plán, blížící se akce, chyby připojení, naposledy odeslané. **Výkon posledních příspěvků se neukazuje a je to napsané** — analytika není |
| 4 | Rychlé vytvoření obsahu | **hotovo** | `marketing/novy` |
| 5 | Průvodce vytvořením (podklady → šablona → návrhy → editor → schválení → termín) | **rozestavěné** | Všechny kroky existují, ale **každý jinde**. Průvodce, který vede za ruku, není |
| 6 | Mediální knihovna | **hotovo** | `marketing/media` — Fotky |
| 7 | Menu a import | **hotovo** | `marketing/menu` |
| 8 | Knihovna šablon | **hotovo** | `marketing/sablony` |
| 9 | Kalendář obsahu | **hotovo** (14. 9.) | `marketing/kalendar` — měsíc a týden, filtr podle kanálu, pilíře a stavu, varování na mezeru a nahuštění |
| 10 | Fronta ke schválení | **hotovo** | `marketing/schvalovani` — dnes dodělané |
| 11 | Kampaně a automatizace | **hotovo** (14. 9.) | `marketing/kampane` — série z jedné akce, automatizace s vypínačem a historií. Nic nezveřejňují, vyrábějí koncepty |
| 12 | Publikované příspěvky a stavy | **hotovo** (14. 9.) | `marketing/publikovane` — fronta i historie po úlohách, chyby s radou česky, nanečisto zvlášť, odkaz na síť a číslo u poskytovatele |
| 13 | Základní analytika | **hotovo** (14. 9.) | `marketing/analytika` — měřitelné odkazy, QR na plakát, prokliky. Čísla ze sítí zůstanou prázdná, dokud nebude připojený účet |
| 14 | Integrace a nástroje | **hotovo** (14. 9.) | `marketing/nastroje` — karty po kategoriích, připojení vlastním klíčem, zkouška před aktivací |
| 15 | Brand kit provozovny | **hotovo** | `marketing/znacka` — Značka |
| 16 | Tým, role a auditní přehled | **rozestavěné** | Lidé a Zařazení jsou ve Foodtabu. **Auditní přehled marketingu** (kdo co schválil a zveřejnil) jako obrazovka chybí, i když data v `audit_log` jsou |

---

## 4. Co je hotové a stojí za to říct nahlas

Tohle nejsou položky ze seznamu, ale věci, které v modulu opravdu drží:

**Nezveřejní se, co nikdo neschválil.** Hlídá to databáze čtyřmi
spouštěmi, ne obrazovka. Kdyby někdo volal rozhraní mimo aplikaci,
neprojde. Když se text po schválení změní, schválení **zaniká** a
odklepává se znovu.

**O vlastní žádosti nerozhoduje ten, kdo ji poslal.** Pravidlo čtyř
očí. Výjimka je jediná: když ve firmě nikdo druhý s právem publikovat
není — jinak by se nedalo zveřejnit nic.

**Nikdy falešné „zveřejněno".** Dokud to nepotvrdí poskytovatel, stav
se nezmění. Zkouška nanečisto se značí zvlášť a do čísel se nepočítá.

**Cena se nedomýšlí.** Ani u menu z textu, ani z fotky. Co se nepřečte,
zůstane prázdné a označí se ke kontrole. Menu se nedá potvrdit, dokud
je v něm nezkontrolovaná položka.

**Klíče k účtům jsou šifrované** a přes rozhraní se nedají přečíst.
13. 9. se našlo, že k tabulce s nimi vedly zbytečné granty — data
neunikla (ověřeno měřením), ale chyběla jedna ze dvou linií. Opraveno.

---

## 5. Dvě věci, které platí a nemají se měnit

**n8n zůstává vypnuté.** Ne proto, že by nefungovalo — zkouška
nanečisto proběhla celá. Důvod: ve vašem n8n běží starý workflow
*„Černá Perla — denní obsah na sítě"*. Kdyby se zapnul i ten nový,
chodily by z Foodtabu **dva příspěvky denně**. Zapnout se smí až
poté, co se starý workflow zúží nebo vypne.

**Nasazuje Šéfík z `main`.** Migrace se z větve nepouštějí. Psané je to
v `docs/marketing-je-modul.md`, oddíl 6.

---

## 5b. Soupis toho, co chybí

Jedním pohledem, seřazené podle toho, jak moc to bude vadět. Podrobnosti
jsou v tabulkách výš.

### Velké kusy, které nejsou vůbec

| Co | Oddíl zadání | Co to znamená v praxi |
|---|---|---|
| **Stahování čísel ze sítí** | 18 | Tabulka i obrazovka stojí, ale zobrazení a dosah nikdo nestahuje — chybí připojený účet s oprávněním číst statistiky |
| **Automatická grafika a video** | 12 | Tabulka `marketing_render_ulohy` stojí, **žádný renderer není napojený**. Publikuje se fotka z knihovny, nic se nerenderuje |
| **Průvodce prvním nastavením** | 6, obrazovka 2 | Nový zákazník dostane prázdný modul a musí si sám najít, kde se co nastavuje |
| **Seed data a ukázková cesta** | 24 | Není z čeho předvést modul někomu, kdo ho vidí poprvé |
| ~~UTM odkazy a QR~~ | 17, 18 | **Hotovo 14. 9.** — `marketing/analytika`, veřejná adresa `/k/<klíč>` |
| **Manuál pro obsluhu** | 26 | Dokumentace je pro vývojáře, ne pro člověka, který to bude používat |

### Věci, které jsou rozestavěné

| Co | Chybí konkrétně |
|---|---|
| **Rozcestník marketingu** (obrazovka 3) | Hotový od 14. 9. Zbývá jediné: **stručný výkon posledních příspěvků** — bez analytiky se nedá vzít odkud |
| **Editor** (oddíl 13) | Náhled Instagramu a Facebooku vedle sebe, bezpečné zóny, obnovení starší verze, duplikace návrhu, nová AI varianta jen pro vybranou část |
| **Průvodce vytvořením** (obrazovka 5) | Všechny kroky existují, ale každý jinde. Průvodce, který vede za ruku, není |
| **Auditní přehled marketingu** (obrazovka 16) | Data v `audit_log` jsou, obrazovka „kdo co schválil a zveřejnil" ne |
| **Upozornění mimo aplikaci** (oddíl 14) | V aplikaci chodí od 14. 9. E-mail a push ne — přijdou nad toutéž tabulkou, ne vedle ní |
| **Nástroje** (oddíl 3.1) | OAuth (dnes jen vlastní klíč) a sledování spotřeby |
| **Evergreen** (oddíl 15) | Druh automatizace „zásoba na prázdné dny" se dnes jen přeskočí |

### Co je hotové u nás, ale ven to zatím nejde

Tohle je nejdůležitější odstavec celého souboru, protože se to snadno
přehlédne: **modul umí připravit a schválit obsah, ale skutečná cesta
na sítě je pořád jen jedna a je vypnutá.**

| Co | Proč |
|---|---|
| **n8n je vypnuté** | Ve vašem n8n běží starý workflow „Černá Perla — denní obsah na sítě". Kdyby se zapnul i nový, chodily by z Foodtabu **dva příspěvky denně**. Zapnout se smí, až se starý zúží |
| **Facebook na straně n8n** | Foodtab ho od 14. 9. umí celý, ale n8n workflow obsluhuje jen Instagram |
| **Účty se nenačítají z Mety** | `marketing_ucty` je prázdná, takže se oprávnění účtu nekontrolují proti ničemu |
| **Migrace čekají na nasazení** | `20260914140000_marketing_kampane.sql` leží v repozitáři. Nasazuje Šéfík z `main` |
| **`CRON_SECRET` a `APP_URL`** | Bez nich se automatizace ani fronta nespustí — plánovač dostane 401 |

---

## 6. V jakém pořadí dál a proč

Pořadí není podle toho, co je snadné, ale podle toho, **co bez čeho
nedává smysl**.

**1. Integrace a nástroje (oddíl 3.1 a 6, obrazovka 14).** — **HOTOVO
14. 9. 2026.** Obrazovka `marketing/nastroje`, katalog nástrojů, zkouška
spojení před aktivací, čtyři režimy. Podrobnosti a co z toho ještě
chybí (průvodce prvním spuštěním, OAuth, sledování spotřeby) jsou
v `docs/marketing-nastroje.md`.

Při té práci se našlo a opravilo, že **vlastní klíč zákazníka tiše
nefungoval**: funkce na klíče ležely ve schématu `app`, které PostgREST
nevystavuje, takže volání z aplikace neprošlo nikdy a vypadalo to jako
„zákazník nemá nic připojeného".

**2. Kalendář obsahu (oddíl 15, obrazovka 9).** — **HOTOVO 14. 9.**
`marketing/kalendar`: měsíc a týden, filtr podle kanálu, pilíře
a stavu, pilíře barvou z měřené palety, koncepty bez termínu zvlášť,
varování na dlouhé ticho a na nahuštěný den, přesun termínu.

**Přetahování myší tam není** a je to vědomé. Přesun se dělá
formulářem v týdenním pohledu a volá tutéž akci, která posune
i čekající publikaci — jinak by v kalendáři seděl nový den a ven by
to odešlo v ten starý. Až přetahování bude, musí volat tutéž akci,
ne psát do tabulky samo.

**3. Publikované příspěvky a stavy (obrazovka 12).** — **HOTOVO 14. 9.**
`marketing/publikovane`: fronta i historie po jednotlivých
publikačních úlohách, ne po příspěvcích — příspěvek jde na dvě sítě
a každá může dopadnout jinak. Chybové stavy s radou česky, ruční
zveřejnění jako normální stav (ne porucha), nanečisto s vlastním
štítkem a bez odkazu na síť, původní hlášení od poskytovatele vedle
rady. Seznam stavů se přestěhoval z detailu příspěvku do
`lib/marketing-text.ts` — dvě kopie téhož seznamu by se rozešly.

**4. Facebook vedle Instagramu (oddíl 16).** — **HOTOVO 14. 9. na
straně Foodtabu.**
Rozdíly mezi sítěmi jsou data v `lib/marketing-kanaly.ts`. Našla se
přitom skutečná závada: odesílání odmítalo KAŽDÝ příspěvek bez fotky
větou o Instagramu, takže Facebook nešel zveřejnit samotným textem,
ačkoli to síť umí.

**Co zbývá a není to Foodtab:** n8n musí umět větev na Facebook Page
(dnes obsluhuje jen Instagram) a účty se pořád nenačítají z Mety, takže
`marketing_ucty` je prázdná a `schopnosti` se nekontrolují proti ničemu.

**5. Kampaně a automatizace (oddíl 15, obrazovka 11).** — **HOTOVO
14. 9.**
`marketing/kampane`: kampaň jako záznam, série čtyř konceptů z jedné
akce, automatizace s vypínačem, vlastníkem, příštím během a historií
výsledků.

**Automatizace nic nezveřejní** a je to zapsané i v datech — tabulka
nemá sloupec, kterým by to šlo zapnout. Vyrobí koncepty a ty projdou
schválením jako všechno ostatní.

**Úloha, která je pustí, je taky hotová** (`api/uloha/marketing-automatizace`,
plánovač `.github/workflows/marketing-automatizace.yml`, jednou za
hodinu). Denní a víkendové menu vyrábí koncepty z potvrzeného menu;
když menu není, zapíše se **přeskočeno**, ne chyba.

**Zbývá:** druh `evergreen` (zásoba na prázdné dny) se dnes jen
přeskakuje — vrátí „zatím se nevyrábí". A automatizace potřebuje
`CRON_SECRET` a `APP_URL` v nastavení repozitáře, stejně jako fronta.

**6. Analytika, UTM a QR (oddíl 18).**
Má smysl teprve tehdy, až něco doopravdy odchází ven. Měřit prázdno
nejde, a obrazovka s nulami vypadá jako porucha.

**7. Zbytek oddílu 17** (schránka nápadů, obsahové pilíře, checklist
podkladů, týdenní report) a **oddíl 12** (render obrázků a videa).
Render je velký kus a dokud se publikuje fotka z knihovny, dá se bez
něj žít.

**Stranou, kdykoli mezi tím:** upozornění na žádost o schválení
(oddíl 14) a manuál pro obsluhu (oddíl 26). Obojí je malé a obojí
chybí.

---

## 7. Zadání pro další relaci

> Následující text je psaný tak, aby se dal poslat jako prompt.
> Předchozí úkoly (Integrace a nástroje, Kalendář obsahu, Publikované
> příspěvky, Facebook vedle Instagramu, Kampaně a automatizace) jsou
> od 14. 9. hotové.

---

Pokračuj na modulu **Marketing** v repozitáři `foodtab-rizeni`.

Přečti si nejdřív `CLAUDE.md`, `docs/marketing-je-modul.md`,
`docs/marketing-nastroje.md` a tenhle soubor. Původní zadání je
`FoodTab Marketing AI — Claude Code prompt v2.2`; tenhle soubor říká,
co z něj je hotové.

**Úkol: úloha, která automatizace doopravdy pustí.**

Kampaně a automatizace jsou od 14. 9. hotové — tabulky, obrazovka,
vypínač, historie i výpočet příštího běhu. **Chybí to, co je spustí.**
Zapnutá automatizace dnes ukazuje „příště v pondělí v 8:00" a v pondělí
se nestane nic.

Vzor je `app/api/uloha/marketing-fronta/route.ts`: běží pod servisním
klíčem, jede po dávkách, každou položku zvlášť v `try`, a na konci
vrátí počty.

Co má vzniknout:

1. **`app/api/uloha/marketing-automatizace/route.ts`** — vybere zapnuté
   automatizace, kterým nastal čas (`pristi_beh_kdy <= now()`).
2. **Podle druhu vyrobí koncepty.** `denni_menu` z potvrzeného menu na
   ten den (`marketing_menu`, stav `potvrzeno`); když menu není,
   zapíše běh jako **přeskočený**, ne jako chybu — není to porucha.
3. **Zapíše běh** do `marketing_automatizace_behy` a posune
   `posledni_beh_kdy` i `pristi_beh_kdy`. Příští běh se počítá funkcí
   `pristiBeh` z `lib/marketing-kampane.ts`, která už kontroly má.
4. **Dvakrát za den ne.** Jedinečný index to sice odmítne, ale úloha
   se na to nesmí spoléhat jako na řízení toku — má to poznat dřív
   a zapsat přeskočení, ne spadnout na porušení jedinečnosti.

Pravidla, která tady platí zvlášť ostře:

- **Nic se nezveřejní.** Úloha zakládá koncepty a verze, nikdy
  publikační úlohy ani schválení. Hlídá to
  `scripts/marketing-kampane.test.mjs` u série; pro tuhle úlohu
  přibude totéž.
- **Provozní den, ne kalendářní** (CLAUDE.md, pravidlo 10). Menu na
  „dnešek" se hledá podle `app.business_date` pobočky.
- **Servisní klíč neopustí server** (pravidlo 6).
- Ke každé nové kontrole **rozbij schválně to, co hlídá, a přesvědč
  se, že spadne.** Napiš, co jsi rozbil a co spadlo.

Nenasazuj. Nasazuje Šéfík z `main`. n8n nech vypnuté.

Až to bude, zbývá z oddílu 6 už jen analytika s UTM a QR — a ta má
smysl teprve tehdy, až něco doopravdy odchází ven.

---

## 8. Co padá a není to marketingem

Aby se to nehledalo znovu: šest kontrol relace **provoz** padá i bez
zásahu do marketingu.

| Kontrola | Na čem |
|---|---|
| `scripts/barvy-lidi.test.mjs` | chybí `smazatSmenu` v náhradě za akce směn |
| `scripts/rozpis.test.mjs` | totéž |
| `scripts/sablony.test.mjs` | totéž |
| `scripts/cas.test.mjs` | špatně složená cesta k dočasnému souboru |
| `scripts/scenare-poradi.test.mjs` | dva nálezy v `krok33_scenar.sql` |
| `supabase/tests/krok31_scenar.sql` | komentář u `zapomenute_odchody` přepsala migrace `20260913140000_drobnosti.sql` a vypadla z něj věta „SCHVÁLNĚ ŽÁDNÁ NENÍ“, na kterou se kontrola ptá doslova (nalezeno 14. 9. proti PostgreSQL 16) |

Do cizího modulu se nesahá (`CLAUDE.md`). Hlásí se to a opraví to ten,
kdo ho píše.
