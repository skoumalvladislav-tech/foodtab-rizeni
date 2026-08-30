import type { ReactNode } from "react";

/**
 * Hlavička obrazovky.
 *
 * Každá obrazovka má právě jeden h1 — svůj název. Nad ním stojí mosazný
 * nadpisek verzálkami („oči" podle předlohy), který říká, kam obrazovka
 * patří: modul, nebo Nastavení.
 *
 * Není to jen ozdoba. Bez h1 nemá odečítač obrazovky stránku podle čeho
 * členit a nevidomému uživateli splyne v jednu souvislou plochu. Oči
 * jsou proto <p>, ne nadpis — kdyby to byl h2, měla by stránka nadpis
 * nižší úrovně dřív než ten hlavní.
 *
 * Obal je <div>, ne <header>. Prohlížeč z <header> dělá orientační bod
 * „záhlaví stránky“ i uvnitř <main> a v seznamu odečítače by pak stála
 * dvě záhlaví — horní lišta a nadpis obrazovky — bez rozlišení, které
 * je které. Záhlaví stránky je jen to v ram.tsx.
 *
 * Podnadpisy uvnitř obrazovky jsou h2. Úrovně se nepřeskakují a nevybírají
 * se podle velikosti písma; velikost řeší CSS.
 */
export default function Nadpis({
  oci,
  popis,
  vpravo,
  children,
}: {
  /** Kam obrazovka patří: „Provoz", „Nastavení". */
  oci?: string;
  /** Věta pod nadpisem. */
  popis?: ReactNode;
  /** Ovládání, které patří k nadpisu — přepínač týdne a podobně. */
  vpravo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ft-hlava">
      <div>
        {oci ? <p className="ft-oci">{oci}</p> : null}
        <h1>{children}</h1>
        {popis ? <p className="ft-popis">{popis}</p> : null}
      </div>
      {vpravo ? <div className="ft-hlava-vpravo">{vpravo}</div> : null}
    </div>
  );
}
