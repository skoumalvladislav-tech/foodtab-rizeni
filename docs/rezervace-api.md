# Příjmové API Foodtabu pro rezervace

Pro rezervační systém, na který se Foodtab neumí napojit sám.
**Choice** se od 25. 10. 2026 napojuje přímo (Foodtab se ptá sám, viz
[rezervace-choice.md](rezervace-choice.md)) — tohle API je pro ostatní.
Systém sám (webhookem), nebo prostředník jako **n8n, Make či Zapier**,
posílá rezervace do Foodtabu. Ve Foodtabu k nim obsluha přidává
poznámky, další informace a dokumenty.

Stejný princip jako příjmové API pokladen (`docs/pokladna-api.md`).

## Klíč

V appce: **Provoz → Rezervace a akce → Napojení a import → Univerzální
příjmové API → Vytvořit klíč** (právo „Správa napojení na externí
systémy“).

- Klíč patří **jedné pobočce**. Všechno, co s ním přijde, se zapíše k ní.
  Druhá pobočka = druhý klíč.
- Appka klíč ukáže **jen jednou**. V databázi je jen zašifrovaný a znovu
  zobrazit nejde. Ztracený klíč se vymění („Vyměnit klíč“), starý přestane
  platit hned.
- Odpojení klíč zneplatní. Už přijaté rezervace zůstávají.
- Do první úspěšně přijaté zprávy ukazuje appka „Čeká na první data“, pak
  „Přijímá data“ s časem a počtem posledních rezervací. Odmítnutou zprávu
  i s důvodem vidí správce napojení na téže obrazovce.

## Požadavek

```
POST https://<adresa appky>/api/rezervace/prijem
Authorization: Bearer ftrez_…
Content-Type: application/json

{
  "system": "choice",
  "rezervace": [
    {
      "id": "R-1042",
      "zacatek": "2026-11-20T19:00:00+01:00",
      "konec": "2026-11-20T21:30:00+01:00",
      "osob": 4,
      "stav": "confirmed",
      "jmeno": "Jan Novák",
      "telefon": "+420 777 111 222",
      "email": "jan@example.cz",
      "poznamka": "u okna, dort ve 20:00",
      "stul": "12",
      "zmeneno": "2026-11-01T10:00:00Z"
    }
  ]
}
```

Adresu i klíč appka ukáže při vytvoření klíče. Místo pole může
`rezervace` být **jedna rezervace** (objekt) — tak to posílá většina
webhooků. V jedné zprávě nejvýš **500 rezervací** a **1 MB**.

### Údaje

| Údaj | Povinné | Význam |
|---|---|---|
| `system` | ne | Krátké jméno systému (malá písmena, číslice, pomlčka), např. `choice`. Podle něj se pozná stejná rezervace i z CSV exportu téhož systému. Bez něj `obecne`. |
| `id` | **ano** | Číslo rezervace ve vašem systému. Stejné `id` poslané znovu rezervaci **upraví, nezdvojí**. |
| `zacatek` | **ano**¹ | Začátek **s časovým pásmem** (ISO 8601): `2026-11-20T19:00:00+01:00` nebo `…Z`. Bez pásma se zpráva odmítne — rezervace by se posunula o hodinu či dvě. |
| `konec` | ne | Konec s pásmem. Musí být po začátku. |
| `datum` + `od` (+ `do`) | ¹ | Místo `zacatek`/`konec`: datum `RRRR-MM-DD` a čas `HH:MM` **na pobočce** (pásmo dodá Foodtab). Pro n8n/Make bývá jednodušší. `do` dřív než `od` = přes půlnoc. |
| `osob` | ne | Počet osob, kladné celé číslo. Bez něj „počet neuveden“, ne nula. |
| `stav` | ne | Viz níž. Bez něj potvrzená. |
| `jmeno`, `telefon`, `email` | ne | Host. Telefon a e-mail vidí ve Foodtabu jen ten, kdo smí rezervace zapisovat; nejsou to marketingové souhlasy. |
| `poznamka` | ne | Co napsal host. Poznámky obsluhy jsou ve Foodtabu zvlášť a zpráva je nepřepíše. |
| `stul` | ne | Stůl nebo prostor. Foodtab ho **jen doplní**, když ho ve Foodtabu ještě nikdo nevyplnil. |
| `zmeneno` | ne | Kdy se rezervace ve vašem systému naposled změnila (s pásmem). **Doporučené:** zpráva starší než to, co už Foodtab má, se přeskočí — pozdě doručený webhook tak nepřepíše novější stav. |

¹ Buď `zacatek`, nebo `datum` + `od`.

### Stav

Foodtab rozumí svým hodnotám `ceka` (předběžná), `potvrzeno`, `dokonceno`
(proběhla), `zrusena`, `nedostavil_se` i běžným slovům z rezervačních
systémů: `confirmed`, `accepted`, `booked`, `seated`, `arrived`, `pending`,
`requested`, `waiting list`, `cancelled`/`canceled`, `refused`,
`no show`/`no_show`, `completed`, `done`, `left`… (česky i anglicky,
na velikosti písmen nezáleží).

**Neznámý stav se nezahodí:** rezervace se zapíše jako **předběžná**
a původní slovo zůstane u ní vidět („Stav ve zdroji: …“).

**Zrušení** = stejné `id` se stavem `zrusena` (nebo `cancelled`).
Rezervace se ve Foodtabu nemaže — zůstanou k ní poznámky i dokumenty.

## Co platí ve Foodtabu (čí je pravda)

- **Patří vašemu systému** (každá novější zpráva je přepíše, ve Foodtabu
  se nemění): čas, počet osob, stav, jméno, telefon, e-mail, poznámka hosta.
- **Patří Foodtabu** (zpráva je nikdy nepřepíše): druh (rezervace/akce),
  název, typ akce, menu, záloha od hosta, poznámky, další informace,
  dokumenty; stůl/prostor jen doplní prázdný.
- Rezervace, která ve zprávě chybí, se **nemaže**.

## Odpovědi

| Kód | Kdy | Co dělat |
|---|---|---|
| 200 `{"ok": true, "nove": 1, "zmenene": 0, "bezeZmeny": 0, "zastarale": 0}` | zapsáno | nic |
| 401 `neplatny_klic` | klíč chybí, neplatí, je vyměněný nebo odpojený | vložit platný klíč |
| 400 `neni_json` | tělo není JSON | opravit zprávu |
| 413 `prilis_velke` | víc než 1 MB | poslat po částech |
| 422 `neplatna_data` | vadný údaj — v `zprava` je, která rezervace a proč. **Nezapíše se nic z celé zprávy.** | opravit data; opakování nepomůže |
| 500 `zapis_selhal` | výpadek zápisu | zopakovat později |
| 503 `nenastaveno` | server nemá nastavený příjem | ozvat se správci Foodtabu |

## Choice a prostředníci

**Choice má vlastní napojení** (stav k 25. 10. 2026): Choice Open API
rezervace číst umí (`GET /bookings/list`, 1 dotaz za 5 s), webhooky
pro rezervace ale nemá. Foodtab se proto ptá sám každých 15 minut —
Rezervace → Napojení a import → karta **Choice** → Připojit podnik
v Choice. Postup a co je potřeba nastavit: [rezervace-choice.md](rezervace-choice.md).
Rezervace z Choice mají systém `choice` a číslo = `_id` z Choice,
takže se párují i s tím, co by přišlo sem s `"system": "choice"`
a stejným `id`.

Tohle příjmové API zůstává pro ostatní systémy. Možnosti:

1. **Webhook ze systému** (pokud ho nabízí) → n8n/Make přemapuje
   údaje na tvar výš a pošle je sem.
2. **E-mail s rezervací** → n8n/Make z e-mailu vytáhne údaje a pošle je
   sem.
3. **Export do CSV** → Rezervace → Napojení a import → Načíst ze
   souboru. Spáruje se se stejnými rezervacemi z API, pokud nesou
   stejné číslo.

Ukázka pro n8n (uzel HTTP Request): metoda POST, adresa z appky, hlavička
`Authorization` = `Bearer <klíč>`, tělo JSON s polem `rezervace`.

Zkouška z příkazové řádky:

```bash
curl -X POST "https://<adresa appky>/api/rezervace/prijem" \
  -H "Authorization: Bearer ftrez_…" \
  -H "Content-Type: application/json" \
  -d '{"system":"choice","rezervace":{"id":"TEST-1","datum":"2026-11-20","od":"19:00","osob":2,"jmeno":"Zkouška"}}'
```

Zkušební rezervaci pak ve Foodtabu zrušte stejnou zprávou se
`"stav": "zrusena"`.
