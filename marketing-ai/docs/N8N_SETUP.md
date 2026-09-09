# n8n — volitelná automatizace

n8n je **volitelný** poskytovatel kategorie `workflow_automation`. Jádro
aplikace na něm nezávisí: render, publikace i opakování řeší interní
fronta (`lib/domena/fronta.ts`, spouštěná přes
`POST /api/v1/ulohy/zpracovat`). n8n dává navíc napojení na cizí
systémy (Slack, e-mail, tabulky) a přehled běhů.

> **Stav:** adaptér `n8n` (`lib/providers/workflow.ts`) je napsaný, ale
> **nebyl spuštěn proti skutečné instanci n8n**. Workflow ve složce
> `n8n/` jsou importovatelné soubory s běžnými uzly; po importu je
> potřeba ověřit, že cesty API v1 odpovídají hotové implementaci.
> Dokumentace n8n (https://docs.n8n.io/ , zadáno z paměti) nešla
> z vývojového prostředí otevřít.

## 1. Co je ve složce `n8n/`

| Soubor | Spouští | Co dělá |
|---|---|---|
| `content-generation.json` | webhook `content.generate` z aplikace | zavolá `/api/v1/obsah/{id}/navrh` a vrátí `executionId` |
| `render-monitor.json` | webhook `render.submitted` | odpoví hned, pak každých 30 s zavolá frontu `/api/v1/ulohy/zpracovat` (ta dotáhne asynchronní render), nejvýš 20×  |
| `approval-notification.json` | webhooky `approval.requested` a `approval.decided` | pošle upozornění do externího kanálu (Slack/e-mail přes `NOTIFY_WEBHOOK_URL`) a **hned skončí** |
| `scheduled-social-publish.json` | každých 5 minut | zavolá frontu `/api/v1/ulohy/zpracovat` s `X-Cron-Secret` |
| `publish-retry-deadletter.json` | webhook `publish.failed` | při vyčerpaných pokusech upozorní (eskalace); jinak počká exponenciálně (1, 2, 4… minut, strop 30) a zavolá frontu `/api/v1/ulohy/zpracovat` |
| `metrics-sync.json` | denně 06:00 | zavolá `/api/v1/analytika/synchronizovat` |
| `connection-health.json` | každou hodinu | `GET /api/v1/health` a `POST /api/v1/integrace/test-vse` (otestuje zákaznická připojení, označí tokeny vypršející do 7 dní, upozorní správce) |
| `recurring-campaigns.json` | denně 07:00 | zavolá `/api/v1/ulohy/zpracovat?automatizace=1` — spustí zapnuté automatizace, které založí **koncepty ke schválení**, nikdy nepublikují |

Podrobný postup importu a tabulka proměnných je v `n8n/README.md`.

## 2. Import

1. n8n → *Workflows → Import from File* → vybrat JSON. Opakovat pro
   všech osm souborů (nebo jen ty, které chcete).
2. Po importu každý workflow **aktivovat** (přepínač vpravo nahoře).
   Webhookové workflow dostanou adresu
   `https://<n8n>/webhook/foodtab-marketing/<typ>` — to je přesně
   adresa, na kterou aplikace posílá (`{N8N_BASE_URL}/webhook/foodtab-marketing/{type}`).
3. Pro testování je k dispozici `/webhook-test/…` (tlačítko *Listen for
   test event*); aplikace na něj neumí přepnout, testujte curlem.

## 3. Proměnné prostředí n8n

Workflow čtou hodnoty přes `$env.…` — nastavují se v prostředí, kde n8n
běží (Docker `environment:`, `.env`, nebo v n8n Cloud *Variables*
s `$vars`, pak je nutné výrazy přepsat).

| Proměnná | Význam |
|---|---|
| `FOODTAB_MARKETING_URL` | adresa aplikace bez lomítka, např. `https://marketing.foodtab.cz` (= `APP_URL` aplikace) |
| `FOODTAB_WEBHOOK_SECRET` | společné tajemství podpisu; **musí být stejné jako `N8N_WEBHOOK_SECRET`** v aplikaci (nebo `webhook_secret` v připojení n8n uloženém v Integracích) |
| `NOTIFY_WEBHOOK_URL` | (volitelné) adresa, kam posílat upozornění — Slack incoming webhook, Teams, e-mailová brána. Když chybí, uzel upozornění se přeskočí. |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | Code uzly volají `require('crypto')` pro HMAC. Bez této proměnné n8n `require` v Code uzlu zakáže. |

## 4. Credentials — „FoodTab Marketing webhook secret“

Podpis požadavků se počítá v Code uzlu z `$env` (credentials do Code
uzlu nejdou). Jediný uzel, který používá n8n credential, je volání
fronty v `scheduled-social-publish.json`:

1. *Credentials → New → Header Auth*.
2. Název: **FoodTab Marketing webhook secret**.
3. Name: `X-Cron-Secret`, Value: hodnota `CRON_SECRET` aplikace.
4. V uzlu „Zpracovat frontu“ vybrat tuhle credential.

`CRON_SECRET` je vlastní tajemství právě proto, aby se do n8n nemuselo
dávat `APP_SECRET`, kterým se podepisují cookie a adresy souborů. Když
`CRON_SECRET` nastavené není, endpoint volání odmítne — n8n pak dostane
401 a je hned vidět, co chybí.

## 5. Podpis webhooků (oběma směry)

Stejný mechanismus pro aplikace → n8n i n8n → aplikace
(`lib/providers/workflow.ts`):

```
X-FoodTab-Timestamp:       unixový čas v sekundách
X-FoodTab-Signature:       hex( HMAC-SHA256( secret, timestamp + "." + body ) )
X-FoodTab-Idempotency-Key: jedinečný klíč události
Content-Type:              application/json
```

`body` je **přesný řetězec těla** požadavku (aplikace používá
`JSON.stringify` bez mezer). Příjemce:

1. odmítne, když chybí tajemství, časová značka nebo podpis,
2. odmítne, když je značka starší nebo novější než **5 minut** (300 s)
   — ochrana proti přehrání (`overitPodpisWebhooku`),
3. spočítá HMAC nad `timestamp.body` a porovná v konstantním čase,
4. u příchozích událostí uloží `(provider_key, idempotency key)` do
   `marketing.webhook_events` — druhé doručení téže události se
   přeskočí.

V Code uzlech workflow je totéž:

```js
const crypto = require('crypto');
const secret = $env.FOODTAB_WEBHOOK_SECRET;
const ts = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify(payload);
const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
```

**Omezení ověření příchozího podpisu v n8n:** webhook uzel tělo rozparsuje
a Code uzel ho znovu serializuje `JSON.stringify($json.body)`. Funguje
to, protože aplikace posílá JSON bez mezer a Node zachová pořadí klíčů —
ale kdyby aplikace někdy začala tělo formátovat jinak, podpis by
neseděl. Bezpečnější varianta je zapnout v uzlu Webhook volbu *Raw
Body* a počítat HMAC nad binárními daty; to je poznámka v každém
workflow.

## 6. Error workflow

n8n umí u každého workflow nastavit *Settings → Error Workflow*.
Doporučení: vytvořit jeden workflow „FoodTab Marketing — chyby“ s uzlem
*Error Trigger* → HTTP POST na `NOTIFY_WEBHOOK_URL` (a případně
podepsaný POST `workflow.failed` do `/api/v1/webhooky/n8n`, aby se
selhání ukázalo v aplikaci). Pak ho nastavit jako Error Workflow u všech
osmi. Není součástí importu, protože obsahuje adresu vašeho kanálu.

## 7. Proč se v n8n nečeká na schválení

Zkušenost z Černé Perly (`docs/marketing-zadani.md` v kořeni
repozitáře): workflow, které čeká na kliknutí člověka (`sendAndWait`,
e-mail), je nejkřehčí článek — mezitím vyprší dočasné odkazy, execution
visí dny, po restartu n8n se ztratí.

Tady proto platí:

1. **Schválení žije v aplikaci** (`approval_requests`,
   `approval_decisions`, spoušť v databázi váže schválení na otisk verze).
2. Workflow `approval-notification` jen **oznámí**, že něco čeká, a
   skončí. Execution nikdy nezůstává otevřená.
3. Rozhodnutí schvalovatele vyvolá v aplikaci **novou** podepsanou
   událost (`content.approved` / `content.changes_requested`) — pokud
   na ni chcete reagovat, založte další webhookový workflow stejným
   vzorem.
4. Publikace se **neděje z n8n**. `scheduled-social-publish` jen
   šťouchne do fronty aplikace; fronta sama ověří, že schválení pořád
   platí (otisk verze), a teprve pak volá publisher.

## 8. Test připojení v aplikaci

`testConnection()` adaptéru volá `GET {N8N_BASE_URL}/healthz`
s časovým limitem 5 s. n8n tenhle endpoint má (self-hosted i cloud);
pokud běží za reverzní proxy, která `/healthz` nepropouští, test
selže, i když webhooky fungují.

## 9. Co ověřit ručně před ostrým nasazením

1. Cesty API v1 použité ve workflow proti hotové implementaci
   (`openapi/openapi.yaml` je smlouva; implementace se píše souběžně).
2. Že `require('crypto')` v Code uzlu funguje ve vaší verzi n8n
   (`NODE_FUNCTION_ALLOW_BUILTIN`), nebo nahradit vestavěným objektem
   `crypto`, který novější n8n do Code uzlu dává.
3. Verze uzlů (`typeVersion`) po importu — n8n je při importu umí
   povýšit, ale parametry `httpRequest` v4 se liší od v3.
4. Že `/healthz` odpovídá 200 zvenčí.
5. Časové pásmo n8n (*Settings → Timezone*): Schedule Trigger bere čas
   z něj. Nastavte `Europe/Prague`, jinak „čtvrtek 10:00“ padne jinam.
6. Idempotence na straně aplikace: dvakrát doručený `render.finished`
   nesmí založit dvě média.
