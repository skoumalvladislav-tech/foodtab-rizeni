import { barvaNeboNic, NAZVY_BAREV_LIDI } from '@/lib/barvy-lidi'

/**
 * Barevná značka člověka v rozpisu.
 *
 * ---------------------------------------------------------------------
 * ČTVEREČEK, NE KOLEČKO — A NE PLOCHA
 *
 * Pobočka se v rozpisu kreslí jako PLOCHA: pruh směny má výplň
 * `--branch-soft` a rámeček `--branch`. Kdyby měl člověk taky plochu,
 * splynulo by to — a dnes mají obě pobočky tutéž Růžovou, takže rozdíl
 * odstínu by nepomohl. Člověk je proto čtvereček a úzký proužek na
 * hraně pruhu; jiná proměnná (`--osoba`) a jiný tvar.
 *
 * Kolečko používá výběr barvy pobočky v nastavení. Čtvereček se s ním
 * neplete ani na obrazovce, kde by se potkaly.
 *
 * ---------------------------------------------------------------------
 * BARVA NIKDY NESTOJÍ SAMA
 *
 * Značka je `aria-hidden` a název barvy jde do textu pro odečítač.
 * Kdo odstíny nerozliší, přečte si jméno vedle — to je v rozpisu
 * napsané vždycky. Barva je pomůcka pro rychlé přehlédnutí, ne nositel
 * informace.
 *
 * Bez barvy se kreslí PRÁZDNÝ čtvereček s obrysem, ne nic. Chybějící
 * značka by posunula jméno o kus vedle a vypadala by jako chyba
 * vykreslení; prázdný obrys říká „tenhle člověk barvu nemá“.
 */
export default function ZnackaOsoby({
  barva,
  velikost = 10,
}: {
  barva: string | null | undefined
  /** Hrana čtverečku v pixelech. */
  velikost?: number
}) {
  const klic = barvaNeboNic(barva)
  const nazev = klic ? NAZVY_BAREV_LIDI[klic] : 'bez barvy'

  return (
    <>
      <span
        aria-hidden="true"
        data-osoba={klic ?? undefined}
        title={nazev}
        style={{
          display: 'inline-block',
          width: `${velikost}px`,
          height: `${velikost}px`,
          borderRadius: '3px',
          flex: 'none',
          background: klic ? 'var(--osoba)' : 'transparent',
          border: klic ? '1px solid var(--osoba)' : '1px solid var(--line-2)',
        }}
      />
      {/* Jen pro odečítač. Vidoucí má vedle jméno i čtvereček. */}
      <span className="ft-jen-pro-odecitac">{nazev}</span>
    </>
  )
}
