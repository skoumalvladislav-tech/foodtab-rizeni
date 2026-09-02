# Kiosek naostro — kontrola 2. 9. 2026 ráno

Prošel jsem celý život tabletu v ostré aplikaci: vystavit kód →
zaregistrovat → kiosek → odvolat. **Funguje to celé.** Testovací
zařízení „Zkouška Claude" jsem hned odvolal, v seznamu zůstalo jen
jako záznam — přesně jak má.

---

## 1. Co jde

**Vystavení kódu.** Vybere se pobočka, napíše název, kód se ukáže
jednou (`EB681456`) s větou, že se už nikde nepřečte. Sedí se zadáním.

**Registrace tabletu.** Kód se na `/kiosek` opsal a zabral napoprvé.
Tablet si uložil klíč do prohlížeče, na obrazovce naskočilo
**Bernard Bar Tábor · Zkouška Claude**.

**Kiosek sám.** Ukazuje rotující kód, políčko na PIN, tlačítka
Příchod/Odchod a dnešní směnu (Veronika 7:30–22:00). Nic z toho
nevyžaduje přihlášeného člověka — což je celý smysl.

**Odvolání.** Hláška „Zařízení odvoláno. Od téhle chvíle neukáže kód
ani nepíchne." a v seznamu zůstalo `odvoláno 2. 9. 7:41`.

**Zálohy na pobočce** se otevřou a v „KOMU" nabízejí **jen lidi té
pobočky** — Lucka, Světlana a Veronika z Bernard Baru tam nejsou.
Rozhodnutí „zálohy jen na pobočce" tedy drží i v rozhraní, ne jen
v databázi.

**Anonymní klíč Supabase v prohlížeči vůbec není.** Prohledal jsem
stránku i `localStorage` — je tam jen `foodtab-rezim`
a `foodtab-kiosek-klic`. Všechno chodí přes serverové akce. To je
lepší, než jsem čekal.

---

## 2. Co nejde — QR na kiosku pořád chybí

Tvoje stížnost z včerejška platí dál. Na kiosku je

```
KÓD K PÍCHNUTÍ TELEFONEM
CE8CA63E
```

a v celém `<main>` **není jediný `canvas`, `svg` ani `img`**. Není to
tedy tak, že by se QR nevykreslil — on tam vůbec není.

**Pro Codea:** rotující kód na `/kiosek` má být QR, ne osm písmen.
Text pod ním ať zůstane jako záložní cesta, když se čtečka nechytne.
Ověřit dekódováním nezávislou knihovnou, jako u toho tabletového QR.

---

## 3. Co nejde — pozastavení záloh nemá obrazovku

Migrace `20260902040000_pozastaveni_zaloh` je nasazená, ale na
obrazovce Zálohy ani u člověka **není nic, čím by se to zapnulo**.
Funkce v databázi je, cesta k ní chybí.

**Pro Codea:** přepínač u člověka, ne u pobočky. Když je pozastavený,
zmizí ze seznamu „KOMU" a při pokusu o výplatu se řekne proč.

---

## 4. Drobnosti, které visí dál

- **`skoumalvladislav`** se pořád jmenuje takhle. Přejmenovat na
  Vladislav Skoumal.
- **Lucie Skoumalová** má účet „Ne" a oprávnění „—" — pozvánku ještě
  nepřijala. Ochrana posledního majitele je nasazená, takže už je to
  bezpečné.
- **Srpnové odchody** dvou směn stále nedopsané.

---

## 5. Bezpečnostní nález mimo aplikaci

V tvém Chromu běží rozšíření **AITOPIA**. Vkládá se do stránky
Foodtabu — vidím jeho tlačítka („Zeptejte se AITOPIA", „Nový
rozhovor", „Poháněno AITOPIA") přímo v seznamu prvků na obrazovce
Nastavení → Zařízení.

Co to znamená prakticky: to rozšíření **čte obsah stránky**, na které
zrovna jsi. Tedy i seznam lidí se sazbami, zálohy, docházku a klíč
kiosku uložený v prohlížeči. Posílá to na svůj server, ne na náš.

To jde přímo proti pravidlu 8 — *mzdy, docházka, kontakty a zálohy se
nikdy neposílají do jazykového modelu*. Hlídáme, co pošle aplikace,
a přitom to vedle čte rozšíření v prohlížeči.

**Doporučuju:** v `chrome://extensions` u AITOPIA buď odinstalovat,
nebo aspoň přepnout přístup na „při kliknutí". Není to chyba
Foodtabu — je to díra v tom, odkud se do Foodtabu díváš.

---

## 6. Co ještě potřebuju od tebe

Že se ty čtyři noční migrace nasadily, usuzuju z toho, že obrazovky
chodí. Jistotu dá tohle:

```powershell
cd C:\Users\vladi\foodtab-rizeni
.\node_modules\.bin\supabase.cmd migration list
```

Vypíše dva sloupce — místní a vzdálený. U `20260902010000` až
`20260902040000` musí být datum **v obou**.
