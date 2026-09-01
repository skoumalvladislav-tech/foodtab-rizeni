# Noční práce — z 1. na 2. 9. 2026

Pracuješ samostatně. Šéfík spí a nikdo ti neodpoví.

Dnes večer se aplikace poprvé zkoušela naostro — pozvánka e-mailem
doopravdy dorazila a Lucie Skoumalová je pozvaná jako **druhá
majitelka**. Skoro všechno níž vzešlo z toho zkoušení, ne od stolu.

---

## Tvrdá omezení

- **`supabase db push` NE.** Migrace piš a commituj, nasazuje Šéfík ráno.
- **Ostrá data neměň.** Dnes v nich přibyly dvě pozvánky a jedna záloha
  na zkoušku — nesahej na ně.
- **SQL a víceřádkové bloky piš editorem, ne přes shell.**
- **Nedomýšlej si.** Co není v `docs/`, se nedělá — napiš otázku a jdi
  na další bod.
- **Commituj po každém dokončeném kroku.**

---

## 1. Poslední majitel — NEJDŘÍV

Zadání: `docs/vlastniku-muze-byt-vic.md`. Leží tam od rána nepostavené
a **od dneška to není teorie**: Lucie má pozvánku s rolí Majitel, takže
jakmile ji přijme, budou majitelé dva a můžou si navzájem odebrat
přístup.

Ve firmě musí vždycky zůstat aspoň jeden aktivní majitel. Odmítne se
odebrání členství, přeřazení na jinou roli i označení za smazaného —
a **vyhodí to chybu, ne tiché neprovedení**. Přes RLS se maže bez
hlášky a člověk si myslí, že to proběhlo.

Pět kontrol je v zadání. Ať jsou ve scénáři pod rolí `authenticated`.

---

## 2. Osm bodů z dnešního klikání

`docs/ukoly-codea-drobnosti-2026-09-01.md`. Pořadí podle toho, jak
často to někoho potká:

**7a — čekající pozvánku nabídnout.** Šéfík se přihlásil adresou, na
kterou mu hodinu předtím přišla pozvánka, a aplikace mu poradila, ať si
o pozvánku požádá. Tohle zažije **každý nový zaměstnanec**.

**4 + 8 — „Doplnit odchod".** Panel radí formulář, který na firemní
úrovni vůbec není, a na pobočce je prázdný. Šéfík proto srpnové odchody
dopsat nemohl a omylem si uzavřel dnešek.

**5 — chybová hláška u pozvánky lže.** „Token není platný" u platného
tokenu.

**6 — přepnutí účtu na jedno kliknutí.**

**1, 2, 3 — skloňování, lidé u záloh, QR k registraci tabletu.**

**7b, 7c — text obrazovky bez firmy a e-mail, který ho splní.**

---

## 3. Kiosek ukazuje kód písmem, ne QR

Šéfík si dnes otevřel kiosek na mobilu a čekal QR. Ukázal se
**osmiznakový kód k opsání**.

Zadání (`docs/kiosek-pin-zalohy-zadani.md`, uspořádání A) říká **QR
měnící se každých 30–60 vteřin**, který zaměstnanec načte svým
telefonem. `app.kiosk_kod` je hotová a správná — mění se, odvozuje se
z tajemství pobočky a neopouští server. **Chybí jen ta poslední míle:
vykreslit ho jako QR.**

- QR ať kóduje **adresu s tím kódem**, aby telefon po načtení rovnou
  píchl, ne aby jen ukázal text.
- **Osmiznakový kód nech pod ním** jako záložní cestu — kdo nemá čím
  načíst, opíše ho.
- QR se překresluje s každým novým oknem, stejně jako kód.

Tajemství pobočky do prohlížeče pořád nesmí; do QR jde jen hotový kód.

**Poznámka pro tebe:** tohle je odchylka od zadání, kterou jsi neohlásil.
Není špatná — bezpečnostně je to totéž — ale mění se tím, co člověk
u píchnutí dělá. Když se od zadání odchýlíš, napiš to do ranní zprávy;
je to levnější než to najít až u zákazníka.

---

## 4. Pozastavení výplaty záloh

`docs/pozastaveni-zaloh-zadani.md`. Nové zadání z dneška. Až po bodech
výš — je to nová funkce, ostatní jsou opravy toho, co lidi vidí.

---

## Ranní zpráva

- co je hotové a commitnuté
- **co jsi NEOVĚŘIL a proč**
- **v čem ses odchýlil od zadání a proč**
- na čem ses zastavil a jakou otázku to čeká

Scénáře pouštím ráno proti opravdovému PostgreSQL. Nepiš, že něco
prošlo, když prošla jen kontrola čitelnosti — dnes to bylo potřetí.
