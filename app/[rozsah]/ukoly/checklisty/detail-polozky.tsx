import Link from "next/link";

import { MAX_FOTEK } from "@/lib/checklisty/fotky";
import { hodinaVPasmu } from "@/lib/cas";
import Ikona from "../../ikona";
import { ulozitPolozku } from "./akce";
import type { Detail, SouvisejiciUkol } from "./data";
import FotoNahrat from "./foto-nahrat";
import { Avatar } from "./prvky";
import { hodnotaText, mezeText, type PolozkaBehu } from "./spolecne";

/**
 * Detail jedné položky (mockup: obrazovka 3 na telefonu, třetí sloupec
 * na počítači) — Instrukce, Fotografie, hodnota, stav a Poznámka.
 *
 * Jeden formulář, jedno „Uložit změny“: stav se volí přepínačem
 * (Splněno / Zatím nesplněno / Nelze splnit), ne třemi tlačítky, ať se
 * poznámka nikdy neztratí jen proto, že člověk klikl na jiné tlačítko.
 * Funguje bez JavaScriptu; jen nahrávání fotek skript potřebuje.
 */
export default function DetailPolozky({
  rozsah,
  tenantId,
  detail,
  polozka: p,
  jmena,
  zona,
  zpet,
  zavrit,
  ukolyPolozky,
  smiSpravovat,
  chyba,
}: {
  rozsah: string;
  tenantId: string;
  detail: Detail;
  polozka: PolozkaBehu;
  jmena: Map<string, string>;
  zona: string;
  zpet: string;
  zavrit: string;
  ukolyPolozky: SouvisejiciUkol[];
  smiSpravovat: boolean;
  chyba: string | null;
}) {
  const b = detail.beh;
  const otevreny = b.status === "open";
  const z = detail.zaznamy.get(p.id);
  const stav = z?.checked ? "splneno" : z?.nelze_splnit ? "nelze" : "otevrene";
  const fotky = detail.fotky.get(p.id) ?? [];
  const kdo = z?.employee_id ? (jmena.get(z.employee_id) ?? "kdosi") : null;
  const jeFotka = p.requires_value && p.value_type === "photo";
  const chceHodnotu = p.requires_value && (p.value_type === "number" || p.value_type === "text");
  // Otevřenou položku člověk otvírá nejčastěji proto, aby ji splnil.
  const vychoziRezim = stav === "otevrene" ? "splnit" : stav === "splneno" ? "splnit" : "nelze";
  const bezMigrace = !detail.plne;

  return (
    <section className="ds-plocha ck-detail-polozky" aria-labelledby="ck-nazev-polozky">
      <div className="ck-hlava">
        <Link href={zavrit} className="ck-zpet" aria-label="Zpět na checklist">
          <Ikona klic="sipkaVlevo" />
        </Link>
        <h2 id="ck-nazev-polozky">{p.label}</h2>
        {p.povinna ? <span className="ck-povinne">Povinné</span> : null}
        <Link href={zavrit} className="ck-zavrit" aria-label="Zavřít položku">
          <Ikona klic="zavrit" />
        </Link>
      </div>

      {stav !== "otevrene" ? (
        <p className="ck-polozka-kdo" style={{ margin: 0 }}>
          {kdo ? <Avatar jmeno={kdo} velikost="male" /> : null}
          {stav === "splneno" ? "Splněno" : "Nelze splnit"}
          {kdo ? ` · ${kdo}` : ""}
          {z?.recorded_at ? ` · ${hodinaVPasmu(z.recorded_at, zona)}` : ""}
        </p>
      ) : null}

      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {chyba}
        </p>
      ) : null}

      {ukolyPolozky.map((u) => (
        <div key={u.id} className="ck-problem-nahlasen">
          <Ikona klic="vykricnik" />
          <p>
            Problém nahlášen —{" "}
            <Link href={`/${rozsah}/ukoly/ukol/${u.id}`}>Úkol: {u.nazev}</Link>
            {u.stav === "done" ? " (hotovo)" : u.stav === "cancelled" ? " (zrušeno)" : ""}
          </p>
        </div>
      ))}

      {p.instructions ? (
        <div className="ck-instrukce">
          <h3>Instrukce</h3>
          <p>{p.instructions}</p>
        </div>
      ) : null}

      {detail.fotkyDostupne && (jeFotka || fotky.length > 0 || otevreny) ? (
        <div>
          <h3>Fotografie{jeFotka ? " (min. 1)" : ""}</h3>
          <div className="ck-fotky">
            {fotky.map((f) =>
              f.url ? (
                <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" title={f.nazev}>
                  {/* Podepsaný odkaz z privátního kbelíku — next/image by ho cachoval déle, než platí. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={`Fotka k položce ${p.label}${f.employeeId ? ` — ${jmena.get(f.employeeId) ?? ""}` : ""}`} />
                </a>
              ) : (
                <span key={f.id} className="ck-fotka-pridat" aria-label="Fotku se nepodařilo načíst">
                  <Ikona klic="fotka" />
                </span>
              ),
            )}
            {otevreny ? (
              <FotoNahrat
                rozsah={rozsah}
                tenantId={tenantId}
                beh={b.id}
                polozka={p.id}
                uzMa={fotky.length}
                max={MAX_FOTEK}
              />
            ) : null}
          </div>
        </div>
      ) : jeFotka && !detail.fotkyDostupne ? (
        <p className="pc-poznamka-navrhu" style={{ margin: 0 }}>
          Položka chce fotku. Nahrávání fotek bude dostupné po nasazení databáze.
        </p>
      ) : null}

      {otevreny ? (
        <form action={ulozitPolozku} className="ck-formular-polozky">
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="beh" value={b.id} />
          <input type="hidden" name="polozka" value={p.id} />
          {z ? <input type="hidden" name="verze" value={z.verze} /> : null}
          <input type="hidden" name="zpet" value={zpet} />

          {chceHodnotu ? (
            <label>
              <span style={{ display: "block", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>
                {p.value_type === "number" ? `Hodnota${p.value_unit ? ` (${p.value_unit})` : ""}` : "Hodnota"}
              </span>
              <input
                type="text"
                name="hodnota"
                inputMode={p.value_type === "number" ? "decimal" : "text"}
                defaultValue={z?.value_number !== null && z?.value_number !== undefined ? String(z.value_number).replace(".", ",") : (z?.value_text ?? "")}
                placeholder={p.value_type === "number" ? mezeText(p) || "číslo" : "Zapište hodnotu"}
                maxLength={p.value_type === "number" ? 20 : 500}
              />
              {p.value_type === "number" && (p.min_value !== null || p.max_value !== null) ? (
                <p className="ck-meze">Povoleno {mezeText(p)}. Hodnota mimo rozsah se neuloží — nahlaste problém.</p>
              ) : null}
            </label>
          ) : null}

          {bezMigrace ? (
            <input type="hidden" name="rezim" value="splnit" />
          ) : (
            <fieldset>
              <legend>Stav</legend>
              <label className="ck-volba">
                <input type="radio" name="rezim" value="splnit" defaultChecked={vychoziRezim === "splnit"} />
                Označit jako splněno
              </label>
              <label className="ck-volba">
                <input type="radio" name="rezim" value="vratit" defaultChecked={false} />
                {stav === "otevrene" ? "Zatím nesplněno — jen uložit poznámku" : "Vrátit jako nesplněné"}
              </label>
              <label className="ck-volba">
                <input type="radio" name="rezim" value="nelze" defaultChecked={vychoziRezim === "nelze"} />
                Nelze splnit
              </label>
              <label>
                <span style={{ display: "block", fontSize: "13px", color: "var(--muted)", margin: "6px 0 4px" }}>
                  Důvod (jen u „Nelze splnit“)
                </span>
                <textarea
                  name="duvod"
                  maxLength={500}
                  defaultValue={z?.nelze_splnit_duvod ?? ""}
                  placeholder="Např. Zámek na zahrádce je poškozený, nejde zamknout."
                />
              </label>
            </fieldset>
          )}

          {bezMigrace ? null : (
            <label>
              <span style={{ display: "block", fontSize: "14px", fontWeight: 600, marginBottom: "6px" }}>Poznámka</span>
              <textarea name="poznamka" maxLength={500} defaultValue={z?.note ?? ""} placeholder="Např. V pravém WC chybí toaletní papír." />
              <p className="ck-pocitadlo">nejvýš 500 znaků</p>
            </label>
          )}

          <button type="submit" className="ft-tl ft-tl-hlavni">
            Uložit změny
          </button>
        </form>
      ) : (
        <div className="ck-formular-polozky">
          {hodnotaText(p, z) ? (
            <p style={{ margin: 0 }}>
              <strong>Hodnota:</strong> {hodnotaText(p, z)}
            </p>
          ) : null}
          {z?.nelze_splnit_duvod ? (
            <p style={{ margin: 0 }}>
              <strong>Důvod:</strong> {z.nelze_splnit_duvod}
            </p>
          ) : null}
          {z?.note ? (
            <p style={{ margin: 0 }}>
              <strong>Poznámka:</strong> {z.note}
            </p>
          ) : null}
          {!hodnotaText(p, z) && !z?.nelze_splnit_duvod && !z?.note ? (
            <p className="pc-prazdno">Bez hodnoty a poznámky.</p>
          ) : null}
        </div>
      )}

      {otevreny && smiSpravovat ? (
        <Link href={`/${rozsah}/ukoly/checklisty/${b.id}/problem?polozka=${p.id}`} className="ft-tl ft-tl-vedlejsi">
          <Ikona klic="vykricnik" /> Nahlásit problém → úkol
        </Link>
      ) : null}
    </section>
  );
}
