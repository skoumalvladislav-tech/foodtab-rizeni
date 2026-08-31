# Noční práce — 1. 9. 2026

Pracuješ samostatně. Šéfík spí a nikdo ti neodpoví.

---

## Tvrdá omezení

Tohle je důležitější než stihnout všechno.

- **`supabase db push` NE.** Ani jednou. Migrace napiš, commitni;
  Šéfík je nechá projít testy a nasadí ráno.
- **Ostrá data neměň.** Žádné mazání, žádné opravy „při té příležitosti".
- **Nesahej na `lib/supabase/server.ts`.** Do `lib/authz.ts` smíš jen
  přidávat klíče oprávnění do `PERMISSIONS`, nic jiného.
- **SQL a víceřádkové bloky piš editorem, ne přes shell.** Rozbil ti
  uvozování už třikrát — naposledy `do $` místo `do $$`, kvůli čemuž
  neproběhla polovina testů.
- **Nedomýšlej si.** Když rozhodnutí není v `docs/`, zastav ten bod,
  napiš otázku a jdi na další.
- **Commituj po každém dokončeném kroku.**

---

## Pořadí

### 1. Pozvánka obchází strop — NEJDŘÍV, je to bezpečnostní díra

`app.create_invitation` neuplatňuje `app.smi_pridelit`. Šéfík to ověřil
samostatnými dotazy, nezávisle na testu:

```
provozní má payroll.read?                    ne
účetní má payroll.read?                      ano
smi_pridelit(Účetní)?                        NE
pozvánka s rolí Účetní odmítnuta?            NE   ← projde
```

Funkce odpovídá správně, `create_invitation` se jí neptá. Provozní tedy
pozvánkou přidělí roli, kterou přes `memberships` přidělit nemůže —
tatáž díra, jen jinou cestou.

Dokud tohle neplatí, **migrace `20260901110000` se nesmí nasadit**.
Zavírá dvě ze tří cest a budila by falešný pocit bezpečí.

### 2. Dvě opravy v testech

- `krok4_scenar.sql:530` → `do $$`, `:557` → `end $$;`
- Kontrola „finance.read nedává ve firmě bez modulu nic ani vlastníkovi"
  stojí na premise, která neplatí — **testovací firma modul Finance
  zapnutý MÁ**. Pozastav ho na tu chvíli a zase zapni. Povolené hodnoty
  jsou `active` / `trial` / `suspended`, ne `paused`.

Po 1 a 2 musí `supabase/tests/run.sh` projít celý.

### 3. Osobní údaje — `docs/osobni-udaje-zadani.md`

Klíčové a snadno se to poplete: **informovat, ne žádat o souhlas.**
Tlačítko je **„Beru na vědomí"**, ne „Souhlasím". Souhlas se u zaměstnanců
nepoužívá, protože není svobodný a jde odvolat.

Z toho zadání dnes v noci udělej:

- sloupce `phone` a `email` na `employees` (RLS, audit)
- **`address` zatím NE** — Šéfík ještě nerozhodl, jestli ji aplikace
  potřebuje. Nech to jako otázku.
- tabulka verzí informačního textu + záznam „vzal na vědomí"
  (kdo, kdy, která verze)
- zobrazení při prvním přihlášení a po změně verze
- volitelné souhlasy zvlášť (fotka, narozeniny), odvolatelné,
  a **odvolání musí něco udělat**
- obrazovka „Moje údaje" — vidět, opravit, vyexportovat

**Právní text nepiš.** Vlož zástupný text viditelně označený jako
nehotový. Aplikace, která ukáže vymyšlený právní text jako závazný,
je horší než ta, která neukáže nic.

### 4. Upozornění na změnu směn — `docs/upozorneni-smeny-zadani.md`

Rozpis dostane stavy **rozpracovaný / vydaný**. Upozornění odchází až
při vydání, ne při každé úpravě.

Dnes v noci stačí:

- stav rozpisu a tlačítko **Vydat**
- porovnání proti stavu při posledním vydání
- **jedna zpráva na člověka**, ne jedna na směnu, a jen jeho směny
- náhled před vydáním („odejde 6 zpráv 4 lidem")
- zvoneček v aplikaci s počtem nepřečtených

E-mail, push ani SMS dnes ne.

Zrušená směna se **nemaže**, jen označuje `cancelled` — jinak zmizí
i záznam, že byla vydaná, a člověk se nedozví, že už nikam nemusí.

### 5. Ruční zadání docházky — `docs/dochazka-qr-zadani.md`, oddíl 4

Z celého toho zadání dnes **jen ruční zadání**. QR kiosk ne.

- ruční záznam je **označený jako ruční**, s tím kdo a proč
- zadat smí jen `attendance.manage`
- jde do auditu
- zaměstnanec si ho sám nezadá

Je to nejmenší kus a potřebný tak jako tak: dokud ruční zadání
nefunguje, nemá QR kam ustoupit, když selže.

---

## Ranní zpráva

Chci v ní tohle, i když to bude vypadat hůř:

- co je hotové a commitnuté
- **co jsi NEOVĚŘIL a proč** — build a lint nejsou ověření vzhledu
  ani chování
- na čem ses zastavil a jakou otázku to čeká
- obrazovky, na které jsi nedošel

Nedodělaná věc, o které vím, je lepší než dodělaná, o které si to jen
myslím.

**Nedělej body 4 a 5, když 1 až 3 nejsou hotové.** Bezpečnostní díra
má přednost před vším ostatním.
