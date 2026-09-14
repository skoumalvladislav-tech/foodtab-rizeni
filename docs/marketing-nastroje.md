# Marketing — Integrace a nástroje

Obrazovka `Marketing → Nástroje` (`/<rozsah>/marketing/nastroje`).
Napsáno 14. 9. 2026 podle zadání *FoodTab Marketing AI — Claude Code
prompt v2.2*, oddíly 3.1 a 6, obrazovka 14 z oddílu 22.

---

## 1. K čemu to je

Zadání označuje volbu nástrojů za **zásadní obchodní požadavek**:
zákazník si má sám vybrat, čím se mu generuje text, čím se renderuje
video a kudy se publikuje. Foodtab nástroje **doporučuje**, rozhodnutí
je zákazníkovo.

Do 14. 9. na to stála celá databáze (`marketing_pripojeni`,
`marketing_tajemstvi` z 9. 9.), ale **obrazovka, na které si to zákazník
vybere, neexistovala** — připojení se dalo založit jedině ručně
v Supabase. Každý další kus modulu tak stál na tom, že to za zákazníka
někdo naklikal potají.

---

## 2. Co je kde

| Vrstva | Soubor | Co v něm je |
|---|---|---|
| Katalog | `lib/marketing-katalog.ts` | Výčet nástrojů, kategorií a režimů. Produktová data, ne provoz |
| Zkouška spojení | `lib/marketing-spojeni.ts` | Co se dá o připojení ověřit, než se zapne |
| Obrazovka | `app/[rozsah]/marketing/nastroje/page.tsx` | Karty po kategoriích |
| Akce | `app/[rozsah]/marketing/nastroje/akce.ts` | Připojit, vyzkoušet, odpojit |
| Data | `marketing_pripojeni`, `marketing_tajemstvi` | Volba firmy a její klíče |
| Kontroly | `scripts/marketing-nastroje.test.mjs`, `supabase/tests/marketing10_scenar.sql` | |

**Katalog je v kódu schválně.** Pravidlo 1 z `CLAUDE.md` mluví o tom, co
má zákazník moct změnit — pobočky, role, lidi, jídla. Tohle je výčet
nástrojů, ke kterým Foodtab **umí mluvit**; nový řádek v databázi by
adaptér nevyrobil. Stejné dělení má `lib/marketing-sablony.ts`: katalog
je nabídka (kód), volba zákazníka je řádek (databáze).

---

## 3. Co dnes opravdu funguje

| Kategorie | Nástroj | Stav | Režimy |
|---|---|---|---|
| Texty a storyboard | Claude (Anthropic) | **podporováno**, doporučeno | účet Foodtabu, vlastní klíč |
| Texty | OpenAI | připravujeme | — |
| Grafika, Video | Shotstack | připravujeme | — |
| Mluvené slovo | ElevenLabs | připravujeme | — |
| Zveřejňování, Automatizace | n8n | **podporováno**, doporučeno | účet Foodtabu, nanečisto |
| Zveřejňování | Meta napřímo | připravujeme | — |
| Zveřejňování | Ruční zveřejnění | **podporováno** | ruční |
| Měření | Meta Insights | připravujeme | — |
| Upozornění | E-mail z Foodtabu | připravujeme | — |
| Vnější úložiště | OneDrive / Google Disk | připravujeme | — |

**„Připravujeme" neznamená tlačítko, na které jde kliknout.** Zadání to
říká doslova: *„pouhá položka v katalogu nesmí předstírat funkční
integraci."* Nástroj bez odzkoušeného adaptéru se na obrazovce ukáže —
ať je vidět, proč si ho nejde vybrat — ale tlačítko nedostane a
serverová akce ho odmítne i tomu, kdo si formulář přepíše.

### Proč n8n nemá zákaznický režim

`lib/marketing-n8n.ts` bere adresu i sdílené tajemství **z prostředí
serveru**. Vlastní n8n zákazníka by tedy šlo uložit, ale nikdy by se
nepoužilo. Dokud to platí, `zakaznicky` v jeho režimech není — a hlídá
to kontrola, která čte ten zdroják.

### Proč Meta napřímo zůstává „připravujeme"

Zadání ji doporučuje (oddíl 6, „Přímé Meta propojení"), ale projekt se
rozhodl publikovat přes n8n: přístup k účtu Černé Perly tam leží od
srpna a druhé místo s týmž tokenem znamená, že se při odvolání na jedno
z nich zapomene. Je to **rozhodnutí, ne nedodělek** —
`docs/marketing-je-modul.md`. Kdyby se přehodnotilo, patří sem
serverový OAuth průvodce podle oddílu 6 zadání.

---

## 4. Co obrazovka dělá

Karta pro každou kategorii ukazuje:

- **stav** připojení (nepřipojeno / připojuje se / připojeno / vyžaduje
  pozornost / chyba / odpojeno),
- **rozsah** — celá firma, nebo tahle provozovna,
- **režim** — vlastní účet zákazníka / spravuje Foodtab / ruční export /
  demo,
- **čas a výsledek poslední zkoušky**,
- co nástroj **umí a neumí** (ne co má v ceníku, ale co projde naší
  cestou),
- kdo platí, odkaz na oficiální návod,
- a hlavně: **co se děje, když připojené není nic.**

Poslední bod je tam kvůli větě ze zadání: *„Neimplementuj podmínku typu
,bez Shotstacku/n8n nelze aplikaci používat'."* Bez připojení se
příspěvek dál připraví, schválí a naplánuje — jen ho člověk zveřejní
sám.

### Zkouška je před připojením, ne po něm

Pořadí je zkouška → teprve pak řádek. Kdyby se zakládalo napřed,
zůstalo by po nepovedeném pokusu připojení ve stavu `chyba` i s klíčem,
který nikdy nefungoval.

**Zkouška říká jen to, co opravdu ověřila.** U Anthropicu se zavolá
výpis modelů — nejlevnější dotaz, který projde celým ověřením klíče.
U n8n se to udělat **nedá**: jediná adresa, kterou Foodtab zná, je
webhook, který příspěvky *zveřejňuje*. Poslat na něj cokoli „na
zkoušku" znamená riskovat příspěvek na Instagramu firmy. Proto se
u n8n ověří jen to, že je adresa a tajemství nastavené, a hláška to
nahlas řekne.

---

## 5. Klíče

- Ukládají se **zašifrovaně** (AES-256-GCM, `lib/marketing-klice.ts`),
  do databáze jde šifra a otisk — nikdy čitelný klíč (pravidlo 7).
- Šifrovací klíč je v prostředí jako `MARKETING_KLIC_SIFRY`
  (64 znaků hexadecimálně). **Bez něj se zákaznický klíč neuloží** a
  obrazovka to řekne dopředu; žádný náhradní režim.
- Po uložení se klíč **nevrací na obrazovku**, ani zakrytý. Kdo si ho
  nepamatuje, vygeneruje si u poskytovatele nový.
- Při odpojení se klíč **maže doopravdy**. Co po něm zůstane, je otisk
  v auditu.
- Tabulka `marketing_tajemstvi` nemá pro `authenticated` žádný grant —
  chodí se k ní třemi funkcemi, které se ptají na `marketing.publish`.

### Co se u toho 14. 9. opravilo

Funkce na klíče ležely ve schématu `app`. **PostgREST vystavuje jen
`public`** (`supabase/config.toml`), takže
`supabase.rpc('marketing_precti_tajemstvi')` z aplikace neprošlo nikdy —
a obrazovka to brala jako „zákazník nemá připojenou vlastní AI".
Vlastní klíč zákazníka tedy **tiše nedělal nic**.

Opravuje `20260914100000_marketing_klice_verejne.sql`: tři obálky
v `public`, které nedělají nic než volání těch v `app`. Nejsou
`security definer` — jinak by se `app.has_access` uvnitř ptalo na práva
vlastníka, tedy na nic.

Hlídají to dvě kontroly: `marketing10_scenar.sql` (obálky jsou v
`public`, nejsou definer, práva nepřidaly) a v
`scripts/marketing-nastroje.test.mjs` porovnání **všech** `rpc` volání
marketingu proti migracím — protože tahle třída chyby se v běhu tváří
jako prázdná odpověď, ne jako chyba.

---

## 6. Co se změnilo v plánování příspěvku

Volba „Zveřejnit" u naplánování brala natvrdo
`{ rezim: 'zakaznicky', poskytovatel: 'n8n' }`. Bylo to špatně dvakrát:
`zakaznicky` znamená účet zákazníka, jenže n8n se volá účtem Foodtabu —
a hlavně se tím zveřejňovalo i tehdy, když si firma žádný nástroj
nevybrala.

Teď se čte připojení kategorie `publikovani` (pobočkové přebíjí
firemní) a do úlohy se zapíše i `pripojeni_id`. Když připojené nic
není, „Zveřejnit" se nenabídne a obrazovka pošle člověka do Nástrojů —
ruční cesta zůstává.

---

## 7. Co tady ještě není

- **Průvodce prvním spuštěním** (oddíl 6 zadání) — otázky na priority
  a z nich doporučená sestava. Katalog na to má všechno, co potřebuje.
- **OAuth** u kteréhokoli nástroje. Dnes jen vlastní klíč.
- **Sledování spotřeby a nákladů** po firmě, pobočce a období
  (oddíl 6). Sloupce na to nejsou.
- **Účty sítí** (`marketing_ucty`) se z obrazovky nezakládají — tabulka
  stojí, plní ji zatím jen ruka.
- Ceny nástrojů se schválně **nikde neuvádějí číslem**. Zadání říká, že
  cena nesmí být zapsaná v aplikační logice; je tam odkaz na návod
  a větu o tom, kdo platí.
