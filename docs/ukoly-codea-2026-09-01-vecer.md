# Úkoly pro Codea — večer 1. 9. 2026

Navazuje na ranní práci. **Šest migrací je nasazených** (`150000`
až `200000`), takže se konečně dá klikat proti opravdovým datům —
většina toho, co jsi ráno nemohl ověřit, se ověřit dá.

---

## Co se mezitím ověřilo za tebe

Pustil jsem `supabase/tests/run.sh` proti **opravdovému PostgreSQL 16**
se všemi 35 migracemi: **320 kontrol, všechny prošly.** Tvoje tři
nálezy platí — `my_context`, `accept_invitation` i `visible_branch_ids`
jsou ověřené pod rolí `authenticated`, ne jen v úvaze.

**Tři kontroly v `krok5_scenar.sql` ale nikdy neproběhly.** Opravil
jsem je, soubor máš v repozitáři:

1. `select oid from pg_proc p join pg_namespace n …` — **nejednoznačný
   sloupec**, `oid` mají obě tabulky. Tahle jediná řádka shodila celý
   scénář, takže by se za ni nedostalo nic.
2. Kontrola „jméno se nebere z e-mailu" **spadla sama na sobě**:
   hledala `split_part` v těle funkce a našla ho ve vlastním komentáři
   „Žádný split_part(…)". Hlásila chybu tam, kde je kód správně.
3. Moje vlastní kontrola byla zastaralá — ověřovala, že si zaměstnanec
   může sám zapsat píchnutí. Tys to zavřel, tak teď ověřuje opak.

Body 1 a 2 jsou tvoje nové kontroly. **Kontrola čitelnosti není
proběhnutí** — obě jsou syntakticky bez chyby a ani jedna by nikdy
neřekla pravdu. `krok6` a `krok7` proti PostgreSQL taky neběžely; teď
už ano a prošly.

---

## 1. Dokončit pozvánky — má přednost

Rozhodnutí jsou v `docs/odpovedi-pozvanky-2026-09-01.md`.

- **Rozsah z pobočky zaměstnance.** Kdo má v Lidech pobočku, dostane
  `scope = 'branch'` a tu jednu; kdo je „Firemní", `scope = 'tenant'`.
  Ne z formuláře.
- **Obrazovka přidělení oprávnění musí umět nastavit i rozsah** —
  firma, nebo vybrané pobočky. Bez toho platí to, cos našel: role sama
  neotevře nic. Výběr podléhá témuž stropu jako role.
- **Moje údaje a „zatím žádné oprávnění" ven zpod `/[rozsah]/`.**
  Starou adresu přesměruj v `next.config.ts`. Na `resolveScope`
  nesahej.
- **Kontrola do `krok7`:** člen s prázdnou rolí má prázdná
  `permissions` a `has_access` mu vrací nepravdu pro každé právo.

Tím se odblokuje pozvání druhého majitele, na které Šéfík čeká
od rána.

---

## 2. Zálohy a „zbývá k výplatě"

Body 5 a 6 z `docs/kiosek-pin-zalohy-zadani.md`. Rozhodnutí, která
padla a jsou v zadání zanesená:

- Nové oprávnění **„Vyplácet zálohy"**, oddělené od `payroll.*` —
  vydávat peníze a vidět mzdy jsou dvě různé věci.
- Zaměstnanec zálohu **potvrdí PINem** na tabletu. Nepotvrzená se
  nezahazuje, zůstane vidět.
- **Vyšší záloha než odpracováno se jen ohlásí, nikdy neodmítne.**
- Čtyři řádky na obrazovce výdělku a **volba firmy**, jak je počítat:
  odečítat (výchozí) / jen ukázat / neukazovat. Volba mění **jen
  zobrazení**, nikdy uložený záznam, a jde do auditu.
- U „zbývá k výplatě" musí stát, že je to **před daněmi a odvody**.

---

## 3. Ranní e-mail

Bod 7 zadání. Souhrn za **provozní** den, v e-mailu počty a částky za
pobočku, **jména a hodiny až v aplikaci**. Píše ho kód, ne jazykový
model. Adresáti a čas jsou nastavení firmy — **postav to s prázdnou
výchozí hodnotou**, adresu si Šéfík doplní sám.

---

## 4. Čtyři drobnosti, které se dnes ukázaly na obrazovce

Malé, ale všechny jsou vidět při prvním použití.

### a) Skloňování

Aplikace píše „2 **záznamů**" a „2 **příchodů**". Správně je
„2 záznamy", „2 příchody"; „5 záznamů" až od pěti. Skloňování máš
zadané u upozornění na směny — platí všude, kde se počítá.

### b) Výdělek umí jen aktuální měsíc

Šéfík má dva nedokončené příchody z 27. a 31. srpna. Až je dopíše,
**ty hodiny nikde neuvidí** — panel ukazuje jen aktuální měsíc.
A u výplaty se hádá právě o minulý. Chce to přepínač měsíce.

### c) Nula si říká o vysvětlení

Když je výdělek 0 Kč, člověk nepozná, jestli nemá odpracováno, nebo mu
chybí sazba. Aplikace obojí ví — ať to napíše. (Ověřeno, že samotný
výpočet je správně: otevřený příchod dá 0 minut, po dopsání odchodu
480 minut a 2 400 Kč při 300 Kč/h.)

### d) Odchod se teď nedá píchnout

Píchnutí smí vzniknout jen kódem nebo PINem, ale **žádné zařízení
zatím zaregistrované není**, takže si Šéfík odchod nepíchne. Řeší to
ruční zápis, ale stálo by za zvážení, jestli obrazovka nemá v takové
chvíli sama napsat, kudy ven.

---

## 5. Co teď jde ověřit a ráno nešlo

Migrace jsou nasazené, takže:

- registrace zařízení a `/kiosek` v provozním stavu
- „čeká na přidělení oprávnění" na skutečném člověku
- odeslání pozvánky proti databázi

**Na ostrá data pořád nesahej** — na zkoušení je testovací firma.

Odeslání e-mailu ověřit nepůjde, dokud v prostředí nebude
`RESEND_API_KEY`. To je úkol pro Šéfíka, ne pro tebe; klíč si
nevymýšlej.
