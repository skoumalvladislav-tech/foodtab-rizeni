# FOODTAB — MASTER AUDIT

## Datum: 14. 9. 2026 (první průchod) → aktualizováno 15. 9. 2026 večer

**Tahle aktualizace nahrazuje** stav z 14.9. — mezitím proběhla samostatná
relace na Faktury+design systém a hodně z „akutních"/„čeká na rozhodnutí"
bodů níž je **vyřešeno**. Podrobný, průběžně udržovaný stav dne žije
v `docs/hlaseni/FOODTAB-CURRENT-HANDOFF.md` — tenhle soubor je zde jako
formální Etapa 0 podle master promptu (`docs/hlaseni/FOODTAB-MASTER-PROMPT.md`
resp. zprávy Šéfíka 15.9.2026 večer), ne jako denně udržovaný deník.

---

## REPO STAV (15.9.2026 večer)

| Věc | Hodnota |
|---|---|
| Pracovní větev | `claude/prompt-review-jtkh74` |
| Stav vůči `main` | pushnutá, `origin` aktuální |
| PR historie | #3 (Faktury sloučení), #4 (design systém — tokeny, komponenty, AppShell, Dnes), #5 (Rozpis směn) — **všechny smergovány do `main`** |
| Nasazení | `https://foodtab-rizeni.vercel.app`, auto-deploy z `main` funguje (ověřeno commit→deploy→CSS diff) |
| Supabase (FoodTab) | `spekntcsuroqhehmjssv`, eu-central-1 (Frankfurt) |
| Supabase (Faktury) | `ctqtwahlzhyjerqulqyn`, eu-north-1 (Stockholm) — oddělená DB, Možnost A, rozhodnuto |
| `gh` CLI | nainstalované a přihlášené (`skoumalvladislav-tech`) |

### Vyřešeno od 14.9. auditu

- 88 commitů za remote → **vyřešeno**, pull proběhl 14.9.
- Faktury DB/rozsah rozhodnutí → **Možnost A** (oddělená DB), **úroveň firmy** — obojí rozhodnuto a implementováno
- `20260907010000_muj_den.sql` → **nasazeno**, Dnes funguje
- `rejection_examples` RLS → **opraveno**, živě ověřen zápis

---

## DATABÁZE — MIGRACE

Vše od `20260818000000_user_access.sql` po `20260915100000_modul_faktury.sql`
nasazeno. `20260907020000_ai_use_pryc.sql` stav neověřen touto aktualizací —
viz `docs/hlaseni/stav-*.md` z relace provoz pro nejaktuálnější číslo.

**ČEKÁ NA NASAZENÍ:** žádná mi známá blokující migrace k 15.9. večer.

---

## BEZPEČNOST — ZNÁMÉ, NEOPRAVENÉ NÁLEZY

1. **TRUNCATE grant** na `audit_log` a 51 provozních tabulek pro roli
   `authenticated` (a `anon`, ale bez RLS politiky pro `anon`, takže data
   samotná neuniknou — první linie ale chybí). Analogický nález pro
   marketing byl opraven (`20260914190000_marketing_granty_uklid2.sql`),
   pro provoz **ne** — cizí modul, jen nahlášeno
   (`docs/granty-provoz-zadani.md` má připravené zadání). **Master prompt
   sekce 65 žádá tohle změřit ZNOVU, ne věřit starému číslu — neproběhlo
   v této aktualizaci, jen zopakován starý nález.**
2. **Security definer inventář** (master prompt sekce 66) — neproveden.
3. **n8n starý workflow Černá Perla** — pořád zapnutý, blokuje nový.

---

## MODUL: PROVOZ

| Obrazovka | Stav | UX stav (dle design systému) |
|---|---|---|
| Dnes | HOTOVO | HOTOVO — lehce doladěno (Card, barvy) |
| Rozpis směn | HOTOVO | HOTOVO — Card, Button, radius tokeny |
| Docházka | HOTOVO (A1 bug aktivní) | ROZPRACOVÁNO (design systém, tahle noc) |
| Vzkazy | HOTOVO | CHYBÍ (design systém) |
| Zálohy | HOTOVO | CHYBÍ (design systém) |
| Úkoly a checklisty | HOTOVO | CHYBÍ (design systém) |
| Lidé | HOTOVO | CHYBÍ (design systém) |
| Receptury | MOCK / PŘIPRAVUJEME | — |
| Jídelní lístky | MOCK / PŘIPRAVUJEME | — |
| Motivace | MOCK / PŘIPRAVUJEME | — |
| Nastavení | HOTOVO | CHYBÍ (design systém), Moduly toggle chybí |
| Přihlášení | HOTOVO, P0 VERIFY neproveden formálně | — |
| Docházka A1 bug | stornovaný příchod nabízí Odchod | **NEOPRAVENO**, cizí modul |

## MODUL: TVORBA MENU

MOCK / PŘIPRAVUJEME — placeholder, žádná logika.

## MODUL: FINANCE

- **Faktury** (sekce uvnitř Finance od 15.9.) — HOTOVO, nasazeno, živě
  ověřeno se skutečnými daty (1741 aktivních + 1138 archivovaných faktur).
  AI vytěžení běží mimo repozitář v n8n — **audit AI workflow (provider,
  model, prompt, confidence, human-in-loop) podle master promptu sekce 27
  NEPROVEDEN.**
- Zbytek Financí (Přehled/Náklady/Cashflow/Banka) — CHYBÍ, jen Faktury
  a Dodavatelé existují jako obrazovky.

## MODUL: MARKETING

HOTOVO — UX ZASTARALÉ (design systém zatím neaplikován). Funkčně:
Kroky 1/2/3/5(část)/6 hotové, Krok 4 (renderer) blokován (prostředí),
Krok 5 E2E blokován (rozhodnutí o service-key auth).

## MODUL: OBJEDNÁVKY

CHYBÍ — jen `nakup` placeholder v navigaci (`hotovo: false`).

## MODUL: GASTRO AI

CHYBÍ — needitovatelné vyhledávací pole v topbaru, žádný backend,
žádná logika. Master prompt sekce 38-51 popisuje cílovou architekturu
(orchestrator + specializovaní agenti, AI gateway, read/draft/write/
external nástroje) — nic z toho nezaloženo.

## EMBEDDED / SILENT AI

Žádná zavedená konvence ani gateway. Existující AI (faktury OCR) běží
mimo repozitář v n8n, ne přes centralizovanou AI gateway podle sekce 56.

---

## CELKOVÝ STAV vs. IMPLEMENTAČNÍ POŘADÍ MASTER PROMPTU (sekce 85)

| Etapa | Stav |
|---|---|
| 0 — Master audit | tahle aktualizace |
| 1 — Security | částečně (marketing granty opraveny, provoz TRUNCATE ne, security definer inventář ne) |
| 2 — App shell + design systém | ROZPRACOVÁNO (tokeny/komponenty/AppShell hotové, probíhá redesign navigace + obrazovek) |
| 3 — Dnes + Owner Attention Center | NEZAPOČATO |
| 4 — Provoz (login verify, směny, docházka, vzkazy, tasks) | ČÁSTEČNĚ (funkčně hotovo, redesign probíhá) |
| 5-14 | NEZAPOČATO |

**Doporučení:** pokračovat Etapou 2 (dokončit redesign navigace a zbylých
Provoz obrazovek), pak Etapa 3 (Dnes/Owner Attention Center — používat jen
reálná data, appka nemá zdroj pro tržby/počasí/hodnocení z mockupu Šéfíka).
Etapy 5+ (Finance rozšíření, Marketing dokončení, AI gateway, Gastro AI)
jsou samostatné, velké bloky práce — nezačínat je, dokud nejsou 2-4 hotové
a ověřené.
