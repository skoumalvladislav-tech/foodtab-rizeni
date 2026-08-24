# Foodtab

Interní systém pro řízení restaurací. Automatizuje denní rutinu provozu:
směny, docházku, úkoly, komunikaci, receptury a jídelní lístky. Později
přibude finance, marketing a nákup.

**Foodtab nenahrazuje pokladnu.** Storyous, Dotykačka a Choice QR jsou
vstupy, na které se aplikace napojuje, ne konkurenti.

## Jak to pustit

Potřebujete Node 22.13 nebo novější.

```bash
npm install
```

Zkopírujte `.env.example` jako `.env.local` a doplňte adresu projektu
Supabase a jeho veřejný (anon) klíč — obojí najdete v Supabase
v Project Settings → API.

```bash
npm run dev
```

Aplikace běží na http://localhost:3000. Přihlašuje se odkazem na e-mail,
heslo se nepoužívá.

Další příkazy: `npm run build` postaví produkční verzi, `npm start` ji
spustí, `npm run lint` prožene kód ESLintem.

## Kde co je

| Kde | Co |
|---|---|
| `docs/` | Zadání a rozhodnutí, ze kterých se staví |
| `supabase/` | Databáze — migrace, testy a [popis modelu](supabase/README.md) |
| `lib/authz.ts` | Jediné místo, kde se rozhoduje o přístupu |
| `app/` | Obrazovky |
| `CLAUDE.md` | Pravidla pro práci na projektu |

## Na co si dát pozor

Servisní klíč Supabase (`service_role`) obchází Row Level Security.
Patří výhradně na server a do prohlížeče se nesmí dostat nikdy.

O tom, kdo co uvidí, rozhoduje databáze — funkce `app.has_access()`
a politiky nad ní. Aplikace si pravidla nedopočítává sama, jinak by
se obě strany časem rozešly.
