"use client";

import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

type Varianta = "hlavni" | "vedlejsi" | "nebezpecne";
type Velikost = "vychozi" | "male";

type Spolecne = {
  children: ReactNode;
  varianta?: Varianta;
  velikost?: Velikost;
  ikona?: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
};

type Props =
  | (Spolecne & { href: string; target?: string; onClick?: undefined; type?: undefined })
  | (Spolecne & {
      href?: undefined;
      target?: undefined;
      onClick?: MouseEventHandler<HTMLButtonElement>;
      type?: "button" | "submit" | "reset";
    });

/**
 * Obal nad `.ft-tl` (app/globals.css) — appka má tenhle vzor tlačítek
 * hotový a barevně odladěný (viz komentář u `.ft-tl`), tahle komponenta
 * ho jen dává k dispozici typovaně, ať nový kód nepíše className ručně.
 * S `href` se vykreslí jako odkaz, jinak jako `<button>`.
 */
export default function Button(props: Props) {
  const { children, varianta = "vedlejsi", velikost = "vychozi", ikona, className, disabled, title } = props;

  const trida = [
    "ft-tl",
    varianta === "hlavni" ? "ft-tl-hlavni" : varianta === "nebezpecne" ? "ft-tl-nebezpecne" : "ft-tl-vedlejsi",
    velikost === "male" ? "ft-tl-male" : null,
    className,
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

  if (props.href) {
    return (
      <Link href={props.href} target={props.target} className={trida} title={title} aria-disabled={disabled || undefined}>
        {obsah}
      </Link>
    );
  }

  return (
    <button type={props.type ?? "button"} className={trida} title={title} disabled={disabled} onClick={props.onClick}>
      {obsah}
    </button>
  );
}
