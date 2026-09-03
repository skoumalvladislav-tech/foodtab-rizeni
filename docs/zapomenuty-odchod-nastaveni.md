# Zapomenutý odchod: co nastavit, aby to začalo běžet

Sepsáno 3. 9. 2026.

Funkce je hotová od `cf4177b` a na nasazené aplikaci žije — adresa
`/api/uloha/zapomenuty-odchod` správně odmítá volání bez tajemství.
**Ale neběží.** Chybí jí dvě proměnné na Vercelu a plánovač, který ji
zavolá.

---

## Co bylo špatně

Hodinový cron ve `vercel.json` tarif Hobby odmítal a blokoval nasazení
(`45c3a7f`). Zbyl denní běh v 08:00 UTC (`8a9d155`) — ten tam **byl
pořád**, takže se aplikace nejspíš každý den volala a pokaždé
odpověděla `401`, protože `CRON_SECRET` na Vercelu neexistuje. Nikdo
se to nedozvěděl, protože se nikdo nedíval.

Nově to plánuje **GitHub Actions** (`.github/workflows/zapomenuty-odchod.yml`)
**každou hodinu** a denní cron z `vercel.json` je pryč. Dva plánovače
nad jednou úlohou nejsou pojistka, ale místo, kde se za rok nikdo
nevyzná.

Hodinově proto, že při denním běhu v 08:00 UTC se firma, která si
nastaví hodinu pozdější než 10:00 pražského času, dozví o zapomenutém
odchodu až druhý den.

---

## Co musíš založit

Čtyři hodnoty na dvou místech. **Hodnoty si vytvoř sám — Code je vidět
nemá a mít nemá.**

### 1. Na Vercelu (Settings → Environment Variables)

| Název | Hodnota | Prostředí |
|---|---|---|
| `CRON_SECRET` | Náhodný řetězec, který si vymyslíš. Klidně `openssl rand -hex 32`. | Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Z Supabase: Settings → API → `service_role` secret | Production |

`SUPABASE_SERVICE_ROLE_KEY` **nikdy nesmí být `NEXT_PUBLIC_`**. Je to
klíč, který obchází RLS; s předponou `NEXT_PUBLIC_` by se zabalil do
JavaScriptu, který si stáhne každý návštěvník.

Po přidání proměnných je potřeba **nasadit znovu** — Vercel je do už
běžícího nasazení nepropíše.

### 2. Na GitHubu (Settings → Secrets and variables → Actions → New repository secret)

| Název | Hodnota |
|---|---|
| `CRON_SECRET` | **Tatáž** hodnota jako na Vercelu. Když se rozejdou, úloha vrátí 401. |
| `APP_URL` | Adresa nasazené aplikace **bez lomítka na konci**, např. `https://foodtab.vercel.app` |

---

## Jak zjistit, že to funguje

1. GitHub → záložka **Actions** → **Zapomenutý odchod** → **Run workflow**.
2. Běh musí skončit zeleně a v souhrnu má stát `Ohlášeno zapomenutých
   odchodů: N` (nula je taky správná odpověď — znamená, že nikdo nic
   nezapomněl).

Když skončí červeně, řekne rovnou proč:

| Co v běhu stojí | Co s tím |
|---|---|
| `Chybí secret APP_URL` | Nezaložil ses ho na GitHubu. |
| `Chybí secret CRON_SECRET` | Totéž. |
| `401 — tajemství nesedí` | `CRON_SECRET` na Vercelu a na GitHubu se liší. |
| `503 — na Vercelu chybí SUPABASE_SERVICE_ROLE_KEY` | Přidat na Vercel a nasadit znovu. |

Od té chvíle to jede každou hodinu samo a **když spadne, přijde ti
e-mail** — GitHub o neúspěšném běhu naplánované úlohy posílá zprávu.
To je ta část, která tady dosud chyběla nejvíc: tichá úloha vypadá
úplně stejně jako úloha, která nemá co dělat.

---

## Co se tím nemění

O hodině rozhoduje dál **databáze** podle pásma pobočky, ne plánovač.
Workflow běží každou hodinu a `public.ohlasit_zapomenute_odchody` si
sama vybere, pro koho už je čas. Kdyby se plánovalo napevno, zvonilo by
to v zimě o hodinu jinam.

Zmeškaný běh se dohání sám — hledá se podle stáří příchodu, ne podle
hodiny. A dvojí spuštění nic nezdvojí: každý záznam se ohlásí jednou,
drží to primární klíč v `zapomenute_odchody`.
