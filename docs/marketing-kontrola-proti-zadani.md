# Kontrola modulu proti původnímu zadání

Šéfík 14. 9. 2026: „zkontroluj jestli to vše sedí proti tomuto promptu".

Zdroj: `FoodTab-Marketing-AI-Claude-Code-prompt-v2_1.md`, 27 oddílů.
Nahrané soubory jsou dva a jsou **bajt po bajtu totožné** (`md5`
`5f949a2a…`) — „(2)" je jen druhý upload téhož, ne novější verze.

Tohle **není** opis soupisu z `docs/marketing-co-zbyva.md`. Tam se
psalo, co zbývá postavit. Tady jde o jinou otázku: **co zadání žádá
a v repozitáři to není** — včetně věcí, které se v soupisu tvářily
jako hotové.

---

## Nejdřív to podstatné

Čtyři nálezy, o kterých se dosud nemluvilo. Dva jsem dnes opravil,
dva ne.

| Co | Kde to zadání žádá | Stav |
|---|---|---|
| Deep link přežije přihlášení | §25 | **opraveno 14. 9.** |
| Překlad auditu na obrazovku | §22, obrazovka 16 | **rozpracováno 14. 9.** |
| Nahrání **videa** | §25 | **nejde vůbec** |
| Čtrnáct dokumentů a osm n8n workflow | §26, §21 | **nejsou v repozitáři** |

---

## 1. Deep link — byla to mezera, dnes opravená

Zadání, §25: „nepřihlášený deep link zachová bezpečnou cílovou cestu
a po přihlášení uživatele vrátí na zamýšlenou obrazovku."

Jednadvacet souborů marketingu dělalo `redirect('/prihlaseni')`, což
původní adresu zahodí. Kdo dostal odkaz na konkrétní příspěvek ke
schválení a nebyl přihlášený, skončil po přihlášení na rozcestníku.

Pomůcka `odkazNaPrihlaseni()` v repozitáři **byla** — používaly ji tři
soubory mimo marketing. Tady se jen nepoužila.

**Proč nestačilo, že to umí layout.** `app/[rozsah]/layout.tsx` to dělá
správně, takže se zdálo, že obrazovky pod ním mají vystaráno. Nemají:

1. Layout a stránka se v App Routeru renderují **paralelně**. Když obě
   zavolají `redirect`, není určené, který vyhraje — a chyba, která se
   projevuje občas, je horší než ta, co se projevuje pokaždé.
2. **U serverových akcí layout neběží vůbec.** Když člověku vyprší
   relace nad rozdělaným formulářem, layout ho nezachytí.

Hlídá `scripts/marketing-prihlaseni.test.mjs`. Rozbito třikrát, chytilo
to všechny tři.

**Nahlášeno a neopraveno:** třináct souborů mimo marketing
(`nastaveni`, `vzkazy`, `zalohy`, `upozorneni`, `pozvanka`) má tutéž
mezeru. Cizí modul.

---

## 2. Video nahrát nejde

Zadání, §25: „lze nahrát fotografii **i video** a zařadit je do správné
provozovny."

`lib/marketing-obrazek.ts` povoluje `image/jpeg`, `image/png`
a `image/webp`. Nic víc. Video se do mediální knihovny nedostane.

Souvisí to s §12 (automatická grafika a video), kde renderer napojený
není — ale **není to totéž**. Renderer video vyrábí; tohle je o tom, že
se nedá nahrát ani hotové video, které si restaurace natočila mobilem.
To by šlo bez rendereru.

Rozsah práce: rozpoznání typu z prvních bajtů (u MP4 je to `ftyp`),
délka, náhledový snímek, strop velikosti, přehrávač na obrazovce Fotky
a v náhledu příspěvku. Není to malé, ale ani to není renderer.

---

## 3. Dokumentace a n8n workflow v repozitáři nejsou

Zadání, §26, žádá čtrnáct konkrétních souborů. V repozitáři jsou
**dva**:

| Soubor | Stav |
|---|---|
| `README.md` | je |
| `.env.example` | je |
| `docs/PROVIDER_CATALOG.md` | **není** |
| `docs/FOODTAB_INTEGRATION.md` | **není** |
| `docs/SECURITY.md` | **není** |
| `docs/DEPLOYMENT.md` | **není** |
| `docs/PRODUCT_ROADMAP.md` | **není** |
| `docs/product-inspiration.md` | **není** |
| `docs/SOCIAL_API_LIMITS.md` | **není** |
| OpenAPI specifikace | **není** |
| n8n workflow JSON (osm) | **není** |
| krátký český manuál | je (`docs/marketing-manual.md`) |

### Proč zmizely — a proč to přesto uvádím

**Nebylo to opomenutí.** Vznikly v samostatné aplikaci `marketing-ai/`
a zmizely s ní, když se marketing převáděl na modul (commit `d8a0b73`,
13. 9., 179 souborů). Rozhodnutí je zapsané v
`docs/marketing-je-modul.md`, oddíl 4, i s návodem, jak je vytáhnout
zpět z historie.

Uvádím to proto, že **zadání říká „v repozitáři vytvoř"** — a proti té
větě to splněné není, ať byl důvod jakkoli dobrý. Kdo modul přebere,
najde v historii commit, který 28 tisíc řádků maže, a bez tohohle
odstavce z toho nepozná, co bylo záměr a co ztráta.

### Co s tím doopravdy

**Vrátit je jedna k jedné by bylo horší než nic.** Zkoušel jsem to na
`scheduled-social-publish.json`: volá `POST /api/v1/ulohy/zpracovat`,
zatímco modul má dnes `/api/uloha/marketing-fronta`
a `/api/uloha/marketing-automatizace`. Workflow, které volá adresu,
jež neexistuje, není dokumentace — je to past.

A většina těch osmi workflow je pro rozhraní, které modul nemá:

| Workflow | Platí pro modul? |
|---|---|
| `scheduled-social-publish` | ano, po opravě adresy |
| `recurring-campaigns` | ano, po opravě adresy |
| `approval-notification` | **ne** — od 14. 9. to dělá spoušť v databázi |
| `publish-retry-deadletter` | **ne** — opakování řeší fronta v databázi |
| `metrics-sync` | **ne** — stahování metrik neexistuje |
| `render-monitor` | **ne** — renderer není napojený |
| `connection-health` | zčásti |
| `content-generation` | zčásti |

Doporučení: **vrátit dvě, které platí, s opravenými adresami**, a k nim
jeden pravdivý dokument o tom, co n8n v dnešním modulu dělá. Ne osm
kusů, které popisují aplikaci, jež už neexistuje.

---

## 4. Šestnáct obrazovek: čtrnáct, ne šestnáct

V hlášení ze 14. 9. jsem napsal „šestnáct obrazovek ze šestnácti".
**Bylo to nepřesné** a `docs/marketing-co-zbyva.md` to říká správně:

- **obrazovka 5** (Průvodce vytvořením) — všechny kroky existují, ale
  každý jinde; průvodce, který vede za ruku, není,
- **obrazovka 16** (Tým, role a auditní přehled) — rozpracovaná
  14. 9. odpoledne, databázová část hotová.

K tomu **obrazovka 3** (Dashboard) postrádá jednu z šesti věcí, které
§22 jmenuje: „stručný výkon posledních příspěvků". Do 14. 9. to nešlo,
protože analytika neexistovala. Teď existuje, takže to udělat jde.

---

## 5. Co proti zadání sedí

Aby byl obrázek úplný — tohle jsem ověřoval a drží to:

| Kritérium (§25) | Čím |
|---|---|
| Data obou provozoven oddělena | RLS + `app.has_access`, scénáře `marketing1`–`marketing14` |
| Bez schválení nelze publish | čtyři spouště v databázi, ne kontrola v aplikaci |
| Po změně schválené verze nové schválení | otisk verze, hlídá databáze |
| Publish retry nevytvoří duplicitu | `idempotencni_klic` s jedinečným indexem |
| Ruční export a mock bez placeného provideru | režimy `rucni`, `demo`, stav `k_rucnimu_zverejneni` |
| Dvě firmy nevidí vzájemně credentials | `marketing_tajemstvi`, šifrované, bez auditní spouště |
| UI jen to, co provider umí | `specProUlohu` v `lib/marketing-kanaly.ts` |
| Kalendář ukazuje koncept i publikaci | `marketing/kalendar` |
| Zimní a letní čas v `Europe/Prague` | pásmo z pobočky, převod v databázi |
| Česká diakritika a dlouhé názvy | kontroly v `scripts/marketing-*.test.mjs` |

**Bezpečnost (§23)** drží v tom podstatném: žádná tajemství v klientovi,
otisky místo čitelných tokenů, RLS i serverová kontrola, audit
důležitých akcí, omezení typů a velikosti nahrávaných souborů.
Nedodělané zůstává ověřování podpisů webhooků a rate limiting — n8n
dnes volá Foodtab jen sdíleným tajemstvím v hlavičce.

---

## 6. Co chybí a nejde to dodělat bez Šéfíka

Beze změny proti 14. 9. ráno:

| Co | Proč to nejde |
|---|---|
| Stahování čísel ze sítí (§18) | chybí připojený účet s oprávněním číst statistiky |
| Automatická grafika a video (§12) | renderer není napojený, je to placená služba |
| Zapnutí cesty ven (§16) | n8n je vypnuté, běží v něm starý workflow |
| E2E scénář (§25) | v repozitáři žádný E2E běh není |

---

## 7. Co navrhuju dál, v tomhle pořadí

1. **Dokončit obrazovku 16** (auditní přehled) — databázová část hotová.
2. **Výkon posledních příspěvků na dashboard** — analytika už je.
3. **n8n: dvě workflow s opravenými adresami + pravdivý dokument.**
4. **Video do mediální knihovny.**
5. Obrazovka 5 (průvodce vytvořením) — je to spíš přeuspořádání
   hotových kroků než nová stavba.

Body 1 a 2 jsou malé. Bod 3 je ten, který nejvíc pomůže, až budete
zapínat cestu ven. Bod 4 je největší.
