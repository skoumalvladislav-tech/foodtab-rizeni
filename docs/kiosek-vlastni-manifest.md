# Zadání: kiosek potřebuje vlastní manifest

Nalezeno 3. 9. 2026 na tabletu za barem.

---

## Co se děje

Šéfík si na tabletu přidal kiosek na plochu. Ikona ale otevře
**přihlašovací obrazovku**, ne kiosek.

Příčina je v `app/manifest.ts` — je jediný a má:

```ts
start_url: "/",
scope: "/",
orientation: "portrait-primary",
display: "standalone",
```

Android se při „Přidat na plochu" **neřídí adresou, na které stojíš**,
ale `start_url` z manifestu. Takže ať se instaluje odkudkoli, ikona
vždycky skončí na kořeni aplikace.

## Co udělat

**Druhý manifest, jen pro kiosek**, odkázaný z té stránky.

- `start_url` i `scope` na **`/kiosek`**.
- **Jiné jméno a jiná ikona** — „Foodtab kiosek". Ty dvě ikony se
  octnou vedle sebe na téže ploše a nesmí jít splést; kdo otevře tu
  špatnou, stojí u baru nad přihlášením.
- **`display: "fullscreen"`**, ne `standalone`. Tablet stojí na baru
  celý den — adresní řádek tam nemá co dělat a bez něj se z kiosku
  hůř odchází jinam.
- **Orientaci nech volnou nebo na šířku.** Společný manifest vynucuje
  `portrait-primary`; Šéfíkův tablet stojí na šířku.

## Jak to ověřit

**Instalací naostro na tabletu s Androidem.** Ne ve vývojářských
nástrojích na počítači — tam se `start_url` chová jinak, než jak
dopadne WebAPK na Androidu.

Ověř tři věci: ikona otevře **rovnou kiosek**, otevře ho **na celou
obrazovku**, a **na šířku**.

## Mimochodem: zastaralé zkratky

`shortcuts` v tom manifestu míří na `/?modul=attendance`,
`/?modul=tasks` a `/?modul=communication`. To je adresování ze starého
prototypu; dnešní obrazovky jsou `/[rozsah]/dochazka` a spol.

Ověř, kam ty zkratky doopravdy vedou. Když jen na rozcestník, oprav je
nebo zruš — zkratka, která nefunguje, je horší než žádná.
