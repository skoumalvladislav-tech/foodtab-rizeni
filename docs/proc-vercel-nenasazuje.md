# Proč Vercel od včerejška nenasazuje

Zjištěno 3. 9. 2026. **Příčina je jistá, ne domněnka.**

---

## Nález

`vercel.json` přibyl v commitu `cf4177b` („Upozornění na zapomenutý
odchod") a obsahuje:

```json
{ "crons": [ { "path": "/api/uloha/zapomenuty-odchod",
              "schedule": "0 * * * *" } ] }
```

Hodinový plán. Účet je na tarifu **Hobby**, a tam Vercel v dokumentaci
říká doslova:

> Hobby accounts are limited to cron jobs that run **once per day**.
> Cron expressions that would run more frequently **will fail during
> deployment**.
> `0 * * * *` … *„Hobby accounts are limited to daily cron jobs. This
> cron expression would run more than once per day."*

**Nasazení tedy nepadá kvůli kódu. Odmítá ho plánovač.**

## Jak to sedí dohromady

Na GitHubu je u commitů vidět, kolik kontrol prošlo:

| commit | co | kontroly |
|---|---|---|
| `72afe8f` | Upozornění na přijetí pozvánky | **3 / 4** |
| `cf4177b` | **Upozornění na zapomenutý odchod** | **2 / 4** |
| `d4e9b4b` | Ruční záznam v pásmu pobočky | 2 / 4 |
| `6d799b7` | Storno docházky | 2 / 4 |
| `98ee2eb` | Panel a odmítnutý odchod (A, B) | 2 / 4 |

`72afe8f` je přesně to nasazení, které na Vercelu svítí jako poslední
(před 16 hodinami). Od `cf4177b` dál padá jedna kontrola navíc — a to
je ten commit, který přidal `vercel.json`.

Ostatní podezření jsem vyloučil: **Git je připojený** (repozitář
`skoumalvladislav-tech/foodtab-rizeni`, od 26. 8.), **Ignored Build
Step je „Automatic"**, commity **jsou na `main`**.

---

## Co s tím

### 1. Vyndat cron z `vercel.json` (odblokuje nasazení hned)

Tím se rozjede všechno ostatní, co od včerejška čeká.

### 2. Plánovat to odjinud

Code napsal do komentáře, že adresa má být volaná zvenčí a při
stěhování z Vercelu se mění jen to, kdo ji volá. Tak to udělejme
rovnou.

**Doporučuju GitHub Actions.** Repozitář tam už je, tajemství se dá
uložit do Secrets, hodinový plán je zdarma a nic z toho nezávisí na
Vercelu — takže se to nebude znovu předělávat při stěhování na
Hetzner.

Hodinový plán byl vědomé rozhodnutí kvůli letnímu času: o hodině
rozhoduje databáze podle pásma pobočky, plánovač jen ťuká každou
hodinu. **Tuhle vlastnost neopouštěj** kvůli obejití tarifu — denní
cron v UTC by se v zimě ozval o hodinu jinde, přesně tomu se to mělo
vyhnout.

Vercel Pro (za 20 $ měsíčně) by to taky vyřešil, ale platit za
plánovač, který za pár týdnů stejně opustíme, nemá smysl.

---

## 3. Chybí dvě proměnné prostředí

Na Vercelu jsou dnes jen tři: `RESEND_API_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Kód ale používá i:

- **`CRON_SECRET`** — `app/api/uloha/zapomenuty-odchod/route.ts:54`
- **`SUPABASE_SERVICE_ROLE_KEY`** — `lib/supabase/uloha.ts:40`

Bez nich by úloha neběžela, ani kdyby se nasazení rozjelo. Přidat je
musí Šéfík sám.

**Ani jedna z nich nesmí mít předponu `NEXT_PUBLIC_`.** Ta předpona
znamená „pošli to do prohlížeče" — a `service_role` obchází RLS
(pravidlo 6). S touhle předponou by byl klíč k celé databázi v každé
načtené stránce.

Až se to bude stěhovat na GitHub Actions, `CRON_SECRET` musí mít
**stejnou hodnotu** na obou místech — v prostředí aplikace i v Secrets
u Actions.
