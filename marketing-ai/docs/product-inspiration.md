# Inspirace: Metricool, Buffer, Later, Canva

Co z těch nástrojů přebíráme a jak je to v aplikaci řešené. Odkazy jsou
jen domovské adresy (z vývojového prostředí nešly weby ověřit; stav
jejich funkcí je popsaný podle obecně známých principů, ne podle
aktuální verze produktů).

- Metricool — https://metricool.com/
- Buffer — https://buffer.com/
- Later — https://later.com/
- Canva — https://www.canva.com/

Žádný z nich není přímý konkurent: jsou to nástroje pro **jednu
značku** nebo pro agentury, kde se každý klient nastavuje ručně.
Marketing AI míří na to, aby restaurace bez marketéra dostala hotový
návrh z toho, co dnes vaří — a aby to fungovalo pro mnoho firem
najednou bez ruční práce.

## Metricool — kalendář přes všechny kanály, plánování, metriky v jednom

| Princip | Jak je to u nás |
|---|---|
| Jeden kalendář pro všechny sítě, barvy podle účtu | `content_items.scheduled_at` + index `content_items_calendar_idx`; provozovna má `venues.color` (9 klíčů, ne odstínů) pro kalendář a přepínač. Obrazovka kalendáře zatím není. |
| Naplánovat a nechat nástroj publikovat ve správný čas | `publish_jobs.scheduled_for` a fronta (`lib/domena/fronta.ts`), časy jako okamžik + pásmo provozovny (`lib/cas.ts`, nikdy `new Date('…T18:00')`) |
| Přesun termínu tažením v kalendáři | `presunoutTermin` posune obsah i všechny naplánované úlohy; zveřejněný obsah přesunout nejde |
| Metriky (dosah, reakce, uložení) u každého příspěvku | `metric_snapshots` s `source` (`provider` / `mock` / `estimate`) a `is_estimate` — odhad je vždy označený, mock čísla nikdy nevypadají jako skutečná |
| Přehled „co je dnes, co čeká, co selhalo“ | přehled provozovny (`app/[provozovna]/prehled`): dnes naplánováno, ke schválení, blížící se, poslední příspěvky, chyby, nápady |

## Buffer — fronta, jednoduchý schvalovací tok, „ruční“ publikace

| Princip | Jak je to u nás |
|---|---|
| Fronta příspěvků s pevnými časy (queue) a evergreen recyklace | `content_items.is_evergreen`, `automations.kind = 'evergreen_queue'` (tabulka je, vykonávání zatím ne) |
| Schvalování v týmu: kdo tvoří, kdo schvaluje | role Editor (tvoří), Schvalovatel (rozhoduje), Manažer (obojí); žádost → rozhodnutí; **čtyři oči** — žadatel si vlastní žádost neschválí, když je jiný schvalovatel; schválení patří přesné verzi (spoušť v DB) |
| Připomínka k ručnímu zveřejnění tam, kde API nedovolí automat (dřív typicky Story) | stav `manual_export`: fronta pošle úlohu k ručnímu zveřejnění se souborem a textem a upozorní lidi s `content.publish` — místo falešného „zveřejněno“ |
| Opakování selhání, jasný stav | `failed` → retry s odstupem → `dead_letter`; tlačítko „Zkusit znovu“ (`zopakovatPublikaci`); `connection_required`, když vypršel token |
| Buffer jako zprostředkovatel API | v katalogu jako `buffer` — „připravujeme“, bez adaptéru; kdyby App Review Meta bylo pro menší zákazníky překážkou, je to připravená alternativa |

## Later — vizuální plánování, knihovna médií, „nejdřív fotka“

| Princip | Jak je to u nás |
|---|---|
| Mediální knihovna jako výchozí bod: nahraj fotky, pak z nich tvoř | `media_assets`, `media_collections` (11 systémových složek na provozovnu: fotografie jídel, videa, prostory, personál, akce, denní/víkendové menu, loga, hudba, hotové, archiv), tagy uživatelské i AI, hero fotka, dedup otiskem SHA-256 |
| Rychlý režim „fotka + věta“ | odkaz z přehledu `?rezim=rychly`; v doméně `vytvoritObsah` + `navrhnout` s mock/AI návrhem ve 3 variantách (věcná, přátelská, stručná) |
| Náhled, jak bude příspěvek vypadat v profilu | varianty obsahu s `spec` (rozměry, poměr, bezpečné zóny) z `lib/formaty.ts`; SVG render interním rendererem; obrazovka náhledu zatím není |
| Sdílení médií mezi účty/pobočkami s kontrolou | `venue_id NULL` = sdílené; přesun jen s `media.share` (spoušť `guard_media_move`) |
| Evidence, co se smí použít (obsah od hostů) | `author`, `license`, `consent_note`, `usable_until`; šablony o lidech vyžadují „Souhlas zaznamenán“ |

## Canva — brand kit a šablony, ale jako data

| Princip | Jak je to u nás |
|---|---|
| Brand kit: barvy, písma, logo, tón | `brand_kits` na provozovnu: barvy (5), písma (2), loga světlé/tmavé, tón hlasu, CTA, povolené a zakázané výrazy, hashtagy, podpis, umístění loga s bezpečnou zónou, intro/outro pro Reels, hudba, hlas, výchozí délka videa. **Adresy a telefony se nevymýšlejí** — demo pole jsou prázdná a označená |
| Šablony s „uzamčenými“ prvky značky | `lib/sablony/katalog.ts`: bloky s `locked: true` (logo, kontakt); organizace si šablonu duplikuje (`parent_template_id`) a upraví jen povolené části |
| Automatický resize do formátů (feed, story, tisk) | jedna šablona → víc formátů (`formats`), rozměry a bezpečné zóny z `lib/formaty.ts`; render pro každý formát zvlášť |
| Text se nikdy neusekne, dlouhý obsah se rozdělí | `textRules`: `noTruncation: true`, `minFontPx`, `itemsPerSlide`, `splitLongMenus`; test scénář 6 hlídá dlouhé názvy s diakritikou a přetečení na další slide |
| Canva jako runtime? | **Ne.** Podle `docs/marketing-zadani.md` (kořen repozitáře) Canva API neumí automatické vyplnění šablony daty, takže může být nanejvýš návrhový nástroj pro člověka, který šablony kreslí. Šablony jsou u nás data, render je interní SVG nebo Shotstack. |

## Co schválně neděláme

- **Autopublikace bez schválení** (mnoho nástrojů to má jako výchozí).
  U nás je schválení vázané na otisk verze a hlídá ho databáze;
  `auto_publish` u kampaně je vypnuté a nic ho nezapne.
- **AI, která si vymýšlí ceny a data.** Fakta jdou jen ze schváleného
  menu; model hlásí, co chybí.
- **Vlastní editor grafiky.** Šablony jsou data, render je stroj;
  uživatel mění vstupy, ne pixely.
- **Skrytý mock.** Demo je vždy vidět (`published_mock`, štítek,
  hláška v přehledu).
