# Příjmové API Foodtabu pro pokladny

Pro pokladnu, kterou Foodtab neumí napojit sám (v Integracích →
Pokladní systémy není v seznamu). Pokladna sama, nebo prostředník jako
n8n, Make či Zapier, posílá denní prodeje po produktech do Foodtabu.
Foodtab z nich počítá foodcost a beverage cost.

## Klíč

V appce: **Finance → Integrace → Pokladní systémy → Jiná pokladna
(příjmové API Foodtabu) → vyberte pobočku → Vytvořit klíč**.

- Klíč patří **jedné pobočce**. Všechno, co s ním přijde, se zapíše
  k ní. Druhá pobočka = druhý klíč.
- Appka klíč ukáže **jen jednou**. V databázi je uložený jen
  zašifrovaný a znovu se zobrazit nedá. Ztracený klíč se vymění
  („Vyměnit klíč"), starý přestane platit hned.
- Odpojení v appce klíč zneplatní. Už přijatá data zůstávají.

## Požadavek

```
POST https://<adresa appky>/api/pokladna/prodeje
Authorization: Bearer ftpos_…
Content-Type: application/json

{
  "prodeje": [
    { "datum": "2026-10-10", "produkt": "Pilsner 0,5 l", "mnozstvi": 120, "trzba": 7800 },
    { "datum": "2026-10-10", "produkt": "Svíčková",      "mnozstvi": 18,  "trzba": 4140.5 }
  ]
}
```

| pole | co | pravidla |
|---|---|---|
| `datum` | **provozní** den, `RRRR-MM-DD` | od 2000-01-01 nejvýš do zítřka |
| `produkt` | název produktu tak, jak ho má pokladna | 1–200 znaků. Když se shoduje s názvem receptury ve Foodtabu, prodej se k ní přiřadí sám |
| `mnozstvi` | prodané množství | nezáporné číslo, smí být desetinné (kg, l) |
| `trzba` | tržba **v korunách s DPH** | nezáporné číslo. Text `"4140,50"` taky projde |
| `dny` *(volitelné)* | dny, které se mají přepsat, i když v nich nic není | pole dat. Pro den, kde bylo všechno stornováno |

**Posílejte vždy celý provozní den.** Každý den, který v dávce je,
Foodtab u pobočky klíče přepíše. Opakované poslání téhož dne nic
nezdvojí a produkt, který mezitím v pokladně zmizel (storno), zmizí
i ve Foodtabu. Den, který v dávce není, zůstane beze změny.

Stejný produkt dvakrát v jednom dni se sečte.

Limity jedné dávky: nejvýš 5000 položek, 62 různých dní a 2 MB.
Historii posílejte po částech, třeba po měsících.

## Odpovědi

| HTTP | `chyba` | co dělat |
|---|---|---|
| 200 | — | `{"ok": true, "dny": [...], "zapsanoRadku": 37}` |
| 400 | `neni_json` | tělo není platný JSON |
| 401 | `neplatny_klic` | klíč chybí, je překlepnutý, vyměněný, nebo je pokladna odpojená |
| 409 | `bez_pobocky` | připojení nemá pobočku, založte klíč znovu |
| 413 | `prilis_velke` | dávka je přes 2 MB, rozdělte ji |
| 422 | `neplatna_data` | `zprava` řekne, která položka a proč. Neuloží se nic z dávky |
| 500 | `zapis_selhal` | zkuste to znovu |

Odmítnutou dávku (422) uvidí i správce v appce u připojení jako
„Poslední dávka odmítnuta: …".

## Příklad (curl)

```bash
curl -X POST "https://<adresa appky>/api/pokladna/prodeje" \
  -H "Authorization: Bearer $FOODTAB_KLIC" \
  -H "Content-Type: application/json" \
  -d '{"prodeje":[{"datum":"2026-10-10","produkt":"Kofola 0,3 l","mnozstvi":42,"trzba":1890}]}'
```

## Co tohle API nedělá

- **Neposílá se sklad.** Foodtab sklad a inventury nestaví, ty jsou
  doménou pokladny (rozhodnutí z 2. 10. 2026).
- **Neposílají se účtenky ani platby**, jen denní souhrn po produktech.
- **Nečte se z něj nic.** Je jen pro zápis.

Kód: `app/api/pokladna/prodeje/route.ts`, kontrola dávky
`lib/pokladna-prijem-api.ts`, zápis `public.pokladna_nahradit_prodeje`
(migrace `20261011100000_pokladna_univerzalni_napojeni.sql`).
