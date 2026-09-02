# Úkoly pro Codea — 2. 9. 2026 ráno

Migrace `20260902010000` až `20260902040000` jsou **nasazené** (ověřeno
`supabase migration list`, obě strany souhlasí). Databáze je hotová,
chybí k ní cesty na obrazovce.

Kiosek jsem prošel naostro v ostré aplikaci — vystavit kód,
zaregistrovat, kiosek, odvolat. Celý koloběh funguje. Podrobnosti
v `docs/kontrola-naostro-2026-09-02.md`.

Pořadí je záměrné: nejdřív dvě věci, které mají hotovou databázi
a chybí jim jen rozhraní, pak teprve nová funkce.

---

## 1. QR na kiosku

Na `/kiosek` se rotující kód pořád ukazuje jako **osm písmen**.
Ověřil jsem to v DOM: v celém `<main>` není `canvas`, `svg` ani `img`.
Není to nevykreslený QR — není tam vůbec.

Samotný QR by ale nepomohl: na Docházce je políčko, do kterého se
kód **píše ručně**, žádná čtečka tam není. Šéfík proto rozhodl, že
QR ponese **odkaz s předvyplněným kódem** a číst se bude **běžným
fotoaparátem telefonu**.

**Celé zadání je v `docs/qr-na-kiosku-zadani.md`.** Přečti ho celé —
jsou tam čtyři věci, na kterých to jinak spadne, a dva případy
(vypršelý kód, nepřihlášený člověk), na které se zapomíná.

## 2. Pozastavení záloh — obrazovka

Migrace `20260902040000_pozastaveni_zaloh` je nasazená, ale na
`/[pobocka]/zalohy` ani u člověka **není nic, čím by se to zaplo**.
Funkce v databázi je, cesta k ní chybí.

- Přepínač **u člověka**, ne u pobočky.
- Pozastavený člověk **zmizí ze seznamu „KOMU"** ve formuláři na
  výplatu.
- Kdyby na to někdo šel přímo voláním, odmítnout s větou, která říká
  proč — ne „nepovedlo se".
- Zapnutí i vypnutí jde do auditu, jako u volby zobrazení.
- Už vyplacené zálohy se nemění. Pozastavení platí dopředu.

## 3. Příchod na jedné pobočce, odchod na druhé

Nové zadání ze stejného dne: `docs/prechod-mezi-pobockami-zadani.md`.

Dobrá zpráva je, že tři čtvrtiny už fungují — kiosek kód z druhé
pobočky přijme, obrazovka nabídne správné tlačítko a mzda se spáruje.
Rozbité je hlavně `nedokoncena_dochazka`, která to seskupuje po
pobočkách, a odvození provozního dne.

**Bod 2.2 udělej, i když dnes nevadí.** Je to chyba, která čeká na
změnu nastavení a pak tiše sní hodiny.

## 4. Upozornění na přijetí pozvánky

Zadání je v `docs/upozorneni-na-prijeti-zadani.md`, nic k němu
nepřidávám. Připomínám jen dvě věty odtamtud, protože se na nich
nejčastěji chybuje:

- Okno se ukazuje **jen když někdo čeká na oprávnění**.
- **Do rozhraní nepiš, že chodí push do mobilu**, dokud nechodí.

## 5. Dopsat, ať se to neptá počtvrté

- Strop na pobočku → `docs/pravidlo-neprideluj-vic.md`
  („rozsah smí přidělit jen správce lidí za celou firmu", vědomé
  rozhodnutí, ne díra).
- Zálohy jen na pobočce → `docs/kiosek-pin-zalohy-zadani.md`,
  oddíl o zálohách.

---

## Co dělám já

Přejmenování `skoumalvladislav` a dopsání srpnových odchodů si beru
na sebe, ať se nám to nekříží v jedné tabulce.
