# Zadání: příchod na jedné pobočce, odchod na druhé

Zadal Šéfík 2. 9. 2026.

> Potřeboval bych, aby si zaměstnanec píchnul na jedné pobočce
> a odpíchnul na druhé. Migrace zaměstnanců.

| Otázka | Rozhodnuto |
|---|---|
| Píchá se dvakrát, nebo jednou? | **Jednou.** Jeden příchod, jeden odchod. Přechod se nepíchá |
| Komu se hodiny napočítají | **Pobočce, kde člověk skončil** |
| Když odchod chybí | Napočítá se tam, kde **začal** — jiná pobočka není známá |

---

## 1. Co už funguje — nesahat na to

Prošel jsem kód a tři věci, u kterých by se to čekalo, jsou v pořádku
už dnes:

**Kiosek na druhé pobočce kód přijme.** `public.pichnout_kodem`
zkouší kód proti **všem činným pobočkám firmy**, ne jen proti té
„své". Odpíchnout se v Bernard Baru tedy jde už teď.

**Obrazovka nabídne správné tlačítko.** Docházka bere **poslední
událost člověka bez ohledu na pobočku**, takže kdo je „v práci"
z Černé Perly, uvidí v Bernard Baru Odchod, ne Příchod.

**Mzda se spočítá správně.** `app.odpracovane_minuty` prochází
události zaměstnance seřazené podle času a pobočku vůbec neřeší —
příchod v jedné a odchod v druhé se spáruje.

Tohle je dobrá zpráva: model událostí je od začátku postavený tak, že
každá událost nese svou pobočku a nic je nesvazuje do dvojice. Zbývá
posbírat místa, která si to spárování domýšlejí jinak.

---

## 2. Co je rozbité

### 2.1 Nedokončená docházka to seskupuje po pobočkách

`public.nedokoncena_dochazka` má

```sql
select distinct on (a.employee_id, a.business_date, a.branch_id)
```

a stejně tak `group by ... a.branch_id`. Příchod v Černé Perle
a odchod v Bernard Baru proto vyrobí **dva půlpáry**: Černá Perla
napořád hlásí nedokončenou směnu a Bernard Bar odchod bez příchodu.

**Oprava:** seskupovat podle `employee_id` a `business_date`, pobočku
z klíče vyndat. Pobočku ať funkce vrací podle **poslední události**,
ať je vidět, kde člověk skončil.

### 2.2 Provozní den se odvozuje z pobočky — a to umí sníst hodiny

`app.set_business_date` počítá `business_date` z `day_starts_at`
**té pobočky, na které událost vznikla**. Dnes to nevadí: obě
pobočky mají 05:00, ověřeno v nastavení 2. 9.

Ale je to **jedna změna nastavení od tiché ztráty hodin.** Kdyby
Bernard Bar přepnul na 04:00 a někdo přišel ve 4:30 do Černé Perly
a odešel v 5:30 v Bernard Baru, každá událost padne na jiný provozní
den. Výpočet mzdy pak na hranici dne otevřenou směnu **zahodí** —
komentář v `mzdy_vypocet` to říká rovnou: *„co zbylo otevřené,
propadá".* Nikdo se nic nedozví, jen budou chybět hodiny.

**Oprava:** odchod (a přestávky) **dědí provozní den otevřeného
příchodu**, ne svůj vlastní. Vlastní se použije jen tehdy, když
žádný otevřený příchod není.

Tohle prosím udělej, i když to dnes nevadí. Chyba, která čeká na
změnu nastavení, je horší než chyba, která padá hned.

### 2.3 Vedoucí jedné pobočky vidí půlku dvojice

RLS na `attendance_events` pouští čtení podle `branch_id` události.
Vedoucí Černé Perly tedy uvidí příchod, ale **odchod v Bernard Baru
nepřečte** — a bude se dívat na směnu, která vypadá neuzavřeně.

**Oprava:** kdo smí číst docházku dané pobočky, ať přečte i **události
téhož člověka a téhož provozního dne z jiné pobočky**, když k nim
patří otevřený příchod na jeho pobočce. Ne celou docházku cizí
pobočky — jen protějšek té dvojice.

Napiš na to kontrolu, která ověřuje, že **víc než protějšek se
nepřečte**. Kontrola má ověřovat, kam se nikdo nedostane.

### 2.4 „Mimo rozpis" bude lhát

Kdo je v rozpisu na Černé Perle a odpíchne se v Bernard Baru,
dostane příznak `mimo_rozpis`. Formálně pravda, prakticky nesmysl —
udělal přesně to, co měl.

**Oprava:** když k odchodu existuje otevřený příchod, který **v rozpisu
je**, `mimo_rozpis` se neuplatní. Místo toho ať je u záznamu vidět
větou, co se stalo:

> Příchod Restaurace Černá Perla · **odchod Bernard Bar Tábor**

---

## 3. Kam se hodiny napočítají

**Pobočce, kde člověk skončil.** Rozhodl Šéfík.

Dvě věci, které z toho plynou a musí být v rozhraní vidět, ne
schované:

**Náklad se ustálí až odchodem.** Dokud je směna otevřená, není jisté,
kde skončí. Ranní přehled a podíl nákladů se tedy během dne **můžou
změnit** — a to není chyba. Otevřenou směnu do té doby počítej tam,
kde začala, a u čísla ať je vidět, že je předběžné.

**Zapomenutý odchod padá tam, kde se začalo.** Jiná pobočka není
známá. Když ho pak vedoucí doplní ručně, ať **vybírá i pobočku** —
jinak se ta informace nedá zadat vůbec.

---

## 4. Co se nemění

- **Přechod se nepíchá.** Žádná třetí událost, žádné „přešel jsem
  sem". Jeden příchod, jeden odchod. Kdo chce mezi pobočkami dvě
  oddělené směny, píchne dvakrát jako dosud.
- **Kód se pořád ověřuje na serveru** proti pobočkám firmy. Že přišel
  z QR nebo z jiné pobočky, na tom nemění nic.
- **Kód jedné firmy neplatí v jiné.** `pichnout_kodem` prochází jen
  pobočky `p_tenant`; ať to tak zůstane a ať je na to kontrola.

---

## 5. Testy

Do scénáře přidej člověka, který přijde na jedné pobočce a odejde na
druhé, a ověř:

1. **Odpíchnutí na druhé pobočce projde** a vznikne jedna dvojice,
   ne dva půlpáry.
2. **Nedokončená docházka je prázdná** — ani jedna pobočka nehlásí
   rozdělanou směnu.
3. **Odpracované minuty sedí** na součet od příchodu do odchodu.
4. **Různé `day_starts_at`**: nastav pobočkám jiný začátek dne, zopakuj
   a ověř, že hodiny **nezmizely**. Tohle je ta kontrola, kvůli které
   se to celé píše.
5. **Vedoucí první pobočky vidí protějšek**, ale **nevidí zbytek
   docházky cizí pobočky**.
6. **`mimo_rozpis` se neuplatní**, když příchod v rozpisu byl.
7. **Náklad připadne pobočce odchodu**; u otevřené směny té, kde se
   začalo.
8. **Cizí firma se do toho nedostane** ani kódem, ani čtením.

---

## 6. Mimochodem

Obě pobočky mají v nastavení **stejnou barvu** (Růžová). Barva má
podle textu na obrazovce pobočku odlišovat v celém rozhraní — takhle
neodlišuje nic. Až budeš u toho, ať jde jedna z nich změnit; opravit
to má ale Šéfík v nastavení, ne ty v kódu (pravidlo 1).
