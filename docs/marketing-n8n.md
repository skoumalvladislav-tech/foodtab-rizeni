# n8n v modulu Marketing — co dělá, co ne, a jak se importuje

Zadání §21 (n8n jako volitelný provider) a §25 („n8n workflow jsou validní
JSON a mají dokumentovaný import"). Stav k 14. 9. 2026 odpoledne.

## Jedna věta

**n8n nic netiká a nic nerozhoduje. Je to vydavatel.** Foodtab rozhodne
co a kdy, zavolá webhook, n8n to pošle na Instagram přístupem, který
drží, a odpoví. Budíky jsou v GitHub Actions
(`.github/workflows/marketing-fronta.yml` každých 15 minut,
`marketing-automatizace.yml` každou hodinu).

Proto v repozitáři **není** osm workflow z původní samostatné aplikace.
Dvě z nich byly budíky — vedle GitHubu by tikaly podruhé —, zbylých
šest bylo pro rozhraní, které modul nemá (renderer, stahování metrik)
nebo které dnes dělá databáze spouští (upozornění, opakování).
Podrobně `docs/marketing-kontrola-proti-zadani.md`, oddíl 3.

## Co v repozitáři je

| Soubor | Co |
|---|---|
| `n8n/foodtab-zverejnit-prispevek.json` | export workflow „Foodtab — zveřejnit příspěvek" (`l9o955GDQVDBf8gc`) z 14. 9. 2026, 22 uzlů |
| `scripts/marketing-n8n-workflow.test.mjs` | kontrola, že JSON sedí s `lib/marketing-n8n.ts` — viz níž |
| `docs/marketing-je-modul.md`, oddíl 7 | proč n8n a ne vlastní přístup k Metě; pět kroků před zapnutím |

## Kontrakt — obě strany, jeden zdroj pravdy

Foodtab (`lib/marketing-n8n.ts`) pošle `POST` s hlavičkou
`x-foodtab-tajemstvi` a tělem
`tenant_id, branch_id, uloha_id, idempotencni_klic, kanal, format,
popisek, obrazky[]`. Workflow vyžaduje `tenant_id, branch_id, kanal,
idempotencni_klic, popisek` a aspoň jeden obrázek s `url`; ostatní
ignoruje.

Odpovídá `{ stav: 'zverejneno', externi_id, odkaz }` nebo
`{ stav: 'chyba', duvod }`. Foodtab čte přesně tyhle klíče; čemu
nerozumí, bere jako chybu (nikdy „asi to vyšlo").

**Kontrola to hlídá z textu obou souborů** — vyžadovaná pole ⊆ posílaná,
název hlavičky, klíče odpovědí, visící spojení, tři instagramové
adresy, a že v JSON není nic, co vypadá jako token. Rozbita osmi
způsoby, všech osm chytila (`docs/hlaseni/stav-2026-09-14.md`).

## Co workflow umí a co ne

- **Jen Instagram** (`graph.instagram.com`), **jen jeden obrázek**
  (první z pole), **žádné video, žádný carousel.** Řádek pro
  `sit = facebook` do `foodtab_ucty` **nepřidávejte** — uzly by volaly
  instagramové adresy s facebookovým id a skončilo by to chybou.
- Idempotence: před zveřejněním se hledá klíč v tabulce
  `foodtab_zverejneno`; nalezený vrací `opakovani: true` bez druhého
  příspěvku. Řádek se zapisuje **až po** zveřejnění — kdyby selhal zápis
  po úspěšném zveřejnění, druhý pokus by zveřejnil znovu. Známá mez.
- Čeká 8 s a ptá se na stav kontejneru **jednou**; když nedozrál, vrátí
  chybu a Foodtab to zkusí příště (nový kontejner, starý propadne).

## Import do jiné instance n8n

1. n8n → Workflows → **Import from File** → `n8n/foodtab-zverejnit-prispevek.json`.
2. Export nese jen **odkazy** na přihlašovací údaje (id a název), ne
   jejich obsah. Po importu: na uzlu „Foodtab volá" přiřadit údaj typu
   Header Auth s hlavičkou `x-foodtab-tajemstvi`; na třech uzlech IG
   údaj s instagramovým tokenem.
3. Založit dvě datové tabulky a přepsat jejich id v uzlech:
   `foodtab_ucty` (`tenant_id, branch_id, sit, ucet_id`)
   a `foodtab_zverejneno` (`idempotencni_klic, media_id, odkaz,
   tenant_id, kdy`). Id v souboru jsou z instance `foodtab.app.n8n.cloud`.
4. Do prostředí Foodtabu `N8N_MARKETING_URL` a `N8N_MARKETING_TAJEMSTVI`.
5. **Neaktivovat, dokud běží staré workflow „Černá Perla — denní obsah
   na sítě".** Jinak dva příspěvky denně. Vyzkoušet nanečisto: příspěvek
   v režimu `demo` projde celou cestou a nikam se neodešle.

Podle exportu ze 14. 9. jsou přihlašovací údaje na uzlech ve vaší
instanci **už přiřazené** (kroky 1–3 z oddílu 7 v `marketing-je-modul.md`).
Jestli je vyplněný řádek v `foodtab_ucty` a proměnné na Vercelu, jsem
neověřoval — to ať udělá ta větev, která bude zapínat.
