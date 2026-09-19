import Skeleton from "@/components/ui/Skeleton";

/**
 * Načítání docházky — kostra tvaru, který se za chvíli ukáže (čtyři
 * karty a seznam), ne celostránkový spinner. Stránka počítá provozní den
 * a čte několik dotazů, takže se chvíli čeká.
 */
export default function NacitaniDochazky() {
  return (
    <div className="ds-dh" aria-busy="true" aria-label="Načítám docházku">
      <Skeleton width="220px" height="34px" radius="8px" />
      <div className="ds-dh-karty">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height="104px" radius="14px" />
        ))}
      </div>
      <Skeleton height="260px" radius="14px" />
      <Skeleton height="200px" radius="14px" />
    </div>
  );
}
