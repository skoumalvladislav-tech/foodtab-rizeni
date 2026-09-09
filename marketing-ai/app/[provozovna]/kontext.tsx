/** Kontextový štítek: pro kterou provozovnu (a případně účet, síť a datum) obsah připravujeme. */
export function Kontext({ venue, extra }: { venue: { name: string }; extra?: string }) {
  return (
    <span className="kontext">
      <span className="venue-dot" aria-hidden /> {venue.name}
      {extra ? <span className="muted"> · {extra}</span> : null}
    </span>
  );
}
