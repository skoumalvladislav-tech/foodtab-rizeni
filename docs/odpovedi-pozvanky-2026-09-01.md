# Odpovědi na dvě otázky z pozvánek

Rozhodl Šéfík 1. 9. 2026. Doplňuje `docs/pozvanky-zadani.md`.

---

## 1. Rozsah pozvánky: z pobočky zaměstnance

Pozvánka si rozsah **nebere z formuláře**. Vezme ho z toho, co už je
u zaměstnance v Lidech:

| zaměstnanec má | pozvánka dostane |
|---|---|
| pobočku (Bernard, Perla) | `scope = 'branch'` a **tu jednu pobočku** |
| „Firemní" (bez pobočky) | `scope = 'tenant'` |

Důvod: pobočka u zaměstnance už jednou zadaná je. Ptát se na ni podruhé
v pozvánce znamená rozhodovat dvakrát o téže věci — a druhé rozhodnutí
se dřív nebo později rozejde s prvním.

**Samotný rozsah nic neotevírá** (potvrdil to tvůj test): bez role
nemá člověk jediné právo, ať je rozsah jakýkoli. Proto je bezpečné ho
nastavit dopředu.

### Z toho plyne jedna věc navíc

Obrazovka, na které se člověku **přiděluje Oprávnění, musí umět
nastavit i rozsah** — firma, nebo vybrané pobočky. Bez toho platí to,
co jsi našel: role sama neotevře nic a člověk zůstane slepý.

Ten výběr podléhá témuž stropu jako role — kdo nemá právo na cizí
pobočku, nesmí ji nikomu přidělit (`docs/pravidlo-neprideluj-vic.md`,
pravidlo 4).

---

## 2. Moje údaje dostanou adresu mimo rozsah

Osobní údaje patří **člověku, ne provozovně**. Odsuň je proto zpod
`/[rozsah]/`:

- `/moje-udaje` — co o vás aplikace vede, oprava kontaktu, souhlasy,
  export, informace o zpracování.
- Stejně tak obrazovka **„zatím vám nikdo nepřidělil oprávnění"**.
  Ta se ze své podstaty ukazuje člověku, který žádný rozsah nemá.
- Stará adresa `/[rozsah]/moje-udaje` musí dál fungovat — přesměruj ji
  v `next.config.ts`, stejně jako `moje-smeny` → `dochazka`.

**Na `resolveScope` ani na rozhodování o přístupu v `lib/authz.ts`
nesahej.** Tohle je přesně ten důvod, proč to zákaz má: obejít se to
dá adresou, a obejít se to má.

---

## 3. K té změně v `lib/authz.ts`

Že jsi `role` musel zesplatnit na `| null` a přidat `raw.role ?? null`,
je v pořádku a děkuju, žes to řekl nahlas. Bez toho by to nešlo.

**Přidej k tomu ale kontrolu**, ať to nikdo příště omylem nevrátí:
člen s prázdnou rolí musí mít prázdná `permissions` a `has_access` mu
musí vracet nepravdu pro každé právo — v `krok7_scenar.sql`, pod rolí
`authenticated`, ne jen v úvaze.

---

## 4. Co udělej hned

**Pushni to.** Čtyři migrace čekají na nasazení a scénáře `krok6`
a `krok7` neproběhly proti opravdovému PostgreSQL — psql u tebe není,
u mě ano. Dokud to nemám, nevím, jestli ty tři nálezy
(`my_context`, `accept_invitation`, `visible_branch_ids`) opravdu drží,
a Šéfík nemá co nasazovat.

Kontrola čitelnosti scénáře není totéž co jeho proběhnutí. Naposledy
zamaskovala díru o dvě stě řádků níž.
