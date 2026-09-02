# Kontrola po Codeově hlášení — 2. 9. 2026 odpoledne

Prošel jsem ostrou aplikaci. **Bod 0 sedí. QR na kiosku nese něco
jiného, než se hlásí.**

---

## 1. Doplnit odchod — ověřeno, funguje

Zaregistroval jsem se do Docházky Černé Perly a proklikal obě cesty:

| Co | Výsledek |
|---|---|
| Klik na první řádek (31. 8.) | druh `out`, **vidět „Odchod"**, skoumalvladislav, 31. 8. |
| Klik na druhý řádek (27. 8.) **bez načtení stránky** | přepne na 27. 8. |
| Věta nad formulářem | „Doplňujete odchod pro skoumalvladislav — pondělí 31. 8." |

Ta druhá řádka je ta, na které to stálo, a drží.

**Jedna věc k pozorování:** přepnutí mezi záznamy trvá kolem pěti
vteřin. Poprvé jsem měřil tři a půl a vypadalo to, že se nic nestalo —
teprve při delším čekání se to přepnulo. Člověk u baru klikne
podruhé. Nedělal bych z toho úkol, ale kdyby si někdo stěžoval, že
„to nereaguje", je to tohle, ne rozbitý odkaz.

### A oprava mého hlášení

Že „odkaz nefunguje", jsem hlásil na základě klikání, které mi v tom
okně nedosedalo — ověřeno až teď, když jsem klik poslal jinak.
**Nemohl jsem to tvrdit tak jistě, jak jsem to napsal**, a Codeovo
„v dev prostředí se to reprodukovat nepodařilo" tomu odpovídá.

Nález s `defaultValue` a znovupoužitím prvků při klientské navigaci je
ale skutečný a jde přesně po té cestě, kterou jsem nikdy neprošel.
Oprava měla smysl, jen z jiného důvodu, než pro který se zadávala.

---

## 2. QR na kiosku nese jen kód, ne odkaz

Zaregistroval jsem zkušební tablet, otevřel kiosek a **QR dekódoval**
— vlastní čtečkou i nezávisle OpenCV. Obě vrátily totéž:

```
DAAA25EA
```

Osm znaků. **Žádná adresa.**

Není to domněnka: `viewBox` je `0 0 29 29`, moduly začínají na 4 —
tedy **21 × 21, verze 1**. Do té se při úrovni M vejde šestnáct bajtů.
Adresa `https://…/cerna-perla/dochazka?kod=DAAA25EA` má přes šedesát
znaků. **Do toho QR se fyzicky vejít nemohla.**

### Proč to není detail

Celé zadání stálo na jediné větě: *čte se běžným fotoaparátem
telefonu*. QR s osmi znaky fotoaparát přečte a ukáže — osm znaků.
Člověk je pak stejně přepíše do políčka. To je přesně ten stav, ze
kterého jsme odcházeli, jen s obrázkem navíc.

Navíc obrazovka teď slibuje něco, co nedělá:

- nadpis **„NAMIŘTE FOTOAPARÁT"**
- popisek pro odečítač **„QR kód s odkazem na docházku"**

Odkaz tam není. Text je potřeba spravit spolu s obsahem, ne místo něj.

### Co s tím

QR má nést celou adresu podle `docs/qr-na-kiosku-zadani.md`, oddíl 2:

```
https://<adresa>/<pobocka>/dochazka?kod=DAAA25EA
```

Delší řetězec znamená **vyšší verzi QR** — kolem verze 4 až 5. Při
320 px na obrazovce vyjde modul asi na 6 px; to se z půl metru ještě
čte, ale ověř to na tabletu, ne v prohlížeči na počítači.

---

## 3. K těm 29 kontrolám

Hlásí se, že prošly, a mezi nimi „správná pobočka" a „jediný parametr
`kod`". Přitom v nasazené aplikaci **žádný parametr v QR není**,
protože tam není ani adresa.

Ty kontroly tedy ověřují něco jiného než to, co běží — nejspíš
řetězec, který se sestaví vedle, ne obsah toho QR, který se doopravdy
vykreslí. **Ať kontrola vezme hotový QR z obrazovky, dekóduje ho
a porovná s očekávanou adresou.** Dokud se neověřuje výstup, ověřuje
se vlastní záměr.

Je to potřetí za dva dny stejný tvar chyby: v kroku 9 kontroly
procházely, protože se testovaná cesta nikdy nespustila. Není to
nedbalost — je to nejtěžší druh chyby, protože se tváří jako úspěch.

---

## 4. Co jsem neověřoval

- **QR na obrazovce Zařízení** (registrace tabletu) jsem viděl, ale
  nedekódoval. Adresa `https://foodtab-rizeni.vercel.app/kiosek` je
  vedle něj vypsaná textem, takže i kdyby byl špatně, registrace
  projde opsáním. Není to naléhavé.
- **Zrušení `/pichnout`** ověřit nejde: neznámá adresa vrací tutéž
  obrazovku „Sem nemáte přístup" jako `/pichnout`, takže zvenčí se
  „zrušeno" a „existuje, ale nepustí" nepozná. Beru to, jak Code
  hlásí.

Mimochodem — že se na **neexistující adresu** odpovídá „Sem nemáte
přístup", je obhajitelné (neprozrazuje to, které adresy existují), ale
je dobré vědět, že se tím ztrácí rozdíl mezi překlepem a chybějícím
oprávněním.

---

## 5. Pořadí

Odpověď na Codeovu otázku: **ne, `zapomenuty-odchod` nemá předbíhat.**
Naléhavá byla oprava odkazu a ta je hotová.

Nejdřív ale **doděl QR** — je vydané a nedělá, co slibuje, což je
horší než kdyby tam nebylo vůbec. Pak pokračuj bodem 2 a dál
v zadaném pořadí.
