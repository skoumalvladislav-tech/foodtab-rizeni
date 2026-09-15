"use client";

import { useId, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> & {
  label?: string;
  hint?: string;
  error?: string;
};

/** Textové pole se štítkem a volitelnou nápovědou/chybou. */
export default function Input({ label, hint, error, ...vstup }: Props) {
  const id = useId();
  return (
    <div className="ds-field">
      {label ? (
        <label className="ds-field-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className="ds-input"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-chyba` : hint ? `${id}-napoveda` : undefined}
        {...vstup}
      />
      {error ? (
        <span id={`${id}-chyba`} className="ds-field-error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-napoveda`} className="ds-field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
