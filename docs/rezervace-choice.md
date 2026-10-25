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

**Provoz → Rezervace a akce → Napojení a import → karta Choice**:

1. vyberte pobočku (když jich máte víc),
2. vyplňte adresu podniku v Choice, např. `cerna-perla.choiceqr.com`
   (jde vložit i celý odkaz na připojení, který Choice vygeneruje
   u aplikace Foodtab v části „Connected company list“),
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
- **Ověřit znovu** — znovu vyzkouší přístup,
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
  vývojáři.

## Proč to chvíli trvá

Choice dovolí jen **jeden dotaz za 5 sekund**. Jeden dotaz přinese
nejvýš 100 rezervací. Při každém běhu se Foodtab nejdřív zeptá na
dnešek a zítřek (storna se tak objeví do čtvrt hodiny) a na nově
vytvořené rezervace, pak pokračuje v procházení dalších 180 dní tam,
kde minule skončil. Velký podnik se tak celý načte během několika
běhů; nové a dnešní rezervace vždy hned.

---

## Pro vývojáře

- Adaptér: `lib/rezervace-choice.ts` (čistá logika, testy
  `scripts/rezervace-choice.test.mjs`), server
  `lib/rezervace-choice-sync.ts`, callback
  `app/api/rezervace/choice/callback/route.ts`, úloha
  `app/api/uloha/rezervace-choice/route.ts` +
  `.github/workflows/rezervace-choice.yml`.
- Migrace `20261031100000_rezervace_choice.sql`: úloha v plánovači
  a fronta dotazů `rezervace_choice_zabrat_dotaz` (jen service_role,
  rozestup 5,5 s pro celou instalaci). Scénář `krok105`.
- Zápis stávající cestou `rezervace_importovat_zdroj` (poskytovatel
  `choice`, číslo = `_id`). Token zašifrovaný v `integrace_tajemstvi`,
  kurzor v `integrace_pripojeni.externi_ucet.kurzor`.
- Co dokumentace Choice neříká a Foodtab nedomýšlí: tvar `dateTime`
  (bere se jen okamžik s pásmem), jednotka `visitDuration` (konec se
  nevyplňuje), jednotka `deposit.amount` (jen stav zálohy), význam
  `digit` v odkazu (předá se, jak přišel), jestli limit 1 dotaz / 5 s
  platí na token, nebo na aplikaci (fronta je proto společná).
