---
name: nasazeni
description: Kontrolní seznam před nasazením migrací Foodtabu do Supabase. Použij vždy, když přijde řeč na db push, nasazení, migration list nebo na to, co se má stihnout před zásahem do ostré databáze. Platí i tehdy, když se nasazovat NEMÁ — obsahuje důvod, proč to nedělá automat.
---

# Před nasazením

> **Nasazuje Šéfík, ne push.**

`supabase db push` se **nespouští sám od sebe, ani nasucho.** Spustí se
jen na výslovný pokyn. V ostatních případech se migrace píšou a nechají
ležet — hlášení řekne, co čeká.

## Proč to nedělá automat

Z `.github/workflows/databaze.yml` byly 7. 9. **schválně odstraněny**
úlohy `tajemstvi` a `nasazeni`. Důvod není, že by nefungovaly:

**Ostrá data leží v projektu `foodtab-test`.** Dokud to platí, stačí,
aby někdo jednou přidal `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
a `SUPABASE_PROJECT_REF` do nastavení repozitáře — pár kliknutí, nikomu
to nepřijde nebezpečné — a od té chvíle **každý push do `main` mění
ostrý provoz**, aniž to kdokoli odklikne.

> „Je to bezpečné, protože někdo něco nenastavil" **není pojistka, to je
> shoda okolností.** Pojistka je, že na ta tajemství ten soubor vůbec
> nesahá.

Vrátit se to smí, až bude ostrý provoz ve vlastním projektu
`foodtab-prod`. Podmínka je věcná, ne kalendářní. Je to rozepsané
v `CLAUDE.md`, „Stav prací", a na konci `databaze.yml`.

## Postup, když pokyn přijde

**1. Ověř, na jaký projekt je CLI napojené.** Čtení, nic nemění:

```bash
cat supabase/.temp/linked-project.json
```

Musí sedět `spekntcsuroqhehmjssv` / `foodtab-test` (CLAUDE.md,
„Prostředí"). 7. 9. skončilo přihlášení v CLI v **jiném, prázdném
účtu** — kdyby ref neseděl, zastav se a napiš to místo nasazování.

**2. Podívej se, co je nenasazené:**

```bash
npx.cmd supabase migration list --linked
```

**3. Zkontroluj POŘADÍ.** Razítka ho hlídají sama, ale musíš vědět,
jestli na něm záleží. Když ano, je to napsané v hlavičce migrace —
například `ai_use_pryc` musela jít **před** převodem na zařazení,
jinak by se `ai.use` zkopírovalo do `position_permissions` a už by ho
tam nic neuklidilo.

**4. U rizikového přepnutí pusť měřicí dotazy PŘED nasazením.**
Jsou v `docs/prepnuti-mereni-2026-09-08.md`, oddíl 1 — všechny čtecí.
Datum u nich není záruka: mezi měřením a nasazením může kdokoli
přijmout pozvánku. Nejdůležitější je ten první — **kdo má aktivní
členství bez záznamu v `employees`, přijde po přepnutí o všechno a nic
to neohlásí.**

**5. Teprve pak:**

```bash
npx.cmd supabase db push --yes
```

**6. Ověř výsledek**, nespoléhej na „Finished". `db push` dokládá, že
migrace proběhly, **ne že vyrobily správná data.** U převodu dat pusť
čtecí dotaz, který porovná stav s předpovědí.

## Co napsat po nasazení

Do hlášení: doslovný výpis `db push`, výsledek `migration list` a to,
co ukázalo ověření. Když se čísla liší od předpovědi, **vysvětli
rozdíl** — u `ai.use` to byl důkaz, že pořadí razítek zabralo.

A oprav v hlášení všechno, co u těch migrací pořád tvrdí „čeká na
`db push`".
