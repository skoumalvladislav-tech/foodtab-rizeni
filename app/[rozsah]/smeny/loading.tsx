import Skeleton from "@/components/ui/Skeleton";

/**
 * Načítání rozpisu — kostra tvaru, který se za chvíli ukáže, ne
 * celostránkový spinner. Na telefonu je to pruh dnů a pár řádků lidí,
 * na počítači nadpis, řádek nástrojů a mřížka s pár řádky (stejná výška
 * jako ta skutečná, ať stránka při načtení neskáče).
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

      <div className="ds-sm-jen-desktop ds-smd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <Skeleton width="260px" height="30px" radius="8px" />
          <div style={{ display: "flex", gap: "8px" }}>
            <Skeleton width="150px" height="38px" radius="10px" />
            <Skeleton width="150px" height="38px" radius="10px" />
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
          <Skeleton width="190px" height="38px" radius="10px" />
          <Skeleton width="180px" height="38px" radius="10px" />
          <Skeleton width="250px" height="38px" radius="10px" />
        </div>
        <Skeleton height="44px" radius="12px" style={{ marginBottom: "10px" }} />
        <div style={{ flex: 1, display: "grid", gap: "6px", alignContent: "start" }}>
          <Skeleton height="46px" radius="10px" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} height="46px" radius="8px" />
          ))}
        </div>
      </div>
    </div>
  );
}
