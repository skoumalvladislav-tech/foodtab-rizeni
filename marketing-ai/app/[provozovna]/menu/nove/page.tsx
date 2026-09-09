import { dnes, nejblizsiSobota, posunDne } from "@/lib/cas";
import { nacistKontext } from "@/lib/authz";

import { Hlasky } from "../../../ui";
import { Kontext } from "../../kontext";
import { importAkce, rucniAkce } from "../akce";

export const dynamic = "force-dynamic";

export default async function NoveMenu({ params, searchParams }: { params: Promise<{ provozovna: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { provozovna } = await params;
  const sp = await searchParams;
  const k = await nacistKontext(provozovna);
  const v = k.venue!;
  const zp = sp.zpusob ?? "rucne";
  const sobota = nejblizsiSobota(k.tz);
  return (
    <>
      <div className="hlavicka"><div><Kontext venue={v} /><h1 style={{ marginTop: 8 }}>Nové menu</h1><p>Čtyři způsoby. Rozpoznaná data vždy zkontrolujete a potvrdíte, než se použijí.</p></div></div>
      <Hlasky sp={sp} />
      <div className="zalozky">
        {[["rucne", "Ruční formulář"], ["text", "Vložit text"], ["foto", "Fotografie / screenshot"], ["pdf", "PDF"]].map(([kk, l]) => <a key={kk} className={zp === kk ? "on" : ""} href={`/${v.slug}/menu/nove?zpusob=${kk}`}>{l}</a>)}
      </div>

      {zp === "rucne" && (
        <form action={rucniAkce} className="karta">
          <input type="hidden" name="slug" value={v.slug} />
          <div className="radek radek-3">
            <div className="pole"><label htmlFor="kind">Druh</label><select id="kind" name="kind" defaultValue="daily"><option value="daily">Denní</option><option value="weekly">Týdenní</option><option value="weekend">Víkendové</option><option value="lunch3">Polední tříchodové</option><option value="special">Speciál</option><option value="seasonal">Sezonní</option><option value="drinks">Nápojové</option><option value="dessert">Dezerty</option></select></div>
            <div className="pole"><label htmlFor="title">Název</label><input id="title" name="title" placeholder="např. Denní menu" /></div>
            <div className="pole"><label htmlFor="valid_from">Platí od</label><input id="valid_from" name="valid_from" type="date" defaultValue={dnes(k.tz)} required /></div>
            <div className="pole"><label htmlFor="valid_to">Platí do</label><input id="valid_to" name="valid_to" type="date" defaultValue={dnes(k.tz)} /></div>
          </div>
          <h3>Položky</h3>
          <p className="faint">Cena v Kč, alergeny čísly oddělenými čárkou. Prázdné řádky se přeskočí.</p>
          <div className="tabulka-obal"><table className="tabulka"><thead><tr><th>Kategorie</th><th>Název</th><th>Popis</th><th>Cena</th><th>Alergeny</th><th>Dostupnost</th></tr></thead>
            <tbody>{Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <td><select name={`cat_${i}`} defaultValue={i === 0 ? "polevka" : i >= 5 ? "dezert" : "hlavni"}><option value="polevka">Polévka</option><option value="predkrm">Předkrm</option><option value="hlavni">Hlavní</option><option value="dezert">Dezert</option><option value="napoj">Nápoj</option><option value="ostatni">Ostatní</option></select></td>
                <td><input name={`name_${i}`} /></td><td><input name={`desc_${i}`} /></td>
                <td><input name={`price_${i}`} type="number" min={0} inputMode="numeric" style={{ width: 90 }} /></td>
                <td><input name={`all_${i}`} placeholder="1,3,7" style={{ width: 90 }} /></td>
                <td><select name={`av_${i}`} defaultValue="available"><option value="available">k dispozici</option><option value="limited">omezeně</option><option value="sold_out">vyprodáno</option></select></td>
              </tr>
            ))}</tbody></table></div>
          <button className="btn btn-primary" style={{ marginTop: 12 }}>Uložit koncept</button>
        </form>
      )}

      {zp === "text" && (
        <form action={importAkce} className="karta">
          <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="zpusob" value="text" />
          <div className="pole"><label htmlFor="text">Vložte text menu (z e-mailu, webu, Wordu…)</label>
            <textarea id="text" name="text" required style={{ minHeight: 220 }} placeholder={`Denní menu ${dnes(k.tz).split("-").reverse().join(". ")}\nPolévka\nHovězí vývar 45 Kč (1,3,9)\nHlavní jídla\nSvíčková na smetaně – houskový knedlík 189 Kč (1,3,7)\n...`} />
            <small>Poznají se ceny (189 Kč, 189,-), alergeny (1,3,7), kategorie (Polévka, Hlavní jídla, Dezert) a dny (Pondělí… nebo „Po 12. 9.“). Co se nepozná, označí se ke kontrole.</small></div>
          <button className="btn btn-primary">Rozpoznat a zkontrolovat</button>
        </form>
      )}

      {(zp === "foto" || zp === "pdf") && (
        <form action={importAkce} className="karta">
          <input type="hidden" name="slug" value={v.slug} /><input type="hidden" name="zpusob" value={zp} />
          <div className="pole"><label htmlFor="soubor">{zp === "foto" ? "Fotografie nebo screenshot menu" : "PDF s menu"}</label>
            <input id="soubor" name="soubor" type="file" accept={zp === "foto" ? "image/*" : "application/pdf"} required />
            <small>Rozpoznání dělá vybraný AI nástroj se schopností „menu.ocr“ (v demu není — vložte text). Původní soubor se uloží do knihovny, aby šel dohledat.</small></div>
          <div className="pole"><label htmlFor="hint">Nápověda pro rozpoznání (nepovinné)</label><input id="hint" name="hint" placeholder={`např. víkendové menu ${sobota}–${posunDne(sobota, 1)}`} /></div>
          <button className="btn btn-primary">Rozpoznat a zkontrolovat</button>
        </form>
      )}
    </>
  );
}
