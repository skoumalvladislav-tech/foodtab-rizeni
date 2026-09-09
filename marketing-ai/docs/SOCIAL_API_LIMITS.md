# Limity sociálních sítí — jak jsou zakódované

Všechna čísla níže jsou **z kódu**, ne z aktuální dokumentace Meta.
Vycházejí z dlouhodobě platných specifikací Instagramu a Facebooku;
z vývojového prostředí **nešlo ověřit** developers.facebook.com. Před
ostrým nasazením se ověřují proti oficiální dokumentaci
(`META_SETUP.md`, „Co ověřit ručně“) a mění se **jen v těchto dvou
souborech**:

- `lib/formaty.ts` — rozměry, poměry, délky, bezpečné zóny, velikosti
  souborů, délky popisků, počty hashtagů
- `lib/providers/social/meta.ts` — konstanta `META` (verze API,
  oprávnění, limit publikací, stavy kontejneru) a chování při chybách

## Formáty (`FORMATY`)

| Klíč | Kanál / formát v DB | Rozměr | Poměr | Druh | Délka | Bezpečná zóna (% shora/zdola/zleva/zprava) | Max soubor | Popisek | Hashtagy | Potřebná schopnost |
|---|---|---|---|---|---|---|---|---|---|---|
| `instagram_feed` | instagram / feed | 1080×1350 | 4:5 | obrázek | — | 4/4/4/4 | 8 MB | 2 200 zn. | 30 | `publish.instagram.feed` |
| `instagram_carousel` | instagram / carousel | 1080×1350 | 4:5 | obrázek | — | 4/4/4/4 | 8 MB | 2 200 | 30 | `publish.instagram.carousel` |
| `instagram_story` | instagram / story | 1080×1920 | 9:16 | obrázek | — | **14/20/6/6** (nahoře profil a nástroje, dole odpověď) | 8 MB | 0 | 0 | `publish.instagram.story` |
| `instagram_reel` | instagram / reel | 1080×1920 | 9:16 | video | 3–90 s | 14/22/6/**12** (vpravo ikony) | 250 MB | 2 200 | 30 | `publish.instagram.reel` |
| `facebook_post` | facebook / page_post | 1080×1350 | 4:5 | obrázek | — | 4/4/4/4 | 8 MB | 5 000 | 10 | `publish.facebook.post` |
| `facebook_reel` | facebook / reel | 1080×1920 | 9:16 | video | 3–90 s | 14/22/6/12 | 250 MB | 5 000 | 10 | `publish.facebook.reel` |
| `video_cover` | interní / cover | 1080×1920 | 9:16 | obrázek | — | 10/10/6/6 | 8 MB | — | — | — |
| `thumbnail` | interní / thumbnail | 1080×1080 | 1:1 | obrázek | — | 4/4/4/4 | 8 MB | — | — | — |
| `pdf_a4` | tisk | 2480×3508 | A4 (300 dpi) | pdf | — | 5/5/5/5 | 20 MB | — | — | — |
| `pdf_a5` | tisk | 1748×2480 | A5 | pdf | — | 5/5/5/5 | 20 MB | — | — | — |

Bezpečná zóna je oblast od okraje, kam šablona **nesmí** dát text —
Instagram tam překrývá vlastní prvky. Render (`lib/render/svg-sablony.ts`)
ji respektuje; při ověřování proti dokumentaci se dívejte hlavně na
Story a Reels (Meta ty překryvy občas mění).

Limit popisku Instagramu (2 200 znaků) a hashtagů (30) hlídá i Zod
schéma návrhu AI (`lib/providers/ai/schema.ts`: `popisek` max 2 200,
`hashtagy` max 30, formát `#bez-mezer`). Facebook 5 000 znaků je
konzervativní (limit stránky je vyšší), 10 hashtagů je doporučení, ne
technický limit.

## Nahrávání do knihovny (`UPLOAD_LIMITY`)

| Druh | Max | Povolené typy |
|---|---|---|
| obrázek | 25 MB, min. šířka 720 px (jen varování) | JPEG, PNG, WebP, HEIC/HEIF, SVG |
| video | 500 MB, 600 s | MP4, MOV (quicktime), WebM |
| zvuk | 50 MB | MP3, MP4 audio, WAV |
| dokument | 30 MB | PDF |

Tohle jsou limity **knihovny**, ne sítí. Do sítě jde vždy výstup
renderu (formát výše), ne originál — s jednou výjimkou: když varianta
nemá vykreslený výstup, fronta pošle zdrojové médium a napíše to do
varování (`naplanovat`).

## Meta Graph API (`META`)

| Položka | V kódu | Poznámka |
|---|---|---|
| verze | `v21.0` (`META_GRAPH_VERSION`) | **ověřit** — Meta verze pravidelně vypíná |
| oprávnění | `pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, instagram_manage_insights, business_management` | **ověřit názvy**; `business_management` možná zbytečné |
| limit IG publikací | **50 za 24 h** (`igPublishLimitPer24h`) | orientační; kód ho zatím **nevynucuje**, jen eviduje pro rozhraní |
| stavy kontejneru | `FINISHED`, `ERROR`, `IN_PROGRESS`, `PUBLISHED`, `EXPIRED` | čeká se max 20 × 3 s = 60 s |
| carousel | max **10** položek (`media.slice(0, 10)`) | |
| Reel | vyžaduje video; `share_to_feed = true` | |
| Story | jen profesionální účty; obrázek nebo video, bez popisku | |
| FB plánování | jen když je termín víc než **10 minut** v budoucnu; jinak hned | Meta limit bývá 10 min – 30 dní, **ověřit** |
| rate limit | kódy 4, 17, 32, 613 nebo HTTP 429 → retry za **15 min** | |
| vypršelý token | kód 190 → `failed`, stav obsahu `connection_required` | |
| metriky IG | `reach, impressions, likes, comments, shares, saved` | **ověřit** (Meta metriky přejmenovává, např. `impressions` → `views`) |
| metriky FB | `post_impressions, post_impressions_unique, post_engaged_users` | **ověřit** |

## Známé nesoulady, na které se přijde až u skutečné publikace

1. **SVG — vyřešeno.** Vestavěné vykreslení převádí SVG na **PNG**
   (`lib/render/rastr.ts`, přes `sharp`); obrázky nad 2 MB uloží jako
   JPEG. Meta tedy dostane formát, který přijímá. Pozor na dvě věci:
   písma se berou z `assets/fonty` a musí se dostat do nasazeného
   balíčku (jinak render skončí chybou — schválně, viz `DEPLOYMENT.md`),
   a tiskové formáty A4/A5 zůstávají SVG, protože se nepublikují.
2. **Rozlišení a poměr.** Instagram má pro feed povolený rozsah poměrů
   (zhruba 4:5 až 1.91:1) a minimální šířku; 1080×1350 je uvnitř, ale
   zdrojové médium bez renderu (viz výše) uvnitř být nemusí.
3. **Reels**: délka 3–90 s je v kódu; Meta u Reels přes API povolovala
   i delší videa — ověřit, ale 90 s je bezpečné.
4. **Story bez popisku**: `captionMaxChars: 0` — text se do Story dává
   jen do obrazu.
5. **Podepsané adresy médií platí 24 h** (`podepsatSoubor(id, 24*3600)`).
   Když Meta stahuje video déle (velké Reels) nebo kontejner zpracovává
   po vypršení, stažení selže. Ověřit, jak dlouho Meta adresu používá.
6. **Limit 50 publikací/24 h se nevynucuje** — při hromadné publikaci
   (např. Story pro každý den týdenního menu na více účtech) může Meta
   odmítnout a fronta to vyřeší retry; lepší je limit hlídat před
   plánováním.
7. **Facebook `page_post` bez média** je v mocku chyba, u Meta jde
   (`/{page}/feed {message}`) — mock je přísnější schválně, aby šel
   vyzkoušet retry.
