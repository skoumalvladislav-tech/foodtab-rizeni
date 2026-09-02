# Pravidlo: nikdo nepřidělí víc, než má sám

Rozhodnuto 1. 9. 2026. Doplňuje pravidla v `CLAUDE.md` — patří k pravidlu 2
(o přístupu rozhoduje jediné místo) a k pravidlu 3 (dvě obranné linie).

---

## Proč

`memberships_write` dnes žádá `people.manage`. Kdo tedy zakládá lidi, může
komukoli — **i sobě** — přidělit roli Majitel a získat všechno, včetně mezd.

Je to tatáž díra, jakou jsme právě zavřeli u `role_permissions` (kde si
`people.manage` mohl dopsat `payroll.read`), jen o patro vedle. Tam se
oprávnění přidávalo do sady; tady se rovnou přidělí celá sada.

Zpřísnit `memberships_write` na `settings.manage` **nejde** — přidělovat
role je součást správy lidí a vedoucí, který přijímá brigádníka, mu roli
dát musí. Řešením není jiné právo, ale strop.

---

## Pravidlo

**Kdo přiděluje roli, musí sám mít všechno, co ta role obsahuje —
v rozsahu, který přiděluje.**

Ze dvou částí:

1. **Roli s `is_owner` smí přidělit jen vlastník.** Majitel je jediná
   role, která obchází katalog oprávnění, takže se nedá porovnávat
   po položkách.
2. **U ostatních musí být oprávnění přidělované role podmnožinou
   oprávnění toho, kdo ji přiděluje**, ve stejném rozsahu. Vedoucí
   Bernardu nesmí nikomu dát právo, které sám nemá, ani na Perle.

Kdo poruší, dostane odmítnutí se srozumitelnou hláškou — ne tiché
neprovedení.

---

## Kde všude to platí

Tohle je ta část, na které se to obvykle láme. Nestačí zavřít jedny dveře.

| místo | co dělá |
|---|---|
| `memberships` (insert i update) | přidělení role účtu |
| `app.create_invitation` | pozvánka **nese roli** — jinak se obejde tabulka |
| obrazovka Oprávnění | nabídne jen role, které smím přidělit |

Pozvánka je ta, na kterou se zapomíná: kdo nemůže přidělit roli přímo,
pošle pozvánku s tou rolí a je ve stejném bodě.

**Změna vlastní role je zvláštní případ:** povyšovat se nesmí nikdo,
ani vlastník sám sobě to nepotřebuje. Nejjednodušší je zakázat úpravu
vlastního členství úplně — kdo se potřebuje přeřadit, požádá někoho
jiného.

---

## Rozsah přiděluje jen správce lidí za celou firmu

Rozhodl Šéfík 1. 9. 2026, zapsáno 2. 9.

Kdo má `people.manage` jen na pobočku, **nepřidělí rozsah nikomu — ani
na tu svou.** Politika na `membership_branches` se ptá
`app.has_access(tenant, 'people.manage')` bez pobočky, a to vyžaduje
členství s rozsahem `tenant`.

**Je to vědomé rozhodnutí, ne díra.** Je přísnější, než pravidlo 4
žádá, a u dvou provozoven to nikomu nevadí. Kdo rozšiřuje, kam někdo
vidí, rozhoduje o celé firmě — i když zrovna přidává jednu pobočku.

Plyne z toho jedna věc, která svádí k „opravě": strop na pobočku
uvnitř `app.smi_pridelit` (kontrola, že přidělující má právo i na tu
konkrétní pobočku) **se nikdy neuplatní**, protože ten, na koho míří,
se k tabulce nedostane už o krok dřív. Zůstává tam schválně — jako
druhá závora pro případ, že by se první uvolnila.

**Neopravujte to na `has_access(tenant, 'people.manage', branch_id)`.**
Vypadalo by to logičtěji a bylo by to volnější, než jsme chtěli.

---

## Dvě obranné linie

Jako všude jinde (pravidlo 3):

- **Databáze** — politika na `memberships` a kontrola uvnitř
  `app.create_invitation`. Tohle je ta, která musí držet.
- **Aplikace** — obrazovka nenabídne role, které přidělit nemůžu.
  Tohle je pohodlí, ne ochrana.

---

## Testy

Do `krok4_scenar.sql` nebo dalšího v řadě:

1. Provozní (`people.manage`, bez `settings.manage`) **nepřidělí** roli
   Majitel — ani sobě, ani nikomu jinému.
2. Provozní **nepřidělí** roli, která má oprávnění, jež sám nemá
   (například `payroll.read`).
3. Provozní **přidělí** roli Servis, protože všechna její oprávnění má.
4. Totéž třikrát přes `app.create_invitation` — pozvánka nesmí být
   obchvat.
5. Vedoucí s rozsahem na jednu pobočku **nepřidělí** členství na jinou.
6. Nikdo **neupraví vlastní členství**.

Kontroly musí ověřovat, že se někdo **nedostane** tam, kam nemá.
A pozor na tiché neprovedení: u zákazu přes RLS se maže bez chyby,
jen se nic nestane — počítejte řádky před a po.
