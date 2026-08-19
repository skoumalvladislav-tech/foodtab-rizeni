# CLAUDE.md

Pravidla pro práci na tomto repozitáři.

## O aplikaci

- Aplikace je interní systém společnosti **Foodtab s.r.o.**
- Pobočky: **Restaurace Černá Perla** a **Bernard Bar Tábor**.
- Zachovej současnou architekturu **React / TypeScript / Vinext**. Nezaváděj alternativní framework ani nenahrazuj stávající stack bez výslovného souhlasu.

## Supabase

- Databáze a autentizace používají **Supabase**.
- Nikdy nevkládej **service-role klíč** ani jiné tajné údaje (API klíče, hesla, tokeny) do zdrojového kódu, konfigurací ani commitů. Tajné údaje patří pouze do proměnných prostředí mimo repozitář.
- Zachovej **Row-Level Security (RLS)** na všech tabulkách — nevypínej ji a neobcházej ji.
- Před jakoukoliv změnou databázového schématu vytvoř novou **Supabase migraci** (`supabase/migrations/`). Neupravuj existující migrace, které už byly aplikovány.

## Workflow a větve

- Nikdy nepracuj přímo ve větvi `main`.
- Pro každou změnu vytvoř samostatnou větev a otevři **pull request**.
- Pull request nikdy automaticky nemerguj — vždy čeká na review.

## Ověřování změn

Před commitem/otevřením PR ověř každou změnu:

```bash
npm run lint
npm test
git diff --check
```

## Bezpečnost dat

- Nemaž existující funkce ani data bez výslovného souhlasu uživatele.
