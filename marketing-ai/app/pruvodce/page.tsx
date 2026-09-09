import { redirect } from "next/navigation";

import { nacistKontext } from "@/lib/authz";

import { Hlasky } from "../ui";
import { dokoncitPruvodceAkce } from "./akce";

export const dynamic = "force-dynamic";

/** Průvodce prvním spuštěním: pár otázek → doporučená sestava → hotovo. */
export default async function Pruvodce({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const k = await nacistKontext(null);
  if (k.organization.onboarding_done_at && k.venues[0] && sp.znovu !== "1") redirect(`/${k.venues[0].slug}/prehled`);
  const o = k.organization.onboarding as Record<string, string | undefined>;
  return (
    <main className="prihlaseni" style={{ alignItems: "start", paddingTop: 40 }}>
      <div className="karta" style={{ maxWidth: 760 }}>
        <p className="brand" style={{ color: "var(--ink)" }}>Food<em>Tab</em> <small style={{ color: "var(--muted)" }}>Marketing AI</small></p>
        <h1>Průvodce prvním nastavením</h1>
        <p className="muted">Pár otázek, ať vám navrhneme sestavu nástrojů. Nic není povinné a všechno jde později změnit v Integracích.</p>
        <Hlasky sp={sp} />
        <form action={dokoncitPruvodceAkce}>
          <div className="pole"><label>Co chcete vytvářet?</label><div className="chip-radek">{[["menu", "Denní a víkendové menu"], ["akce", "Akce a přenosy"], ["reels", "Reels a videa"], ["story", "Story"], ["print", "Tisk (A4 na dveře)"]].map(([v, l]) => <label key={v} className="chip"><input type="checkbox" name="tvorba" value={v} defaultChecked={!o.tvorba || o.tvorba.includes(v)} /> {l}</label>)}</div></div>
          <div className="radek radek-2">
            <div className="pole"><label htmlFor="provozoven">Kolik provozoven spravujete?</label><input id="provozoven" name="provozoven" type="number" min={1} defaultValue={o.provozoven ?? (k.venues.length || 1)} /></div>
            <div className="pole"><label htmlFor="priorita">Co je pro vás nejdůležitější?</label><select id="priorita" name="priorita" defaultValue={o.priorita ?? "jednoduchost"}><option value="jednoduchost">nejjednodušší nastavení</option><option value="cena">nejnižší cena</option><option value="kvalita">nejvyšší kvalita</option></select></div>
            <div className="pole"><label htmlFor="publikace">Chcete automatické publikování?</label><select id="publikace" name="publikace" defaultValue={o.publikace ?? "ano"}><option value="ano">Ano, po schválení zveřejnit přímo</option><option value="ne">Ne, jen tvorba a stažení souboru</option></select></div>
            <div className="pole"><label htmlFor="ucty">Používáte vlastní API účty, nebo balíček FoodTabu?</label><select id="ucty" name="ucty" defaultValue={o.ucty ?? "vlastni"}><option value="vlastni">Vlastní účty (platím poskytovateli přímo)</option><option value="foodtab">Budoucí balíček spravovaný FoodTabem</option></select></div>
          </div>
          <div className="pole"><label>Máte už účet u některého poskytovatele?</label><div className="chip-radek">{[["meta", "Meta (Facebook/Instagram)"], ["anthropic", "Anthropic (Claude)"], ["shotstack", "Shotstack"], ["n8n", "n8n"], ["canva", "Canva"]].map(([v, l]) => <label key={v} className="chip"><input type="checkbox" name="ucet" value={v} defaultChecked={o.ucet?.includes(v)} /> {l}</label>)}</div></div>
          <div className="hlaska hlaska-info">
            <b>Doporučená sestava FoodTabu:</b> Claude (texty) · vestavěná grafika · Shotstack (video) · přímé Meta API (Instagram + Facebook) · n8n volitelně.
            <details><summary>Další podporované možnosti</summary><p className="male">Bez připojení běží vestavěné a demo nástroje: interní návrhář textů, interní grafika, demo video, ruční export místo publikace. Cokoli z toho jde zvolit v Integracích. Žádná placená služba není povinná; adaptéry „Připravujeme“ (Buffer, ElevenLabs, e-mail) nejde zatím připojit.</p></details>
          </div>
          <div className="btn-radek"><button className="btn btn-primary btn-velke">Dokončit a začít</button><span className="faint">Připojení konkrétních účtů uděláte v Integracích.</span></div>
        </form>
      </div>
    </main>
  );
}
