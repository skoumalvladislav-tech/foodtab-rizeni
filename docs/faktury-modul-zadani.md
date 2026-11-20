# Zadání: nový modul Faktury (příjem z e-mailu, focení, AI, párování s bankou)

## 1. Kdo to rozhodl a kdy

Šéfík, 18. 11. 2026: „potřebuji do aplikace Foodtab vytvořit a předělat modul faktury. Aby modul automaticky načítal faktury z několika emailových schránek, byla možnost faktury a doklady fotit pomocí apky, faktury se párovaly s daty z bankovního účtu a celkově se zpracovávaly pomocí AI."

Čtyři požadavky, všechny povinné:
1. automatický příjem faktur z více e-mailových schránek,
2. focení faktur a dokladů přímo v aplikaci,
3. párování faktur s pohyby na bankovním účtu,
4. zpracování pomocí AI (čtení dokladů, kontrola, návrhy).

## 2. Co dnes nesedí

Neznám aktuální stav kódu, nepíšu ho z paměti. **Krok 0 je proto audit.** Než cokoli změníš:

- `git fetch`, `git log` na modul faktur, grep na všechna místa, kterých se týká (stránky, API, tabulky, migrace, oprávnění),
- dotaz do ostré databáze (jen čtení): kolik faktur existuje, v jakých stavech, jaké sloupce se skutečně používají,
- výsledek zapiš do `docs/hlaseni/audit-faktury.md` ve tvaru „soubor:řádek, co dnes nesedí". Ne „modul má chybu", ale konkrétní místo.

Stávající data se nesmí ztratit. Nová struktura je musí umět převzít.

## 3. Co udělat (každý krok se dá odevzdat samostatně)

**Krok 1 – Datový model a oprávnění.**
Tabulky (názvy uprav podle konvencí projektu): `faktury`, `faktura_polozky`, `faktura_zdroje` (schránky a nahrání z apky), `dodavatele`, `bankovni_transakce`, `faktura_parovani`, `faktura_audit` (kdo/co/kdy změnil).
- Každá faktura nese: původní soubor (storage), zdroj (e-mail/foto/ruční), stav (`nova`, `ke_kontrole`, `schvalena`, `sparovana`, `zamitnuta`), jistotu AI, hash souboru.
- RLS podle provozovny a role, sloupcové granty stejným způsobem jako jinde v projektu. Citlivá pole (tokeny schránek) nejsou čitelná z klienta vůbec.
- Ochrana před duplicitami: hash souboru **a zároveň** dodavatel + číslo faktury + částka + datum. Stejná faktura přišla e-mailem i vyfocená = jeden záznam, druhý zdroj se jen připojí.

**Krok 2 – Příjem z e-mailových schránek.**
- Více schránek, každá se zapíná a vypíná zvlášť, v nastavení modulu.
- Napojení přes API poskytovatele (Gmail API / Microsoft Graph), IMAP jen pokud některá schránka jiné řešení nemá. Přihlášení přes OAuth, tokeny šifrované na serveru.
- Plánovaná úloha na serveru (ne v prohlížeči): stahuje jen nové zprávy, bere přílohy PDF/JPG/PNG, ignoruje podpisy a loga (malé obrázky), odkazy na faktury v těle zprávy zatím nestahuje (viz „nedělat").
- Idempotence: stejná zpráva se nikdy nezpracuje dvakrát (ukládej ID zprávy).
- Chyba jedné schránky nesmí zastavit ostatní. Chyba se zobrazí v nastavení („schránka X: přihlášení vypršelo").

**Krok 3 – Focení v aplikaci.**
- Tlačítko „Vyfotit doklad" na telefonu: kamera, ořez a narovnání, komprese, víc stran do jednoho dokladu, nahrání i z galerie a PDF.
- Při špatném signálu fronta k odeslání, nic se neztratí.
- Dál jde stejnou cestou jako e-mail (krok 4). Žádná druhá pipeline.

**Krok 4 – AI zpracování.**
- Volání Claude API **jen ze serveru**, klíč nikdy do klienta ani do repa. PDF i obrázek se posílá přímo jako dokument/obrázek, ne přes samostatné OCR.
- Výstup jako strukturovaný JSON podle schématu: dodavatel, IČO, DIČ, číslo faktury, datum vystavení, DUZP, splatnost, variabilní symbol, číslo účtu/IBAN, měna, celková částka, rozpad DPH po sazbách, položky, typ dokladu (faktura / účtenka / dobropis / zálohová).
- Kontroly po AI, které napíšeš běžným kódem, ne další AI: součet položek = celkem, DPH sedí na sazby, IČO existuje (ARES, když je dostupný), dobropis má záporné částky, splatnost není před vystavením.
- Jistota: pokud kterákoli kontrola selže nebo AI není jistá polem, faktura jde do `ke_kontrole`. **AI nikdy sama nic neschvaluje.** Pouze navrhuje.
- Návrh dodavatele z existujících (shoda IČO), návrh zařazení nákladu podle historie.
- Ukládej surovou odpověď AI vedle zpracovaných hodnot, aby šlo zpětně zjistit, co se stalo.

**Krok 5 – Párování s bankou.**
- Zdroj dat: import výpisu (CSV/ABO/MT940) jako základ, přímé napojení banky jako nadstavba (viz ROZHODNOUT níže).
- Pravidla v pořadí: (1) variabilní symbol + částka + účet dodavatele = jisté párování; (2) částka + dodavatel + blízké datum = návrh; (3) jinak zůstává nespárované.
- Zvládnout: jedna platba za více faktur, jedna faktura zaplacená po částech, platby v cizí měně, dobropisy.
- Jisté párování se provede automaticky, **návrhy čekají na potvrzení** v rozhraní. Každé párování jde vrátit zpět.
- Přehled: faktury bez platby po splatnosti, platby bez faktury (to je to, co hledá účetní).

**Krok 6 – Rozhraní.**
- Fronta „Ke kontrole": vlevo náhled dokladu, vpravo pole s označením, kterým AI nevěřila. Schválit/opravit/zamítnout na dvě kliknutí.
- Seznam všech faktur s filtry (stav, dodavatel, období, spárováno/nespárováno).
- Stránka nastavení: schránky, banka, pravidla.

**Krok 7 – Export pro účetního** (jen pokud zbude čas): CSV, případně ISDOC. Žádné napojení na účetní software.

## 4. Co teď nedělat

- **Neplatit z aplikace** a nevytvářet platební příkazy. Modul jen čte a páruje.
- **Nenasazovat**, `db push` ani nasucho. Nasazuje majitel.
- Nemazat ani nepřepisovat stávající faktury. Migrace jen přidávají a převádějí.
- Žádné přístupy ani klíče v kódu, v repu, v logu ani v odpovědích klientovi.
- Nestahovat faktury z odkazů v těle e-mailu (riziko: cizí weby, phishing). Jen přílohy.
- Neposílat doklady AI přes nic jiného než server aplikace.
- Neměnit jiné moduly, než je nutné pro napojení (dodavatelé, sklad).

## 5. Zkoušky

U každé platí: **rozbij schválně to, co má hlídat, a přesvědč se, že zkouška spadne.**

1. Duplicita: stejná faktura e-mailem i fotkou vytvoří jeden záznam. Zkouška musí spadnout, když vypneš kontrolu hashe.
2. RLS: uživatel jiné provozovny fakturu nevidí ani nezmění. Zkouška proti opravdovému PostgreSQL, ne proti mocku.
3. Tokeny schránek se klientovi nikdy nevrátí. Zkouška přes roli klienta.
4. Idempotence e-mailu: dvojí spuštění úlohy nad stejnou schránkou nevytvoří druhý záznam.
5. Selhání jedné schránky nezastaví ostatní.
6. AI výstup se špatným součtem skončí v `ke_kontrole`, ne v `schvalena`.
7. Dobropis se záporným součtem se nezpracuje jako běžná faktura.
8. Párování: jisté (VS + částka) se spáruje samo, nejisté zůstane návrhem, částečná a sdružená platba sedí na koruny.
9. Zpětné vrácení párování vrátí oba záznamy do původního stavu.
10. Migrace převede stávající faktury bez ztráty. Zkouška nanečisto proti kopii ostrých dat (použij skill `overeni-pred-nasazenim`).

## 6. Pořadí a kde se dá skončit

Pořadí: 0 → 1 → 4 → 2 → 3 → 5 → 6 → 7. AI zpracování (4) je před příjmem, protože oba zdroje se do něj vlévají.

- Po kroku 0 se skončit dá (jen hlášení).
- Po kroku 1 se skončit **nedá**, pokud je rozdělaná migrace nebo zásah do oprávnění. Necommitovat půlku. Buď celý krok 1 včetně zkoušek, nebo nic.
- Po kroku 4, 2, 3, 5 se skončit dá, každý je samostatně odevzdatelný.

## 7. Pravidla noční práce

- **Na nic se neptej.** Otázku zapiš do `docs/hlaseni/otazky.md`, do kódu `// ROZHODNOUT:`, vyber nejopatrnější variantu a pokračuj dalším krokem.
- Technická rozhodnutí (knihovny, struktura tabulek, OAuth vs IMAP) jsou tvoje.
- **Provozní pravidla neodhaduj**, patří Šéfíkovi. Rozhodnutí, která tu zatím chybí a čekají na jeho odpověď:
  - které e-mailové schránky a u jakého poskytovatele (Gmail / Microsoft / vlastní server),
  - která banka a zda stačí import výpisu, nebo chce napojení přímo,
  - kdo smí schvalovat faktury a od jaké částky,
  - zda se faktury dělí podle provozovny (Černá Perla / Bernard Bar).
  U všech zatím vyber nejopatrnější variantu: import výpisu, schvalovat smí jen majitel, provozovna jako povinné pole.
- Ráno hlášení v `docs/hlaseni/` a push. Do hlášení i to, na co jsi narazil a nešlo to. Bývá to nejcennější část.
