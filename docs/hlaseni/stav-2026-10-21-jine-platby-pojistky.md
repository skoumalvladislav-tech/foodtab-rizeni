# Stav k 21. 10. 2026 — Jiné platby: pojistky výsledku pokladny a úhrady (opravná migrace, nic nenasazeno)

Třetí nezávislé ověření Jiných plateb (po sloučení #146 a `db push` 21. 10.)
potvrdilo, že dvě opravy z 20. 10. drží. Našlo ale dvě střední díry a několik
nízkých. Migrace `20261016100000` je nasazená a měnit se nesmí. Opravy proto
jsou v **nové migraci `20261021100000_jine_platby_pojistky_pokladny`** na
větvi `jine-platby-pojistky-pokladny` (PR #149).

## Nejdřív to podstatné

- **Nic není nasazené.** Nic jsem nesloučil, `db push` jsem nespustil a do pokladny jsem nic nezapsal.
- **Slučovat až po #147.** Razítko 20261021100000 je novější než migrace Faktur (20261018100000). Hlídač „Migrace jen přibývají“ chce, aby nová migrace byla novější než všechny v `main`, takže #147 musí přistát dřív. #145 se potom přerazítkuje.
- **Po sloučení je potřeba `db push`** (jedna migrace). Bez něj zůstanou díry otevřené, ale nic se nerozbije: aplikace nový sloupec jen čte a jeho hodnota je prázdná.

## Co je opravené

**Střední:**
1. **„Cesta B“: smazat číslo účtu a pustit novou kontrolu.**
   - Pokladna našla konkrétní účet (nebo že spotřebu už odečetla). Obsluha pak smazala nebo změnila číslo účtu, případně položky, a pustila novou kontrolu. Slabší výsledek nález přepsal a šla zapsat druhá tržba nebo poslat druhý odpis, a to bez práva na opravy.
   - Teď konkrétní nález drží (`app.jp_nalez_pokladny`). Slabší výsledek ho nepřepíše.
   - Proti nálezu neprojde zápis nové tržby, schválení výdeje, jeho opakování ani zahájení požadavku.
   - Přepsat ho smí jen člověk s právem na opravy, nebo ho nahradí nový konkrétní nález.
2. **Ruční „neodečteno“ po zrušení nejasného požadavku.**
   - Po zrušení požadavku, který mohl v pokladně proběhnout, stačilo ruční „neodečteno“ a odešel druhý požadavek.
   - Teď u záznamu zůstane značka (`nedohledana_operace`). Vymaže ji kontrola v pokladně, která dohledá i zrušený požadavek. Ručně ji může vyřešit jen člověk s právem na opravy.

**Nízké:**
- „Pravděpodobně“ bez uvedené shody: pojistka kvůli NULL v podmínce pustila přepis bez práva na opravy. Opraveno.
- **Falešná blokace po oprávněném přepisu.** Přepis teď nese značku. Po uložení záznamu tak pokladní nemusí znovu volat někoho s právem na opravy, dokud pokladna nenajde jiný účet.
- **Historie kontroly v pokladně** nese celý výsledek, i číslo účtu. Návod to sliboval.
- **Úhrada jen z banky.** Ručně zapsaná platba ani platba z pokladny úhradu neprokáže. Platí to v databázi i v seznamu plateb na obrazovce. Když banka napárovanou platbu stornuje, úhrada se sama vrátí na „neověřeno“ a v historii zůstane proč.
- **Storno tržby** zruší i propojení s prodejem z pokladny. Dodatečná kontrola propojené tržby hledá nejdřív přímo propojený účet, ne podle čísla v návrhu.
- **Vypršení času u čtení AI:** dočasná chyba („zkuste znovu“) se ukáže jen tehdy, když akce před čtením spotřebovala víc než pětinu času. Jinak zůstává trvalá „doklad je moc dlouhý“. Dřív byla dočasná pokaždé a každý další pokus se zaplatil.
- **AI po zápisu tržby nepřepíše číslo účtu ani typ dokladu.** To je opravené už v #146 (`dcf9bf8`) a ověření to potvrdilo, proto beze změny.

## Co se mění pro obsluhu

- Když pokladna jednou našla konkrétní účet, obrazovka po úpravě záznamu řekne, proč novou tržbu zapsat nejde, a s jakým účtem. U skladu stejně: „pokladna už spotřebu odečetla“.
- Po zrušení nejasného požadavku se ruční „neodečetla“ nabízí jen člověku s právem na opravy. Ostatní uvidí, že mají kliknout **Zkontrolovat v pokladně**.
- K napárování úhrady se nabízejí jen platby z banky.
- Snímky nových vět: `docs/hlaseni/snimky-jine-platby/2026-10-21-pojistky-1440.png` a `…-375-tmavy.png`. Jde o statické vykreslení detailu se smyšlenými daty. Při 375 i 1440 px nic nepřetéká a žádné tlačítko není menší než 44 px.

## Čísla

- **krok98:** 242 kontrol (o 28 víc, oddíl 16). Celý řetěz na PGlite má 3 775 kontrol a nic nespadlo. Složeně (main + #147 + tahle větev, bez konfliktů): **3 928 kontrol**, krok98 242 a krok99 153, nic nespadlo; 92 z 92 sad aplikace; hlídač pořadí migrací vůči #147 jako budoucímu `main` prošel.
- Běželo na **PGlite**, ne na PostgreSQL. RLS ani granty to neověří. Rozhodne workflow „Migrace a scénáře“ v PR.
- **Testy aplikace:** 90 z 90 sad; `tsc` i `eslint` čisté. Jiné platby: `jine-platby` 568, `jine-platby-detail` 614, `jine-platby-ai` 202.
- **Schválná rozbití:**
  - **24 v nové migraci, 20 v aplikaci.** Všechna spadla na své kontrole.
  - **Dvěma způsoby:** NULL i černá listina u shody, ruční platba vypnutím kontroly i přidáním mezi zdroje, storno platby bez spouště i bez historie. Aplikace stejně.
  - **Rozbití odhalilo slabý test:** u „pravděpodobně bez shody“ ho nejdřív držel dřívější nález na témže záznamu. Rozbití NULL a černé listiny tak prošla. Test teď běží na čerstvém záznamu a obě rozbití spadnou.

## Na co jsem narazil

- **Testovací platby ve scénáři byly zapsané jako ruční** (`rucni`). Teď, když úhradu prokazuje jen banka, jsem je přepnul na výpis z banky (`csv_banka`). Ruční platba má vlastní kontrolu, která musí spadnout.
- **Dva stavy jsou ve scénáři nastavené přímo:** prokázaná chyba požadavku a značka nedohledaného požadavku u druhého záznamu. Kontrola opakování a vymazání značky by jinak potřebovala celou cestu přes pokladnu. Skutečnou cestu ke značce (zrušení nejasného požadavku) ověřuje kontrola na `z16`.
- **Konkrétní nález zruší jen člověk s právem na opravy, nebo nový nález jiného účtu.** Když AI přečte číslo účtu špatně a pokladna najde cizí účet, pokladní po opravě čísla tržbu sám nezapíše. Je to záměrně opatrné: oprávněný postup existuje a obrazovka ho popíše.

## Nenasazoval jsem

- `db push`: **ne.** Migrace `20261021100000` není v ostré databázi.
- Sloučení PR: **ne.**
- Zápis do pokladny: **ne.**
- Proměnné ve Vercelu, n8n, Salt Edge: **beze změny.**
