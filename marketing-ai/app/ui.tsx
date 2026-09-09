import { STAVY_OBSAHU, STAVY_PUBLIKACE, STAVY_RENDERU } from "@/lib/domena/stavy";

export function Stav({ s }: { s: string }) {
  const d = STAVY_OBSAHU[s] ?? { label: s, tone: "" };
  return <span className={`stitek ${d.tone ? "stitek-" + d.tone : ""}`}>{d.label}</span>;
}

export function StavPublikace({ s }: { s: string }) {
  const d = STAVY_PUBLIKACE[s] ?? { label: s, tone: "" };
  return <span className={`stitek ${d.tone ? "stitek-" + d.tone : ""}`}>{d.label}</span>;
}

export function StavRenderu({ s }: { s: string }) {
  const d = STAVY_RENDERU[s] ?? { label: s, tone: "" };
  return <span className={`stitek ${d.tone ? "stitek-" + d.tone : ""}`}>{d.label}</span>;
}

/** Hláška z ?chyba= nebo ?ok= v adrese. */
export function Hlasky({ sp }: { sp: Record<string, string | undefined> }) {
  return (
    <>
      {sp.chyba && <div className="hlaska hlaska-bad" role="alert">{sp.chyba}</div>}
      {sp.ok && <div className="hlaska hlaska-dobre" role="status">{sp.ok}</div>}
      {sp.pozor && <div className="hlaska hlaska-pozor">{sp.pozor}</div>}
    </>
  );
}

export function kc(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `${Math.round(cents / 100)} Kč`;
}

/** Bezpečný text chyby pro adresu (bez tajemství, zkrácený). */
export function chybaDoAdresy(e: unknown): string {
  const msg = e instanceof Error ? e.message : "Neznámá chyba";
  return encodeURIComponent(msg.slice(0, 300));
}
