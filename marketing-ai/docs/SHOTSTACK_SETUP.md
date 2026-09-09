# Shotstack — render videí a obrázků

Adaptér `shotstack` (`lib/providers/render/shotstack.ts`) posílá do
Shotstack Edit API JSON s časovou osou a Shotstack z ní vyrobí MP4
(Reels z fotografií, střih klipů, titulky) nebo PNG. Je to
**doporučený video renderer**; bez něj běží `internal_mock_video`,
který žádné video nevytvoří (jen storyboard a titulní snímek).

> **Stav:** adaptér je napsaný, ale **nebyl spuštěn proti skutečné
> službě** (chybí klíč). Endpointy a tvar časové osy vycházejí
> z veřejného Shotstack Edit API; z vývojového prostředí nešlo otevřít
> shotstack.io. Vstupní adresy dokumentace zadané z paměti:
> https://shotstack.io/docs/ a https://shotstack.io/docs/guide/ .
> Před ostrým nasazením projděte „Co ověřit ručně“.

## 1. Účet a klíč

1. Registrace na https://shotstack.io/ . Bezplatný tarif dává
   **sandbox** (prostředí `stage`) — video s vodoznakem, zdarma, na
   vyzkoušení celého toku.
2. V dashboardu jsou dva klíče: **Sandbox (stage)** a **Production
   (v1)**. Zkopírujte ten, který odpovídá zamýšlenému prostředí.
3. Kam klíč patří:
   - **zákazník platí sám** (`customer_managed`): v aplikaci
     Integrace → Shotstack → vložit klíč a zvolit prostředí. Klíč se
     zašifruje (AES-256-GCM) a uloží přes `marketing.store_secret`;
     v `credentials` je pak `{ api_key, env }`.
   - **FoodTab platí** (`foodtab_managed`): `SHOTSTACK_API_KEY` a
     `SHOTSTACK_ENV` v prostředí serveru.

## 2. `stage` vs. `v1`

| | `stage` | `v1` |
|---|---|---|
| Adresa (`ENDPOINTS`) | `https://api.shotstack.io/edit/stage` | `https://api.shotstack.io/edit/v1` |
| Cena | zdarma | podle tarifu, účtuje se za minuty renderu |
| Výstup | s vodoznakem | čistý |
| Kdy | vývoj, ukázky, ověření časové osy | ostrý provoz |

Výchozí je `stage` — když si nikdo prostředí nevybere, aplikace nikdy
nezačne účtovat.

## 3. Callback

Render je asynchronní. Aplikace posílá v požadavku
`callback: "{APP_URL}/api/v1/webhooky/shotstack"` a zároveň si stav
hlídá dotazem `GET /render/{id}` z fronty (`lib/domena/fronta.ts`,
`dokoncitRendery`; první kontrola po 20 s, další po 30 s). Callback
tedy zrychlí dokončení, ale bez něj to funguje také — fronta se doptá.

Když je render `done`, fronta stáhne soubor z `response.url`, uloží ho
do úložiště jako nové médium (`ulozitRenderVystup`) a připojí
k variantě obsahu (`content_variants.output_asset_id`). Teprve pak jde
publikovat jako video.

`APP_URL` musí být veřejně dosažitelná: Shotstack si z ní stahuje
zdrojové fotky a videa přes podepsané adresy (platnost 6 h).

## 4. Jak se skládá časová osa ze storyboardu (`sestavitTimeline`)

Vstupem je `RenderRequest` (`lib/providers/types.ts`): storyboard po
scénách z návrhu AI (`poradi`, `druh`, `sekundy`, `mediaAssetId`,
`textVObraze`, `titulek`), média s podepsanými adresami a brand kit
(`colors.primary`, `colors.accent`, `fonts.heading`).

Postup v kódu:

1. Scény se seřadí podle `poradi`; každá dostane `start` (součet
   předchozích délek) a `length` (nejméně 0,5 s).
2. Scéna s médiem → klip `image` (efekt `zoomIn`, `fit: cover`,
   přechod `fade`) nebo `video` (bez zvuku, `volume: 0`).
   Scéna bez média → HTML klip s barevným pozadím `colors.primary`.
3. Text scény (`textVObraze` + `titulek`) → HTML klip v horní stopě:
   písmo `fonts.heading` (jinak Archivo), 64 px, bílé se stínem,
   `position: center`, `offset.y = -0.05`, přechod `slideUp`/`fade`.
   HTML se escapuje.
4. Přes celé video jde dole 12 px pruh v barvě `colors.accent` jako
   podpis značky.
5. Výsledek: `{ background, tracks: [ {clips: texty}, {clips: média} ] }`
   — texty ve vyšší stopě, aby byly nad obrazem.

Výstup: `output.format` `mp4` (video) nebo `png`, `size` podle formátu
(`lib/formaty.ts`, Reel 1080×1920), `fps: 25`.

Co adaptér **neumí**: hudbu (brand kit má `music_style`, ale do timeline
se nic nepřidává), voice-over (samostatný poskytovatel, `elevenlabs` je
jen „připravujeme“), titulky z řeči (`render.subtitles` je v katalogu
`partial` — jen text ze storyboardu).

## 5. Odhad ceny

`estimateCostCents(req)`:

- `stage` → 0,
- `v1` → `sekundy / 60 × 100 × 23 × 0,2` haléřů, tj. **orientačně
  0,20 USD za minutu renderu** přepočteno kurzem 23 Kč/USD. Patnáctivteřinový
  Reel ≈ 1,15 Kč.

Je to jen odhad pro `provider_usage_records` a `render_jobs.cost_estimate_cents`
— skutečnou cenu určuje tarif zákazníka (`pricing_url` v katalogu:
https://shotstack.io/pricing/ , neověřeno). Nikdy se z něj neúčtuje.

## 6. Test připojení

`testConnection()` zavolá `GET {base}/render/00000000-0000-0000-0000-000000000000`
s hlavičkou `x-api-key`. Platný klíč vrátí 404/400 (render neexistuje),
neplatný 401/403. Nic se nerenderuje, nic nestojí.

## 7. Co ověřit ručně před ostrým nasazením

1. **Adresy** `https://api.shotstack.io/edit/stage` a `/edit/v1`
   (`ENDPOINTS`) a hlavička `x-api-key`.
2. **`POST /render`** — tvar odpovědi `{ success, message, response: { id, message } }`.
3. **`GET /render/{id}`** — hodnoty `response.status` (`queued`,
   `fetching`, `rendering`, `saving`, `done`, `failed`) a pole
   `response.url`, `response.error`. Kód považuje `saving` za
   „rendering“ — ověřit, že to nespadne do jiné větve.
4. **Časová osa**: klíče `timeline.background`, `tracks[].clips[]`,
   `asset.type` (`image`, `video`, `html`), `fit`, `effect: "zoomIn"`,
   `transition.in/out` (`fade`, `slideUp`), `position`, `offset.y`,
   HTML asset s `width`/`height` a podpora vlastního písma v HTML
   (`font-family`) — zda Shotstack Archivo/Newsreader zná, nebo je
   potřeba `font` asset.
5. **`output`**: `format` (`mp4`, `png`), `size {width,height}`, `fps`;
   zda `png` výstup vyžaduje jiný typ požadavku než video.
6. **Callback**: název pole (`callback`), tvar POST těla, zda Shotstack
   podepisuje (v kódu se callback **neověřuje** — endpoint
   `/api/v1/webhooky/shotstack` musí výsledek vždy potvrdit vlastním
   dotazem `GET /render/{id}`, ne věřit tělu).
7. **Limity**: maximální délka videa, počet klipů, velikost zdrojových
   souborů, platnost podepsané adresy (6 h) vs. čekací fronta Shotstacku.
8. **Cena za minutu** v `estimateCostCents` a tarif sandboxu (vodoznak,
   kvóta).
9. **Rate limit** API (kód nemá retry na 429 u odeslání renderu; fronta
   opakuje jen dotazy na stav).
