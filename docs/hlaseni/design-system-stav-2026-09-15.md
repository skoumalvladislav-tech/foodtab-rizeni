# Design systém FoodTab — stav k 15. 9. 2026 (večer)

Zadání Šéfíka: sjednotit FoodTab do moderního hospitality SaaS vzhledu,
připravit pevný základ, teprve pak postupně převádět obrazovky.
Business logika, RLS, permissions a workflow se v téhle etapě neměnily.

## Co bylo hotové už předtím (nezakládalo se od nuly)

Audit před prací zjistil, že appka MĚLA solidní základ, ne prázdné
místo:

- `app/_tokeny.css` — barevné tokeny, dvojí (media+explicitní) dark mode,
  9 barev poboček ověřených kontrastem WCAG i ΔE2000 (`scripts/barvy.js`)
- `Nadpis` (`app/[rozsah]/nadpis.tsx`) — sdílená hlavička stránky, ~50 užití
- `Sdeleni` (`app/sdeleni.tsx`) — sdílený empty/error/no-access stav, ~50 užití
- `.ft-tl*` tlačítka, `.ft-hlava` — hotová, odladěná, token-driven CSS
- Mosaz (jantár/zlatá) jako hlavní akcent a `--dobre` (zelená) jen pro
  success — **už seděly přesně podle zadání**, nebylo co měnit

Problém nebyl v základu, ale v tom, že **karty, tabulky, štítky, vstupy,
dialogy, skeletony a toasty appka vůbec neměla jako sdílené komponenty**
— každá obrazovka je psala znovu inline (např. identický `const karta`
duplikovaný v `marketing/page.tsx` i `finance/faktury/page.tsx`).
`app/dashboard.tsx` (148 KB) je mrtvý, odpojený kód ze starší (indigo)
palety — nepoužit jako základ, jen zůstává jako varování před dalším
takovým souborem.

## Co je hotové v téhle etapě

### 1. Tokeny (`app/_tokeny.css`) — doplněno, nepřepsáno

- Škála zaoblení: `--radius-sm` (8px), `--radius-md` (12px),
  `--radius-lg` (14px), `--radius-full`
- Druhý a třetí stupeň stínu: `--shadow-sm`, `--shadow-lg` (`--shadow`
  zůstává střední, jak appka zná)
- **Vínová/burgundy sekundární akcent**: `--vino`/`-sv`/`-ink`/`-soft`,
  stejným duálním light/dark vzorem jako zbytek souboru. Ověřeno:
  - kontrast 8.15–9.63:1 na `--paper`/`--card` v obou režimech (cíl 4.5)
  - ΔE2000 ≥ 20 od `--bad`, `--pozor`, `--mosaz` (cíl appky 14–15) —
    nezaměnitelná se stávajícími barvami

### 2. Sdílená knihovna komponent (`components/ui/`, 17 kusů)

`Badge`, `Button` (obal nad `.ft-tl`, nezavádí nový systém), `Card`,
`Avatar`, `Input`, `Tabs`, `EmptyState`/`ErrorState` (vedle `Sdeleni`
pro místa uvnitř obsahu s akcí, ne místo něj), `Skeleton`,
`StatusIndicator`, `MetricCard`, `ActionCard`, `DropdownMenu` (stejný
`<details>` vzor jako `prepinac-rozsahu.tsx`), `Dialog`, `Drawer`,
`Toast` + `ToastProvider` (zapojen v `app/layout.tsx`), `DataTable`.

Žádný nový balíček — čistý React + existující tokeny. Nová CSS jen tam,
kde inline styl nestačí (`:hover`, `:focus-visible`, animace, portály)
— `app/_komponenty.css`, třídy `.ds-*`, ať se nepletou s `.ft-*`
(rám appky — ten se podle `docs/vzhled-zadani.md` PŘEBARVUJE, ne
přejmenovává, a nesahalo se na něj).

### 3. AppShell — priorita č. 1, hotovo a živě ověřeno

`app/[rozsah]/ram.tsx` (jeden soubor) rozdělen na pojmenované kusy:

- `components/shell/AppShell.tsx` — stav a odvozená logika
- `components/shell/GlobalTopbar.tsx`
- `components/shell/ModuleSidebar.tsx`
- `components/shell/MobileBottomNav.tsx`

**Chování beze změny** — žádná logika se nepřepisovala, jen se
rozdělil jeden soubor. `ram.tsx` smazán (žádný druhý mrtvý soubor
vedle `dashboard.tsx`). `app/[rozsah]/layout.tsx` upraven o jeden
import a dva výskyty jména komponenty, nic víc.

**Vedlejší nález a oprava:** cestou se objevila skutečná hydratační
chyba v novém `Toast` portálu — `typeof document` se na klientu liší
od serveru už od úplně prvního (hydratačního) vykreslení, ne až po
efektu, takže podmíněné vykreslení portálu podle něj rozbíjí hydrataci.
Opraveno na standardní `mounted`-stav vzor (`useState(false)` +
`useEffect`), který dopadne stejně na serveru i při hydrataci. Vyvolalo
to následně false-positive `react-hooks/set-state-in-effect` (pravidlo
nerozezná tenhle legitimní SSR vzor od skutečného zbytečného efektu) —
zdůvodněno komentářem a `eslint-disable-next-line`, stejným vzorem jako
existující výjimky pro `@next/next/no-img-element` jinde v appce.

### 4. Dnes — lehký průchod (obrazovka byla už funkčně hotová)

`karta`/`radek` duplikované style objekty nahrazeny sdíleným `Card`.
Oprava: zpráva „Příchod zapsán" používala neutrální barvy místo
`--dobre` (zelená) — opraveno, teď odpovídá zadání „zelená jen pro
success".

## Co zbývá z prioritního seznamu

Nedotčeno v téhle etapě (žádná z nich není rozbitá, jen zatím
nevyužívá novou knihovnu): **Rozpis směn, Docházka, Vzkazy, Úkoly a
checklisty, Lidé, Finance (shell), Marketing (shell), ostatní moduly**.
Doporučené pořadí zůstává podle zadání Šéfíka.

Mimo prioritní seznam, nalezeno a vědomě NEudělaso teď (příliš by to
nafouklo tuhle změnu) — založena samostatná navazující úloha:
**tři nezávislé ruční implementace modálního okna**
(`smeny/formular-smeny.tsx`, `ceka-na-opravneni.tsx`,
`pwa-registration.tsx`) čekají na přechod na sdílený `Dialog`/`Drawer`.

## Ověření

- `tsc --noEmit` — čisté
- `eslint` na všem změněném — čisté (po opravě Toast.tsx)
- Node testy: **žádná nová regrese** — všech 13 předexistujících
  selhání (`scripts/*.test.mjs`, zastaralá mock infrastruktura
  `scripts/vykreslit.mjs`, nesouvisí s designem) potvrzeno identických
  i se změnami stashnutými, tedy prokazatelně nezpůsobených touhle prací
- Živě v prohlížeči (`claude-in-chrome`, desktop + mobil): AppShell,
  Dnes, Rozpis směn, Finance/Faktury (reálná data, 1741+1138 faktur),
  Marketing — bez chyby, bez regrese, bez ztráty oprávnění
- Vizuální smoke test bez nálezu mimo výše popsanou hydratační chybu
  (nalezenou a opravenou v rámci téhle etapy)

## Doporučený další krok

Pokračovat obrazovka po obrazovce v pořadí ze zadání (Rozpis směn →
Docházka → Vzkazy → Úkoly → Lidé → Finance → Marketing shell →
ostatní), aplikovat `Card`/`DataTable`/`Badge`/`EmptyState`/`Skeleton`
tam, kde nahradí duplikovaný inline kód, a po každé obrazovce ověřit
desktop+mobil stejně jako u AppShellu a Dnes.
