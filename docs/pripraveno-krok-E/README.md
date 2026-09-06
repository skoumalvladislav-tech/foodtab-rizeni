# Krok E (kiosek) — hotový, ale nenasazený. Chybí jedno slovo.

**Tyhle dva soubory NEJSOU na svém místě schválně.** Nejsou to zbytky
rozdělané práce: jsou napsané, prohnané zkouškou a prošly. Leží tady,
protože je nemůžu zapojit, aniž bych sáhl na cizí scénář — a dnešní
zadání říká, že na `krok*_scenar.sql` mimo své vlastní sahat nemám.

Přesunout je zpátky je práce na dvě minuty a je popsaná níž.

---

## Co v nich je

| soubor | kam patří |
|---|---|
| `20260906050000_kiosek_zpravy.sql` | `supabase/migrations/` |
| `krok28_scenar.sql` | `supabase/tests/` |

Kiosek podle zadání, oddíl krok E:

- **Že zprávy jsou, ale ne jejich obsah.** `kiosk_zpravy_pocet(klic)`
  vrací JEDNO ČÍSLO — kolika lidem na té pobočce něco nepřečtené leží.
  Bez jmen a bez textu: tablet stojí na baru a chodí kolem něj hosté.
- **Obsah až po PINu.** `kiosk_zpravy_pinem(klic, pin)` vrátí zprávy
  toho, komu PIN sedl, a k tomu okamžik, kdy je má tablet zahodit.
- **Viditelný odpočet do odhlášení** (Jolt). Délka je nastavení firmy
  (`tenant_settings.kiosek_odhlaseni_s`), ne konstanta v kódu.

Sezení se schválně nezavádí — vysvětlení je v hlavičce migrace.

---

## Proč to tady leží

`supabase/tests/krok19_scenar.sql`, ř. 94–100, má tuhle kontrolu:

```sql
select pg_temp.check('žádný nový průzor kolem PINů nepřibyl',
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%pin%')
  = array['nastavit_pin', 'navrh_pinu', 'pichnout_pinem',
          'potvrdit_zalohu_pinem', 'pridelit_pin', 'zrusit_pin']);
```

Je to výčet povolených veřejných funkcí, jejichž jméno obsahuje `pin`,
a komentář nad ním říká proč:

> „Kdyby někdo přidal další veřejnou funkci kolem PINů, tahle kontrola
> spadne a bude se muset podívat, jestli náhodou nevrací PIN ven.“

**Ta kontrola je dobrá a zachovala se přesně tak, jak měla.**
`kiosk_zpravy_pinem` na `%pin%` sedí, takže krok19 spadl. Podíval jsem
se, co po mně chtěla: funkce PIN **bere a nevrací**, stejně jako
`pichnout_pinem` a `potvrdit_zalohu_pinem`, které ve výčtu jsou. Patří
tam tedy taky.

Jenže dopsat ji do toho výčtu znamená upravit `krok19_scenar.sql` —
a to je cizí soubor.

**Přejmenovat funkci tak, aby na `%pin%` nesedla, jsem odmítl.** Byla
by to obezlička kolem kontroly, ne její splnění: funkce by PIN brala
dál a příště by se na ni nikdo nepodíval. Kontrola, kterou jde obejít
přejmenováním, přestane hlídat cokoli.

---

## Jak to zapojit (dvě minuty)

```bash
git mv docs/pripraveno-krok-E/20260906050000_kiosek_zpravy.sql supabase/migrations/
git mv docs/pripraveno-krok-E/krok28_scenar.sql supabase/tests/
rmdir docs/pripraveno-krok-E   # zůstane tam ještě tenhle README, smazat
```

V `supabase/tests/krok19_scenar.sql` doplnit do výčtu jedno jméno
(pořadí je abecední, `kiosk_zpravy_pinem` jde na začátek):

```sql
  = array['kiosk_zpravy_pinem', 'nastavit_pin', 'navrh_pinu',
          'pichnout_pinem', 'potvrdit_zalohu_pinem', 'pridelit_pin',
          'zrusit_pin']);
```

V `supabase/tests/run.sh`, ř. 89, na konec seznamu `krok28_scenar`.

V `.github/workflows/databaze.yml` za kontrolu kroku 27:

```yaml
          grep -qE '^[[:space:]]*== KROK 28 HOTOV[[:space:]=]*$' vystup.txt \
            || { echo "CHYBÍ hláška: KROK 28"; chybi=1; }
```

Pak `supabase/tests/run.sh`. U mě (PGlite) krok28 prošel 22 kontrolami.

---

## Co k tomu ještě chybí

**Obrazovka kiosku se needitovala vůbec.** `app/kiosek/kiosek.tsx`
zatím o zprávách neví — tyhle dva soubory jsou jen databázová část.
Odpočet, který má podle Joltu běžet v rohu, se musí dokreslit tam;
podklad k tomu je v `docs/` u kroku E a vzorec pro časovač je
v `kiosek.tsx` u `useEffect` s `nacti`.

Doporučené pořadí: nejdřív zapojit tyhle dva soubory a nasadit, teprve
pak obrazovku. Databázová část se dá nasadit sama a nic nerozbije —
dokud ji nikdo nevolá, jen leží.
