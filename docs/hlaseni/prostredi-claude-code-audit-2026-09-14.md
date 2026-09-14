# Audit prostředí Claude Code — 14. 9. 2026

Cíl: menší spotřeba kontextu a rychlejší start relace, beze změny
aplikačního kódu, migrací nebo obchodní logiky. Jde o nástroje kolem
projektu, ne o samotný Foodtab.

## Skills — před a po

**Před:** `.claude/skills/` mělo čtyři skilly, všechny o databázových
scénářích a nasazení: `hlaseni` (formát hlášení), `migrace` (jak psát
migraci), `nasazeni` (kontrolní seznam před `db push`), `scenar` (jak
napsat kontrolu, co umí spadnout). Architektura appky, bezpečnost
grantů, marketing, finance, AI a workflow předávání práce neměly svůj
skill — všechno leželo jen v CLAUDE.md nebo v hlavách jednotlivých
`lib/` souborů.

**Po:** přidáno osm nových skillů, všechny zapsané do existujících
zdrojů (CLAUDE.md, kód, docs), žádný neobsahuje domyšlený obsah:
`foodtab-core` (multitenance, has_access, moduly, časové pásmo),
`foodtab-db-security` (RLS, SECURITY DEFINER, granty — doplňuje
`migrace`), `foodtab-marketing` (schéma, navigace, pipeline),
`foodtab-finance` (schválně tenký — modul skoro neexistuje, jen
odkazy a jasné „nedomýšlej"), `foodtab-ai` (pravidlo 8, tři režimy
klíčů, ochrana proti prompt injection), `foodtab-e2e` (mapa
`scripts/*.test.mjs` a `run.sh`, doplňuje `scenar`), `foodtab-release`
(větvení, proč nenasazuje CI, doplňuje `nasazeni`), `foodtab-handoff`
(jak napsat předávací dokument, podle reálného vzoru
`docs/hlaseni/navazujici-prompt.md`).

## MCP servery

**V repozitáři není žádný `.mcp.json`.** MCP servery pro tuhle relaci
jsou nastavené na úrovni klienta (mimo repo) — v nástrojích téhle
relace je vidět jen Supabase MCP (`mcp__431dc0f0…`), GitHub MCP ani
Playwright/browser MCP nastavené nejsou.

**Doporučení:** nezakládat `.mcp.json` preventivně. Repo-scoped
konfigurace dává smysl, až bude potřeba, aby MCP servery byly stejné
pro každého, kdo repozitář otevře (ne jen pro tuhle relaci) — dnes to
tak není a přidávat soubor bez jistoty, co má obsahovat, by jen
vytvořilo další věc k údržbě. Pokud se má něco doplnit, priorita je
GitHub MCP (chybí, práce s PR/issues jde dnes jen přes `gh` v shellu)
a Playwright/browser MCP (chybí, master audit ho žádá pro marketing
E2E — priorita P2).

## TypeScript LSP

**Nenastaveno.** `package.json` neobsahuje `typescript-language-server`
ani obdobný balíček, `.claude/settings.json` obsahuje jen `permissions`
(žádnou zmínku o LSP).

**Doporučení (bez zásahu — vyžaduje nastavení na úrovni Claude Code,
ne repozitáře):** doplnit `typescript-language-server` jako dev
závislost (`npm install -D typescript-language-server typescript`)
a napojit ho jako LSP server pro tenhle projekt v konfiguraci Claude
Code. Přínos: go-to-definition a find-references přímo přes protokol
LSP místo čtení celých souborů při hledání, kde se něco používá — u
projektu s `lib/marketing-*.ts` (20 souborů) a `app/[rozsah]/...` by
to ušetřilo dost kontextu při každém hledání volajících. Nezkoušel
jsem to instalovat ani zapojit — může to vyžadovat nastavení, které
nejde ověřit jen z repozitáře.

## Návrh zkrácení CLAUDE.md

Podrobný návrh: [`docs/hlaseni/claude-md-navrh-zkraceni-2026-09-14.md`](./claude-md-navrh-zkraceni-2026-09-14.md).
Krátce: CLAUDE.md (575 řádků) má zůstat u pravidel, která platí skoro
v každé relaci (multitenance, has_access, časové pásmo, co se
neporušuje), a ztratit dlouhá vyprávění o konkrétních nehodách
(Turbopack, sloupcové granty, TRUNCATE, dvě relace v repozitáři) —
ta se stěhují do nových skillů výše nebo do `docs/potize-vyvojoveho-serveru.md`,
s tím, že v CLAUDE.md zůstává vždy aspoň krátké pravidlo a odkaz.
Samotný CLAUDE.md nebyl upraven — čeká na Šéfíkovo rozhodnutí.
