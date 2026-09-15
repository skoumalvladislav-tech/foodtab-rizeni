import type { ReactNode } from "react";

export type SloupecTabulky<T> = {
  klic: string;
  hlavicka: ReactNode;
  vykresli: (radek: T) => ReactNode;
  zarovnaniVpravo?: boolean;
  sirka?: string;
};

/**
 * Obecná tabulka — appka do teď měla ruční `<table>` v šesti různých
 * souborech (faktury, marketing, lidé, zálohy…), pokaždé zvlášť
 * stylovanou. Řádkový odkaz/klik řeší volající obalením `vykresli()`
 * do `<Link>` — tabulka sama žádnou navigaci nezná.
 */
export default function DataTable<T>({
  sloupce,
  radky,
  klicRadku,
  prazdno,
  zebra = false,
}: {
  sloupce: SloupecTabulky<T>[];
  radky: T[];
  klicRadku: (radek: T) => string;
  prazdno?: ReactNode;
  zebra?: boolean;
}) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table" data-zebra={zebra || undefined}>
        <thead>
          <tr>
            {sloupce.map((s) => (
              <th key={s.klic} data-align={s.zarovnaniVpravo ? "right" : undefined} style={{ width: s.sirka }}>
                {s.hlavicka}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {radky.map((r) => (
            <tr key={klicRadku(r)}>
              {sloupce.map((s) => (
                <td key={s.klic} data-align={s.zarovnaniVpravo ? "right" : undefined}>
                  {s.vykresli(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {radky.length === 0 ? <div className="ds-table-empty">{prazdno ?? "Žádná data."}</div> : null}
    </div>
  );
}
