import type { ReactNode } from 'react'

/**
 * Rám modulu Finance (gastro ERP, 3. 10. 2026).
 *
 * ---------------------------------------------------------------------
 * ŽÁDNÉ KRESLENÍ
 *
 * Faktury uvnitř (`/finance/faktury`) mají VLASTNÍ vnořený layout
 * s vlastním levým sloupcem a spodní lištou (lib/faktury-navigace.ts).
 * Kdyby tenhle layout kreslil svůj `modul-ram` kolem něj, vnořily by se
 * dvě sady postranních sloupců do sebe. `<Navigace>` si proto každá
 * finanční obrazovka vykresluje sama (app/[rozsah]/finance/navigace.tsx).
 *
 * ---------------------------------------------------------------------
 * ŽÁDNÁ BRÁNA (N23, kontrola 19. 10. 2026)
 *
 * Do 19. 10. tu stála brána „Finance pobočky zatím jen s přehledem celé
 * firmy" s výjimkou pro Jiné platby podle adresy (hlavička
 * `x-foodtab-adresa`). Fungovala jen při přímém otevření adresy: sdílený
 * layout se při přechodu přes menu (next/link) znovu nevykreslí, takže
 * vedoucí, který přišel z Přehledu, zůstal v Jiných platbách na hlášce,
 * dokud stránku nenačetl znovu. A stránku stejně nezastavila — Next
 * vykreslí stránku vedle layoutu a pošle její data, i když ji layout
 * nevloží (kontrola 14. 10. 2026).
 *
 * Rozhoduje proto KAŽDÁ stránka sama, prvním řádkem a bez ohledu na to,
 * odkud člověk přišel:
 *   * obrazovky s daty pobočky — `zkusPristupFinanci` (lib/finance-pristup.ts),
 *     při `pobocka_bez_firmy` hláška `SdeleniPobockyBezFirmy`;
 *   * Nákup (jiné právo) — `pobockaBezPrehleduFirmy` hned za vstupem;
 *   * obrazovky jen pro firmu (Kontakty, Integrace, AI analytik, import
 *     výpisu, Faktury) — pobočku odmítnou samy (`jeRozsahFirmy`);
 *   * Jiné platby — vlastní vstup `zkusPristupJinymPlatbam`.
 * Hlídá scripts/finance-pobocky.test.mjs (každá stránka má bránu, tenhle
 * layout nerozhoduje vůbec — ani podle adresy, ani podle práv).
 */
export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
