# Stav k 11. 10. 2026 (večer) — banka: Salt Edge nejde, Komerční banka napřímo (ADAA), opravy synchronizace

## Nejdřív to podstatné

- **Napojení přes Salt Edge v appce nefunguje a fungovat nemůže.** Je
  napsané pro partnerské rozhraní Salt Edge (Partners API v1). To Salt
  Edge 16. 7. 2024 ohlásil jako ukončené a k 16. 7. 2025 jako smazané
  (docs.saltedge.com/v6/changelog). Kontrola průzkumu zjistila, že
  adresa ještě odpovídá, ale stavět na ní nejde. Proti živému API se to
  napojení nikdy nevyzkoušelo.
- **Váš účet u Salt Edge („FoodTab s.r.o.", Open Banking Gateway) je
  klientský.** Dokumentace v6 ho určuje pro firmy, které **mají vlastní
  licenci** k přístupu k účtům (PSD2/AISP). Foodtab ji nemá. Bez licence
  se dokumentovaně jde jen přes partnerský program Salt Edge, na pozvánku
  a se smlouvou. Jestli smí klientský účet připojit KB pod licencí Salt
  Edge, dokumentace neříká. Odpovědět musí Salt Edge písemně.
- **Stav účtu je Pending:** jen vymyšlené banky, nejvýš 10 připojení.
  Stav Test (skutečné banky, 100 připojení na 90 dní) je podle jejich
  podmínek „jen pro testování". Ostrý provoz (Live) vyžaduje písemnou
  smlouvu a technickou kontrolu.

> **ROZHODNUTÍ ŠÉFÍKA (11. 10. 2026):** Komerční banku připojit
> **napřímo přes KB — služba „Přímý přístup k účtu" (ADAA)**, bez
> agregátoru a bez licence. Salt Edge zůstává pozastavený, dokud
> písemně nepotvrdí licenci. Firma má účet v **MojeBanka Business**.
> Tím se mění rozhodnutí ze 7. 10. („první bankovní integrace přes Salt
> Edge Partners"), které stálo na ukončeném rozhraní.

- **Napojení na KB je napsané celé a čeká na vás:** registrace na
  portálu KB, klíče do Vercelu a aktivace v MojeBanka Business. Proti
  skutečné KB ještě neproběhlo — co přesně udělat, je v oddíle
  „Co čeká na Šéfíka" a v `docs/kb-adaa-navod.md`.

## Proč KB ADAA

Podle stránek KB je to služba pro **podnikatele a firmy** a pro jejich
vlastní systémy a účetní programy. KB sama uvádí desítky účetních
programů, které ji používají. Licence ČNB není potřeba (ta je jen pro
PSD2 přístup k cizím účtům).
- MojeBanka Business: 50 stažení měsíčně zdarma, stahování každou
  hodinu 100 Kč měsíčně, každých 10 minut 500 Kč měsíčně
  ([KB](https://www.kb.cz/cs/kbapi/sluzby-kb-api/primy-pristup-k-uctu)).
- Data: pohyby až 2 roky zpět, zůstatky (účetní i disponibilní),
  oznámení o pohybech, výpisy v PDF.
- Co bude potřeba: registrace na developers.kb.cz, **kvalifikovaný
  certifikát pro elektronickou pečeť** firmy (I.CA, kolem 858 Kč s DPH
  na rok, jen pro ostrý provoz), jednou za rok obnovit souhlas přes
  KB Klíč. Postup krok za krokem: `docs/kb-adaa-navod.md`.

## Opravy synchronizace (PR #128, sloučený 11. 10.)

Tři chyby v kódu banky, na které průzkum narazil. Projevily by se
u každého agregátoru, i u napojení na KB:

| chyba | oprava | kde |
|---|---|---|
| „Synchronizovat teď" spouštělo u **každého** připojení synchronizaci Fio. U agregátoru nenašla token, přepnula připojení na „chyba" a hodinová úloha ho už nikdy nevzala | synchronizace se vybírá podle poskytovatele; synchronizace Fio navíc sama odmítne připojení, které není Fio | `lib/banka-synchronizace.ts`, `banka/akce.ts`, `lib/integrace-fio-sync.ts` |
| Po jediné přechodné chybě API přepnula synchronizace agregátoru připojení na „Vyžaduje pozornost" a úloha ho už nikdy nevzala (bere jen „Připojeno") | stav se nemění, jen se zapíše důvod; další běh to zkusí sám | `lib/integrace-saltedge-sync.ts` |
| Chyba zápisu zůstatku se tiše spolkla (supabase-js chybu nevyhazuje, try/catch nic nechytil) | chyba se zapíše k připojení jako poznámka | `lib/integrace-saltedge-sync.ts` |

Obrazovka Banka už netvrdí, že KB jde přes Enable Banking, ani že Salt
Edge jde přes partnerský program. U Salt Edge je místo formuláře
vysvětlení, proč je pozastavený.

Čísla: `scripts/banka-synchronizace.test.mjs` 6 kontrol, 2 schválná
rozbití, obě spadla na své kontrole. Synchronizace Salt Edge testy nemá
(je `server-only`), opravy v ní jsou ověřené jen typy a čtením.

## Komerční banka napřímo (ADAA) — co je hotové (větev `banka-kb-adaa`)

Napojení je napsané celé, **ale proti skutečné KB ještě neproběhlo ani
jednou** — chybí registrace na portálu KB a klíče (viz „Co čeká na
Šéfíka"). Bez nich karta v appce jen vysvětlí, co chybí, a nic nenabízí.
Databáze se nemění, db push není potřeba.

**Jak to funguje pro uživatele** (Finance → Integrace → Banka →
„Komerční banka — přímé napojení"): vybere platební účet a od kdy
načíst pohyby, KB ho přihlásí KB Klíčem, potvrdí registraci aplikace
a souhlas, vybere účet. Zpátky ve Foodtabu se účet připojí a hned
stáhne pohyby i s variabilním symbolem. Souhlas platí 12 měsíců; měsíc
předem appka upozorní a nabídne „Obnovit souhlas v KB".

| část | soubor |
|---|---|
| Volání KB (registrace, šifra AES-256-GCM, tokeny, účty, pohyby, zůstatky) — čisté funkce bez databáze | `lib/kb-adaa.ts` |
| Synchronizace jednoho připojení (zámek, zápis pohybů a zůstatků, stavy) | `lib/kb-adaa-sync.ts` |
| Podepsaný `state` pro návrat z KB (platí 30 minut) | `lib/kb-adaa-stav.ts` |
| Návrat z registrace a ze souhlasu | `app/api/integrace/kb/registrace`, `app/api/integrace/kb/vratit` |
| Obrazovka (karta, detail připojení, výběr účtu, obnova souhlasu, dokončení přerušeného připojení) | `app/[rozsah]/finance/integrace/banka/kb.tsx`, `akce.ts`, `page.tsx` |
| Hodinová úloha bere i KB | `app/api/uloha/banka-synchronizace/route.ts` |
| Pomocný příkaz na „software statement" (jednou ročně, na vašem PC) | `scripts/kb-software-statement.mjs` |
| Návod krok za krokem | `docs/kb-adaa-navod.md` |

Rozhodnutí, která jsem udělal sám (nejopatrnější varianta):

- **Jen čtení.** Appka žádá u KB pouze `adaa` (čtení účtu), ne platby.
- **1× denně, zůstatek ob den.** KB od 1. 11. 2025 dává 50 stažení
  měsíčně zdarma a počítá i zůstatky. Denní pohyby (~31) + zůstatek, jen
  když je poslední starší než 40 hodin (~15) se do 50 vejde. Interval jde
  u připojení změnit (častější stahování je u KB placené).
- **Pohyby po měsících s uloženým postupem.** Stáhnout celou historii
  najednou by u rušného účtu přeteklo a skončilo chybou pokaždé znovu.
  Jeden běh stáhne nejvýš 50 stránek, zbytek dotáhne příště.
- **Úloha zkouší připojení 1× za interval i po chybě** (počítá od
  posledního pokusu, ne úspěchu). Trvalá chyba by jinak stahovala a platila
  totéž stažení při každém spuštění úlohy (à 4 h). Chyba je vidět
  u připojení a „Synchronizovat teď" jde kdykoli.
- **Jeden účet KB = jeden platební účet.** Stejný účet KB (podle id i
  IBANu) appka k druhému platebnímu účtu nepřipojí — pohyby by se
  započítaly dvakrát.
- **Obnova souhlasu nesmí změnit účet.** Když nový souhlas v KB
  nezahrnuje dosud připojený účet, appka nic neuloží a starý souhlas
  zůstává.
- **Párování věří jen zaúčtovaným pohybům** (`BOOK`). Blokované (`PDNG`)
  se nezapisují — KB je později pošle znovu jako zaúčtované se stejným
  identifikátorem. Duplicity hlídá identifikátor KB `accountServicer`.
- **Přerušené připojení** (okno KB zavřené před návratem) zůstane
  „Připojuje se…" s tlačítkem „Dokončit připojení v KB" a jde dokončit
  na stejném platebním účtu. Jinak by ho blokovalo (jedno živé
  bankovní připojení na účet).

## Čísla — a z čeho jsou

- `scripts/kb-adaa.test.mjs`: **77 kontrol**, zapsáno do CI (`aplikace.yml`).
  Testují `lib/kb-adaa.ts` proti napodobeným odpovědím KB, tvar odpovědí
  podle oficiálního swaggeru a ukázek KB. **Neověřují skutečnou KB.**
- **27 schválných rozbití** (`lib/kb-adaa.ts`), každé spadlo na kontrole,
  na kterou mířilo: PDNG se zapíše, `entryReference` místo
  `accountServicer`, prohozený směr, záporná částka, VS se ztratí, jen
  první stránka, prohozený účetní/disponibilní zůstatek, zůstatek bez
  znaménka, šifra bez ověřovací značky, scope s platbami, `invalid_grant`
  jako dočasná chyba, `invalid_client` jako „obnovte souhlas", kód chyby
  jen malými písmeny, kód jen z OAuth tvaru, každé 401/403 jako chyba
  souhlasu, 429 jako trvalá chyba, částka přes 21 mil. Kč se zapíše,
  okno bez 7denního překryvu, víc než 2 roky zpátky, celá historie
  jedním oknem, smyčka bez konce po dohnání, bez stropu stránek, bez
  časového stropu, chyba zápisu nezastaví stahování, postup se neposune,
  plánování bez tolerance, plánování jen od úspěchu.
- **Netestované automaticky:** `lib/kb-adaa-sync.ts`, `lib/kb-adaa-ucty.ts`
  a oba návraty z KB (`server-only`, potřebují databázi a KB). Ověřené
  typy, lintem, čtením a kontrolou kódu (níž).
- `tsc --noEmit` a `eslint` na změněných souborech čisté; celá sada CI
  testů (74 souborů) lokálně prošla.

## Snímky obrazovky

Viděl jsem vykreslené (desktop i mobil 390 px) **dočasný náhled
s vymyšlenými daty**: kartu „Připojit", kartu bez nastavení, připojený
účet, souhlas brzy vyprší, výběr z více účtů. Na mobilu přetékal výběr
účtu s dlouhým IBANem — opraveno. **Neviděl jsem** skutečnou stránku nad
databází, stránky KB ani návrat z nich (bez klíčů nejdou).

## Co čeká na Šéfíka

Podrobně s příkazy v `docs/kb-adaa-navod.md`:

1. **developers.kb.cz** — registrace, aplikace, API klíče pro sandbox
   (Client Registration Sandbox, OAuth2, Account Direct Access).
2. Na svém PC spustit `scripts/kb-software-statement.mjs` pro sandbox
   (bez certifikátu) — vypíše „software statement".
3. Čtyři proměnné `KB_ADAA_*` do Vercelu (vložíte sám, nebo mi řekněte
   a vložím je já). Klíče neposílejte do chatu.
4. **MojeBanka Business**: Open banking → Přístup k účtům KB → Nastavení
   přímého přístupu k účtům přes API (statutár nebo zmocněnec).
5. Pro ostrý provoz **kvalifikovaný certifikát pro elektronickou pečeť**
   (I.CA nebo PostSignum, s názvem firmy a IČO, kolem 858 Kč ročně).
6. Poslat dotaz na **api@kb.cz** (text je v návodu, 6 otázek).
7. Sloučit PR s KB, až ho projdete (db push není potřeba).
8. Salt Edge: zatím nic nezakládat. Volitelně se jich zeptat, jestli
   klientský účet bez licence smí připojit KB pod jejich licencí.

## Na co jsem narazil a nešlo to

- **Dokumentace KB si místy odporuje** a rozhodne až sandbox: způsob
  přihlášení na token endpoint (`client_secret_post` v příkladech,
  `client_secret_basic` ve swaggeru — appka posílá podle příkladů),
  kódování `registrationRequest` (base64 nebo base64url — appka posílá
  base64), a jestli KB filtruje podle IP (Vercel pevnou IP nemá).
- Ukázkový kód KB v Node.js pro rozšifrování registrace je chybný
  (bere klíč jako text, ne dekódovaný z base64). Průzkum to ověřil na
  vzorových datech KB: funguje jen dekódovaný klíč, appka ho tak používá.
- První připojení s dlouhou historií spotřebuje víc stažení (každá
  stránka po 100 pohybech je jedno využití) — jednorázově, odhad v návodu.
- Dokumentace Salt Edge v6 si sama odporuje, jestli stav Test pustí
  skutečné banky (Statuses ano, Quick Start ne).

## Nenasazoval jsem

Nic. Žádný merge PR s KB, žádný db push, žádné proměnné ve Vercelu,
v Salt Edge ani na portálu KB jsem nic nezakládal.
