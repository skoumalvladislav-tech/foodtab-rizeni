/**
 * Formulář nové šablony checklistu — jen vykreslení.
 *
 * Stejný tvar jako formulář „Zadat úkol“ na /ukoly (inline styly, ne
 * `pc-formular` třídy z Komunikace — je to sourozenec toho, ne vzkazů).
 * Nesahá do databáze, takže se dá vykreslit i v dočasném náhledu.
 */

const POCET_RADKU = 16;

export default function FormularSablony({
  akce,
  rozsah,
  useky,
  chyba,
}: {
  akce: (formData: FormData) => void | Promise<void>;
  rozsah: string;
  useky: { id: string; nazev: string }[];
  chyba?: string | null;
}) {
  return (
    <div>
      {chyba ? (
        <p role="alert" style={{ ...ramecekChyby, marginBottom: "16px" }}>
          {popisChyby(chyba)}
        </p>
      ) : null}

      <form action={akce}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="pocetRadku" value={POCET_RADKU} />

        <fieldset style={poleSkupina}>
          <legend style={popisek}>Základ</legend>

          <label style={{ display: "block", marginBottom: "10px" }}>
            <span style={radekPopisek}>Název</span>
            <input
              name="nazev"
              required
              placeholder="např. Otevírací checklist kuchyně"
              style={pole}
            />
          </label>

          <label style={{ display: "inline-block", marginRight: "10px", marginBottom: "10px" }}>
            <span style={radekPopisek}>Úsek</span>
            <select name="usek" defaultValue="" style={vyber}>
              <option value="">— bez úseku —</option>
              {useky.map((u) => (
                <option key={u.id} value={u.id}>{u.nazev}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "inline-block", marginBottom: "10px" }}>
            <span style={radekPopisek}>Kdy se dělá</span>
            <select name="rozvrh" defaultValue="opening" style={vyber}>
              <option value="opening">Otevírací</option>
              <option value="closing">Zavírací</option>
              <option value="haccp">HACCP</option>
              <option value="weekly">Týdenní</option>
            </select>
          </label>
        </fieldset>

        <fieldset style={poleSkupina}>
          <legend style={popisek}>
            Položky — vyplňte, co potřebujete, zbytek nechte prázdné
          </legend>

          <div style={{ display: "grid", gap: "10px" }}>
            {Array.from({ length: POCET_RADKU }, (_, i) => (
              <div key={i} style={radekPolozky}>
                <input
                  name={`polozka-${i}-nazev`}
                  placeholder={`Položka ${i + 1} — např. „Teplota lednice“`}
                  style={pole}
                />

                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                  <label style={volba}>
                    <input type="checkbox" name={`polozka-${i}-vyzaduje`} />
                    Chce hodnotu (ne jen odškrtnutí)
                  </label>

                  <select name={`polozka-${i}-typ`} defaultValue="number" style={{ ...vyber, minWidth: "120px" }}>
                    <option value="number">Číslo</option>
                    <option value="text">Text</option>
                    <option value="photo">Fotka</option>
                  </select>

                  <input
                    name={`polozka-${i}-jednotka`}
                    placeholder="jednotka, např. °C"
                    style={{ ...vyber, minWidth: "110px" }}
                  />
                  <input
                    name={`polozka-${i}-min`}
                    placeholder="min"
                    inputMode="decimal"
                    style={{ ...vyber, minWidth: "80px" }}
                  />
                  <input
                    name={`polozka-${i}-max`}
                    placeholder="max"
                    inputMode="decimal"
                    style={{ ...vyber, minWidth: "80px" }}
                  />
                </div>
              </div>
            ))}
          </div>

          <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: "var(--muted)" }}>
            „Fotka“ zatím jen položku vytvoří — nahrávání souborů do
            checklistu appka ještě neumí.
          </p>
        </fieldset>

        <button type="submit" className="ft-tl ft-tl-hlavni" style={{ width: "100%" }}>
          Vytvořit checklist
        </button>
      </form>
    </div>
  );
}

function popisChyby(kod: string): string {
  switch (kod) {
    case "nazev":
      return "Checklist potřebuje název.";
    case "nepovedlo":
      return "Checklist se nepodařilo založit. Zkuste to prosím znovu.";
    default:
      return "Něco se nepovedlo. Zkuste to prosím znovu.";
  }
}

const ramecekChyby = {
  background: "var(--bad-bg)",
  color: "var(--bad)",
  border: "1px solid var(--bad)",
  borderRadius: "var(--radius-md)",
  padding: "10px 12px",
  fontSize: "14px",
} as const;

const poleSkupina = {
  border: "none",
  padding: 0,
  margin: "0 0 20px",
} as const;

const popisek = {
  fontSize: "13px",
  color: "var(--muted)",
  padding: 0,
  marginBottom: "10px",
} as const;

const radekPopisek = {
  display: "block",
  fontSize: "13px",
  color: "var(--muted)",
  marginBottom: "4px",
} as const;

const volba = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "13.5px",
  color: "var(--ink)",
} as const;

const pole = {
  width: "100%",
  padding: "10px 12px",
  // 16 px schválně: iOS jinak při zaostření pole zoomuje celou stránku.
  fontSize: "16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line-2)",
  background: "var(--paper)",
  color: "var(--ink)",
  minHeight: "44px",
} as const;

const vyber = {
  ...pole,
  width: "auto",
} as const;

const radekPolozky = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-md)",
  padding: "10px",
  display: "grid",
  gap: "8px",
} as const;
