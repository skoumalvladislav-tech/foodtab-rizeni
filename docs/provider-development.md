# Jak přidat nového poskytovatele (adapter) — stav k 2. 10. 2026

Povinný výstup nočního zadání (oddíl 14: "Dokumentuj přidání nového
poskytovatele"). Popisuje, jak se dnes přidává nový nástroj do Marketingu —
jediné místo v appce, kde "katalog poskytovatelů" opravdu existuje jako
vzor (viz `docs/finance-marketing-audit.md`, bod 7 — obecný registr napříč
kategoriemi POS/banka/mailbox dnes neexistuje).

## Kde se co píše

| Soubor | Co |
|---|---|
| `lib/marketing-katalog.ts` | Metadata nástroje — `POSKYTOVATELE: Poskytovatel[]`. Jediné místo, kam se nástroj PŘIDÁVÁ. |
| `lib/marketing-spojeni.ts` | `otestovatSpojeni()` — zkouška spojení, než se připojení aktivuje. |
| `lib/marketing-odeslani.ts` | `odeslat()` — co se stane při skutečném odeslání úlohy z fronty. |
| `lib/marketing-klice.ts` | Šifrování zákaznických tajemství (AES-256-GCM), beze změny per nástroj. |
| `app/[rozsah]/marketing/nastroje/*` | Obrazovka, kde si zákazník nástroj vybírá a připojuje. |

## Krok 1 — položka v katalogu

Přidej záznam do `POSKYTOVATELE` v `lib/marketing-katalog.ts`:

```ts
{
  klic: 'novy-nastroj',
  nazev: 'Název, jak ho zákazník zná',
  kategorie: ['ai_text' /* nebo jiná z Kategorie */],
  kCemu: 'Jedna věta, k čemu to je.',
  prinos: '...',
  omezeni: '...',          // co to NEumí, řekni rovnou
  slozitost: 'snadne' | 'stredni' | 'narocne',
  uctovani: '...',
  doporuceny: false,
  podporovany: false,      // DOKUD adaptér neexistuje a není odzkoušený
  rezimy: [],              // prázdné, dokud podporovany === false
  pole: [ /* jaké údaje se zadávají, tajne: true u klíčů/tokenů */ ],
  umi: [],                 // co OPRAVDU projde naší cestou
  neumi: [],               // co ne — i když to poskytovatel v ceníku má
  platiZakaznik: true,
}
```

**Pravidlo, které se nesmí obejít** (zadání, oddíl 3.1 — "Funkce aplikace
aktivuj podle skutečných capabilities, ne podle názvu poskytovatele"):
`podporovany: false` dokud adaptér skutečně nefunguje a není otestovaný.
Katalogová položka s `podporovany: false` se v UI ukáže (ať je vidět, že
existuje a proč na ni není tlačítko), ale `lzePripojit()` ji odmítne.
`umi`/`neumi` se nepíšou podle toho, co nástroj UMÍ OBECNĚ, ale podle toho,
co projde NAŠÍ cestou — rozdíl je zásadní (např. n8n dnes publikuje na
Instagram/Facebook, ale "vlastní n8n zákazníka" v `rezimy` není, protože
se dnes volá podle adresy ze serverového prostředí, ne per-tenant).

## Krok 2 — zkouška spojení

V `lib/marketing-spojeni.ts:otestovatSpojeni()` přibude větev pro nový
`klic`. Pravidlo z hlavičky souboru, které platí i pro nový nástroj:
**zkouška smí tvrdit jen to, co opravdu ověřila.** Pokud nejde bezpečně
"zazkoušet nanečisto" (typicky publikační webhook — cokoli na něj poslané
může skutečně zveřejnit příspěvek), zkouška ověří jen dostupnost
konfigurace (adresa + tajemství nastavené) a HLÁŠKA TO ŘEKNE NAHLAS — ne
"Připojeno ✓" jako by to bylo totéž co ověřený klíč.

## Krok 3 — skutečné odeslání

Dnešní `lib/marketing-odeslani.ts:odeslat()` směruje všechno (kromě
`demo`/`rucni` režimu) přes `predatN8n()` — není to "if podle poskytovatele",
protože n8n je dnes JEDINÁ cesta ven pro publikování. **Nový publikační
nástroj, který NEJDE přes n8n** (např. přímé napojení na Meta Graph API bez
prostředníka), bude první skutečný druhý adaptér v týhle kategorii — a
teprve TEHDY dává smysl postavit obecné rozhraní
(`interface Publisher { odeslat(), otestuj() }` s mapou klíč→implementace)
místo dalšího `if (poskytovatel === '...')`. Nestavět ho preventivně bez
druhého konkrétního adaptéru po ruce (riziko špatně odhadnuté abstrakce —
viz `docs/finance-marketing-audit.md`, kde je přesně tahle úvaha rozepsaná).

**Nástroj mimo kategorii "publikování na sociální síť"** (Dotykačka POS,
banka, mailbox) nemá dnes VŮBEC žádný sdílený vzor — `lib/marketing-katalog.ts`
je specifické pro marketing. Pro první takový adaptér (podle P1 priority
zadání: Dotykačka) bude potřeba navrhnout obdobu katalogu + capability
mapy pro kategorii "pokladna", ne rozšiřovat marketingový katalog.

## Krok 4 — tajemství

Zákaznické klíče/tokeny jdou přes `lib/marketing-klice.ts` do
`marketing_tajemstvi` (šifra + otisk, žádný grant pro `authenticated`,
čtení/zápis jen přes `security definer` RPC, které si tenant dohledá SAMO
z `marketing_pripojeni.tenant_id` — nikdy z parametru klienta). Nový
nástroj recykluje tenhle vzor beze změny; nevymýšlej nové úložiště.

## Krok 5 — testy

**Mezera zjištěná při psaní tohohle dokumentu**: `lib/marketing-katalog.ts`
a `lib/marketing-spojeni.ts` dnes NEMAJÍ vlastní `scripts/*.test.mjs` —
ověřeno výpisem `scripts/` adresáře, žádný soubor s těmito názvy
neexistuje. Nová větev zkoušky spojení nebo nová katalogová položka se
tedy dnes neověří žádným automatizovaným testem, jen ručně přes UI. Než
se přidá další poskytovatel, stálo by za to napsat
`scripts/marketing-spojeni.test.mjs` (vzor: `scripts/faktury-filtry.test.mjs`
— falešné volání/proxy nad síťovým voláním) — mimo rozsah týhle dávky práce,
zapsáno jako samostatný dluh.

Integrace se NIKDY neoznačí jako "připojeno", dokud není skutečně ověřená
— testovací/demo adaptér se v UI i v hlášení pojmenuje jako testovací, ne
jako plnohodnotné připojení (zadání, oddíl 2).

## Co se tímhle vzorem NEŘEŠÍ (mimo rozsah)

- OAuth authorization-code flow k externí službě (Meta, Google) — dnešní
  vzor je statický token/klíč zadaný ručně, ne OAuth redirect. Nový vzor
  pro tohle by potřeboval token refresh cyklus a revoke endpoint, které
  dnes nikde v repozitáři neexistují (viz `docs/tenant-isolation.md`,
  "Provider-level izolace").
- Capability negotiation mezi víc instancemi STEJNÉHO poskytovatele
  (dva různé n8n účty) — `marketing_pripojeni` dnes drží jedno připojení
  na nástroj a rozsah (firma/pobočka), ne N instancí.
