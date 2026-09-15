"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Varianta = "hlavni" | "vedlejsi" | "nebezpecne";
type Velikost = "vychozi" | "male";

type Spolecne = {
  children: ReactNode;
  varianta?: Varianta;
  velikost?: Velikost;
  ikona?: ReactNode;
  className?: string;
};

type OdkazProps = Spolecne &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { href: string };

type TlacitkoProps = Spolecne &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { href?: undefined };

type Props = OdkazProps | TlacitkoProps;

/**
 * Obal nad `.ft-tl` (app/globals.css) — appka má tenhle vzor tlačítek
 * hotový a barevně odladěný (viz komentář u `.ft-tl`), tahle komponenta
 * ho jen dává k dispozici typovaně, ať nový kód nepíše className ručně.
 * S `href` se vykreslí jako odkaz, jinak jako `<button>`. Zbylé atributy
 * (`aria-*`, `id`, `onClick`, `aria-pressed`…) se předávají beze změny —
 * appka jich používá hodně (přepínače pohledu, šipky s aria-label).
 */
export default function Button({ children, varianta = "vedlejsi", velikost = "vychozi", ikona, ...zbytek }: Props) {
  const trida = [
    "ft-tl",
    varianta === "hlavni" ? "ft-tl-hlavni" : varianta === "nebezpecne" ? "ft-tl-nebezpecne" : "ft-tl-vedlejsi",
    velikost === "male" ? "ft-tl-male" : null,
    zbytek.className,
  ]
    .filter(Boolean)
    .join(" ");

  const obsah = (
    <>
      {ikona ? (
        <span className="ds-button-ikona" aria-hidden="true">
          {ikona}
        </span>
      ) : null}
      {children}
    </>
  );

  if (zbytek.href) {
    // href odlišuje odkaz od tlačítka (viz Props výš) — zbytek atributů
    // (target, aria-*…) se předává beze změny, jen href/className jdou
    // zvlášť, ať je className vždycky trida, ne to, co pošle volající.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { href, className: _tridaVolajiciho, ...rest } = zbytek as OdkazProps;
    return (
      <Link href={href} className={trida} {...rest}>
        {obsah}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { href: _neniOdkaz, className: _tridaVolajiciho, ...rest } = zbytek as TlacitkoProps;
  return (
    <button type="button" className={trida} {...rest}>
      {obsah}
    </button>
  );
}
