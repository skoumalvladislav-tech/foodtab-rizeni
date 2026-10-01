# Claude Code: nastavení pro kvalitní vývoj celé gastro aplikace

Připraveno 1. 10. 2026 pro Foodtab Řízení, budoucí prodejný gastro SaaS s ERP a marketingem. Tento postup neznamená, že nastavení na tvém počítači již bylo provedeno. Nemám přístup k tvé místní instalaci Claude Code ani repozitáři. Příkazy a nastavení musíš spustit u sebe; úvodní prompt nechá Claude nakonfigurovat a ověřit projektové prostředí.

Prompty lze vložit přímo do Claude Code bez přípravy souborů. Pokud zadání dostal v konverzaci, má si jej uložit sám a nevydávat chybějící soubor za chybějící požadavek. Souborový postup níže je volitelná cesta pro pohodlné obnovení práce.

## 1. Připrav správný projekt

Otevři aktuální místní repozitář, ve kterém aplikaci opravdu vyvíjíš. Samotné otevření webu foodtab-rizeni.vercel.app Claude nedá přístup ke zdrojovému kódu. Nezakládej druhou nesouvisející kopii aplikace.

Ve Windows otevři složku projektu v Průzkumníku, klikni do adresního řádku, napiš `powershell` a stiskni Enter. V otevřeném terminálu spusť jednotlivě:

```powershell
git status
git branch --show-current
claude --version
claude doctor
```

Výsledek: správná větev a projekt, známý stav rozpracovaných změn a funkční instalace Claude. Pokud máš otevřenou aktivní relaci, nezakládej druhou souběžnou relaci, která upravuje stejné soubory. Instalaci/updaty prováděj až po uložení práce a ukončení relace.

Používáš-li nativní instalaci a chceš aktualizovat, spusť `claude update`. Používáš-li WinGet, příslušný příkaz je `winget upgrade Anthropic.ClaudeCode`. Pokud Claude nemáš, zvol jednu oficiální instalační cestu z dokumentace; neinstaluj současně několik kopií. Node a package manager aplikace určuj podle repozitáře, ne podle náhodného návodu.

Pokud pracuješ v Claude Desktop na záložce Code, vyber tutéž místní složku a nastavení modelu/oprávnění použij v jeho rozhraní. Následující příkazy pro spuštění v terminálu patří ke CLI; nepíší se do běžného chatu Claude.

## 2. Odděl vývoj od ostré aplikace

Před noční prací zajisti:

- Samostatnou git větev pro změny. Předchozí práci zachovej, nepotvrzuj slepě commit všeho včetně tajemství.
- Vývojovou nebo staging databázi; migrace tam nejprve ověř. Jestli máš jen produkci, Claude může připravit migrace a testovat lokálně, ale nemá je automaticky aplikovat na ostrá data.
- Preview deployment s vývojovými proměnnými. Zkontroluj, že preview není omylem připojené k produkční Supabase databázi.
- Testovací účty pro vlastníka, účetní, marketing, zaměstnance a dva různé zákazníky. Vhodná jsou syntetická data včetně prodejů, faktur, receptur a směn.
- Vývojový e-mailový sandbox, falešný publikační adapter a testovací dokumenty. Test nesmí poslat reálnou fakturu nebo příspěvek.

Pokud prostředí chybí, nech Claude podle úvodního promptu připravit lokální variantu a přesně napsat, který lidský krok zbývá. Založení placeného projektu nebo udělení OAuth oprávnění řeší vlastník.

## 3. Nastav model a míru uvažování

Pro tento rozsah doporučuji dostupný model z rodiny Opus a effort `high` jako výchozí nastavení. Je to doporučení pro architekturu ERP, izolaci zákazníků a složité vazby; maximální effort na každém úkolu nemusí dát lepší výsledek a spotřebuje více kapacity.

V CLI můžeš spustit:

```powershell
claude --model opus --effort high
```

V relaci použij `/model` pro výběr dostupného modelu. Pokud chceš snížit spotřebu, zvol Sonnet pro běžnou implementaci a Opus ponech pro architekturu a finální kontrolu. Dostupnost modelů a effortu závisí na účtu a verzi; nepřebírej z návodu pevné číslo modelu.

Přes `/status` ověř skutečně použitý model a účet, přes `/usage` zbývající kapacitu. Předplatné ChatGPT nezajišťuje předplatné Claude. Nákup dalších kreditů ani zvyšování platebního limitu není součástí automatického nastavení.

## 3A. Model, režim a nástroje: jak volit pro tvorbu aplikace

Uživatel doplnil odkaz na Google vyhledávání „jaký je nejlepší modul pro tvorbu apky v Claude Code“. Konkrétní Google AI odpověď se nepodařilo načíst; následující doplnění vychází z oficiální dokumentace Claude Code, nikoli z neověřeného obsahu výsledku. Pokud šlo o konkrétní plugin nebo doporučení, jeho název/text je potřeba doplnit zvlášť.

| Volba | Použití v tomto projektu |
| --- | --- |
| Model Opus | Doporučený základ pro architekturu ERP, finanční vazby a review |
| Model Sonnet | Běžná implementace při potřebě šetřit kapacitu |
| `opusplan` | Volitelná kombinace Opus v Plan mode a Sonnet při implementaci; přepnutí závisí na skutečné změně režimu |
| Effort `high` | Výchozí doporučení pro složité změny; nepřepínat automaticky na maximum |
| Plan mode | Analýza a návrh před zásahem; poté přejít do režimu umožňujícího implementaci |
| Auto / acceptEdits | Oprávnění pro práci, oddělená od volby modelu; dostupnost ověřit |
| CLAUDE.md | Stručné trvalé projektové instrukce |
| Skills | Opakovatelné postupy pro review, migrace nebo kontrolu hotové funkce, jen pokud se skutečně využijí |
| MCP a pluginy | Konkrétní přístupy nebo schopnosti; připojení ověřit a omezit |
| Pomocní agenti | Vymezené průzkumy a oddělené review s jedním koordinátorem |
| Hooks a CI | Otestované automatické kontroly; nenahrazují uživatelské ověření |

Neexistuje jedno univerzální nastavení zaručující nejlepší aplikaci. Pro dnešní práci doporučuji Opus + high, dostupný autonomní režim, vývojové prostředí a ověřování celých procesů. `opusplan` je alternativa pro nižší spotřebu, ne automaticky lepší kvalitu. Silnější či další dostupný model lze zvážit podle reálné nabídky účtu, ceny a zkoušky na projektu; nekupovat kredity ani měnit rozpočet automaticky.

Cyklus práce: prohlédnout existující implementaci → navrhnout nejmenší souvislou změnu → implementovat celý proces → ověřit data, oprávnění a UI → provést oddělené review → opravit nálezy → uložit stav. Plan mode je vhodný pro první fázi, ale neponechávej v něm relaci, od které čekáš úpravy kódu. Textový pokyn sám skutečný režim ani model nepřepne.

## 4. Nastav oprávnění pro běžnou práci

Použij `/permissions` a zkontroluj dostupné režimy. Pro autonomní vývoj preferuj Auto, pokud ho tvůj účet, model, verze a pravidla organizace umožňují. Režim stále může zamítnout krok nebo vyžadovat zásah; není zárukou nepřerušené noci.

Po ověření podpory můžeš novou CLI relaci spustit:

```powershell
claude --model opus --effort high --permission-mode auto
```

Pokud Auto není dostupný, použij automatické přijímání editací a předem povol konkrétní potřebné vývojové příkazy. Přesný seznam nech odvodit z projektu: jeho testy, typecheck, lint, build a lokální testovací server. `acceptEdits` samo neznamená neomezené spouštění všech příkazů.

Vyhni se blanket povolení všech shell/MCP příkazů na počítači s ostrými klíči. Nepoužívej zde `--dangerously-skip-permissions`. Pro dlouhou autonomní práci je vhodné izolované vývojové prostředí; pro dnešní noc nemigruj zbytečně celý Windows projekt do WSL jen kvůli nastavení.

Prompt ani CLAUDE.md samy oprávnění nevynucují. Skutečná ochrana vzniká kombinací omezených přístupů, vývojových účtů, nastavení Claude Code, CI a případně otestovaných hooks. Existující organizací spravované limity nepřepisuj.

## 5. Připoj jen nástroje potřebné pro práci

| Přístup nebo nástroj | K čemu ho Claude potřebuje | Doporučený rozsah |
| --- | --- | --- |
| Místní repozitář a git | Úpravy kódu a historie | Projektová větev |
| GitHub CLI nebo oficiální konektor | Draft PR a kontrola CI | Daný repozitář; bez automatického merge |
| Vývojová databáze / Supabase CLI či MCP | Schéma, migrace, testy izolace | Lokál/staging; produkce bez zápisu |
| Prohlížeč / Playwright | Test skutečných obrazovek a mobilního rozložení | Lokální/preview aplikace a testovací účty |
| Vercel CLI či konektor | Preview a jeho logy | Neprodukční deployment |
| Oficiální API dokumentace | Správné integrační kontrakty | Čtení; bez zákaznických tajemství |
| Jazykové nástroje pro skutečný stack | Typy, navigace a diagnostika | Ověřený plugin, pokud je přínosný |

MCP použij jen tam, kde usnadní konkrétní krok; není povinné pro každý nástroj. Stav připojení kontroluj přes `/mcp`. Nástroje připojené v ChatGPT nebo v běžném chatu Claude nejsou automaticky připojené v Claude Code ani v runtime tvé aplikace.

Klíče zadávej do místní ignorované konfigurace nebo správy tajemství. Do promptu dej názvy potřebných proměnných, ne hodnoty. Claude nemá vypisovat tokeny, connection strings ani kompletní .env. Přístupy k účtům zákazníků patří do tenantových připojení aplikace, ne do jedné globální konfigurace Foodtab.

## 6. Dej Claude trvalý kontext a kontrolovatelný cíl

Stáhni dřívější soubor `Foodtab_Claude_Code_nocni_zadani.md` a tento návod do projektu, ideálně do složky `docs/`. Jejich umístění není konfigurace samo o sobě; Claude musí dostat instrukci je přečíst.

Vlož úvodní prompt níže. Nech vytvořit nebo doplnit krátký CLAUDE.md a podrobnější dokumentaci. Existující pravidla má doplnit, nikoli přepsat. Velké zadání patří do docs, ne celé do souboru načítaného při každém požadavku.

Trvalé instrukce mají obsahovat produktové požadavky, mapu kódu, ověřené příkazy, pravidla práce s daty, definici hotové funkce a obnovu po přerušení. Výsledek má dokládat testy a chováním, ne počtem vytvořených souborů.

## 7. Zkouška před nocí

Nech úvodní prompt skutečně proběhnout, než odejdeš. Jeho výstup má ukázat:

- Je schopen číst a upravovat správný projekt.
- Zjistil příkazy pro instalaci, build a kontroly podle lockfilu.
- Testovací aplikaci lze spustit a prohlížeč otevře obrazovku.
- Je ověřena cílová databáze bez zveřejnění tajemství.
- Je možné spustit relevantní kontroly bez nečekaného potvrzování každého kroku.
- Je připraven postup pro dva zákazníky a jejich role.
- Blokery mají náhradní postup, ne jen seznam chyb.

Při chybě databáze není nutné čekat s celým vývojem. Claude může připravit aditivní migrace, lokální testy a adaptery. Ale bez databázového testu nemá prohlásit izolaci zákazníků za ověřenou.

## 8. Spusť implementaci

Po nastavení vlož krátký spouštěcí prompt na konci tohoto souboru. Neotvírej současně několik vývojářských relací na stejných souborech. Pomocné agenty, pokud jsou dostupné, ať koordinuje jedna hlavní relace; počet není měřítkem kvality.

Počítač připoj k napájení. Ve Windows v Nastavení → Systém → Napájení nastav po dobu běhu při napájení ze sítě spánek na „Nikdy“ a poznamenej původní hodnotu. Monitor může zhasnout. Nezavírej terminál; notebook nezavírej, pokud nemáš ověřeno chování víka. Naplánované restarty mohou práci přerušit, nevypínej kvůli tomu ochrany systému.

Při přerušení otevři stejný projekt a spusť:

```powershell
claude --continue
```

Nebo vyber konkrétní předchozí relaci přes `claude --resume`. Poté nech přečíst stavový soubor a pokračovat. Žádný prompt nezaručí překročení limitů účtu, automatický restart počítače nebo neomezené pokračování po ukončení relace.

## 9. Ranní kontrola celé aplikace

Otevři docs/morning-report.md a preview. Projdi: přihlášení, přepnutí zákazníka/pobočky, fakturu, příjemku a nákupní cenu, recepturu, import prodeje, inventuru, platbu a cashflow, docházku, koncept příspěvku a jeho schválení. Zvlášť ověř omezenou roli a druhého zákazníka.

Požaduj tabulku Hotovo / Částečně / Blokováno a přesné důkazy. Čistý build nestačí. Je rozdíl mezi skutečně připojeným providerem, testovaným adaptérem a pouhým mockem. Nasaď až po review, úspěšných kontrolách a ověření migračního/rollback postupu. Produkt připravený k prodeji vyžaduje i pozdější pilot s jinou gastro firmou, obnovu ze zálohy a provozní monitoring.

---

## Úvodní prompt — vložit do Claude Code jako první

Jsi hlavní technický vedoucí a vývojář existující aplikace Foodtab Řízení. Nejprve připrav a ověř kvalitní vývojové prostředí a pravidla práce pro celou aplikaci, potom umožni navázat autonomní implementací. Nezůstaň u rady: prováděj autorizované lokální úpravy a kontroly. Skutečné přístupy a dostupné funkce zjisti, nepředpokládej je.

Produkt bude prodáván více gastro firmám. Modul Finance je gastro ERP: nákup, sklad, výroba, receptury, foodcost/beverage cost, prodej, faktury, platby, cashflow, controlling, náklady práce a CRM. Marketing je propojený s menu, akcemi, kapacitou a výsledky. Foodtab je první tenant, nikoli hardcoded logika. Integrace musí být vyměnitelné po zákaznících a nezávislé na jednom POS, mailboxu, bance, sociální síti či AI poskytovateli.

1. Přečti existující CLAUDE.md, AGENTS.md, README, konfigurace a dokument `Foodtab_Claude_Code_nocni_zadani.md`, pokud je v projektu. Najdi ho podle názvu. Pokud je zadání vložené přímo v této konverzaci, použij jej a ulož jeho aktuální podobu do docs sám. Není-li zadání dostupné ani v konverzaci, ani v projektu, poznamenej jeho absenci; dokonči nezávislé nastavení, ale nedoplňuj obsah domněnkami.
2. Zjisti git stav, stack, lockfile, používaný package manager, verze runtime, routy, datový model, role, API, jobs a deployment. Zachovej cizí změny. Připrav izolovanou pracovní větev podle konvencí projektu; žádný reset nebo force push.
3. Ověř lokální a staging prostředí. Nezapisuj do produkce. Zjisti cílové prostředí bez vypsání klíčů. Seznam chybějících proměnných napiš pouze názvy a účel. Připrav bezpečný .env.example a náhradní lokální postup, když přístup chybí. OAuth přihlášení a souhlasy vlastníka nenahrazuj mockem označeným jako skutečné připojení.
4. Vytvoř nebo doplň stručný CLAUDE.md s ověřenými příkazy, mapou projektu, multi-tenant požadavky, provider-neutral pravidly, pravidly dat a definicí dokončené funkce. Neopisuj do něj celé zadání; podrobnosti odkazuj do docs. Nepřepisuj platná existující pravidla ani nepřidávej domnělé technické zákazy.
5. Připrav docs/product-spec.md jako mapu celé aplikace: moduly a vztahy, role, klíčové uživatelské procesy, ověřené existující chování, mezery a akceptační kritéria. U ostatních modulů zachovej funkční rozsah a testuj regrese; nezačínej jejich plošný redesign nad rámec hlavního zadání. Vytvoř stručný backlog podle přínosu a závislostí.
6. Zaveď přiměřený quality gate přes příkazy projektu: relevantní lint, typy, build, jednotkové testy finančních výpočtů, integrační testy databáze/autorizace a E2E kritických procesů. Reuse existující runner. Chybějící nástroj doplň jen s konkrétním přínosem; žádná výměna celé testovací infrastruktury bez důvodu. Změř výchozí výsledky, rozliš existující chyby a nové regrese.
7. Připrav otestovaná syntetická data pro dvě organizace, více provozoven a omezené role. Dolož izolaci dat přes UI, API, databázi, soubory, workery, exporty a AI nástroje. Testovací login neřeš vypnutím autentizace nebo RLS. Připrav POS/mail/social/bank testovací adaptery s jasným označením.
8. Zprovozni testovací prohlížeč pro lokální nebo preview aplikaci. Ověř desktop i mobil, navigaci, validace, prázdné a chybové stavy. Zachyť výchozí kritické obrazovky, pokud to prostředí dovolí. Dostupnost, rychlost důležitých procesů a finanční správnost jsou součást kvality, ne pouze vzhled.
9. Připrav nebo uprav CI podle projektu tak, aby stejná relevantní kontrola běžela v PR. Nasazení nesmí být povinnou součástí lokálního testu. Migrace testuj na disposable/staging DB, včetně existujících dat a konzistence po přechodu. Kontroly zákaznické izolace nesmí být nahrazeny pouhým lintem SQL.
10. Zkontroluj dostupné CLI/MCP/prohlížečové nástroje a navrhni nejmenší potřebný rozsah oprávnění. Změny nastavení prováděj pouze v autorizovaném projektovém rozsahu, se zachováním existující konfigurace a podle schématu instalované verze. Globální či spravovaná pravidla nepřepisuj. Pokud skutečné nastavení vyžaduje lidský krok, napiš přesný krok a pokračuj nezávislou částí. Nevypínej schvalování ani bezpečnostní ochrany.
11. Hooks použij jen pro levné, deterministické a skutečně užitečné kontroly. Existující hooks zachovej; otestuj je na úspěchu i chybě. Nespouštěj celý build po každém editovaném řádku. Nevytvářej nekonečný stop-hook nebo smyčku, která nutí model pokračovat za každou cenu.
12. Pokud jsou dostupní pomocní agenti, použij úzce vymezenou kontrolu architektury, izolace a správnosti financí a UX/integračních testů. Hlavní relace rozhoduje a integruje. Souběžné editace stejného souboru nepovoluj; pro větší nezávislé změny používej izolované worktrees. Agentům neposílej tajemství a nepoužívej je jen pro zvýšení počtu výstupů.
13. Kritické změny po implementaci zkontroluj odděleným reviewerem nebo alespoň samostatným review krokem nad diffem. Požaduj konkrétní nalezenou chybu, důkaz a opravu. Oprav závažné nálezy a znovu spusť dotčené kontroly; nezávislé review nenahrazuje testy.
14. Připrav docs/development-setup.md, docs/quality-gates.md, docs/night-run-status.md a stručné rozhodnutí o architektuře. Stav aktualizuj po každé dokončené etapě: commit, hotové procesy, výsledky testů, další krok, blokery a předpoklady. Ukládej stabilní práci před vyčerpáním kontextu/limitu a po obnově pokračuj z dokumentace.
15. Proveď preflight: načtení projektu, minimální bezpečná ověřovací úprava pokud je nutná, odpovídající test, build a otevření testovací aplikace. Nevytvářej zbytečnou produktovou změnu pouze kvůli zkoušce. Na konci napiš READY / READY WITH LIMITATIONS / BLOCKED s důkazy a přesnými zbývajícími kroky. Neprohlašuj za nastavené to, k čemu nemáš přístup.

16. Rozliš volbu modelu, effort, režim oprávnění a rozšiřující nástroje. Zkontroluj dostupnost a skutečný stav. Pro složité ERP a SaaS změny preferuj dostupný Opus s high effortem; Sonnet nebo opusplan jsou volitelné podle rozpočtu a konkrétního úkolu. Vynucený model ani spravované limity neobcházej a nevydávej textovou instrukci za provedené přepnutí. Nezvyšuj placenou spotřebu bez oprávnění. Pokud jsi v Plan mode, připrav návrh a sděl potřebný přechod do implementačního režimu; po přechodu pokračuj bez dalšího zbytečného potvrzování plánu.

17. Pracuj v cyklu průzkum → návrh → implementace → relevantní testy → ověření UI a dat → oddělené review → opravy → checkpoint. Skills, pluginy a MCP použij pouze pro konkrétní účel. Všechny integrační procesy v aplikaci zachovej nezávislé na těchto vývojových nástrojích. Nepředpokládej instalovaný plugin podle odkazu na Google vyhledávání.

Definice hotového: skutečný datový tok UI → server → persistence → oprávnění → výsledek, validace a chyby, úspěšné relevantní kontroly, uživatelské ověření, dokumentované omezení. Číselné výpočty jsou deterministické, účetní a cashflow logika oddělená, chyby a chybějící data nepřeváděj na nuly. Nepřidávej nepoužívané abstrakce ani paralelní entity vedle funkčních modulů. Běžné implementační volby řeš sám, nezastavuj na chybějícím externím přístupu, když zbývá jiná práce.

Začni nastavením a preflightem teď. Produkční deployment, změny ostrých dat, nové placené služby a skutečné odesílání/publikování nejsou součástí tohoto oprávnění.

---

## Spouštěcí prompt — po úspěšné přípravě

Příprava je hotová; pokračuj autonomní implementací podle `Foodtab_Claude_Code_nocni_zadani.md`. Přečti skutečný preflight výsledek, CLAUDE.md a docs/night-run-status.md. Dodržuj gastro ERP, prodejnost více zákazníkům a vyměnitelné integrace. Rozpracuj úkoly podle závislostí a dokončuj celé testovatelné procesy. Běžné volby rozhoduj sám; blokery zaznamenej a pokračuj nezávislou prací. Ověřuj chování v testovací aplikaci, finanční výpočty, zákaznickou izolaci a regresi existujících modulů. Po každé etapě ulož stav a přiměřený commit. Neukončuj po plánu či první funkci; pokračuj, dokud zbývá proveditelná práce a kapacita. Před dosažením limitu nebo koncem relace připrav docs/morning-report.md s pravdivým stavem, výsledky kontrol, preview a dalším krokem. Produkční změny ani skutečné publikování neprováděj.

## Pokračovací prompt — po přerušení

Pokračuj v existujícím zadání. Nejprve přečti CLAUDE.md, zadání, docs/night-run-status.md a git diff/status. Zachovej dosavadní práci, neopakuj dokončený audit. Urči první nedokončený závislý krok a pokračuj implementací a relevantním ověřením. Pokud předchozí běh skončil limitem nebo blokací, zkontroluj aktuální stav místo opakování neúspěšných volání. Aktualizuj ranní zprávu podle skutečně ověřeného výsledku.

## Oficiální dokumentace

- Instalace a diagnostika: https://code.claude.com/docs/en/setup
- Model a effort: https://code.claude.com/docs/en/model-config
- Oprávnění: https://code.claude.com/docs/en/permissions
- Režimy oprávnění: https://code.claude.com/docs/en/permission-modes
- Příkazy CLI: https://code.claude.com/docs/en/cli-reference
- Příkazy v relaci: https://code.claude.com/docs/en/commands
- Ověřování a pracovní postupy: https://code.claude.com/docs/en/best-practices
- Nástroje MCP: https://code.claude.com/docs/en/mcp
- Modely, skills, subagenti, hooks a pluginy: https://code.claude.com/docs/en/features-overview

Funkce závisí na instalované verzi, platformě, účtu a pravidlech organizace. Při nesouladu ověř `claude --help` a aktuální nabídku v relaci.
