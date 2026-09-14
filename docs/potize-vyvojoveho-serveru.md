# Potíže vývojového serveru (Turbopack) — jak je poznat a spravit

Přesunuto z `CLAUDE.md` (návrh zkrácení, `docs/hlaseni/claude-md-navrh-zkraceni-2026-09-14.md`).
Dvě opakující se poruchy `npm run dev` na Windows/Turbopacku, obě
stály desítky minut hledání neexistující chyby v kódu, než se přišlo
na to, že chyba je ve vývojovém serveru.

## Zaseknutý stylopis v Turbopacku

Když se změna v CSS neprojeví, ale na disku je správně, drží Turbopack
starý přeložený stylopis. Pozná se to tak, že se obsah souboru liší
od toho, co posílá server. Spraví to dotčení `globals.css` nebo
smazání `.next/dev`. Stalo se to už třikrát, pokaždé to stálo desítky
minut hledání neexistující chyby:

- **tři vzhledy tlačítek** — v souboru `border-color: var(--mosaz)`, ze
  serveru chodilo `border-color: #0000`, takže hlavní tlačítko nemělo
  obrys a vypadalo to jako chyba ve specificitě
- **zlom 1360 px** — moduly se nesklápěly do vlastního pruhu, protože
  v odeslaném CSS ten `@media` blok vůbec nebyl
- **zlom 960 px** — totéž u přepínače poboček

Ověřit se to dá takhle: v konzoli prohlížeče se stáhne odeslaný
stylopis a hledá se v něm pravidlo, které má být v souboru.

```js
for (const l of document.querySelectorAll('link[rel=stylesheet]'))
  console.log(l.href, (await fetch(l.href).then(r => r.text())).includes('max-width: 960px'))
```

## Zaseknutý Turbopack umí i 404

Počtvrté, a jinak než předtím: neumí jen držet starý stylopis, **umí
přestat obsluhovat celou větev adres**.

Příznak z 1. 9. 2026 — `/[rozsah]/nastaveni/lide`, `/pobocky`, `/pozice`
i `/role` vracely **404**, zatímco `/dochazka`, `/smeny`, `/upozorneni`
a `/moje-udaje` na téže úrovni odpovídaly 200. Soubory na disku byly
v pořádku, importy taky, nikde v kódu není jediné `notFound()`.
**Smazání `.next` nepomohlo.** Stálo to hodinu.

Rozhodlo tohle:

```bash
npm.cmd run build
```

Build vypsal seznam adres a všechny čtyři v něm byly — takže chyba
nebyla v kódu. A protože build přepsal celý obsah `.next`, po dalším
`npm.cmd run dev` už obrazovky chodily.

**Pravidlo: když stránka vrací 404 a soubor přitom existuje, nehledej
chybu v kódu.** Nejdřív `npm.cmd run build` — vypíše seznam adres a tím
oddělí chybu v kódu od zaseknutého vývojového serveru.

## PowerShell na Windows

V PowerShellu se musí psát `npm.cmd` a `npx.cmd`. Verze `.ps1`
neprojdou přes zákaz spouštění skriptů.

*(Tenhle poslední bod zůstává i v CLAUDE.md — je tak krátký a tak
časté ho potřebovat, že přesun by nic neušetřil. Duplicita je tu
záměrná, ne přehlédnutí.)*
