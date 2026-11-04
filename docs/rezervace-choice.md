# Choice → Foodtab: rezervace načítané přímo

Rezervace z Choice (choiceqr.com) se samy objeví v **Provoz → Rezervace
a akce**. Foodtab se Choice ptá **každých 15 minut** (Choice je sám
poslat neumí) a do Choice **nic nezapisuje** — potvrzování a rušení
zůstává v Choice.

Ve Foodtabu k rezervacím dál přidáváte poznámky, dokumenty, zálohu od
hosta a stůl. To Choice nepřepíše. Čas, počet osob, stav, jméno
a kontakt patří Choice — změna v Choice se do Foodtabu propíše při
dalším načtení. Zrušená rezervace ve Foodtabu zůstane jako „zrušená“,
i s vašimi poznámkami.

## Co je potřeba jednou nastavit (tři kroky)

### 1. Klíče aplikace Foodtab do Vercelu

Aplikace „Foodtab“ (typ Plugin) je v Choice už založená. V Choice
otevřete <https://open-api.choiceqr.com/auth/client> → aplikace
**Foodtab** a zkopírujte **Client ID** a **Client secret**.

Ve Vercelu: projekt **foodtab-rizeni** → Settings → Environment
Variables → přidejte (prostředí Production):

| Název | Hodnota |
|---|---|
| `CHOICE_CLIENT_ID` | Client ID z Choice |
| `CHOICE_CLIENT_SECRET` | Client secret z Choice |

Pak **Redeploy** (proměnné se projeví až v novém nasazení).

U aplikace v Choice musí být jako **Authorization callback URL**
přesně `https://foodtab-rizeni.vercel.app/api/rezervace/choice/callback`
(už tam je). Kdybyste appku otevírali na jiné adrese, musí ta adresa
sedět i tady.

Dokud klíče ve Vercelu nejsou, ukazuje karta Choice **„Čeká na
nastavení“** a připojit nenabízí.

### 2. ChoiceQR token od Choice

Při připojení se Choice zeptá na **ChoiceQR token**. Ten posílá Choice
— napište na **api@choiceqr.com** (nebo své kontaktní osobě v Choice),
že chcete připojit svůj podnik k aplikaci Foodtab přes Open API.

### 3. Připojit podnik ve Foodtabu

Nejdřív si v Choice nechte vygenerovat **odkaz na připojení**: na
<https://open-api.choiceqr.com/auth/client> → aplikace **Foodtab** →
**Connected company list** zadejte adresu podniku (např.
`https://cernaperlatabor.choiceqr.com`) a klikněte na **Connect**.
Objeví se odkaz, který začíná
`https://…choiceqr.com/admin/open-api/connect?clientId=…` a končí
`&digit=` a čtyřmi číslicemi. Ten zkopírujte **celý**.

Jen adresa podniku nestačí: číslo `digit` v odkazu přiděluje Choice
a bez něj se připojení nedokončí.

Pak ve Foodtabu **Provoz → Rezervace a akce → Napojení a import →
karta Choice**:

1. vyberte pobočku (když jich máte víc),
2. do pole **Odkaz na připojení z Choice** vložte zkopírovaný odkaz,
3. **Připojit podnik v Choice** → Choice se zeptá na ChoiceQR token
   a na povolení → po povolení vás vrátí do Foodtabu.

Foodtab pak přístup **hned vyzkouší** (jedním dotazem na rezervace)
a teprve když projde, ukáže **„Připojeno“**. První rezervace se začnou
načítat hned. Odkaz na připojení platí 10 minut a jen pro vás —
kdyby vypršel, klikněte znovu.

Připojit smí ten, kdo má právo „Správa napojení na externí systémy“.

## Na co se dívat

U pobočky na kartě Choice:

- **Připojeno** + „naposledy načteno … · N rezervací“ — vše běží,
- **Načíst teď** — načte hned, nečeká na čtvrthodinu (smí i ten, kdo
  na pobočce zapisuje rezervace),
- **Ověřit znovu** — znovu vyzkouší přístup (u pobočky nejvýš jednou
  za minutu),
- **Odpojit** — Foodtab se přestane ptát a smaže uložený token.
  Už načtené rezervace zůstanou. Přístup aplikace můžete zrušit i
  v Choice.

Červený text pod pobočkou říká, co se nepovedlo, třeba:

- *Choice omezil počet dotazů (429)* — nic se neděje, pokračuje se při
  dalším běhu;
- *Choice odmítl přístup (401/403)* — token přestal platit, připojte
  podnik znovu (Odpojit → Připojit podnik v Choice);
- *Nezapsaly se 2 rezervace z Choice (čas bez časového pásma)* — Choice
  poslal čas, ze kterého nejde poznat, kdy rezervace je. Foodtab si ho
  nedomýšlí (posunula by se o hodinu či dvě). Pošlete prosím tu hlášku
  vývojáři;
- *Stoly z Choice se nenačetly (…) — u N rezervací zůstávají naposledy
  načtené* — seznam stolů z Choice se tentokrát nepřečetl. Rezervace se
  načítají dál, jen stoly se neobnovily; příští běh to zkusí znovu;
- *U N rezervací poslal Choice stůl, který v seznamu míst v Choice
  není* — ve Foodtabu je u nich „1 stůl bez názvu“. Zkontrolujte
  v Choice nastavení míst (stůl mohl být smazaný nebo přejmenovaný).

## Co se z Choice načítá

U každé rezervace: čas, počet osob, stav, jméno a kontakt hosta,
poznámky (hosta, restaurace, důvod zrušení), záloha (jen stav),
**přidělené stoly** a **číslo rezervace v Choice** (#105).

- **Stoly** se ukážou v kalendáři (týden: druhý řádek karty, den:
  u počtu osob) a v detailu rezervace jako „Stoly v Choice: Patro:
  S1–S12“. Tři a víc stolů po sobě se píšou rozsahem (S1–S12), víc
  částí podniku se oddělí tečkou („Patro: S1, S2 · Terasa: L7“). Stoly
  patří Choice: když hosta v Choice přesadíte, Foodtab to při dalším
  načtení přepíše.
- **„Stůl / prostor“** ve Foodtabu patří dál obsluze. Choice ho jen
  doplní přáním hosta (část podniku), když je prázdný; co do něj napíše
  obsluha, načtení z Choice nepřepíše.
- **Číslo rezervace** je v detailu („Převzato z rezervačního systému
  (Choice, č. 105)“), ať se dá rezervace v Choice dohledat.
- **Délka návštěvy** (v Choice třeba „2h“) se zatím nenačítá: Choice
  v dokumentaci neříká, v jakých jednotkách ji posílá, a odhadnutý konec
  by mohl být špatně. Konec rezervace tedy ve Foodtabu zůstává prázdný.

## Proč to chvíli trvá

Choice dovolí jen **jeden dotaz za 5 sekund**. Jeden dotaz přinese
nejvýš 100 rezervací. Při každém běhu se Foodtab nejdřív zeptá na
dnešek a zítřek (storna se tak objeví do čtvrt hodiny) a na nově
vytvořené rezervace, pak pokračuje v procházení dalších 180 dní tam,
kde minule skončil. Velký podnik se tak celý načte během několika
běhů; nové a dnešní rezervace vždy hned.

Jeden běh (čtvrthodinu) stihne zhruba sedm dotazů. S jednou nebo
dvěma pobočkami na Choice se tak každá načte při každém běhu. Při víc
pobočkách se střídají (dvě za běh): žádná se nepřeskočí natrvalo
a každá, když přijde na řadu, dostane čas i na procházení 180 dní.
Se čtyřmi pobočkami se tedy každá načte zhruba každou půlhodinu.

---

## Pro vývojáře

- Adaptér: `lib/rezervace-choice.ts` (čistá logika, testy
  `scripts/rezervace-choice.test.mjs`), server
  `lib/rezervace-choice-sync.ts`, callback
  `app/api/rezervace/choice/callback/route.ts`, úloha
  `app/api/uloha/rezervace-choice/route.ts` +
  `.github/workflows/rezervace-choice.yml`.
- Migrace `20261031100000_rezervace_choice.sql`: úloha v plánovači
  a fronta dotazů `rezervace_choice_zabrat_dotaz(p_tenant, …)` (jen
  service_role, rozestup 5,5 s pro celou instalaci, každá firma nejvýš
  jeden zabraný dotaz, který ještě neodešel — souběžné kliky jedné
  firmy nezaberou frontu ostatním). Tlačítka (Ověřit znovu, Načíst teď,
  callback) čekají ve frontě nejvýš dva rozestupy
  (`NEJDELE_CEKA_TLACITKO_MS`, 11 s): vedle jednoho běžícího načítání
  jiné firmy se vejdou vždy (s jedním rozestupem skoro nikdy) a ani
  mnoho firem nezdrží úlohu ostatních o víc než ~16,5 s; celý svůj díl
  čeká jen naplánovaná úloha (`uloha: true`). „Ověřit znovu“ nejvýš
  jednou za minutu na připojení — odstup a dotaz ve frontě rozhoduje
  `rezervace_choice_zabrat_overeni` naráz, takže klik, který se do
  fronty nevejde, minutu nespálí. Scénář `krok105` (oddíly 2b a 2d
  zkoušejí zámek řádku firmy a zámek odstupu dvěma spojeními přes
  dblink — jen proti PostgreSQL).
- Migrace `20261102100000_rezervace_choice_fronta_tlacitka.sql`
  (nezávislé ověření po sloučení #162): úloha jde do fronty vlastním
  vstupem `rezervace_choice_zabrat_dotaz_ulohy` bez pravidla firmy
  (úloha je v instalaci jediná) — tlačítko její firmy ji neusekne a ona
  tlačítko nezablokuje. Tlačítka, když se nevejdou, dostanou záporně
  „zkusit znovu za n ms“ (až odejde dotaz, který má firma zabraný, a až
  se fronta posune) a server jednou počká, nejvýš jeden rozestup
  (`NEJDELE_PRED_OPAKOVANIM_MS`). Tak projde callback pobočky 2 během
  prvního načtení pobočky 1 téže firmy i třetí tlačítko vedle dvou běhů
  jiných firem a dva běhy téže firmy se střídají. „Načíst teď“ má na
  běh 55 s (`KONEC_NACIST_TED_MS`), aby i vedle běžícího načítání
  stihlo všechny tři dotazy. `db push` až po nasazení kódu (starý kód
  bere záporné číslo jako chybu fronty); nový kód se starou databází
  jede jako dřív. Souběh ve virtuálním čase: `scripts/rezervace-choice.test.mjs`,
  oddíl 6a.
- Úloha dělí čas: rezerva 20 s se odečte jednou za úlohu, zbytek po
  dílech nejméně na tři dotazy; pořadí `poradiSynchronizace` (firmy se
  střídají, podle `synchronizace_behy`, tentýž podnik u firmy jednou).
  Běh, který se na Choice ani jednou nezeptal (fronta plná), zapíše
  prázdný `pocet_novych_radku` a pořadí ho nepočítá — „Načíst teď“, které
  nic nenačetlo, připojení neodsune.
- Zápis stávající cestou `rezervace_importovat_zdroj` (poskytovatel
  `choice`, číslo = `_id`). Token zašifrovaný v `integrace_tajemstvi`,
  kurzor v `integrace_pripojeni.externi_ucet.kurzor`.
- Stoly (migrace `20261107100000_rezervace_misto_zdroje.sql`, 4. 11.):
  `locationPoints` rezervace (id stolů) se převedou na text podle
  seznamu míst (`GET /location/cs/areas/list`, pak
  `/location/cs/points/list/:areaId` pro každou oblast se stoly, nejvýš
  20). Seznam se načte nejvýš jednou za běh, jen když nějaká rezervace
  stoly má, a zabere si místo ve frontě dotazů (limit 1 / 5 s
  dokumentace u míst neuvádí, fronta je pojistka). Časový limit 6 s na
  dotaz (`CASOVY_LIMIT_MIST_MS`), oblasti, pak stoly souběžně — vejde
  se do rezervy běhu. Výsledek jde do `rezervace.misto_zdroje` (patří
  zdroji, přepisuje se), `num` do `rezervace.cislo_zdroje`,
  `cancelReason` do poznámky ze zdroje. Nepovedený seznam = klíč
  `misto_zdroje` v řádku chybí a databáze nechá uložené
  (`app.rezervace_zapsat_radky`); prázdné `locationPoints` = `''`
  (stoly smazat). Klíče se čtou jen u `p_zdroj = 'externi'` — import
  ze souboru je posílá z prohlížeče a nesmí si vydávat stoly za Choice.
  Kód čte nové sloupce s náhradou (`sloupciZdroje` v
  `app/[rozsah]/rezervace/data.ts`): do `db push` kalendář ukazuje
  rezervace bez stolů, ne chybu. Testy: `rezervace-choice` oddíl 11,
  `rezervace-pobocky` oddíl 7, scénář `krok109`.
- NEOVĚŘENO proti živému Choice: že id v `locationPoints` rezervace
  jsou tatáž id jako `_id` míst z `/location` (dokumentace to neříká
  výslovně). Kdyby nebyla, u rezervací bude „N stolů bez názvu“
  a u napojení hláška „poslal Choice stůl, který v seznamu míst není“ —
  podle ní se to pozná hned po prvním načtení.
- Co dokumentace Choice neříká a Foodtab nedomýšlí: tvar `dateTime`
  (bere se jen okamžik s pásmem), jednotka `visitDuration` (konec se
  nevyplňuje), jednotka `deposit.amount` (jen stav zálohy), význam
  `digit` v odkazu (přiděluje ho Choice, proto se připojuje jen celým
  odkazem z Choice a `digit` se předá, jak přišel), jestli limit
  1 dotaz / 5 s platí na token, nebo na aplikaci (fronta je proto
  společná).
