"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Ikona from "@/app/[rozsah]/ikona";
import {
  KBELIK_FOTEK,
  cestaFotky,
  jeObrazek,
  jeTypFotky,
  ocistitNazev,
  typSouboru,
  zkontrolujFotkuPoZmenseni,
  zkontrolujFotky,
} from "@/lib/checklisty/fotky";
import { NEMENIT_DO_BAJTU, noveId, zmensitObrazek } from "@/lib/obrazky";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { pripojitFotku } from "./akce-fotky";

/**
 * Přidání fotky k položce checklistu (mockup: dlaždice „Přidat foto").
 *
 * SOUBOR JDE Z PROHLÍŽEČE PŘÍMO DO ÚLOŽIŠTĚ, ne přes Server Action (ta má
 * strop 1 MB, fotka z telefonu je větší). Nahrává se pod přihlášeným
 * člověkem — kdo smí kam, rozhoduje politika úložiště
 * (20260923110000_checklisty_mockup.sql), ne tenhle soubor. Pak se fotka
 * připojí přes pripojitFotku → public.pripojit_checklist_fotku, která
 * cestu, právo, stav běhu i strop ověří znovu.
 *
 * Fotka se zmenší (delší strana 2000 px, JPEG) — na mobilních datech
 * v kuchyni by originál nahrával dlouho a nikdo ho v plném rozlišení
 * nepotřebuje. Nepovede-li se zmenšení, jde originál, pokud vyhovuje.
 *
 * ČESTNĚ: bez spojení nahrání selže nahlas; do fronty neodeslaných se
 * fotky neukládají.
 */
export default function FotoNahrat({
  rozsah,
  tenantId,
  beh,
  polozka,
  uzMa,
  max,
}: {
  rozsah: string;
  tenantId: string;
  beh: string;
  polozka: string;
  uzMa: number;
  max: number;
}) {
  const router = useRouter();
  const vstup = useRef<HTMLInputElement>(null);
  const bezi = useRef(false);
  const [stav, setStav] = useState<"klid" | "nahrava">("klid");
  const [chyby, setChyby] = useState<string[]>([]);

  async function nahrat(seznam: FileList | null) {
    if (!seznam || seznam.length === 0 || bezi.current) return;
    bezi.current = true;
    setStav("nahrava");
    setChyby([]);
    const nove: string[] = [];
    let pripojeno = 0;

    try {
      const soubory = Array.from(seznam);
      const kontrola = zkontrolujFotky(
        soubory.map((s) => ({ name: s.name, type: s.type, size: s.size })),
        uzMa,
      );
      nove.push(...kontrola.chyby);
      const supabase = getBrowserSupabase();

      for (const i of kontrola.platne) {
        const s = soubory[i];
        const typ = typSouboru(s);
        let blob: Blob = s;
        let mime = typ;
        if (jeObrazek(typ) && (s.size > NEMENIT_DO_BAJTU || !jeTypFotky(typ))) {
          const zmenseny = await zmensitObrazek(s);
          if (zmenseny) {
            blob = zmenseny;
            mime = "image/jpeg";
          }
        }
        const problem = zkontrolujFotkuPoZmenseni(s.name, mime, blob.size);
        if (problem || !jeTypFotky(mime)) {
          nove.push(problem ?? `„${ocistitNazev(s.name)}“: tenhle typ fotky nejde použít.`);
          continue;
        }

        const cesta = cestaFotky(tenantId, beh, polozka, noveId(), mime);
        const { error } = await supabase.storage.from(KBELIK_FOTEK).upload(cesta, blob, {
          contentType: mime,
          upsert: false,
        });
        if (error) {
          nove.push(`„${ocistitNazev(s.name)}“ se nepodařilo nahrát: ${error.message}`);
          continue;
        }

        const vysledek = await pripojitFotku({
          rozsah,
          beh,
          polozka,
          cesta,
          nazev: mime === "image/jpeg" && typ !== "image/jpeg"
            ? `${ocistitNazev(s.name).replace(/\.[^.]*$/, "")}.jpg`
            : ocistitNazev(s.name),
          mime,
          velikost: blob.size,
        });
        if (vysledek.ok) pripojeno += 1;
        else nove.push(vysledek.chyba);
      }
    } catch {
      nove.push("Není spojení — zkuste to znovu, až se vrátí.");
    } finally {
      bezi.current = false;
      setStav("klid");
      setChyby(nove);
      if (vstup.current) vstup.current.value = "";
      if (pripojeno > 0) router.refresh();
    }
  }

  const plno = uzMa >= max;

  return (
    <>
      <input
        ref={vstup}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={(e) => void nahrat(e.target.files)}
      />
      <button
        type="button"
        className="ck-fotka-pridat"
        onClick={() => vstup.current?.click()}
        disabled={stav !== "klid" || plno}
        aria-describedby={chyby.length > 0 ? `ck-foto-chyby-${polozka}` : undefined}
      >
        <Ikona klic="fotka" />
        {stav === "nahrava" ? "Nahrává se…" : plno ? `Nejvýš ${max} fotek` : "Přidat foto"}
      </button>
      {chyby.length > 0 ? (
        <div id={`ck-foto-chyby-${polozka}`} role="alert" style={{ gridColumn: "1 / -1" }}>
          {chyby.map((c, i) => (
            <p key={i} className="hlaska-chyba" style={{ margin: "4px 0 0" }}>
              {c}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}
