import { formatDatumCas, formatDatum } from "@/lib/cas";
import { nacistKontext, muze } from "@/lib/authz";
import { withUser } from "@/lib/db";

import { Hlasky } from "../../ui";
import { cenaAkce, odpojitAkce, otestovatAkce, ulozitKlicAkce, vybratAkce } from "./akce";

export const dynamic = "force-dynamic";

const KATEGORIE: { key: string; label: string; popis: string }[] = [
  { key: "social_publishing", label: "Instagram + Facebook (publikování)", popis: "Kam se obsah zveřejňuje. Bez připojení funguje tvorba, schvalování, plánování a stažení souboru k ručnímu zveřejnění." },
  { key: "ai_generation", label: "AI pro texty a storyboard", popis: "Popisky, hooky, hashtagy, storyboard a rozpoznání menu z fotografie." },
  { key: "image_rendering", label: "Grafika (obrázky a PDF)", popis: "Statické obrázky z datových šablon a tisková PDF." },
  { key: "video_rendering", label: "Video (Reels)", popis: "Render videí z fotografií a klipů, titulky, hudba." },
  { key: "workflow_automation", label: "Automatizace workflow", popis: "Dlouhé asynchronní procesy a napojení na další systémy. Volitelné." },
  { key: "voiceover", label: "Voice-over", popis: "Český hlas pro Reels." },
  { key: "notifications", label: "Notifikace", popis: "Upozornění na žádost o schválení, vrácení, schválení a selhání publikace." },
  { key: "analytics", label: "Analytika", popis: "Dosah, reakce, uložení podle dostupných oprávnění." },
  { key: "external_storage", label: "Úložiště médií", popis: "Kde leží soubory. Spravuje FoodTab." },
  { key: "menu_source", label: "Propojení s FoodTabem (menu)", popis: "Budoucí automatické načtení schváleného menu z FoodTab Řízení." },
];
const STAVY: Record<string, { l: string; t: string }> = { not_connected: { l: "nepřipojeno", t: "" }, connecting: { l: "připojuje se", t: "info" }, connected: { l: "připojeno", t: "dobre" }, needs_attention: { l: "vyžaduje pozornost", t: "pozor" }, error: { l: "chyba", t: "bad" }, revoked: { l: "odpojeno", t: "" } };
const REZIMY: Record<string, string> = { customer_managed: "vlastní účet zákazníka", foodtab_managed: "spravuje FoodTab", manual_export: "ruční export", mock: "demo" };
const DOPORUCENI: Record<string, { l: string; t: string }> = { foodtab_recommended: { l: "Doporučeno FoodTabem", t: "mosaz" }, supported: { l: "Jiná podporovaná možnost", t: "" }, planned: { l: "Připravujeme", t: "info" } };

export default async function Integrace({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const k = await nacistKontext(sp.provozovna ?? null);
  const venueId = k.venue?.id ?? null;
  const data = await withUser(k.session.userId, async (tx) => {
    const [katalog, schopnosti, pref, spojeni, ucty, klice] = await Promise.all([
      tx.q<{ key: string; category: string; name: string; vendor: string; description: string; recommendation: string; implementation_status: string; connection_modes: string[]; auth_type: string; billing: string; docs_url: string | null; pricing_url: string | null; pricing_note: string | null; pricing_checked_at: string | null; score_cost: number; score_simplicity: number; score_quality: number; score_speed: number; score_automation: number; setup_complexity: number; benefits: string[]; limitations: string[] }>("select * from marketing.provider_catalog order by category, sort_order"),
      tx.q<{ provider_key: string; capability: string; status: string; note: string | null; description: string }>("select pc.*, c.description from marketing.provider_capabilities pc join marketing.capabilities c on c.key = pc.capability order by pc.capability"),
      tx.q<{ category: string; provider_key: string; connection_id: string | null; venue_id: string | null }>("select category, provider_key, connection_id, venue_id from marketing.organization_provider_preferences where organization_id = $1 and is_active and (venue_id is null or venue_id = $2)", [k.organization.id, venueId]),
      tx.q<{ id: string; provider_key: string; venue_id: string | null; mode: string; status: string; display_name: string; external_account: Record<string, unknown>; granted_scopes: string[]; expires_at: string | null; last_test_at: string | null; last_test_ok: boolean | null; last_error: string | null; venue_name: string | null }>(
        "select c.*, v.name as venue_name from marketing.integration_connections c left join marketing.venues v on v.id = c.venue_id where c.organization_id = $1 and c.revoked_at is null order by c.created_at", [k.organization.id]),
      tx.q<{ connection_id: string; platform: string; name: string; username: string | null; venue_name: string | null; is_active: boolean }>("select sa.connection_id, sa.platform, sa.name, sa.username, v.name as venue_name, sa.is_active from marketing.social_accounts sa left join marketing.venues v on v.id = sa.venue_id where sa.organization_id = $1", [k.organization.id]),
      tx.q<{ connection_id: string; fingerprint: string; rotated_at: string | null; created_at: string }>("select connection_id, 'uloženo' as fingerprint, null::timestamptz as rotated_at, now() as created_at from marketing.integration_connections where organization_id = $1 and secret_ref is not null", [k.organization.id]),
    ]);
    return { katalog, schopnosti, pref, spojeni, ucty, klice };
  });
  const smi = muze(k, "integrations.manage");
  const aktivni = (cat: string) => data.pref.find((p) => p.category === cat && p.venue_id === venueId) ?? data.pref.find((p) => p.category === cat && p.venue_id === null);
  const onboarding = k.organization.onboarding as { priorita?: string };

  return (
    <>
      <div className="hlavicka"><div><h1>Integrace a nástroje</h1><p>Každá organizace si vybírá a připojuje vlastní nástroje. FoodTab doporučuje, rozhoduje zákazník. Klíče se ukládají šifrovaně na serveru a po uložení se už nezobrazují.</p></div>
        <div className="btn-radek"><span className="faint">Rozsah:</span><a className={`btn btn-male${!sp.provozovna ? " btn-primary" : ""}`} href="/nastaveni/integrace">Celá organizace</a>{k.venues.map((v) => <a key={v.id} className={`btn btn-male${sp.provozovna === v.slug ? " btn-primary" : ""}`} href={`/nastaveni/integrace?provozovna=${v.slug}`}>{v.name}</a>)}</div></div>
      <Hlasky sp={sp} />
      <div className="hlaska hlaska-info male">
        <b>Doporučená sestava FoodTabu{onboarding.priorita ? ` (priorita: ${onboarding.priorita})` : ""}:</b> Claude pro texty · vestavěná grafika · Shotstack pro video · n8n (volitelně) · přímé Meta API pro Instagram a Facebook. Žádná placená služba není povinná — u každé kategorie jde vybrat jiný nástroj nebo zůstat u ručního exportu.
        {" "}Návody: <a href="/docs/META_SETUP.md" target="_blank">Meta</a> · <a href="/docs/SHOTSTACK_SETUP.md" target="_blank">Shotstack</a> · <a href="/docs/N8N_SETUP.md" target="_blank">n8n</a> · <a href="/docs/PROVIDER_CATALOG.md" target="_blank">katalog</a> (v repozitáři, složka docs/).
      </div>

      {KATEGORIE.map((kat) => {
        const a = aktivni(kat.key);
        const providers = data.katalog.filter((p) => p.category === kat.key);
        const conn = a?.connection_id ? data.spojeni.find((c) => c.id === a.connection_id) : undefined;
        const prov = providers.find((p) => p.key === a?.provider_key);
        const caps = data.schopnosti.filter((s) => s.provider_key === a?.provider_key);
        const chybi = data.schopnosti.filter((s) => s.provider_key === a?.provider_key && s.status !== "available");
        const st = conn ? STAVY[conn.status] ?? { l: conn.status, t: "" } : { l: "nepřipojeno", t: "" };
        const zdejsi = sp.pripojit === conn?.id;
        return (
          <section key={kat.key} className="karta" id={kat.key}>
            <div className="hlavicka" style={{ marginBottom: 8 }}>
              <div><h2>{kat.label}</h2><p>{kat.popis}</p></div>
              <span className={`stitek stitek-${st.t}`}>{st.l}</span>
            </div>
            {prov ? (
              <div className="mrizka mrizka-2">
                <div>
                  <h3>{prov.name} <span className="faint">({prov.vendor})</span> <span className={`stitek stitek-${DOPORUCENI[prov.recommendation]?.t}`}>{DOPORUCENI[prov.recommendation]?.l}</span> {conn?.mode === "mock" && <span className="stitek stitek-mock">demo</span>}</h3>
                  <p className="male">{prov.description}</p>
                  <ul className="seznam male">
                    <li><div className="roste">Režim: <b>{REZIMY[conn?.mode ?? ""] ?? "—"}</b> · poplatky: {prov.billing === "customer_pays_provider" ? "hradí zákazník přímo poskytovateli" : prov.billing === "included" ? "v ceně aplikace" : "zdarma"}</div></li>
                    <li><div className="roste">Patří k: {conn?.venue_name ?? "celé organizaci"} · účet: {String(conn?.external_account?.user_name ?? conn?.external_account?.model ?? conn?.display_name ?? "—")}</div></li>
                    <li><div className="roste">Poslední test: {conn?.last_test_at ? `${formatDatumCas(new Date(conn.last_test_at), k.tz)} — ${conn.last_test_ok ? "OK" : "selhal"}` : "nikdy"}{conn?.last_error ? ` · ${conn.last_error}` : ""}{conn?.expires_at ? ` · token vyprší ${formatDatum(new Date(conn.expires_at), k.tz)}` : ""}</div></li>
                    {conn?.granted_scopes?.length ? <li><div className="roste">Udělená oprávnění: {conn.granted_scopes.join(", ")}</div></li> : null}
                    {data.ucty.filter((u) => u.connection_id === conn?.id).length > 0 && <li><div className="roste">Účty: {data.ucty.filter((u) => u.connection_id === conn?.id).map((u) => `${u.platform}: ${u.name}${u.venue_name ? ` (${u.venue_name})` : ""}`).join(" · ")}</div></li>}
                    {prov.pricing_note && <li><div className="roste">Orientační cena: {prov.pricing_note} <span className="faint">(kontrola {prov.pricing_checked_at ? formatDatum(prov.pricing_checked_at) : "—"}{prov.pricing_url ? <>, <a href={prov.pricing_url}>ceník</a></> : null})</span></div></li>}
                    {prov.docs_url && <li><div className="roste"><a href={prov.docs_url}>Oficiální návod služby</a></div></li>}
                  </ul>
                  <h3>Skutečně dostupné schopnosti</h3>
                  <div className="chip-radek">{caps.map((c) => <span key={c.capability} className={`stitek ${c.status === "available" ? "stitek-dobre" : c.status === "partial" ? "stitek-pozor" : ""}`} title={c.note ?? c.description}>{c.description}{c.status === "partial" ? " (částečně)" : c.status === "planned" ? " (chybí)" : ""}</span>)}</div>
                  {chybi.length > 0 && <p className="faint">Chybějící nebo omezené: {chybi.map((c) => c.description).join(", ")}.</p>}
                </div>
                <div>
                  {smi && conn && (
                    <div className="btn-radek">
                      {prov.auth_type === "oauth" && prov.key === "meta_graph" && <a className="btn btn-primary" href={`/api/v1/meta/oauth/start?connection=${conn.id}`}>Připojit Instagram a Facebook</a>}
                      {(prov.auth_type === "api_key" || prov.auth_type === "webhook_secret") && <a className="btn btn-primary" href={`/nastaveni/integrace?pripojit=${conn.id}#${kat.key}`}>{conn.status === "connected" ? "Nahradit klíč" : "Zadat klíč"}</a>}
                      <form action={otestovatAkce}><input type="hidden" name="connectionId" value={conn.id} /><button className="btn">Otestovat spojení</button></form>
                      {prov.auth_type !== "none" && <form action={odpojitAkce}><input type="hidden" name="connectionId" value={conn.id} /><button className="btn btn-bad">Odpojit</button></form>}
                    </div>
                  )}
                  {zdejsi && smi && conn && (
                    <form action={ulozitKlicAkce} className="karta" style={{ marginTop: 10 }}>
                      <input type="hidden" name="connectionId" value={conn.id} />
                      <p className="male"><b>Než uložíte:</b> služba dostane jen to, co potřebuje k dané schopnosti (texty a storyboard, nebo soubory k renderu). Klíč se uloží šifrovaně a už se nezobrazí celý.</p>
                      {prov.auth_type === "api_key" ? (
                        <div className="pole"><label htmlFor="api_key">API klíč</label><input id="api_key" name="api_key" type="password" autoComplete="off" required /></div>
                      ) : (
                        <div className="pole"><label htmlFor="webhook_secret">Tajemství pro podpis webhooků</label><input id="webhook_secret" name="webhook_secret" type="password" autoComplete="off" required /></div>
                      )}
                      {prov.key === "shotstack" && <div className="pole"><label htmlFor="env">Prostředí</label><select id="env" name="env" defaultValue="stage"><option value="stage">stage (sandbox s vodoznakem, zdarma)</option><option value="v1">v1 (produkce, placené)</option></select></div>}
                      {prov.key === "anthropic_claude" && <div className="pole"><label htmlFor="model">Model</label><input id="model" name="model" defaultValue="claude-opus-5" /></div>}
                      {prov.key === "n8n" && <div className="pole"><label htmlFor="base_url">Adresa n8n</label><input id="base_url" name="base_url" type="url" placeholder="https://n8n.vase-domena.cz" required /></div>}
                      <button className="btn btn-primary">Uložit a otestovat</button>
                    </form>
                  )}
                  <details style={{ marginTop: 12 }}>
                    <summary>Vybrat jiný nástroj — porovnání</summary>
                    <div className="tabulka-obal"><table className="tabulka male">
                      <thead><tr><th>Nástroj</th><th>Doporučení</th><th>Cena</th><th>Jednoduchost</th><th>Kvalita</th><th>Rychlost</th><th>Automatizace</th><th>Nastavení</th><th></th></tr></thead>
                      <tbody>{providers.map((p) => (
                        <tr key={p.key} style={p.key === prov.key ? { background: "var(--accent-soft)" } : undefined}>
                          <td><b>{p.name}</b><div className="faint">{p.benefits.slice(0, 2).join(" · ")}{p.limitations.length ? <><br />omezení: {p.limitations.slice(0, 2).join("; ")}</> : null}</div></td>
                          <td><span className={`stitek stitek-${DOPORUCENI[p.recommendation]?.t}`}>{DOPORUCENI[p.recommendation]?.l}</span>{p.implementation_status !== "implemented" && <div className="faint">bez adaptéru</div>}</td>
                          <td>{"●".repeat(p.score_cost ?? 0)}</td><td>{"●".repeat(p.score_simplicity ?? 0)}</td><td>{"●".repeat(p.score_quality ?? 0)}</td><td>{"●".repeat(p.score_speed ?? 0)}</td><td>{"●".repeat(p.score_automation ?? 0)}</td><td>{"●".repeat(p.setup_complexity ?? 0)}</td>
                          <td>{smi && p.key !== prov.key && p.implementation_status === "implemented" && <form action={vybratAkce}><input type="hidden" name="providerKey" value={p.key} /><input type="hidden" name="provozovna" value={sp.provozovna ?? ""} /><button className="btn btn-male">Vybrat</button></form>}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                    <p className="faint">Cena = tečky podle orientační nákladnosti (méně = levnější). Údaje jsou orientační, s datem poslední kontroly; skutečné ceny určuje poskytovatel.</p>
                    {k.isOwner && (
                      <details><summary className="faint">Aktualizovat orientační cenu (správce)</summary>
                        {providers.map((p) => <form key={p.key} action={cenaAkce} className="btn-radek" style={{ marginTop: 6 }}><input type="hidden" name="providerKey" value={p.key} /><span style={{ width: 160 }}>{p.name}</span><input name="pricing_note" defaultValue={p.pricing_note ?? ""} style={{ flex: 1, minWidth: 200 }} /><input name="pricing_url" defaultValue={p.pricing_url ?? ""} placeholder="odkaz na ceník" style={{ width: 200 }} /><button className="btn btn-male">Uložit</button></form>)}
                      </details>
                    )}
                  </details>
                </div>
              </div>
            ) : (
              <div>
                <p className="muted">Není vybraný žádný nástroj.</p>
                {smi && <div className="chip-radek">{providers.filter((p) => p.implementation_status === "implemented").map((p) => <form key={p.key} action={vybratAkce}><input type="hidden" name="providerKey" value={p.key} /><input type="hidden" name="provozovna" value={sp.provozovna ?? ""} /><button className="chip">{p.name}</button></form>)}</div>}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
