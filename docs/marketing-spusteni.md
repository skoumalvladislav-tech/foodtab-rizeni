# Marketing — jak ho spustit

Kontrolní seznam k modulu Marketing. Rozhodnutí, proč to je takhle
postavené, je v `docs/marketing-je-modul.md`; tenhle soubor je jen
postup, který se odklikává.

**Tajemství tu nejsou a nebudou.** Repozitář si je pamatuje navždycky
i po smazání. Jsou v chatu, kde vznikla.

---

## Co už je hotové — nedělat znovu

| Hotovo | Kde |
|---|---|
| Workflow v n8n | „Foodtab — zveřejnit příspěvek", `l9o955GDQVDBf8gc`, **neaktivní** |
| Instagramový přístup na třech uzlech IG | připojeno |
| Tabulka `foodtab_ucty` | vyplněná: Černá Perla → účet `27920687187583900` |
| Tabulka `foodtab_zverejneno` | prázdná, plní se sama |
| Vyzkoušené cesty | požadavek bez fotky a požadavek cizí firmy — obě odmítnuty, k Instagramu se nedostaly |

Staré workflow „Černá Perla — denní obsah na sítě" je **nedotčené
a běží dál**.

---

## Kroky 1 a 2 — n8n — HOTOVO 13. 9. 2026

Přihlašovací údaj `Foodtab do n8n` je založený a přepnutý na uzlu
„Foodtab volá". Webhook teď žádá hlavičku `x-foodtab-tajemstvi`, tedy
přesně tu, kterou Foodtab posílá.

Ověřeno na celém grafu: tři instagramové uzly mají svůj přístup a
**všech osm možných konců končí odpovědí** — neúplný požadavek,
opakování, neznámý účet, nevzniklý kontejner, nedozrálý kontejner,
neúspěšné zveřejnění i úspěch. Fronta tedy nikdy nezůstane viset a vždy
se dozví proč.

Zbývá jen kosmetika z kroku 3 níž (přejmenování údaje). Původní znění
kroků 1 a 2 je pod čarou, kdyby se to někdy dělalo znovu.

<details>
<summary>Původní krok 1 — už není potřeba</summary>

## Krok 1 — n8n: přihlašovací údaj pro Foodtab

Tohle přes rozhraní udělat nejde, protože se zadává tajemství.

1. n8n → **Credentials** → **Create credential** → typ **Header Auth**.
2. Vyplnit:
   - **Name** (název hlavičky, ne jméno údaje): `x-foodtab-tajemstvi`
   - **Value**: tajemství z chatu
3. Údaj pojmenovat `Foodtab do n8n` a uložit.

## Krok 2 — n8n: přepnout ho na webhooku

1. Otevřít workflow **Foodtab — zveřejnit příspěvek**.
2. Kliknout na první uzel **Foodtab volá**.
3. V **Credential for Header Auth** je teď omylem **Authorization** —
   to je ten instagramový. Přepnout na **Foodtab do n8n**. Uložit.

> Přiřadil se tam sám při zakládání. Není to nebezpečné, jen rozbité:
> workflow by čekalo jinou hlavičku, než Foodtab posílá, a požadavek
> by odmítlo.

</details>

## Krok 3 — n8n: přejmenovat instagramový údaj — ZBÝVÁ

Credentials → **Authorization** → přejmenovat na
`Instagram — Černá Perla`.

Není to kosmetika. Údaj typu hlavička HTTP se pošle na **jakoukoli**
adresu, na kterou ho někdo připne. Pod jménem „Authorization" k tomu
svádí; pod jménem „Instagram — Černá Perla" si toho člověk všimne.

## Krok 4 — Foodtab: tři proměnné prostředí

Vercel → projekt Foodtab → **Settings** → **Environment Variables**.
Přidat **jen pro Production**:

| Název | Hodnota |
|---|---|
| `N8N_MARKETING_URL` | `https://foodtab.app.n8n.cloud/webhook/foodtab-zverejnit` |
| `N8N_MARKETING_TAJEMSTVI` | tajemství z kroku 1 — **musí sedět přesně** |
| `MARKETING_KLIC_SIFRY` | klíč z chatu, 64 znaků |

### Proč jen Production a ne Preview

Protože náhled se nasazuje z každé větve. Kdyby tam ty tři proměnné
byly, mohlo by rozdělané nasazení poslat příspěvek na **skutečný**
Instagram Černé Perly — a to není chyba, kterou jde vzít zpátky.

Bez nich se v náhledu ani nenabídne „Zveřejnit": obrazovka se ptá,
jestli je n8n nastavené, a nabídne jen nanečisto a ruční cestu. Přesně
tak to v náhledu má být.

Je to i shodné s tím, co v projektu už platí: `CRON_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY` i `RESEND_API_KEY` jsou nastavené jen pro
Production. V Preview jsou jen veřejná adresa Supabase a veřejný klíč.

### Redeploy

Když se hned potom slévá do `main`, **přenasazovat ručně netřeba** —
nasazení z merge si proměnné vezme samo. Ručně jen tehdy, když se mezi
uložením proměnných a dalším nasazením nic dít nebude.

## Krok 5 — databáze (dělá Šéfík z `main`)

1. Slít větev `claude/prompt-review-jtkh74` do `main`.
2. `supabase/tests/run.sh` proti PostgreSQL — musí být zelené.
3. `supabase db push`.

Přibývají tři migrace:

- `20260910020000_marketing_okamzik` — převod hodiny na okamžik
- `20260910040000_marketing_fronta` — fronta publikací
- `20260913170000_marketing_ulozne` — úložiště fotek a pravidla k němu

**U třetí pozor.** `storage.objects` vlastní role
`supabase_storage_admin`, ne `postgres`. Když push skončí na
„must be owner of table objects", není to chyba migrace — je to práva
role, kterou push používá. Ten jeden příkaz se pak pustí pod rolí
storage admina; politika se kvůli tomu nezjednodušuje.

## Krok 6 — plánovač na GitHubu — HOTOVO, nic nedělat

Ověřeno 13. 9. 2026: úloha „Zapomenutý odchod" má za sebou 230 běhů
a poslední desítky po sobě jsou zelené. Běží každou hodinu a používá
tatáž tajemství, takže je jisté, že `APP_URL` i `CRON_SECRET` jsou
nastavené a sedí s Vercelem.

Workflow „Marketing — fronta publikací" si je vezme taky — přibude
samo, až se větev slije do `main`. Běží každou čtvrthodinu; spustit
jde i ručně: Actions → to workflow → **Run workflow**.

---

## Krok 7 — zkouška nanečisto

Nic nejde ven. Tohle projít **dřív**, než se cokoli zapne.

1. Foodtab → **Marketing** → **Fotky** → nahrát fotku.
2. **Nový příspěvek** → název, účel, kanál Instagram.
3. Napsat text, **zaškrtnout fotku**, uložit jako novou verzi.
4. **Požádat o schválení**.
5. Schválit — **musí to udělat někdo jiný** než ten, kdo žádal. Čtyři
   oči hlídá databáze, ne obrazovka.
6. **Naplánovat**, u „Jak to má odejít" vybrat **Jen nanečisto**, čas
   dát pár minut do minulosti.
7. Actions → „Marketing — fronta publikací" → **Run workflow**.
8. V příspěvku má být **zveřejněno nanečisto**.

Když to nevyjde, kouká se sem:

| Co vidím | Kde hledat |
|---|---|
| „Zveřejňování přes n8n není nastavené" | krok 4, chybí proměnná nebo se nepřenasadilo |
| „bez fotky to nepřijme" | v kroku 3 se nezaškrtla fotka |
| úloha zůstala „naplánováno" | plánovač neběžel — krok 6 |
| 401 v Actions | `CRON_SECRET` na Vercelu a na GitHubu se liší |

---

## Krok 8 — teprve teď ostrý provoz

**Nejdřív staré workflow.** „Černá Perla — denní obsah na sítě" pořád
publikuje každý všední den v 8:00. Dokud běží obojí, vyjdou dva
příspěvky denně a jeden o druhém neví. Buď se osekne na „zveřejni, co
přijde", nebo se vypne.

Pak:

1. n8n → workflow **Foodtab — zveřejnit příspěvek** → přepnout na
   **Active**.
2. Ve Foodtabu naplánovat příspěvek se způsobem **Zveřejnit**.
3. **U prvního zůstat u toho** a podívat se na profil.

---

## Co se ještě neumí

Ať to není překvapení:

- **Facebook.** Workflow posílá jen na Instagram. V n8n jsou tři
  facebookové údaje, ale nic je nepoužívá.
- **Víc fotek v jednom příspěvku.** Vybrat jde víc, odejde první.
  Koláž ani video zatím ne.
- **Návrh textu od modelu.** Text se píše ručně. Kostra kolem něj
  (verze, schválení, plán) musela stát dřív, jinak by první návrh
  neměl kam přistát.
