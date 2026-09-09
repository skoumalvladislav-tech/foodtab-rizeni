# Dodělat všechno — závěrečné zadání z 8. 9. 2026

Šéfík: *„Dochází nám čas, potřebuji vše rozchodit. Ať vše pushne a ať vše
nastaví podle mých požadavků, které jsme dnes probírali."*

**Tenhle soubor je jediný seznam, podle kterého se teď jede.** Sbírá
všechno z dneška. Starší zadání platí jako podklad — pořadí je tady.

---

## 0. Hned teď, než začneš cokoli dalšího

1. **Pushni všechno, co máš.** Co není v repozitáři, to neexistuje.
2. **Nic nenasazuj.** `db push` spustil Šéfík dnes jednou a znovu ho
   spustí až na pokyn. Migrace se píšou, nenasazují.
3. **Necommituj nedodělaný krok E.** Platí dál a je to jediné pravidlo
   z dneška, které se nesmí porušit ani při spěchu.

---

## 1. Co je hotové — nesahej na to

| | co | stav |
|---|---|---|
| A1 | Docházka: po stornu už nenabízí Odchod | hotové, ověřeno proti PostgreSQL |
| A2 | Pruh o osobních údajích pryč z rámu | hotové |
| A3 | Odhlášení na rozcestníku, s dotazem | hotové |
| A4 | Úklid pohledu zaměstnance | hotové |
| E½ | Tabulky zařazení, `je_majitel`, převod | hotové **a nasazené** |

Ověřeno proti opravdovému PostgreSQL: **946 kontrol**. Po nasazení
v ostré databázi: 12 zařazení, 0 výjimek, 2 majitelé, `ai.use` nikde.

---

## 2. Pořadí zbytku

Každý bod se dá odevzdat sám. **Když dojde čas, skonči na hranici bodu
a napiš to** — nedodělaný bod v repozitáři je horší než chybějící.

---

### Bod 1 — dokončit krok E *(největší a nejrizikovější)*

Zadání: `docs/zarazeni-misto-roli.md`, `docs/zarazeni-opravy-zadani.md`,
`docs/zarazeni-cisla-z-ostre-databaze.md`, tvoje nálezy a **7b**.

Zbývá: jádro (`has_permission`, `has_access`) → devět opsaných kopií →
`app.smi_pridelit` → aplikační vrstva (`my_context`, všechna
`if (!ctx.role)`, `cekaji_na_opravneni`, `my_tenants`, počítání majitele,
obě hlášky o pozvánce, obrazovka Oprávnění, skryté pole `nabizeno`).

**Musí padnout naráz.** Hranice, na které se dá skončit, tu není.

**Povinně podle 7b:** uvnitř funkcí s vyšším oprávněním žádné RLS není,
takže si nové tělo musí odfiltrovat `tenant_id = p_tenant`,
`deleted_at is null` a `status = 'active'` samo — a na každý z těch tří
filtrů vlastní kontrola s cizí firmou, rozbíjená po jednom.

---

### Bod 2 — obrazovky zařazení *(tohle Šéfík skutečně chtěl)*

Bez tohohle je krok E pro něj neviditelný.

1. **Nastavení → Zařazení** místo Rolí: tatáž obrazovka, čte
   `positions` a `position_permissions`. U každého zařazení ať je
   vidět, **kolika lidí se změna týká.**
2. **Formulář zaměstnance:** pole „Pozice" se jmenuje **Zařazení**
   a pod ním jsou zaškrtávátka oprávnění, předvyplněná ze zařazení.
   Co Šéfík změní, uloží se jako **výjimka** a je u toho vidět, že to
   výjimka je, plus „vrátit na zařazení".
3. **U člověka bez účtu** věta: *„Uloží se a začne platit, jakmile se
   přihlásí."* Bez ní to vypadá jako chyba.
4. **Pryč s hláškou** „nejdřív mu pošlete pozvánku" — obě místa.

---

### Bod 3 — přestávky paušálem

Zadání: **`docs/prestavky-pausalem.md`**, celé, nezačaté.

Dvě nastavení (kolik minut, od jak dlouhé směny) na firmě s možností
přebít u pobočky, `prestavka_platna_od` ať se nepřepíše historie,
zapsaná přestávka má přednost před paušálem, a odečet **musí být vidět**
na obrazovce: `8:00–16:00 · 7 h 30 min (−30 min přestávka)`.

Mění se `app.worked_minutes` **i** její dvojče ve `storno_dochazky` —
obě jedním commitem.

---

### Bod 4 — upozornění na změny

Zadání: `docs/velka-prace-2026-09-08.md`, oddíl 5.

**Nestav nic nového.** Tabulka `notifications`, zvoneček i obrazovka
Upozornění existují a píše do nich devět míst. Chybí jen zápis
u **změny směny, zrušení směny, přiřazení na směnu, nového vzkazu,
nového oznámení, nového úkolu a úkolu po termínu.**

Tři pravidla: upozornění je **odkaz na věc, ne opis věci** (nikdy mzda,
sazba, záloha, telefon); rozhoduje `app.has_access`, ne seznam adresátů;
**vlastní změna neupozorňuje.** A **slučuj** podle `(user_id, druh, den)`
— osm přehozených směn je jedno upozornění, ne osm.

E-mail přes Resend až potom, jen naléhavé, souhrn za hodinu, tichá
hodina 22:00–6:00. **Push do mobilu ne** a v rozhraní ho neslibuj.

---

### Bod 5 — vzkazy a komunikace

Zadání: `docs/velka-prace-2026-09-08.md`, oddíl 4.

1. **Jednotný adresát** — firma / pobočka / úsek / pozice / člověk,
   tatáž komponenta jako u úkolů.
2. **Před odesláním ať je vidět, kdo to uvidí** — *„Uvidí: Bernard Bar
   — úsek Bar (4 lidé)"*. U volby „celá firma" zvýrazněné.
3. **„Beru na vědomí"** se seznamem jmen, kdo nepotvrdil.
4. **Jedno číslo nepřečtených** z obou záložek.

**Přílohy ne** — potřebují úložiště v Supabase, které není nastavené.

---

### Bod 6 — hlasové zadávání *(krátké)*

Zadání: `docs/velka-prace-2026-09-08.md`, oddíl 6.

**Žádné tlačítko s mikrofonem** — na iPhonu by nefungovalo. Jen zařiď,
aby pole na vzkaz uneslo diktování z klávesnice: `<textarea>`, které
roste, **žádné překreslování při psaní**, žádný měnící se `key`, text
přežije otočení telefonu. A jedna věta v nápovědě, že diktovat jde.

---

### Bod 7 — pozvánky musí umět selhat srozumitelně

`app/pozvanka/[token]`. Dnes se rozešlou lidem, kteří aplikaci nikdy
neviděli. **Každý z těchhle případů česky a s cestou ven:** vypršelá,
použitá, zrušená, poškozený odkaz, člověk přihlášený jiným účtem.
Slepá ulička znamená telefonát uprostřed směny.

---

### Bod 8 — drobnosti na konec

- **`search_path` u tří funkcí** (`doruci_se`, `delka_smeny_minut`,
  `sablona_poradi`). Ověřeno: **nejsou** `security definer`, takže to
  není díra — jen odchylka od konvence.
- **`zapomenute_odchody`** má RLS a žádnou politiku. Ověřeno: nemá ani
  grant pro přihlášeného, takže je zavřená dvakrát. **Napiš k ní
  komentář, proč politika není potřeba** — ať ji za měsíc někdo
  „neopraví" tím, že ji otevře.

---

## 3. Co čeká na Šéfíka, ne na tebe

Vypiš mu to do hlášení, ať to má na jednom místě:

1. **Rozeslat pozvánky.**
2. **Sloučit dvojí pojmenování zařazení** — Barman vedle Bar, Číšník
   a Číšník/servírka vedle Servis, Majitel/ka vedle příznaku majitele.
   **Neslučuj to sám**, je to rozhodnutí o tom, kdo bude co smět.
3. **Nasazení** dalších migrací, až budou hotové.
4. **Strop na e-maily** v Supabase, pokud ho ještě nezvedl.

---

## 4. Ráno

Hlášení do `docs/hlaseni/stav-2026-09-09.md`: co je hotové s commity,
na které hranici jsi skončil, čísla kontrol **a z čeho jsou**, co čeká
na Šéfíka, a hlavně **na co jsi narazil a nešlo to.**

**A pushni.**
