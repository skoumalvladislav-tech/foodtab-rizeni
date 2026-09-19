import Skeleton from "@/components/ui/Skeleton";

/**
 * Načítání rozpisu — kostra tvaru, který se za chvíli ukáže, ne
 * celostránkový spinner. Na telefonu je to pruh dnů a pár řádků lidí,
 * na počítači blok mřížky.
 */
export default function NacitaniSmen() {
  return (
    <div aria-busy="true" aria-label="Načítám směny">
      <div className="ds-sm-jen-mobil">
        <div className="ds-sm">
          <Skeleton height="46px" radius="12px" />
          <Skeleton height="56px" radius="12px" />
          <Skeleton width="55%" height="24px" />
          <Skeleton width="30%" height="14px" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0" }}>
              <Skeleton width="40px" height="40px" radius="50%" style={{ flex: "none" }} />
              <div style={{ flex: 1, display: "grid", gap: "6px" }}>
                <Skeleton width="60%" height="15px" />
                <Skeleton width="35%" height="12px" />
              </div>
              <Skeleton width="104px" height="34px" radius="9px" style={{ flex: "none" }} />
            </div>
          ))}
        </div>
      </div>

      <div className="ds-sm-jen-desktop" style={{ padding: "16px" }}>
        <Skeleton height="48px" radius="12px" />
        <div style={{ height: "16px" }} />
        <Skeleton height="420px" radius="14px" />
      </div>
    </div>
  );
}
