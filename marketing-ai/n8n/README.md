# Workflow pro n8n

Osm hotových workflow k importu. Jsou **volitelné** — jádro aplikace na
nich nestojí. Render, publikace i opakování řeší interní fronta
(`lib/domena/fronta.ts`, spouštěná přes `POST /api/v1/ulohy/zpracovat`).
n8n je navíc: budík, napojení na Slack nebo e-mail a přehled běhů.

Souvislosti a rozhodnutí jsou v `docs/N8N_SETUP.md`. Tenhle soubor je
návod k obsluze.

> **Stav:** workflow **nebyla spuštěna proti skutečné instanci n8n.**
> Jsou to platné importovatelné soubory s běžnými uzly; po importu je
> potřeba ověřit verze uzlů a cesty API (viz §8).

## 1. Import

1. n8n → **Workflows → Import from File** → vyberte JSON. Zopakujte pro
   všech osm souborů (nebo jen pro ty, které chcete).
2. Každé workflow po importu **aktivujte** přepínačem vpravo nahoře.
   Bez aktivace webhooková adresa neexistuje a Schedule Trigger nespustí
   nic.
3. Webhooková workflow dostanou adresu
   `https://<n8n>/webhook/foodtab-marketing/<typ>` — přesně tu, na
   kterou aplikace posílá
   (`{N8N_BASE_URL}/webhook/foodtab-marketing/{type}`,
   `lib/providers/workflow.ts`).
4. Na testování je vedle toho `/webhook-test/…` (tlačítko *Listen for
   test event*). Aplikace na testovací adresu přepnout neumí, zkoušejte
   curlem.
5. V n8n nastavte **Settings → Timezone = `Europe/Prague`**. Schedule
   Trigger bere čas odtud; jinak „denně 06:00“ padne o hodinu nebo dvě
   jinam a v létě jinam než v zimě.

## 2. Proměnné prostředí n8n

Workflow čtou hodnoty přes `$env.…`. Nastavují se v prostředí, kde n8n
běží (Docker `environment:`, `.env`, systemd unit). V n8n Cloud jsou
místo toho *Variables* a výrazy je nutné přepsat na `$vars.…`.

| Proměnná | Povinná | Význam |
|---|---|---|
| `FOODTAB_MARKETING_URL` | ano | adresa aplikace **bez koncového lomítka**, např. `https://marketing.foodtab.cz`. Musí souhlasit s `APP_URL` aplikace. |
| `FOODTAB_WEBHOOK_SECRET` | ano | společné tajemství podpisu. **Musí být stejné jako `N8N_WEBHOOK_SECRET`** v aplikaci (nebo jako `webhook_secret` uložený u připojení n8n v Integracích). |
| `FOODTAB_CRON_SECRET` | ano pro plánovaná workflow | hodnota, kterou aplikace přijme v hlavičce `X-Cron-Secret` — tedy `CRON_SECRET`, a když není nastavený, `APP_SECRET`. |
| `NOTIFY_WEBHOOK_URL` | ne | kam posílat upozornění: Slack incoming webhook, Teams, e-mailová brána — cokoli, co přijme `POST` s JSON. Když chybí, uzel upozornění se přeskočí (v každém workflow je na to podmínka `Je kam poslat?`). |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | ano | Code uzly volají `require('crypto')` kvůli HMAC. Bez toho n8n `require` v Code uzlu zakáže a workflow spadne na `crypto is not defined`. |

Poznámka k `FOODTAB_CRON_SECRET`: pokud aplikace nemá vlastní
`CRON_SECRET`, spadne to na `APP_SECRET`, který podepisuje i cookie
a adresy souborů. To je širší přístup, než fronta potřebuje —
v `docs/SECURITY.md` je to vedené jako věc k dořešení. Nastavte
aplikaci `CRON_SECRET` zvlášť a do n8n dejte jenom ten.

## 3. Credentials

Workflow záměrně **nepoužívají žádnou n8n credential.** Obě tajemství
jdou z `$env`, protože Code uzel na credentials nedosáhne a podpis se
počítá právě tam. Je to jedno místo místo dvou.

Pokud chcete tajemství držet v credentials store n8n (kvůli auditu nebo
sdílení mezi projekty), dá se to udělat u HTTP uzlů, které podpis
nepočítají:

1. *Credentials → New → **Header Auth***.
2. Název: **FoodTab Marketing — cron**.
3. Name: `X-Cron-Secret`, Value: hodnota `CRON_SECRET` aplikace.
4. V uzlech „Zpracovat frontu“ a „Spustit automatizace“ přepněte
   *Authentication* na *Generic → Header Auth* a vyberte tuhle
   credential; z `headerParameters` pak řádek `X-Cron-Secret` smažte.

U podepsaných volání (`X-FoodTab-Signature`) to nejde — podpis se musí
spočítat z těla požadavku, a to umí jen Code uzel.

## 4. Error workflow

n8n umí u každého workflow nastavit *Settings → **Error Workflow***.
Ve složce záměrně není, protože obsahuje adresu vašeho kanálu. Založte
si ho ručně:

1. *Workflows → New*, název „FoodTab Marketing — chyby“.
2. Uzel **Error Trigger** (`n8n-nodes-base.errorTrigger`).
3. Uzel **HTTP Request**: `POST` na `={{ $env.NOTIFY_WEBHOOK_URL }}`,
   tělo třeba
   `={{ JSON.stringify({ text: "n8n: workflow " + $json.workflow.name + " selhalo v uzlu " + ($json.execution.lastNodeExecuted || "?") + " — " + ($json.execution.error ? $json.execution.error.message : "") }) }}`.
4. Volitelně druhý HTTP uzel: podepsaný `POST` typu `workflow.failed` na
   `{URL}/api/v1/webhooky/n8n`, aby bylo selhání vidět i v aplikaci.
   Podpis se počítá stejně jako v uzlech „Podepsat požadavek“.
5. Uložte, **aktivujte** a pak u všech osmi workflow nastavte
   *Settings → Error Workflow* na tenhle.

Bez error workflow selhání nikam nedojde — jen zůstane červené
v seznamu běhů, kam se nikdo nedívá.

## 5. Přehled: workflow × spouštěč × co volá

| Soubor | Spouštěč | Co volá | Tajemství |
|---|---|---|---|
| `content-generation.json` | webhook `foodtab-marketing/content.generate` | `POST {URL}/api/v1/obsah/{id}/navrh` | podpis HMAC |
| `render-monitor.json` | webhook `foodtab-marketing/render.submitted` | `POST {URL}/api/v1/ulohy/zpracovat`, každých 30 s, nejvýš 20× | `X-Cron-Secret` |
| `approval-notification.json` | webhooky `foodtab-marketing/approval.requested` a `…/approval.decided` | `POST $NOTIFY_WEBHOOK_URL` | žádné (jen ověření příchozího podpisu) |
| `scheduled-social-publish.json` | Schedule, každých 5 minut | `POST {URL}/api/v1/ulohy/zpracovat` | `X-Cron-Secret` |
| `publish-retry-deadletter.json` | webhook `foodtab-marketing/publish.failed` | `POST {URL}/api/v1/ulohy/zpracovat` po exponenciálním čekání, jinak `POST $NOTIFY_WEBHOOK_URL` | `X-Cron-Secret` |
| `metrics-sync.json` | Schedule, denně 06:00 | `POST {URL}/api/v1/analytika/synchronizovat` | podpis HMAC |
| `connection-health.json` | Schedule, každou hodinu | `GET {URL}/api/v1/health` + `POST {URL}/api/v1/integrace/test-vse` | podpis HMAC u druhého volání |
| `recurring-campaigns.json` | Schedule, denně 07:00 | `POST {URL}/api/v1/ulohy/zpracovat?automatizace=1` | `X-Cron-Secret` |

## 6. Podpis webhooků — stejný v obou směrech

```
X-FoodTab-Timestamp:       unixový čas v sekundách
X-FoodTab-Signature:       hex( HMAC-SHA256( secret, timestamp + "." + telo ) )
X-FoodTab-Idempotency-Key: jedinečný klíč události
Content-Type:              application/json
```

`telo` je **přesný řetězec těla** požadavku. Aplikace používá
`JSON.stringify` bez mezer; workflow proto posílají tělo jako *raw*
řetězec, který si samy sestavily — kdyby ho n8n serializovalo znovu,
podpis by neseděl.

Příjemce odmítne požadavek, když chybí tajemství, značka nebo podpis,
a taky když je značka starší nebo novější než **5 minut** (300 s).
Hodiny obou serverů musí být synchronizované; při větším rozdílu padá
všechno na 401 a je to vidět hned.

Každé webhookové workflow má hned za webhookem Code uzel **Ověřit
podpis**, který dělá totéž jako `overitPodpisWebhooku` v aplikaci —
porovnání v konstantním čase přes `crypto.timingSafeEqual`. Bez toho by
webhooková adresa n8n byla otevřená komukoli, kdo ji uhodne.

**Známé omezení:** uzel Webhook tělo rozparsuje a Code uzel ho
serializuje znovu (`JSON.stringify($json.body)`). Funguje to, protože
aplikace posílá JSON bez mezer a Node zachová pořadí klíčů. Kdyby
aplikace tělo někdy začala formátovat jinak, podpis by přestal sedět.
Bezpečnější je zapnout v uzlu Webhook volbu *Raw Body* a počítat HMAC
nad ním; je to poznámka v každém workflow.

## 7. Proč se v n8n nikdy nečeká na člověka

Žádné workflow nedrží execution otevřenou kvůli schválení. Žádný
`sendAndWait`, žádné čekání na kliknutí v e-mailu.

1. **Schválení žije v aplikaci** — `approval_requests`,
   `approval_decisions`, a spoušť v databázi váže schválení na otisk
   verze. Úprava po schválení schválení ruší.
2. `approval-notification` jen **oznámí** a skončí.
3. Rozhodnutí schvalovatele vyvolá v aplikaci **novou** podepsanou
   událost (`approval.decided`) — to je zase jenom další webhook.
4. **Publikace se neděje z n8n.** `scheduled-social-publish` jen
   šťouchne do fronty; fronta si sama ověří, že otisk schválené verze
   pořád sedí, a teprve pak zavolá publisher.

Důvod je zkušenost, ne názor: execution, která čeká na člověka, je
nejkřehčí článek. Mezitím vyprší dočasné odkazy, běh visí dny a po
restartu n8n se ztratí.

## 8. Které endpointy workflow volají a jak jsou v aplikaci

Všechny endpointy, které workflow volají, v aplikaci existují:
`/api/v1/health`, `/api/v1/ulohy/zpracovat` (i s `?automatizace=1`),
`/api/v1/webhooky/{zdroj}`, `/api/v1/obsah/{id}/navrh`,
`/api/v1/analytika/synchronizovat` a `/api/v1/integrace/test-vse`.
Podepsané volání (`X-FoodTab-Signature`) běží jménem vlastníka organizace
(návrh obsahu jménem autora obsahu), aby platila stejná oprávnění a RLS
jako z obrazovky.

Co NEBYLO otestováno proti skutečné instanci n8n: síť vývojového
prostředí n8n nepustila. Import a první spuštění každého workflow proto
udělejte nejdřív proti testovací aplikaci (demo režim) a sledujte
`marketing.webhook_events` — každá přijatá událost tam má záznam včetně
výsledku ověření podpisu.

## 9. Co ověřit ručně před ostrým nasazením

1. **Verze uzlů** (`typeVersion`) po importu. n8n je umí povýšit, ale
   parametry `httpRequest` v4 se liší od v3 — po povýšení zkontrolujte,
   že tělo pořád odchází jako *raw*, jinak přestane sedět podpis.
2. Že `require('crypto')` v Code uzlu ve vaší verzi n8n funguje
   (`NODE_FUNCTION_ALLOW_BUILTIN=crypto`). Novější n8n dává do Code uzlu
   objekt `crypto` rovnou — pak stačí řádek s `require` smazat.
3. Že `$env` je v Code uzlech čitelné. Když je nastavené
   `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, workflow spadne na chybějícím
   tajemství.
4. Že `{URL}/api/v1/health` odpovídá 200 zvenčí, z počítače, kde běží
   n8n (ne jen z vašeho).
5. Časové pásmo n8n (§1, bod 5).
6. Idempotenci na straně aplikace: dvakrát doručená stejná událost nesmí
   založit dvě média ani dva příspěvky. Aplikace to hlídá tabulkou
   `marketing.webhook_events` (`unique (provider_key, external_event_id)`)
   a `idempotency_key` u úloh — ověřte, že to platí i po vašich změnách.
7. Že se webhooková adresa n8n nedá zvenčí zneužít: pošlete na ni
   požadavek bez podpisu a čekejte chybu, ne 200.
