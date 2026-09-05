# Úkoly pro Šéfíka — 4. 9. 2026

Tohle jsou věci, které **za tebe nemůžu udělat já** — buď k nim nemám
přístup, nebo jsou to tvoje rozhodnutí a tvoje tajemství. U každé je
odkaz, postup a jak se pozná, že to sedí.

Seřazené tak, jak na sebe navazují. První tři blokují večerní zkoušku
naostro.

---

## 1. Vercel: přejmenovat proměnnou (5 minut)

**Odkaz:** https://vercel.com/skoumalvladislav-tech/foodtab-rizeni/settings/environment-variables

**Proč.** Aplikace čte `CRON_SECRET` velkými písmeny, ale na Vercelu se
ta proměnná jmenuje `cron_secret` malými. U proměnných prostředí
rozhoduje velikost písmen, takže aplikace čte prázdno a hlídání
zapomenutých odchodů odmítá každé zavolání s chybou 401.

Zkoušel jsem to přepsat sám a nepustilo mě to — zásahy do nastavení
tvého projektu mám zakázané.

**Postup:**

1. Otevři odkaz výš.
2. Najdi řádek `cron_secret`. Vpravo na jeho konci jsou **tři tečky**
   → **Edit**.
3. V poli **Key** přepiš název na `CRON_SECRET` — velkými písmeny,
   podtržítko uprostřed.
4. Kdyby chtěl vyplnit i hodnotu (u „sensitive" proměnných se ta stará
   nedá přečíst), vygeneruj si novou v PowerShellu:

   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
   ```

   Tu jednu hodnotu vlož na **dvě místa**: sem na Vercel a do GitHubu
   (odkaz v úkolu 2). Musí být na obou stejná, jinak to zase bude 401.
5. **Save.**

**Pak nové nasazení, jinak se změna neprojeví:**

6. https://vercel.com/skoumalvladislav-tech/foodtab-rizeni/deployments
7. U nejnovějšího řádku tři tečky → **Redeploy** → potvrdit.
   Použij existující cache, nic se tím nepřestaví.

**Jak poznáš, že je hotovo:** napiš mi to. Spuštění hlídače
i kontrolu výsledku udělám sám — tam už žádné tajemství zadávat
nemusím.

---

## 2. GitHub: zkontrolovat druhou půlku tajemství

**Odkaz:** https://github.com/skoumalvladislav-tech/foodtab-rizeni/settings/secrets/actions

Obě tajemství tam už jsou — `APP_URL` jsem založil já, `CRON_SECRET`
jsi přidal ty. **Dělej tu něco jen tehdy, když jsi v úkolu 1
vygeneroval novou hodnotu:** klikni u `CRON_SECRET` na tužku,
vlož tutéž hodnotu a **Update secret**.

---

## 3. Sazby u lidí — devět z dvanácti je nemá

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/nastaveni/lide

**Proč.** Bez sazby se nedá spočítat nic, co je na docházce postavené —
ani mzdové náklady, ani podíl nákladů pro agenta. Docházka se bude
zapisovat správně, ale bude z ní jen počet hodin.

**Postup:** u každého člověka **Upravit** → pole se sazbou → uložit.
Sazba se zadává **v celých korunách za hodinu**.

**Jak poznáš, že je hotovo:** v seznamu nemá nikdo prázdnou sazbu.

---

## 4. Pozice u lidí — má ji jen Láďa

**Odkaz na číselník:** https://foodtab-rizeni.vercel.app/firma/nastaveni/pozice
**Odkaz na lidi:** https://foodtab-rizeni.vercel.app/firma/nastaveni/lide

**Proč.** Bez pozice nefunguje to, cos chtěl u šablon směn: že kuchař
má `D` od 7:30 a číšník od 9:00. Aplikace nemá podle čeho rozhodnout
a nabídne obecný čas.

**Postup:**

1. Nejdřív zkontroluj číselník pozic — musí tam být aspoň Kuchař,
   Číšník, Barman, a co u vás ještě je.
2. Pak u každého člověka **Upravit** → pozice → uložit.

---

## 5. Šablony směn — D a N pro obě profese

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/nastaveni/sablony

**Proč.** Tohle je to, cos zadával: `D` jako denní, ale s jinými časy
podle profese. Pak se do rozpisu zadává písmeno, ne hodiny.

**Postup** — založ aspoň tyhle čtyři:

| Klíč | Název | Pozice | Od | Do |
|---|---|---|---|---|
| `D` | Denní | Kuchař | 7:30 | 22:00 |
| `D` | Denní | Číšník | 9:00 | 22:00 |
| `N` | Noční | (všechny) | 22:00 | 6:00 |
| `R` | Ranní | (všechny) | 6:00 | 14:00 |

**Pozor na dvě věci:**

- Pobočku nech prázdnou, dokud se obě provozovny neliší. Prázdno
  znamená „platí pro celou firmu".
- **Změna šablony nepřepíše už zadané směny.** Je to předvyplnění, ne
  vazba. Kdyby přepisovala, posunuly by se lidem směny, které už mají
  naplánované.

---

## 6. PINy na píchání

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/nastaveni/lide

**Proč.** Brigádník bez telefonu se na tablet dostane jen PINem.

**Postup:** u člověka **Upravit** → PIN → **PIN uvidíš jen jednou, při
nastavení**. Zapiš si ho, nebo ho člověku rovnou řekni. Když se ztratí,
nastavíš nový — přečíst zpětně nejde ani ty, protože se ukládá jen
otisk.

---

## 7. Tablet v Bernard Baru

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/nastaveni/zarizeni

**Proč.** Kiosek se váže na konkrétní zařízení a pobočku. V Černé Perle
už zaregistrovaný je, v Bernardu ne.

**Postup:** na tabletu za barem otevři kiosek, v Zařízeních ho spáruj
a vyber pobočku Bernard Bar. Vytištěný list s QR máš v `docs\qr\`
(`kiosek-tablet-a4.pdf`).

---

## 8. Vydat rozpis znovu — čeká sedm změn

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/smeny

**Proč.** Aplikace ti to sama hlásí červeně na obrazovce Směn: *„Od
vydání se změnilo 7 směn."* Dokud rozpis nevydáš znovu, lidé pořád
vidí starou podobu — a přijdou podle ní.

**Postup:** přepni se na pobočku (přepínač vlevo nahoře), na Směnách
klikni **Vydat znovu**. Zvlášť pro každou pobočku.

**Tohle udělej až po úkolech 3–5**, ať se nevydává rozpis, který budeš
za hodinu zase měnit.

---

## 9. Rozeslat pozvánky

**Odkaz:** https://foodtab-rizeni.vercel.app/firma/nastaveni/lide

**Postup:** u člověka **Pozvat** → e-mail nebo telefon. Telefon je
plnohodnotný přihlašovací údaj, brigádník bez e-mailu se dostane dovnitř
přes SMS.

**Až naposled**, po úkolech 3–6. Kdo dostane pozvánku dřív, přihlásí se
do aplikace, kde ještě nemá sazbu, pozici ani PIN — a první dojem
z aplikace je poloprázdná obrazovka.

---

## Co dělám mezitím já

- Kontroluju kód Codea a píšu mu zadání
  (`docs/mobil-a-dokonceni-2026-09-04.md` je dnešní).
- Pouštím celou zkoušku databáze proti opravdovému PostgreSQL —
  naposledy **712 kontrol prošlo**, padá jen `marketing1_scenar.sql`
  z druhé relace.
- Až mi řekneš, že je úkol 1 hotový, spustím hlídače zapomenutých
  odchodů a zkontroluju výsledek.
