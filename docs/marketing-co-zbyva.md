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
| 14 | Schvalování a verzování | **hotovo** | Čtyři oči, otisk verze, nová verze ruší schválení, hromadné schválení, auditní stopa. **Chybí jediné: upozornění** (žádost, vrácení, schválení, selhání) |
| 15 | Kalendář, kampaně, automatizace | **chybí** | Termín se dá nastavit u jednoho příspěvku. Kalendář, série, opakování, evergreen fronta — nic |
| 16 | Publikování na IG a FB | **rozestavěné** | Fronta úloh, opakování, dead-letter, idempotence, „nikdy falešné zveřejněno" — **to všechno hotové**. Odesílá se přes n8n. **Facebook je v číselníku, ale skutečná cesta ven je zatím jen Instagram** |
| 17 | Inspirace z jiných nástrojů | **chybí** | Schránka nápadů, obsahové pilíře, mini-kampaň z akce, checklist podkladů, QR a UTM, týdenní report — nic z toho |
| 18 | Analytika a měření | **chybí** | Žádná tabulka, žádná obrazovka |
| 19 | Databázový model | **hotovo** | 16 tabulek, RLS všude, granty prověřené |
| 20 | API a integrace do Foodtabu | **hotovo** | Modul JE uvnitř Foodtabu, takže odpadlo. Ven vede `api/uloha/marketing-fronta` |
| 21 | n8n jako volitelný poskytovatel | **hotovo** | Ale **vypnuté** — viz oddíl 5 níž |
| 22 | Obrazovky MVP | **11 ze 16** | Rozepsané v oddílu 3 |
| 23 | Bezpečnost a provoz | **hotovo** | Klíče šifrované, `service_role` na serveru, dvě obranné linie, audit |
| 24 | Seed data | **chybí** | Ukázková cesta pro nového zákazníka není |
| 25 | Testy a akceptace | **hotovo** | 10 scénářů v databázi, 12 kontrol v Node. Každá nová kontrola prošla sabotáží |
| 26 | Dokumentace | **rozestavěné** | `marketing-je-modul.md`, `marketing-spusteni.md`, `marketing-nastroje.md`. **Manuál pro obsluhu chybí** |
| 27 | Rozdělení realizace | — | Etapa 1 z velké části hotová, etapa 2 sotva začatá |

---

## 3. Šestnáct obrazovek z oddílu 22

| # | Obrazovka | Stav | Kde je |
|---|---|---|---|
| 1 | Přihlášení | **hotovo** | Foodtab, `/prihlaseni` |
| 2 | Průvodce prvním nastavením | **chybí** | — |
| 3 | Dashboard s přepínačem provozovny | **rozestavěné** | `marketing` — je to seznam příspěvků, ne rozcestník. **Velké tlačítko „Vytvořit", blížící se akce, dnešní obsah a chyby připojení chybí** |
| 4 | Rychlé vytvoření obsahu | **hotovo** | `marketing/novy` |
| 5 | Průvodce vytvořením (podklady → šablona → návrhy → editor → schválení → termín) | **rozestavěné** | Všechny kroky existují, ale **každý jinde**. Průvodce, který vede za ruku, není |
| 6 | Mediální knihovna | **hotovo** | `marketing/media` — Fotky |
| 7 | Menu a import | **hotovo** | `marketing/menu` |
| 8 | Knihovna šablon | **hotovo** | `marketing/sablony` |
| 9 | **Kalendář obsahu** | **chybí** | — |
| 10 | Fronta ke schválení | **hotovo** | `marketing/schvalovani` — dnes dodělané |
| 11 | **Kampaně a automatizace** | **chybí** | — |
| 12 | **Publikované příspěvky a stavy** | **chybí** | Stavy jsou vidět v seznamu, samostatná obrazovka ne |
| 13 | **Základní analytika** | **chybí** | — |
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

**2. Kalendář obsahu (oddíl 15, obrazovka 9).**
Druhá nejviditelnější věc. Dnes se termín nastaví u jednoho příspěvku
a nikde není vidět, co kdy půjde ven. Restaurace plánuje po týdnech,
ne po příspěvcích.

**3. Publikované příspěvky a stavy (obrazovka 12).**
Malá práce s velkým užitkem: po zapnutí n8n bude potřeba vidět, co
odešlo, co čeká a co spadlo — dnes se to musí proklikat.

**4. Facebook vedle Instagramu (oddíl 16).**
Číselník ho zná, cesta ven zatím ne. Pro gastro provoz je FB pořád
důležitý — jiné publikum než IG.

**5. Kampaně a automatizace (oddíl 15, obrazovka 11).**
Série příspěvků (pozvánka → připomínka → poslední výzva → report).
Až po kalendáři — bez něj není kam je nakreslit.

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
> Předchozí úkol (Integrace a nástroje) je od 14. 9. hotový.

---

Pokračuj na modulu **Marketing** v repozitáři `foodtab-rizeni`.

Přečti si nejdřív `CLAUDE.md`, `docs/marketing-je-modul.md`,
`docs/marketing-nastroje.md` a tenhle soubor. Původní zadání je
`FoodTab Marketing AI — Claude Code prompt v2.2`; tenhle soubor říká,
co z něj je hotové.

**Úkol: kalendář obsahu** (zadání, oddíl 15, obrazovka 9 z oddílu 22).
Je to druhá nejviditelnější chybějící věc: dnes se termín nastaví
u jednoho příspěvku a nikde není vidět, co kdy půjde ven. Restaurace
plánuje po týdnech, ne po příspěvcích.

Co má vzniknout:

1. **Měsíční a týdenní pohled** s filtrem podle pobočky, kanálu a stavu.
2. **Přesunutí termínu** s kontrolou oprávnění a auditním záznamem.
   Přesun schválené verze nesmí obejít to, co hlídají spouště.
3. **Varování před dlouhou mezerou** a před příliš častým publikováním.
4. **Koncept bez data** — ne všechno má termín.
5. Doporučený čas publikace **až tehdy, až budou vlastní data.** Do té
   doby průhledné výchozí pravidlo, ne vymyšlené číslo.

Pravidla, která tady platí zvlášť ostře:

- **Hodina na zdi není okamžik** (CLAUDE.md, pravidlo 11). Termín se
  převádí v databázi přes `marketing_okamzik`, nikdy
  `new Date('…T18:00')`. Ukládání a zobrazení se ověřují ZVLÁŠŤ.
- Kontrola, která závisí na kalendáři, musí platit i ve 23:50 a za
  týden (CLAUDE.md, „Testy, které závisí na kalendáři").
- Ke každé nové kontrole **rozbij schválně to, co hlídá, a přesvědč se,
  že spadne.** Napiš, co jsi rozbil a co spadlo.
- Nová obrazovka patří do `app/[rozsah]/nabidka.ts` — **před** obecnou
  položku `marketing`.

Nenasazuj. Nasazuje Šéfík z `main`. n8n nech vypnuté.

Až to bude, pokračuj podle pořadí v oddílu 6 (publikované příspěvky,
Facebook, kampaně, analytika).

---

## 8. Co padá a není to marketingem

Aby se to nehledalo znovu: pět kontrol relace **provoz** padá i bez
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
