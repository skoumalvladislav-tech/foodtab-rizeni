# Krok 4 (renderer grafiky) — proč se dnes v noci nedodal, ani napůl

Zadání: `docs/hlaseni/zadani-pro-ai-marketing-faktury.md`, Krok 4.
Podmínka zadání: „Renderer buď kreslí a ověří písma, nebo ne.
Neodevzdávat napůl." Tenhle dokument je důvod, proč dnes v noci
nevznikl žádný kód ani commit k rendereru — jen zjištění, co brání
pokračovat, a jak na to hned navázat.

## Co je hotové a ověřené

- **`sharp` je nainstalovaný a funguje** — `require('sharp')` projde,
  umí vyrobit obyčejné PNG (ověřeno přímo v tomhle prostředí).
  V `package.json` zatím není jako přímá závislost (je tažený
  tranzitivně), to je snadná úprava.
- **Písma se dají obnovit z historie beze ztráty** — `assets/fonty/`
  (Archivo × 3, Newsreader × 2, licence OFL) existují v commitu
  `6cb7d72` a jdou zpátky se stejným git hashem (ověřeno
  `git hash-object` proti `git rev-parse 6cb7d72:...`, žádná
  poškození řádkování). Příkaz pro obnovení:
  ```
  git show 6cb7d72:marketing-ai/assets/fonty/<soubor> > assets/fonty/<soubor>
  ```
  pro všech sedm souborů (5 `.ttf` + 2 `LICENSE-*.txt`).
- **Tabulka `marketing_render_ulohy` už je nasazená** —
  `supabase/migrations/20260910000000_marketing_vystup.sql`. Žádná
  nová migrace pro tenhle krok není potřeba.
- Původní zdroj (`marketing-ai/lib/render/rastr.ts`,
  `svg-sablony.ts`, oba smazané před `d8a0b73`, dál čitelné přes
  `git show 6cb7d72:...`) je čistý, dobře zdokumentovaný a má
  vestavěnou **vlastní kontrolu písem**: vysází stejný text jednou
  písmem Newsreader a jednou neexistujícím písmem a porovná bajty
  výstupu. Když vyjdou stejně, písmo se nepoužilo a převod má spadnout
  — místo aby se roznesly příspěvky v cizím písmu.

## Kde to uvázlo

Ta samá kontrola (spuštěná ručně, stejná logika jako v `rastr.ts`)
**na tomhle Windows stroji nahlas řekne, že se písmo nepoužívá** — obě
varianty (Newsreader i neexistující písmo) vyjdou jako identických
6037 bajtů. Vyzkoušeny dva způsoby, jak `sharp`/`librsvg` navést na
naše písmo, a selhaly stejně:

1. **`FONTCONFIG_PATH`** — přesně postup z originálu (dočasná složka
   s `fonts.conf`, ukazatel na `assets/fonty`). Vyzkoušeno dvakrát —
   nastavené z Node.js před prvním použitím `sharp` i nastavené na
   úrovni shellu ještě před startem Node procesu (aby nešlo o pořadí
   inicializace nativního modulu). Stejný výsledek obakrát.
2. **Font vložený přímo do SVG** (`@font-face` s `data:font/ttf;base64,…`
   uvnitř `<style>`) — na papíře přenositelnější, protože nezávisí na
   systémovém fontconfigu vůbec. Výsledek stejný: identické bajty jako
   s neexistujícím písmem.
3. **Nativní `sharp({ text: { fontfile: … } })`** (create image z textu,
   ne SVG) — `sharp.versions` u týhle instalace hlásí `fontconfig` i
   `pango` jako zabalené (`2.17.1` / `1.57.0`), takže šlo o rozumný
   předpoklad, že cesta k souboru předaná přímo mine fontconfig úplně.
   Výsledek stejný jako u prvních dvou — identické bajty jako
   s neexistujícím písmem, i s reálně existujícím souborem na disku
   (ověřeno `git hash-object` znovu po prvním úklidu).

Čtyři různé přístupy, stejný výsledek, ověřeno dvakrát nezávisle na
sobě (jednou 14. 9. večer, jednou 15. 9. po smazání a čerstvém obnovení
písem) — tohle už není otázka konfigurace, kterou by šlo odsud doladit.

Text se vykresluje — není prázdný, není chyba za běhu — ale vždycky
nějakým náhradním písmem, bez ohledu na to, co SVG žádá. To ukazuje na
omezení konkrétně WINDOWS sestavení `sharp`/`libvips`/`librsvg`
(pravděpodobně chybějící font/pango vrstva), ne na chybu v přístupu
samotném.

## Proč se to neodevzdalo „aspoň zkusmo"

Cílová platforma je Vercel (Linux/Lambda), ne tenhle notebook. Původní
kód byl zjevně napsaný a laděný pro Linux — `FONTCONFIG_PATH` tam
pravděpodobně funguje přesně jak popsáno. Jenže **odsud se to
neověří**: nasazení na Vercel kvůli vyzkoušení by bylo produkční
nasazení bez svolení, a to se nedělá autonomně. Zůstala by tak jen
možnost odevzdat kód, který na jednom prostředí prokazatelně
neprojde vlastní kontrolou písem — přesně to, co zadání zakazuje.

## Jak na to navázat

1. Ověřit `FONTCONFIG_PATH` postup (originál, beze změny) v prostředí
   blízkém Vercelu — Linux kontejner nebo přímo zkušební nasazení,
   které Šéfík schválí.
2. Pokud tam kontrola projde: přenést `svg-sablony.ts` a `rastr.ts`
   1:1 (jsou hotové, jen se dřív mazaly z `marketing-ai/`), obnovit
   písma podle příkazu výš, přidat `sharp` do `package.json` napřímo,
   napojit na `marketing_render_ulohy`.
3. Pokud tam kontrola NEPROJDE ani na Linuxu: hledat jinou cestu
   (např. jiná verze `sharp`/`libvips` se skutečnou fontconfig
   podporou, nebo úplně jiný rasterizer) — vlastní kontrola písem
   v `rastr.ts` je přesně k tomu, aby se tohle poznalo hned, ne až
   u zákazníka.

Do repozitáře dnes nešlo nic — ani písma samotná (aby nevznikl dojem,
že je něco částečně zapojené, když není).
