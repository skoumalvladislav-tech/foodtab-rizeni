# Zadání: šablony směn (D, N, R…) s časy podle pozice

Zadal Šéfík 3. 9. 2026.

> U každé profese definovat jinak časy směn. Číšník má D jako denní od
> 9:00 do 22:00, ale kuchař má D od 7:30 do 22:00.

**Tohle patří k bodu 2 (zadávání směn), ne za něj.** Kdo staví
formulář na zadávání směn s ručním psaním časů a šablony přidá až
potom, dělá tu obrazovku dvakrát. Čti to spolu.

---

## 1. Co to je

Pojmenovaná směna s časem — `D` = denní, `N` = noční, `R` = ranní.
V rozpisu se pak nezadává „7:30–22:00", ale **`D`**, a čas se doplní
podle toho, **kdo tu směnu má**.

Kuchař a číšník mají oba `D`, ale jiné hodiny. To je celý smysl.

---

## 2. Tabulka

`public.shift_templates`:

| sloupec | k čemu |
|---|---|
| `tenant_id` | povinné, RLS, politika (pravidlo 3) |
| `branch_id` | **nullable** — prázdné = platí pro celou firmu |
| `position_id` | **nullable** — prázdné = platí pro všechny pozice |
| `key` | `D`, `N`, `R` — krátké, ukazuje se v kalendáři |
| `label` | „Denní" |
| `starts_at`, `ends_at` | `time`, hodina na zdi |
| `poradi`, `active` | řazení a zneplatnění |

Jedinečnost na `(tenant_id, branch_id, position_id, key)`.

Zneplatnit, ne mazat — visí na tom historie a lidé to znají.

## 3. Které pravidlo vyhraje

Od nejužšího k nejširšímu. **První nalezené platí:**

1. tahle pobočka + tahle pozice
2. tahle pobočka, bez pozice
3. celá firma + tahle pozice
4. celá firma, bez pozice

Když nic nesedí, šablona se nenabídne a časy se napíšou ručně.

**Pořadí napiš do komentáře u funkce.** Až se za měsíc někdo bude
divit, proč se u kuchaře doplnilo něco jiného než u číšníka, musí to
najít v kódu, ne hádat.

---

## 4. Čeho se bojím nejvíc

### Změna šablony nesmí přepsat už zadané směny

Směna si při založení **opíše časy**. Nedrží si odkaz na šablonu jako
zdroj pravdy.

Kdyby si ho držela, stačilo by opravit `D` z 9:00 na 9:30 — a **tiše
by se posunuly všechny už vydané směny**, které lidé mají naplánované.
V rozpisu, který se vydává a podle kterého si lidé zařizují život, je
tohle nepřijatelné.

Šablona je tedy **předvyplnění, ne vazba**. Uveď to i na obrazovce
šablon: *„Změna se projeví na nově zadaných směnách. Ty už zadané
zůstávají."*

### Směna přes půlnoc

`N` bude 22:00–06:00. `ends_at` menší než `starts_at` znamená druhý
den — stejná past jako u ručního zadávání směn. Řeš to na jednom
místě pro obojí, ne dvakrát.

### Člověk bez pozice

Dnes má pozici **jediný člověk z dvanácti** (Láďa — Kuchař). Ostatní
spadnou na pravidlo bez pozice; když žádné není, nesmí se stát nic
záhadného — prostě se šablona nenabídne a časy se napíšou.

### Ruční přepsání

Šablona doplní časy, ale **musí jít přepsat**. Záskok od devíti do
dvou je normální den v provozu, ne odchylka, kterou má aplikace
odmítat.

---

## 5. Obrazovka

**Nastavení → Šablony směn.** Založit, pojmenovat, časy, pozice,
pobočka, pořadí, zneplatnit.

Ať je v seznamu na první pohled vidět, **pro koho která platí** —
sloupce Pozice a Pobočka, a u těch obecných ať stojí „všechny", ne
prázdno. Prázdná buňka se čte jako chyba.

## 6. Co to odemkne později

Až se bude nahrávat rozpis z Excelu, budou v tabulce od zákazníka
skoro jistě právě tyhle zkratky — `D`, `N`, `R`. Tímhle číselníkem se
z nich rovnou stanou časy. **Teď to nezadávám**, jen ať se to při
návrhu drží v hlavě: `key` je to, co se bude párovat s buňkou
z tabulky, takže porovnávej přes `lower(btrim(...))` jako u ostatních
rozpoznávacích klíčů.

---

## 7. Testy

1. Kuchař a číšník mají oba `D` a dostanou **jiné časy**.
2. Když pro pozici pravidlo není, použije se **to bez pozice**.
3. Pobočkové pravidlo **přebije** firemní.
4. **Změna šablony nezmění už zadané směny.**
5. Šablona přes půlnoc dá směnu, která **končí druhý den**, a sedí
   s provozním dnem.
6. Doplněné časy **jde přepsat**.
7. Dvě šablony se stejným `key` pro tutéž pozici a pobočku **nejdou
   založit**.
8. **Cizí firma** svoje šablony nevidí a nepoužije.
