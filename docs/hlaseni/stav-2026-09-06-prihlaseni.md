# Stav k 6. 9. 2026 — dodělaná noc a přihlašování

Podle `docs/prihlaseni-dokonceni-2026-09-06.md`, části 0 až 2.
Navazuje na `docs/hlaseni/stav-2026-09-06.md`.

---

## Nejdřív dvě věci, které chci mít nahoře

**1. Kontroly mi třikrát prošly nad rozbitým kódem.** Vždycky až
schválné rozbití ukázalo, že měřily něco jiného, než na co mířily —
jednou vlastní komentář, jednou deklaraci místo použití, jednou vzorec,
který nemohl chytit ten tvar, co v souboru doopravdy byl. Všechny tři
jsou opravené a je u nich napsané, co se stalo. Podrobně v oddílu
„Co se málem prošvihlo".

**2. E-mailová šablona je na tobě a bez ní přihlášení nefunguje.**
Kód se v e-mailu neobjeví, dokud se v Supabase nepřepne šablona na
`{{ .Token }}`. Text k vložení je dole.

---

## Část 0 — zbytek z noci, všech pět hotovo

| co | commit | čeká na `db push` |
|---|---|---|
| Krok E dopsaný do výčtu v `krok19` | `45491ee` | `20260906050000_kiosek_zpravy.sql` |
| Štítek, ne zámek | `c832f10` | `20260906060000_stitek_ne_zamek.sql` |
| Doručení jen v provozním dni | `a48320c` | `20260906070000_doruceni_jen_v_provoznim_dni.sql` |
| Vzkaz vedení: pobočku vybírá odesílatel | `771a3e3` | `20260906080000_vzkaz_vedeni_pobocka.sql` |
| `CLAUDE.md`, názvy tabulek | `07136e9` | — |

**Krok E.** Do výčtu jsem `kiosk_zpravy_pinem` dopsal a nad kontrolu
napsal, **kdo a kdy ji prošel** — ať je za rok vidět, že to nikdo
neproklouzl. Soubory se vrátily z `docs/pripraveno-krok-E/` na své
místo, `krok28` je v `run.sh` i v CI.

**Štítek, ne zámek.** `complete_task` i kontrola v `krok3_scenar`
v jednom commitu, `krok27` sjednocený. „Kdo vidí" se bere z `app.can_read_scoped`,
tedy z **téže funkce jako politika čtení** — ne z `has_access`. Rozdíl
není kosmetický: u firemního úkolu (`branch_id is null`) by `has_access`
vyžadoval členství na celou firmu, takže by číšník úkol **viděl
a nesměl ho zavřít**, a věta „kdo vidí, smí zavřít" by přestala platit
hned u prvního firemního úkolu. Platí to i pro úkol na úsek
(odpověď 3).

**Doručení jen v provozním dni.** Zapomenutý odchod už člověka nedrží
„ve službě". Záznam se tím ale **neuklidí** — zůstává nedokončený,
zůstává v panelu i v dosahu hlídače. Na tu druhou polovinu je zvláštní
kontrola: kdyby aplikace překážku odklidila, vedoucí by se nedozvěděl,
že tam byla.

**Vzkaz vedení.** Kdo dosáhne na jednu pobočku, se na nic neptá; kdo na
víc, vybere ji — a když nevybere, dostane větu, ne tiché dosazení
domovské pobočky. Na obrazovce se adresáti vypisují **jmenovitě**
a berou se z `kdo_uvidi_vzkaz`, tedy z téže funkce, kterou se pak
vybírají účastníci. Kdyby si to obrazovka počítala po svém, slíbila by
jeden okruh a konverzace by vznikla s jiným.

---

## Část 1 a 2 — přihlašování

### Odpověď na tvoji otázku: cookie zakládá SERVER. Tady je, na čem jsem to viděl.

Ptal ses výslovně a tohle je důkaz, ne dojem:

1. **`app/auth/callback/route.ts` je route handler** (`export async function GET`),
   ne server komponenta. V něm je `cookies()` zapisovatelné a Next z toho
   udělá skutečnou hlavičku `Set-Cookie`. Sezení tam vzniká na ř. 28
   voláním `exchangeCodeForSession(code)` nad **serverovým** klientem.
2. **`lib/supabase/server.ts` používá `createServerClient`** z `@supabase/ssr`
   a zapisuje přes `cookieStore.set(name, value, options)` — tedy přes
   adaptér, ne přes `document.cookie`.
3. **`proxy.ts` obnovuje přes `response.cookies.set`** na `NextResponse`,
   což je zase hlavička.
4. **Pustil jsem tu knihovnu doopravdy**, ne jen přečetl. S adaptérem
   přesně toho tvaru, jaký má `server.ts`, a podvrženou sítí:
   `setAll` dostal cookii `sb-…-auth-token` s `maxAge` 400 dní. Do
   `document.cookie` nesáhl nikdo. Pro srovnání `createBrowserClient`
   ve stejné zkoušce zapsal touž cookii do `document.cookie`.

**ALE NAŠLA SE DÍRA a byla přesně tam, kde jsi popisoval potíž.**

Cookie **není `httpOnly`** (Supabase to tak má schválně), takže ji
javascript přepsat může. A `getBrowserSupabase()` se stavěl **na
přihlašovací obrazovce**. Ten klient si sám obnovuje token a při
obnově zapisuje sezení do `document.cookie` — tedy javascriptem, a to
je přesně ta cookie, kterou Safari zkracuje na sedm dní.

K tomu druhá polovina: **`/prihlaseni` neměla obrácenou branku.**
Nikde nebylo „už jsi přihlášený, běž pryč", takže přihlášený člověk na
té stránce zůstat mohl — a nechat si serverem zapsanou cookii přepsat
tou horší.

Obojí je zavřené: browser klient z přihlášení **zmizel úplně**
(všechno běží v serverové akci) a branka přibyla. Hlídá to kontrola,
která se dívá do zdrojáku — kdyby tam někdo příště Supabase z prohlížeče
vrátil, spadne to hned, a ne za týden na tvém telefonu.

**Zbývá jedno místo, které jsem nechal:** `app/kiosek/kiosek.tsx`
browser klient používá dál. Na kiosku není nikdo přihlášený, takže tam
žádná přihlašovací cookie k přepsání není — ale kdyby si tam někdo
otevřel `/kiosek` na svém přihlášeném telefonu, tatáž cesta se otevře.
Nesahal jsem na to; kiosek je jiný modul a jiné riziko. **Nález.**

### Kód místo odkazu

Odkaz nesl `token=pkce_…` a dokončit ho šlo jen v tom prohlížeči, který
si o něj řekl. Teď se posílá kód:

- pole s `autoComplete="one-time-code"` a `inputMode="numeric"`,
- **„Poslat znovu" je 60 vteřin zašedlé** i s odpočtem, a čas přišel ze
  **serveru** — kdyby si ho měřil prohlížeč, obejde se to přetočením
  hodin,
- e-mail jde změnit **bez načtení stránky**,
- pod tím věta, že nový kód zneplatní předchozí (to je ta past, na
  které jsi ztratil tři kódy).

**Přihlášení už nezakládá účty.** Do Foodtabu se vstupuje jen na
pozvánku, a bez `shouldCreateUser: false` by si vstup udělal kdokoli
s e-mailovou adresou. Neznámá adresa dostane **stejnou odpověď** jako
známá.

**„Moc pokusů" (429) se odlišuje od „špatný kód".** Limity jsou na IP
a celá provozovna má na wifi jednu — kdyby to splynulo, hledal bys
chybu tam, kde žádná není. Chytá se stav 429 **i textový kód**
(`over_email_send_rate_limit`, `over_request_rate_limit`); Supabase
vrací podle cesty jedno, nebo druhé.

### Odhlásit se

Na **Moje údaje, dole, oddělené**. Ne v horní liště: omylem ťuknutý
odhlas uprostřed směny je horší než o jedno ťuknutí delší cesta.
Na kiosku není — tam se odhlašuje samo (krok E). Obojí hlídá kontrola.

### Návrat tam, odkud člověk šel

`redirect('/prihlaseni')` původní adresu zahazoval. Teď se cesta
zabaluje do adresy **už ve chvíli odmítnutí** — na přihlašovací
obrazovce je hlavička `x-foodtab-adresa` už rovna `/prihlaseni`, takže
později se původní cesta nedozví nikdo.

Změněno v **rámu** (pokrývá všechny obrazovky uvnitř rozsahu) a na
Moje údaje. Jednotlivé stránky uvnitř `[rozsah]` mají svoje
`redirect('/prihlaseni')` dál — rám běží dřív, takže se k nim člověk
nedostane, ale hezké to není. **Nález, ne hotovo.**

### Věta o přidání na plochu

Ukazuje se **jen v prohlížeči na telefonu**, ne v aplikaci na ploše
a ne na počítači. Rozhodnutí je vytažené do `lib/prihlaseni.ts`, takže
se dá vyzkoušet bez prohlížeče — a je na ně čtveřice kontrol.

### SMS

Nedělá se. Komponenta se ale jmenuje `prihlaseni-kodem.tsx` a mluví
o **kódu**, ne o e-mailu, takže až SMS přijde, změní se jen to, kam se
kód posílá.

---

## Co musíš udělat ty

### 1. Šablona e-mailu — bez ní kód nepřijde

Supabase → Authentication → Email Templates → **Magic Link**.

Předmět:

```
Foodtab — přihlašovací kód
```

Tělo:

```html
<h2>Váš kód pro přihlášení do Foodtabu</h2>

<p style="font-size:28px;letter-spacing:0.2em;font-weight:bold">
  {{ .Token }}
</p>

<p>
  Platí několik minut a použije se jednou. Opište ho do aplikace,
  kde jste o něj požádali.
</p>

<p>Když jste o kód nežádali, nic nedělejte.</p>

<p style="font-size:12px;color:#666">
  Nebo se přihlaste odkazem, pokud čtete poštu na tomtéž zařízení:
  <a href="{{ .ConfirmationURL }}">Přihlásit se</a>
</p>
```

Odkaz je schválně dole a menším písmem — **kód je hlavní cesta**.

### 2. E-maily z 30/h na 100/h

Než rozešleš pozvánky. Deset pozvánek, kde si půlka lidí nechá kód
poslat podruhé, je přes dvacet zpráv — a po překročení stropu se
e-maily **tiše zahazují**: člověk vidí „kód odeslán" a nepřijde nic.

---

## Čísla — a z čeho jsou

| kde | kolik |
|---|---|
| databázové scénáře | **910 kontrol, PGlite** |
| `scripts/prihlaseni.test.mjs` | **68 kontrol, Node** (nové) |
| `scenare.test.mjs`, `scenare-poradi`, `manifest`, `qr`, `barvy` | prošly |
| `npm run build` | prošel |
| eslint nad novými soubory | mlčí |

Databázová čísla jsou **z PGlite**, ne z PostgreSQL — na tomhle stroji
není psql ani Docker. Tvých 875 z opravdového PostgreSQL a moje čísla
seděly, takže tomu zatím věřím; rozhoduje ale dál workflow Databáze.

**Schválných rozbití: 25.** Osm u části 0, čtrnáct u přihlášení, tři
u návratu na původní adresu. Každé spadlo na té kontrole, kterou mělo
shodit — u tří to bylo až napodruhé, viz níž.

---

## Co se málem prošvihlo

Tohle je ta část, kterou má smysl číst, i kdyby zbytek ne.

**1. Kontrola měřila vlastní komentář.** Kontrola „přihlašovací
obrazovka nesahá na Supabase z prohlížeče" hledala `getBrowserSupabase`
ve zdrojáku a spadla — jenže nad **správným** kódem. Trefila se do
odstavce v hlavičce, který vysvětluje, PROČ se ten klient nepoužívá.
Kdybych ji „opravil" smazáním toho odstavce, zůstane kontrola, která
zakazuje psát o tom, čemu brání. Teď se komentáře odstraňují a ten
odstraňovač má vlastní kontrolu, že opravdu něco odstraňuje.

**2. React vypisuje `autoComplete`, ne `autocomplete`.** Kontrola na
`one-time-code` hledala malými písmeny a spadla nad kódem, ve kterém
ten atribut byl. **Kdybych to opravil v komponentě místo v kontrole,
rozbil bych funkční kód podle chybné zkoušky** — a iPhone by kód
z oznámení přestal nabízet. Porovnává se teď bez ohledu na velikost
písmen.

**3. Dvě kontroly u návratu na původní adresu neuměly spadnout.**
Vzorec `/redirect\(\s*["']\/prihlaseni/` minul jediného pachatele,
co v souboru byl: `redirect(zQr ? "/prihlaseni?qr=1" : "/prihlaseni")`
má za závorkou ternární operátor, ne adresu. A druhá kontrola měřila
**deklaraci** proměnné `kamZAdresy` místo jejího **použití**, takže
prošla i po vyndání hodnoty z výpočtu. Obě jsou přepsané a obě mají
vedle sebe kontrolu, že se ten vzorec vůbec umí trefit.

**4. `krok28_scenar` četl `test.tenant`, který si sám nenastavil.**
V PGlite to prošlo, protože tam jede všechno v jednom sezení a hodnota
tam po předchozím scénáři ještě ležela. **V psql by to spadlo** — každý
soubor je vlastní sezení. Chytil to `scripts/scenare.test.mjs`, ne
můj běh. Je to přesně ten rozdíl mezi PGlite a PostgreSQL, na který
je potřeba dávat pozor.

---

## Nálezy

1. **`app/kiosek/kiosek.tsx` používá browser klient.** Na kiosku není
   nikdo přihlášený, takže tam přihlašovací cookie k přepsání není —
   ale kdo si `/kiosek` otevře na svém přihlášeném telefonu, otevře
   tutéž cestu k sedmidenní cookii. Nesahal jsem na to.
2. **Stránky uvnitř `[rozsah]` mají vlastní `redirect('/prihlaseni')`**
   a tím zahazují adresu. Rám běží dřív, takže se k nim člověk
   nedostane, ale je to dvacet míst, která budou při příští úpravě
   mást.
3. **`udelej_apka_qr.py` v repozitáři není.** Prohledal jsem celou
   historii: žádný python tu nikdy nebyl, jen hotové
   `docs/qr/foodtab-apka-a4.pdf` a `.png` z commitu `5ceea76`.
   **List s QR se dnes nedá přegenerovat**, takže tam větu o pořadí
   („nejdřív na plochu, pak se přihlas") doplnit neumím. Buď je ten
   skript mimo repozitář, nebo PDF vzniklo ručně — poraď, kde je.
4. **`proxy.ts:74`** má v matcheru `'.*\.(?:svg|png|…)$'` v jednoduchých
   uvozovkách. `\.` je v řetězci neplatná escape sekvence a zredukuje se
   na `.`, takže výsledný vzorec má „libovolný znak" místo tečky.
   Prakticky to nic neshodí, ale je to jiné, než jak to vypadá.
   Patří tam `\\.`.
5. **`npm run lint` je pořád červený** — 10 chyb a 23 varování
   v souborech, kterých jsem se nedotkl (`app/dashboard.tsx`,
   `rozpis.tsx`). Moje nové soubory jsou čisté, ověřeno spuštěním jen
   nad nimi. Zmiňuju to znovu, protože červený lint, na který se nikdo
   nedívá, je stejný případ jako červené CI.

---

## Co jsem NEOVĚŘIL

**Neviděl jsem přihlašovací obrazovku vykreslenou v prohlížeči.**
Nemám jak: přihlásit se nejde, dokud nezměníš šablonu e-mailu, a
migrace na testu ještě nejsou.

Ze **deseti bodů zkoušek** v zadání jde bez živého Supabase a bez
prohlížeče ověřit **pět**. Zbylých pět je napsaných přímo v hlavičce
`scripts/prihlaseni.test.mjs` a musí se projít rukou:

| bod | co potřebuje |
|---|---|
| 1. kód projde a přihlásí | živý Supabase |
| 3. vypršelý kód neprojde | živý Supabase (platnost hlídá on) |
| 4. kód nejde použít dvakrát | živý Supabase |
| 5. nový kód zneplatní předchozí | živý Supabase |
| 8. odhlášení a tlačítko zpět | prohlížeč |
| 9. přihlášení drží po zavření aplikace | prohlížeč |

Bod 9 je ten, kvůli kterému se to celé dělalo — a je zároveň ten,
který se pozná až **za týden**. Kdyby se ti přihlášení zase ztratilo,
první, kam se podívat, je jestli něco nesáhlo na Supabase z prohlížeče.

---

## Co je potřeba udělat, v tomhle pořadí

1. **Pushnout.** Commitů je teď devět a nejsou na GitHubu — CI je
   nevidí. Nepushoval jsem: je to krok ven a nežádal jsi o něj.
2. **Změnit šablonu e-mailu** a zvednout limit na 100/h.
3. **`supabase db push`** — čeká devět migrací:
   `20260905010000`, `20260905020000`, `20260906010000` až
   `20260906080000`.
4. **Zkusit se přihlásit** a projít těch šest bodů z tabulky výš.
5. **Podívat se na obrazovky** — seznam čtyř věcí je v předchozím
   hlášení, plus nově formulář „Napsat vedení" na Rozhovorech a
   „Odhlásit se" na Moje údaje.
