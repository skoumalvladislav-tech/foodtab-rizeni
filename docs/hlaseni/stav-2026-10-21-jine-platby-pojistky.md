# Stav k 21. 10. 2026 — Jiné platby: pojistky výsledku pokladny a úhrady (opravná migrace, nic nenasazeno)

Třetí nezávislé ověření Jiných plateb (po sloučení #146 a `db push` 21. 10.)
potvrdilo, že dvě opravy z 20. 10. drží. Našlo ale dvě střední díry a několik
nízkých. Migrace `20261016100000` je nasazená a měnit se nesmí. Opravy proto
jsou v **nové migraci `20261021100000_jine_platby_pojistky_pokladny`** na
větvi `jine-platby-pojistky-pokladny` (PR #149).

> **Doplněno 22. 10.:** čtvrté ověření potvrdilo, že na jednom záznamu opravy
> drží. Našlo ale „cestu C“ přes víc záznamů (2× střední) a dvě nízké věci.
> Všechno je opravené v téže migraci (pořád nenasazené) — viz oddíl
> **Čtvrté ověření (22. 10.)**. #147 je mezitím sloučená a `main` je ve větvi.

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

## Čtvrté ověření (22. 10.)

**Střední — „cesta C“: nález a značka platily jen na jednom záznamu.**
- **Tržba:** autor záznam s nálezem pokladny zrušil a týž doklad připojil k novému záznamu. Šlo také rovnou založit druhý záznam téhož dne a částky. U nového záznamu pak „není“ a nová tržba prošly, i když pokladna ten prodej našla.
- **Sklad:** značku nedohledaného požadavku obešlo zrušení záznamu nebo nový záznam téhož dokladu. Kontrola v pokladně u nového záznamu dohledá jen jeho vlastní požadavky, takže odešel druhý požadavek.
- **Oprava:**
  - Záznam s konkrétním nálezem pokladny nebo s nedohledaným požadavkem smí zrušit jen člověk s právem na opravy. Autorovi stránka řekne proč.
  - Nová tržba a schválení výdeje hlídají i **jiné záznamy téhož dokladu nebo prodeje** (`app.jp_souvisejici`): se stejnou fotkou, nebo se stejnou pobočkou, dnem, částkou a měnou, a to i zrušené. Když má takový záznam nález (u skladu i nedohledaný požadavek), projde to jen s právem na opravy.

**Nízké:**
- Značka přepisu u „víc účtů s tím číslem“ přešla na nález **jiného čísla**. Identita nálezu teď zahrnuje hledané číslo a seznam účtů.
- Scénář nehlídal značku po zrušení zaseknutého požadavku („odesílá se“). Kontrola je doplněná a rozbití ji shodí.
- Hláška u tržby teď pamatuje i na špatně přečtené číslo účtu: výsledek pokladny má přepsat člověk s právem na opravy, ne „vraťte číslo“.

**Kompromis, který je vidět:** dvě různé útraty téhož dne, pobočky a částky (dva stejné cateringy) jsou pro appku „týž prodej“. Když pokladna u jedné našla účet, druhou novou tržbu zapíše jen člověk s právem na opravy. Je to záměrně přísné, protože u peněz je lepší počkat na kontrolu než zapsat tržbu dvakrát.

### Před `db push`: dotazy jen pro čtení

Migrace nic nedopočítává zpětně. Ověření doporučilo před nasazením pustit nad ostrou databází tyhle dotazy, které nic nemění. Každý by měl vrátit 0 řádků, protože Jiné platby běží v ostré databázi teprve od 21. 10.:

```sql
-- 1. Úhrada napárovaná na platbu, která není z banky
select z.id from public.jine_platby z join public.transakce t on t.id = z.uhrada_transakce_id
 where t.zdroj not in ('fio_api', 'bankovni_agregator', 'csv_banka');
-- 2. Úhrada na platbě, ke které už existuje storno
select z.id from public.jine_platby z
 where z.uhrada_transakce_id is not null
   and exists (select 1 from public.transakce s where s.storno_of = z.uhrada_transakce_id);
-- 3. Zrušený požadavek do pokladny, který mohl odejít (nemá značku)
select o.id, o.zaznam_id from public.pos_operace o where o.stav = 'zruseno' and o.odeslano is not null;
-- 4. Starší přepis výsledku pokladny bez značky (pokladní tam bude znovu blokovaný)
select zaznam_id, kdy from public.jine_platby_historie
 where udalost like 'rucne_dolozeno_%' and detail ->> 'prepsano_pokladny' is not null;
-- 5. Započítaná tržba u záznamu, kde pokladna dřív prodej našla (proběhlá cesta B)
select distinct h.zaznam_id from public.jine_platby_historie h
  join public.ostatni_trzby t on t.zaznam_id = h.zaznam_id and t.stav = 'platna' and t.zapocitat
 where h.udalost = 'kontrola_pos_trzba' and h.detail ->> 'vysledek' = 'nalezeno';
```

Nespouštěl jsem je. Do ostré databáze jsem se nepřipojoval.

## Co se mění pro obsluhu

- Když pokladna jednou našla konkrétní účet, obrazovka po úpravě záznamu řekne, proč novou tržbu zapsat nejde, a s jakým účtem. U skladu stejně: „pokladna už spotřebu odečetla“.
- Po zrušení nejasného požadavku se ruční „neodečetla“ nabízí jen člověku s právem na opravy. Ostatní uvidí, že mají kliknout **Zkontrolovat v pokladně**.
- K napárování úhrady se nabízejí jen platby z banky.
- Záznam, u kterého pokladna našla prodej nebo odpis, zruší jen člověk s právem na opravy. K témuž dokladu nebo prodeji v jiném záznamu zapíše novou tržbu nebo schválí výdej taky jen on.
- Snímky nových vět: `docs/hlaseni/snimky-jine-platby/2026-10-21-pojistky-1440.png` a `…-375-tmavy.png`. Jde o statické vykreslení detailu se smyšlenými daty. Při 375 i 1440 px nic nepřetéká a žádné tlačítko není menší než 44 px.

## Čísla

- **krok98:** 255 kontrol (oddíl 16 z 21. 10., oddíl 17 z 22. 10.). Celý řetěz na PGlite (main s #147 a #150 + tahle větev) má 3 941 kontrol a nic nespadlo; krok99 153.
- Běželo na **PGlite**, ne na PostgreSQL. RLS ani granty to neověří. Rozhodne workflow „Migrace a scénáře“ v PR.
- **Testy aplikace:** 92 z 92 sad; `tsc` i `eslint` čisté. Jiné platby: `jine-platby` 573, `jine-platby-detail` 617, `jine-platby-ai` 202.
- **Schválná rozbití:**
  - **21. 10.: 24 v nové migraci, 20 v aplikaci.** Všechna spadla na své kontrole.
  - **22. 10.: dalších 11 v migraci a 4 v aplikaci.** Všechna spadla, i celá migrace ve stavu ze `41ab72d`. Těch 24 z 21. 10. jsem nad upravenou migrací pustil znovu a všechna dál spadnou.
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
