/**
 * Databázové a doménové scénáře proti čisté PGlite databázi (RLS zapnuté).
 *
 *   npm run test:db
 *
 * Scénáře (číslování odpovídá výpisu při běhu):
 *  1. izolace organizací a provozoven (RLS),
 *  2. celá cesta Černá Perla: obsah → návrh → úprava → schválení → plán →
 *     published_mock, včetně toho, že druhý běh fronty nic nezdvojí,
 *  3. změna po schválení ruší schválení; bez schválení nejde publikovat,
 *  4. přepnutí poskytovatele bez ztráty obsahu; cizí credentials nejdou číst,
 *  5. katalog nepředstírá adaptér, který v kódu není,
 *  6. render: dlouhé názvy s diakritikou, přetečení na víc slidů,
 *  7. Bernard Bar: víkendové menu → carousel/feed,
 *  8. poruchy: neplatný klíč, výměna a odpojení připojení, selhání AI
 *     i renderu, vypršelý token Meta s opakováním až do dead_letter,
 *     překročený limit Meta a duplicitní webhook,
 *  9. spouštění fronty: kdo ji smí spustit a čí úlohy tím spustí,
 * 10. zakládání organizací jen na pozvánku.
 */
import { dnes, nejblizsiSobota, posunDne } from "../../lib/cas.ts";
import { DEMO_ORG, DEMO_ORG_2, DEMO_USERS, DEMO_VENUES } from "../../lib/demo-ucty.ts";
import { zopakovatPublikaci, zpracovatFrontu } from "../../lib/domena/fronta.ts";
import { aktivovat, odpojit, ulozitKlic, vybratPoskytovatele } from "../../lib/domena/integrace.ts";
import { nahratMedium } from "../../lib/domena/media.ts";
import { rozpoznatMenuZTextu } from "../../lib/domena/menu-text.ts";
import { potvrditMenu, rozpoznaniNaVstup, ulozitMenu } from "../../lib/domena/menu.ts";
import { naplanovat, navrhnout, novaVerze, oznacitSelhaniNavrhu, pozadatOSchvaleni, rozhodnout, spustitRender, vytvoritObsah, nacistAktualniVerzi } from "../../lib/domena/obsah.ts";
import { encryptCredentials } from "../../lib/providers/credentials.ts";
import { FACTORIES } from "../../lib/providers/registry.ts";
import { vykreslit } from "../../lib/render/svg-sablony.ts";
import { ukazkovyObrazekSvg } from "../../lib/seed/ukazkove-obrazky.ts";
import { check, jako, ocekavatChybu, souhrn, testovaciDb } from "./harness.ts";

const [vlastnik, manazer, schvalovatel, editorPerla, editorBernard, pozorovatel, bistro] = DEMO_USERS;
const PERLA = DEMO_VENUES.cernaPerla.id;
const BERNARD = DEMO_VENUES.bernardBar.id;

const d = await testovaciDb();

console.log("\n1. Izolace organizací a provozoven");
{
  const bistroVidi = await jako(d, bistro.id, (tx) => tx.q("select id from marketing.menus"));
  check("druhá organizace vidí jen své menu", bistroVidi.length === 1);
  const bistroPerla = await jako(d, bistro.id, (tx) => tx.q("select id from marketing.venues where id = $1", [PERLA]));
  check("druhá organizace nevidí Černou Perlu", bistroPerla.length === 0);
  const perlaEditorMenu = await jako(d, editorPerla.id, (tx) => tx.q("select venue_id from marketing.menus"));
  check("editor Černé Perly nevidí menu Bernard Baru", perlaEditorMenu.every((m) => m.venue_id === PERLA) && perlaEditorMenu.length === 1);
  const bernardMedia = await jako(d, editorBernard.id, (tx) => tx.q("select venue_id from marketing.media_assets"));
  check("editor Bernard Baru nevidí média Černé Perly", bernardMedia.every((m) => m.venue_id === BERNARD) && bernardMedia.length === 3);
  const cizi = await jako(d, bistro.id, (tx) => tx.q("select id from marketing.integration_connections where organization_id = $1", [DEMO_ORG.id]));
  check("druhá organizace nevidí připojení první", cizi.length === 0);
  await ocekavatChybu("editor bez práva media.share nevloží sdílené médium", () =>
    jako(d, editorPerla.id, (tx) => tx.q("insert into marketing.media_assets (organization_id, venue_id, kind, original_filename, storage_path, mime_type) values ($1, null, 'image', 'x.png', 'organizations/x/shared/media/a/x.png', 'image/png')", [DEMO_ORG.id])));
  await ocekavatChybu("pozorovatel nezaloží obsah (RLS)", () =>
    jako(d, pozorovatel.id, (tx) => tx.q("insert into marketing.content_items (organization_id, venue_id, title) values ($1, $2, 'x')", [DEMO_ORG.id, PERLA])));
  await ocekavatChybu("editor Černé Perly nezaloží obsah v Bernard Baru", () =>
    jako(d, editorPerla.id, (tx) => tx.q("insert into marketing.content_items (organization_id, venue_id, title) values ($1, $2, 'x')", [DEMO_ORG.id, BERNARD])));
  await ocekavatChybu("kolega nepřečte e-mail (sloupcové granty)", () =>
    jako(d, editorPerla.id, (tx) => tx.q("select email from marketing.profiles")), /permission denied/);
  const jmena = await jako(d, editorPerla.id, (tx) => tx.q("select display_name from marketing.profiles"));
  check("kolega přečte jména členů své organizace", jmena.length === 6, `${jmena.length}`);
  await ocekavatChybu("integration_secrets nejsou pro authenticated vůbec", () =>
    jako(d, vlastnik.id, (tx) => tx.q("select * from marketing.integration_secrets")), /permission denied/);
}

console.log("\n2. Černá Perla: celá cesta až k published_mock");
let itemId = "";
let versionId = "";
{
  // Nahrání fotografie
  const png = new TextEncoder().encode(ukazkovyObrazekSvg("Test svíčková", "#6b4c8a"));
  const up = await jako(d, manazer.id, (tx) => nahratMedium(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, filename: "svickova.svg", mime: "image/svg+xml", bytes: png, collectionKey: "jidla-foto", tags: ["svíčková", "menu"] }));
  check("fotografie nahraná do Černé Perly", Boolean(up.id) && !up.duplicate);
  const dup = await jako(d, manazer.id, (tx) => nahratMedium(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, filename: "svickova2.svg", mime: "image/svg+xml", bytes: png }));
  check("stejný soubor podruhé se pozná jako duplicita", dup.duplicate !== undefined && dup.id === up.id);
  await ocekavatChybu("nepodporovaný typ souboru se odmítne", () =>
    jako(d, manazer.id, (tx) => nahratMedium(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, filename: "x.exe", mime: "application/x-msdownload", bytes: png })), /Nepodporovaný/);

  // Vložení demo denního menu z textu
  const text = `Denní menu ${dnes().split("-").reverse().join(". ")}
Polévka
Hovězí vývar s játrovými knedlíčky 45 Kč (1,3,9)
Hlavní jídla
Svíčková na smetaně s houskovým knedlíkem – brusinky 189 Kč (1,3,7)
Kuřecí řízek s bramborovou kaší 169,- (1,3,7)
Zapečené těstoviny se špenátem ?
Dezert
Palačinka s tvarohem 79 Kč`;
  const roz = rozpoznatMenuZTextu(text);
  check("text menu: rozpoznán název a datum", roz.title.startsWith("Denní menu") && roz.valid_from === dnes(), JSON.stringify([roz.title, roz.valid_from]));
  check("text menu: 5 položek, jedna k doplnění", roz.items.length === 5 && roz.items.filter((i) => i.needs_review).length === 1);
  check("text menu: cena 169,- rozpoznána", roz.items[2].price_cents === 16900);
  check("text menu: alergeny", roz.items[1].allergens.join(",") === "1,3,7");
  const menuId = await jako(d, manazer.id, (tx) => ulozitMenu(tx, rozpoznaniNaVstup(roz, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, source: "text" })));
  const potvrz1 = await jako(d, manazer.id, (tx) => potvrditMenu(tx, menuId, manazer.id));
  check("menu s položkou k doplnění nejde potvrdit", !potvrz1.ok && potvrz1.problemy.length >= 1);
  await jako(d, manazer.id, (tx) => tx.q("update marketing.menu_items set needs_review = false, price_cents = 14900 where menu_id = $1 and needs_review", [menuId]));
  const potvrz2 = await jako(d, manazer.id, (tx) => potvrditMenu(tx, menuId, manazer.id));
  check("po doplnění ceny jde menu potvrdit", potvrz2.ok);

  // Obsah: Story + feed
  const tpl = await d.one<{ id: string }>("select id from marketing.templates where key = 'denni_menu'");
  const r = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, {
    organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Denní menu – test", purpose: "denni_menu", templateId: tpl!.id, menuId,
    brief: "Dnešní menu, přátelsky.", channels: ["instagram", "facebook"], formats: ["instagram_story", "instagram_feed", "facebook_post"], mediaAssetIds: [up.id], inputs: { date: dnes() },
  }));
  itemId = r.itemId;
  const variants = await d.q("select * from marketing.content_variants where content_version_id = $1", [r.versionId]);
  check("verze 1 má 3 varianty (story, feed, fb post)", variants.length === 3);

  // Návrh (mock AI)
  const nav = await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId, userId: manazer.id }));
  check("mock AI vrátil validovaný návrh se 3 variantami", nav.navrh.varianty.length === 3 && nav.isMock);
  check("návrh nese storyboard se scénami", nav.navrh.varianty[0].storyboard.length >= 3);
  check("návrh použil fakta z menu (cena 189 Kč)", nav.navrh.varianty[0].instagram.popisek.includes("189 Kč"));
  const st = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [itemId]);
  check("stav po návrhu je preview_ready", st?.status === "preview_ready");

  // Úprava textu (změna ceny v popisku)
  const v2 = await jako(d, manazer.id, (tx) => nacistAktualniVerzi(tx, itemId));
  const texts = { ...v2!.texts, instagram: { ...v2!.texts.instagram, caption: v2!.texts.instagram.caption.replace("189 Kč", "199 Kč") } };
  versionId = await jako(d, manazer.id, (tx) => novaVerze(tx, { itemId, userId: manazer.id, changes: { texts }, note: "Úprava ceny" }));
  check("úprava vytvořila novou verzi s jiným otiskem", versionId !== v2!.id);

  // Render feed varianty
  const feed = await d.one<{ id: string }>("select id from marketing.content_variants where content_version_id = $1 and format = 'feed'", [versionId]);
  const rend = await jako(d, manazer.id, (tx) => spustitRender(tx, { versionId, variantId: feed!.id, userId: manazer.id }));
  check("interní render feedu proběhl", rend.status === "done", rend.error);
  const out = await d.one<{ output_asset_id: string | null }>("select output_asset_id from marketing.content_variants where id = $1", [feed!.id]);
  check("varianta má výstupní médium odvozené od originálu", Boolean(out?.output_asset_id));
  // Instagram ani Facebook SVG nepřijmou — výstup musí být rastr.
  const vystup = await d.one<{ mime_type: string; width: number | null; height: number | null }>("select mime_type, width, height from marketing.media_assets where id = $1", [out!.output_asset_id]);
  check("výstup pro sítě je PNG nebo JPEG, ne SVG", vystup?.mime_type === "image/png" || vystup?.mime_type === "image/jpeg", vystup?.mime_type);
  check("výstup má rozměry formátu 1080×1350", vystup?.width === 1080 && vystup.height === 1350, `${vystup?.width}×${vystup?.height}`);

  // Žádost o schválení a schválení jinou osobou
  await ocekavatChybu("schvalovatel nemůže žádat o schválení (nemá content.create)", () =>
    jako(d, schvalovatel.id, (tx) => pozadatOSchvaleni(tx, { itemId, userId: schvalovatel.id })), /oprávnění/);
  const reqId = await jako(d, manazer.id, (tx) => pozadatOSchvaleni(tx, { itemId, userId: manazer.id, summary: "Dnešní menu" }));
  const notif = await d.q("select user_id from marketing.notifications where kind = 'approval_requested'");
  check("schvalovatelé dostali upozornění", notif.some((n) => n.user_id === schvalovatel.id) && !notif.some((n) => n.user_id === editorBernard.id));
  await ocekavatChybu("žadatel nesmí schválit sám sebe, když je jiný schvalovatel", () =>
    jako(d, manazer.id, (tx) => rozhodnout(tx, { requestId: reqId, userId: manazer.id, decision: "approved", comment: "" })), /jiný schvalovatel/);
  await ocekavatChybu("editor bez content.approve nerozhodne", () =>
    jako(d, editorPerla.id, (tx) => rozhodnout(tx, { requestId: reqId, userId: editorPerla.id, decision: "approved", comment: "" })), /oprávnění/);
  await jako(d, schvalovatel.id, (tx) => rozhodnout(tx, { requestId: reqId, userId: schvalovatel.id, decision: "approved", comment: "Vypadá dobře." }));
  const it = await d.one<{ status: string; approved_version_id: string }>("select status, approved_version_id from marketing.content_items where id = $1", [itemId]);
  check("obsah je schválený pro přesnou verzi", it?.status === "approved" && it.approved_version_id === versionId);
  const audit = await d.q("select * from marketing.audit_logs where entity_type = 'approval_decision'");
  check("rozhodnutí je v auditu (spoušť)", audit.length === 1);

  // Naplánování a publikace
  await ocekavatChybu("schvalovatel bez content.publish nezveřejní hned", () =>
    jako(d, schvalovatel.id, (tx) => naplanovat(tx, { itemId, userId: schvalovatel.id, datum: null, cas: null, tz: "Europe/Prague" })), /oprávnění/);
  const plan = await jako(d, manazer.id, (tx) => naplanovat(tx, { itemId, userId: manazer.id, datum: dnes(), cas: "00:00", tz: "Europe/Prague" }));
  check("naplánováno: 3 publikační úlohy (story, feed, fb)", plan.jobIds.length === 3, String(plan.jobIds.length));
  const st2 = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [itemId]);
  check("stav je scheduled", st2?.status === "scheduled");

  const beh = await zpracovatFrontu({ now: new Date(Date.now() + 86400000) });
  check("fronta zveřejnila mockem (published_mock)", beh.publikace.mock === 3, JSON.stringify(beh));
  const pubs = await d.q<{ is_mock: boolean }>("select is_mock from marketing.publications where content_item_id = $1", [itemId]);
  check("3 publikace, všechny označené jako mock", pubs.length === 3 && pubs.every((p) => p.is_mock));
  const st3 = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [itemId]);
  check("stav obsahu je published", st3?.status === "published");

  const beh2 = await zpracovatFrontu({ now: new Date(Date.now() + 86400000) });
  const pubs2 = await d.q("select id from marketing.publications where content_item_id = $1", [itemId]);
  check("druhý běh fronty nevytvoří duplicitní publikaci", beh2.publikace.mock === 0 && pubs2.length === 3);
}

console.log("\n3. Změna po schválení a publikace bez schválení");
{
  const tpl = await d.one<{ id: string }>("select id from marketing.templates where key = 'jidlo_dne'");
  const media = await d.one<{ id: string }>("select id from marketing.media_assets where venue_id = $1 limit 1", [PERLA]);
  const r = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Jídlo dne", purpose: "jidlo_dne", templateId: tpl!.id, brief: "", channels: ["instagram"], formats: ["instagram_feed"], mediaAssetIds: [media!.id], inputs: { title: "Svíčková", price: 189 } }));
  await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: r.itemId, userId: manazer.id }));
  const reqId = await jako(d, manazer.id, (tx) => pozadatOSchvaleni(tx, { itemId: r.itemId, userId: manazer.id }));
  await jako(d, schvalovatel.id, (tx) => rozhodnout(tx, { requestId: reqId, userId: schvalovatel.id, decision: "approved", comment: "" }));
  const plan = await jako(d, manazer.id, (tx) => naplanovat(tx, { itemId: r.itemId, userId: manazer.id, datum: posunDne(dnes(), 3), cas: "18:00", tz: "Europe/Prague" }));
  check("naplánováno na později", plan.jobIds.length === 1);
  // Úprava po schválení
  const v = await jako(d, manazer.id, (tx) => nacistAktualniVerzi(tx, r.itemId));
  await jako(d, manazer.id, (tx) => novaVerze(tx, { itemId: r.itemId, userId: manazer.id, changes: { brief: "změna po schválení" }, note: "změna" }));
  const it = await d.one<{ status: string; approved_version_id: string | null }>("select status, approved_version_id from marketing.content_items where id = $1", [r.itemId]);
  check("po úpravě zaniklo schválení a stav je draft", it?.approved_version_id === null && it.status === "draft");
  const req = await d.one<{ status: string }>("select status from marketing.approval_requests where id = $1", [reqId]);
  check("původní žádost je superseded", req?.status === "superseded");
  const job = await d.one<{ status: string }>("select status from marketing.publish_jobs where id = $1", [plan.jobIds[0]]);
  check("naplánovaná publikace byla zrušena", job?.status === "cancelled");
  await ocekavatChybu("bez schválení nejde naplánovat", () =>
    jako(d, manazer.id, (tx) => naplanovat(tx, { itemId: r.itemId, userId: manazer.id, datum: null, cas: null, tz: "Europe/Prague" })), /schválen/);
  // Přímý pokus obejít aplikaci: vložit publish_job se starým schválením
  const cur = await jako(d, manazer.id, (tx) => nacistAktualniVerzi(tx, r.itemId));
  await ocekavatChybu("databáze odmítne publish job se schválením starší verze", () =>
    jako(d, manazer.id, (tx) => tx.q(
      `insert into marketing.publish_jobs (organization_id, venue_id, content_item_id, content_version_id, version_checksum, approval_request_id, channel, format, provider_key, mode, scheduled_for, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, 'instagram', 'feed', 'mock_publisher', 'mock', now(), 'hack-1')`,
      [DEMO_ORG.id, PERLA, r.itemId, cur!.id, cur!.checksum, reqId])), /schválení/);
  await ocekavatChybu("verze obsahu je neměnná", () =>
    jako(d, manazer.id, (tx) => tx.q("update marketing.content_versions set brief = 'hack' where id = $1", [v!.id])), /neupravuje|permission/);
  await ocekavatChybu("stav approved nejde nastavit přímo bez žádosti", () =>
    jako(d, manazer.id, (tx) => tx.q("update marketing.content_items set status = 'approved' where id = $1", [r.itemId])), /žádost/);
}

console.log("\n4. Přepnutí poskytovatele a cizí credentials");
{
  // Uložení tajemství do připojení první organizace
  const conn = await jako(d, vlastnik.id, (tx) => tx.one<{ id: string }>(
    "insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name) values ($1, 'anthropic_claude', 'customer_managed', 'connecting', 'Claude test') returning id", [DEMO_ORG.id]));
  await jako(d, vlastnik.id, (tx) => tx.q("select marketing.store_secret($1, 'v1.cipher', 'fp1')", [conn!.id]));
  const ct = await jako(d, manazer.id, (tx) => tx.one<{ ct: string }>("select marketing.read_secret($1) as ct", [conn!.id]));
  check("člen s integrations.use přečte ciphertext své organizace", ct?.ct === "v1.cipher");
  await ocekavatChybu("pozorovatel bez integrations.use tajemství nepřečte", () =>
    jako(d, pozorovatel.id, (tx) => tx.q("select marketing.read_secret($1)", [conn!.id])), /oprávnění/);
  await ocekavatChybu("druhá organizace tajemství nepřečte", () =>
    jako(d, bistro.id, (tx) => tx.q("select marketing.read_secret($1)", [conn!.id])), /oprávnění/);
  await ocekavatChybu("editor bez integrations.manage tajemství neuloží", () =>
    jako(d, editorPerla.id, (tx) => tx.q("select marketing.store_secret($1, 'x', 'y')", [conn!.id])), /oprávnění/);

  // Přepnutí publisheru na ruční export → nový obsah skončí manual_export, starý zůstává
  const manual = await d.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'manual_export'", [DEMO_ORG.id]);
  if (!manual) {
    await jako(d, vlastnik.id, (tx) => tx.q("insert into marketing.integration_connections (organization_id, provider_key, mode, status) values ($1, 'manual_export', 'manual_export', 'connected')", [DEMO_ORG.id]));
  }
  const manualConn = await d.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'manual_export'", [DEMO_ORG.id]);
  await jako(d, vlastnik.id, async (tx) => {
    await tx.q("update marketing.organization_provider_preferences set is_active = false where organization_id = $1 and category = 'social_publishing' and venue_id is null", [DEMO_ORG.id]);
    await tx.q("insert into marketing.organization_provider_preferences (organization_id, category, provider_key, connection_id, set_by) values ($1, 'social_publishing', 'manual_export', $2, $3)", [DEMO_ORG.id, manualConn!.id, vlastnik.id]);
  });
  const tpl = await d.one<{ id: string }>("select id from marketing.templates where key = 'atmosfera'");
  const media = await d.one<{ id: string }>("select id from marketing.media_assets where venue_id = $1 limit 1", [PERLA]);
  const r = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Atmosféra", purpose: "atmosfera", templateId: tpl!.id, brief: "Večer u nás", channels: ["facebook"], formats: ["facebook_post"], mediaAssetIds: [media!.id], inputs: { title: "Večer u nás" } }));
  await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: r.itemId, userId: manazer.id }));
  const reqId = await jako(d, manazer.id, (tx) => pozadatOSchvaleni(tx, { itemId: r.itemId, userId: manazer.id }));
  await jako(d, schvalovatel.id, (tx) => rozhodnout(tx, { requestId: reqId, userId: schvalovatel.id, decision: "approved", comment: "" }));
  await jako(d, manazer.id, (tx) => naplanovat(tx, { itemId: r.itemId, userId: manazer.id, datum: null, cas: null, tz: "Europe/Prague" }));
  const beh = await zpracovatFrontu();
  check("po přepnutí na ruční export skončí publikace jako manual_export", beh.publikace.manual === 1, JSON.stringify(beh));
  const stare = await d.q("select id from marketing.publications where content_item_id = $1", [itemId]);
  check("starší publikace a obsah zůstaly", stare.length === 3);
  const bistroPref = await jako(d, bistro.id, (tx) => tx.q<{ provider_key: string }>("select provider_key from marketing.organization_provider_preferences where category = 'social_publishing' and is_active"));
  check("druhá organizace má vlastní, jinou volbu", bistroPref.length === 1 && bistroPref[0].provider_key === "manual_export");
}

console.log("\n5. Katalog nepředstírá adaptéry");
{
  const impl = await d.q<{ key: string }>("select key from marketing.provider_catalog where implementation_status = 'implemented'");
  const chybi = impl.filter((p) => !FACTORIES[p.key]).map((p) => p.key);
  check("každý 'implemented' poskytovatel má továrnu v kódu", chybi.length === 0, chybi.join(","));
  const planned = await d.q<{ key: string }>("select key from marketing.provider_catalog where implementation_status = 'planned'");
  check("'planned' poskytovatelé nemají továrnu (nepředstírají podporu)", planned.every((p) => !FACTORIES[p.key]));
  const caps = await d.q<{ n: number }>("select count(*)::int as n from marketing.provider_capabilities pc where not exists (select 1 from marketing.capabilities c where c.key = pc.capability)");
  check("schopnosti v katalogu odkazují na známé capability", caps[0].n === 0);
}

console.log("\n6. Render: diakritika, dlouhé názvy, přetečení");
{
  const dlouhy = "Pomalu pečená vepřová žebírka v medovo-hořčičné marinádě s pečenými bramborami, křenovým dipem a čerstvým chlebem z naší pece";
  const req = {
    jobId: "test", formatKey: "instagram_feed", width: 1080, height: 1350, kind: "image" as const,
    template: { key: "denni_menu", layout: { style: "menu-list" }, textRules: { minFontPx: 28, itemsPerSlide: 5 } },
    inputs: { items: [{ name: dlouhy, price_cents: 24900, allergens: ["1", "10"] }, { name: "Řízek", price_cents: 16900 }, { name: "Čočka", price_cents: null }, { name: "Dezert 4" }, { name: "Dezert 5" }, { name: "Šestá položka" }] },
    brand: { colors: { primary: "#1f1a2e", accent: "#d8ab4e" }, signature: "Černá Perla" },
    texts: { headline: "Denní menu", cta: "Přijďte ochutnat" }, media: [],
  };
  const out = vykreslit(req);
  check("dlouhý název se nikdy neusekne (celý je v SVG)", dlouhy.split(" ").every((w) => out.svg.includes(w.slice(0, 8))));
  check("diakritika zůstává textem", out.svg.includes("Přijďte ochutnat") && out.svg.includes("Řízek"));
  check("6 položek při 5 na slide hlásí přetečení", out.overflow && out.itemsRendered === 5);
  check("položka bez ceny nedostane vymyšlenou cenu", !out.svg.includes("0 Kč"));
  const ok = vykreslit({ ...req, inputs: { items: req.inputs.items.slice(0, 3) } });
  check("3 položky se vejdou bez přetečení", !ok.overflow);
}

console.log("\n7. Bernard Bar Tábor: víkendové menu");
{
  const menu = await d.one<{ id: string }>("select id from marketing.menus where venue_id = $1 and kind = 'weekend'", [BERNARD]);
  const tpl = await d.one<{ id: string }>("select id from marketing.templates where key = 'vikendove_menu'");
  const media = await d.q<{ id: string }>("select id from marketing.media_assets where venue_id = $1", [BERNARD]);
  const sobota = nejblizsiSobota();
  const r = await jako(d, editorBernard.id, (tx) => vytvoritObsah(tx, {
    organizationId: DEMO_ORG.id, venueId: BERNARD, userId: editorBernard.id, title: "Víkendové menu", purpose: "vikendove_menu", templateId: tpl!.id, menuId: menu!.id,
    brief: "Pozvánka na víkend, uvolněně.", channels: ["instagram", "facebook"], formats: ["instagram_carousel", "instagram_feed", "facebook_post", "pdf_a4"], mediaAssetIds: media.map((m) => m.id), inputs: { range: { from: sobota, to: posunDne(sobota, 1) } },
  }));
  const nav = await jako(d, editorBernard.id, (tx) => navrhnout(tx, { itemId: r.itemId, userId: editorBernard.id }));
  check("Bernard: návrh nese žebra z menu", JSON.stringify(nav.navrh).includes("žebra"));
  const pdf = await d.one<{ id: string }>("select id from marketing.content_variants where content_version_id = $1 and format = 'pdf_a4'", [nav.versionId]);
  const rend = await jako(d, editorBernard.id, (tx) => spustitRender(tx, { versionId: nav.versionId, variantId: pdf!.id, userId: editorBernard.id }));
  check("Bernard: tisková A4 vykreslena", rend.status === "done", rend.error);
  const tisk = await d.one<{ mime_type: string }>("select m.mime_type from marketing.content_variants v join marketing.media_assets m on m.id = v.output_asset_id where v.id = $1", [pdf!.id]);
  check("tisk zůstává SVG (ostrý v jakékoli velikosti), nerastruje se", tisk?.mime_type === "image/svg+xml", tisk?.mime_type);
  await ocekavatChybu("editor Bernard Baru nerozhoduje o schválení", () =>
    jako(d, editorBernard.id, (tx) => pozadatOSchvaleni(tx, { itemId: r.itemId, userId: editorBernard.id }).then((id) => rozhodnout(tx, { requestId: id, userId: editorBernard.id, decision: "approved", comment: "" }))), /oprávnění/);
}

console.log("\n8. Poruchy: neplatný klíč, selhání AI a renderu, opakování publikace, duplicitní webhook");
{
  // --- (a) neplatný zákaznický klíč se NIKDY sám neaktivuje -----------
  // 127.0.0.1:9 je „discard“ port — spojení se odmítne hned, bez sítě
  // a bez čekání, takže kontrola nezávisí na tom, kde běží.
  const vyber = await jako(d, vlastnik.id, (tx) => vybratPoskytovatele(tx, { organizationId: DEMO_ORG.id, venueId: null, providerKey: "n8n", userId: vlastnik.id }));
  check("n8n si před připojením řekne o tajemství webhooku", vyber.needs === "webhook_secret");
  const spatny = await jako(d, vlastnik.id, (tx) => ulozitKlic(tx, { connectionId: vyber.connectionId, credentials: { base_url: "http://127.0.0.1:9", webhook_secret: "spatne-tajemstvi" }, userId: vlastnik.id }));
  check("nefunkční připojení se neoznačí za funkční", !spatny.ok, spatny.message);
  const stavN8n = await d.one<{ status: string; last_test_ok: boolean | null; last_error: string | null }>("select status, last_test_ok, last_error from marketing.integration_connections where id = $1", [vyber.connectionId]);
  check("připojení zůstalo ve stavu error i s důvodem", stavN8n?.status === "error" && stavN8n.last_test_ok === false && Boolean(stavN8n.last_error));
  const poNeuspechu = await d.one<{ provider_key: string }>("select provider_key from marketing.organization_provider_preferences where organization_id = $1 and category = 'workflow_automation' and venue_id is null and is_active", [DEMO_ORG.id]);
  check("po neúspěšném testu zůstává vybraná interní fronta", poNeuspechu?.provider_key === "internal_queue");

  // --- (b) výměna klíče: jiný otisk, starý ciphertext je pryč ---------
  const tajemstvi1 = await d.one<{ fingerprint: string; ciphertext: string; key_version: number }>("select fingerprint, ciphertext, key_version from marketing.integration_secrets where connection_id = $1", [vyber.connectionId]);
  await jako(d, vlastnik.id, (tx) => ulozitKlic(tx, { connectionId: vyber.connectionId, credentials: { base_url: "http://127.0.0.1:9", webhook_secret: "jine-tajemstvi" }, userId: vlastnik.id }));
  const tajemstvi2 = await d.one<{ fingerprint: string; ciphertext: string; key_version: number }>("select fingerprint, ciphertext, key_version from marketing.integration_secrets where connection_id = $1", [vyber.connectionId]);
  check("výměna klíče přepsala tajemství (jiný otisk i ciphertext)", Boolean(tajemstvi1) && tajemstvi2!.fingerprint !== tajemstvi1!.fingerprint && tajemstvi2!.ciphertext !== tajemstvi1!.ciphertext);
  check("výměna zvýšila verzi klíče, nezaložila druhý řádek", tajemstvi2!.key_version === tajemstvi1!.key_version + 1);
  const kolikTajemstvi = await d.one<{ n: number }>("select count(*)::int as n from marketing.integration_secrets where connection_id = $1", [vyber.connectionId]);
  check("po výměně zůstává jediné tajemství", kolikTajemstvi?.n === 1);

  // --- (c) odpojení smaže tajemství a vrátí záložní nástroj ----------
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, null, "workflow_automation", "n8n", vyber.connectionId, vlastnik.id));
  const predOdpojenim = await d.one<{ provider_key: string }>("select provider_key from marketing.organization_provider_preferences where organization_id = $1 and category = 'workflow_automation' and venue_id is null and is_active", [DEMO_ORG.id]);
  check("n8n je teď opravdu aktivní (jinak by další kontrola neplatila)", predOdpojenim?.provider_key === "n8n");
  await jako(d, vlastnik.id, (tx) => odpojit(tx, vyber.connectionId, vlastnik.id));
  const poOdpojeni = await d.one<{ n: number }>("select count(*)::int as n from marketing.integration_secrets where connection_id = $1", [vyber.connectionId]);
  check("odpojení tajemství opravdu smazalo", poOdpojeni?.n === 0);
  const zaloha = await d.one<{ provider_key: string }>("select provider_key from marketing.organization_provider_preferences where organization_id = $1 and category = 'workflow_automation' and venue_id is null and is_active", [DEMO_ORG.id]);
  check("po odpojení se aplikace vrátila k interní frontě", zaloha?.provider_key === "internal_queue");

  // --- (d) selhání AI: vybraný Claude bez klíče ----------------------
  const claude = await jako(d, vlastnik.id, (tx) => tx.one<{ id: string }>(
    "insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name) values ($1, 'anthropic_claude', 'customer_managed', 'connected', 'Claude bez klíče') returning id", [DEMO_ORG.id]));
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, null, "ai_generation", "anthropic_claude", claude!.id, vlastnik.id));
  const tplAtmo = await d.one<{ id: string }>("select id from marketing.templates where key = 'atmosfera'");
  const fotoPerla = await d.one<{ id: string }>("select id from marketing.media_assets where venue_id = $1 limit 1", [PERLA]);
  const bezKlice = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Návrh bez klíče", purpose: "atmosfera", templateId: tplAtmo!.id, brief: "Zkouška selhání", channels: ["instagram"], formats: ["instagram_feed"], mediaAssetIds: [fotoPerla!.id], inputs: { title: "Zkouška" } }));
  await ocekavatChybu("bez klíče AI návrh selže a řekne proč", () =>
    jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: bezKlice.itemId, userId: manazer.id })), /chybí API klíč/i);
  const verzePoAi = await d.one<{ n: number }>("select count(*)::int as n from marketing.content_versions where content_item_id = $1", [bezKlice.itemId]);
  check("selhaný návrh nezaložil verzi s vymyšleným textem", verzePoAi?.n === 1);
  const konceptZil = await d.one<{ brief: string }>("select v.brief from marketing.content_items i join marketing.content_versions v on v.id = i.current_version_id where i.id = $1", [bezKlice.itemId]);
  check("koncept i se zadáním přežil selhání AI (nemusí se psát znovu)", konceptZil?.brief === "Zkouška selhání");
  // Aplikace zapisuje selhání až po vrácení transakce zpátky — uvnitř ní
  // by se zápis ztratil s ní. Tady se dělá totéž co v obrazovce a v API.
  await oznacitSelhaniNavrhu(manazer.id, bezKlice.itemId);
  const stavPoAi = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [bezKlice.itemId]);
  check("selhání je vidět v Přehledu jako generation_failed", stavPoAi?.status === "generation_failed");
  const mockAi = await d.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'internal_mock_ai' and revoked_at is null", [DEMO_ORG.id]);
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, null, "ai_generation", "internal_mock_ai", mockAi!.id, vlastnik.id));

  // --- (e) selhání renderu: vybraný Shotstack bez klíče --------------
  const shotstack = await jako(d, vlastnik.id, (tx) => tx.one<{ id: string }>(
    "insert into marketing.integration_connections (organization_id, provider_key, mode, status, display_name) values ($1, 'shotstack', 'customer_managed', 'connected', 'Shotstack bez klíče') returning id", [DEMO_ORG.id]));
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, null, "video_rendering", "shotstack", shotstack!.id, vlastnik.id));
  const reelItem = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Reel bez renderu", purpose: "atmosfera", templateId: tplAtmo!.id, brief: "Krátké video z fotek", channels: ["instagram"], formats: ["instagram_reel"], mediaAssetIds: [fotoPerla!.id], inputs: { title: "Večer u nás" } }));
  const reelNav = await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: reelItem.itemId, userId: manazer.id }));
  const reelVar = await d.one<{ id: string }>("select id from marketing.content_variants where content_version_id = $1 and format = 'reel'", [reelNav.versionId]);
  const reelRend = await jako(d, manazer.id, (tx) => spustitRender(tx, { versionId: reelNav.versionId, variantId: reelVar!.id, userId: manazer.id }));
  check("render bez klíče skončí jako failed, ne jako hotový", reelRend.status === "failed");
  const reelJob = await d.one<{ status: string; error: string | null; output_asset_id: string | null }>("select status, error, output_asset_id from marketing.render_jobs where variant_id = $1", [reelVar!.id]);
  check("úloha renderu nese srozumitelný důvod", reelJob?.status === "failed" && /Shotstack/.test(reelJob.error ?? ""), reelJob?.error ?? "");
  check("selhaný render nevytvořil žádný výstupní soubor", reelJob?.output_asset_id === null);
  const reelStav = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [reelItem.itemId]);
  check("obsah je označený render_failed", reelStav?.status === "render_failed");
  const mockVideo = await d.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'internal_mock_video' and revoked_at is null", [DEMO_ORG.id]);
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, null, "video_rendering", "internal_mock_video", mockVideo!.id, vlastnik.id));

  // --- (f) publikace: vypršelý token, opakování, dead-letter ---------
  // Meta se tu neptáme sítě: fetch je nahrazený a vrací přesně to, co
  // vrací Graph API (OAuthException 190 = token, 4 = překročený limit).
  const metaConn = await jako(d, vlastnik.id, (tx) => tx.one<{ id: string }>(
    "insert into marketing.integration_connections (organization_id, venue_id, provider_key, mode, status, display_name) values ($1, $2, 'meta_graph', 'customer_managed', 'connected', 'Meta (zkouška)') returning id", [DEMO_ORG.id, PERLA]));
  const sifra = encryptCredentials({ access_token: "TESTOVACI-TOKEN-NIKAM-NEJDE" });
  await jako(d, vlastnik.id, (tx) => tx.q("select marketing.store_secret($1, $2, $3)", [metaConn!.id, sifra.ciphertext, sifra.fingerprint]));
  await jako(d, vlastnik.id, (tx) => tx.q(
    "insert into marketing.social_accounts (organization_id, venue_id, connection_id, platform, kind, external_id, name, capabilities) values ($1, $2, $3, 'instagram', 'ig_business', '17841400000000000', 'Černá Perla', $4)",
    [DEMO_ORG.id, PERLA, metaConn!.id, ["publish.instagram.feed"]]));
  await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, PERLA, "social_publishing", "meta_graph", metaConn!.id, vlastnik.id));

  const puvodniFetch = globalThis.fetch;
  const metaOdpovi = (code: number, message: string, status = 400) => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message, code, type: "OAuthException" } }), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
  };

  const pubItem = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Publikace s vypršelým tokenem", purpose: "atmosfera", templateId: tplAtmo!.id, brief: "Zkouška selhání publikace", channels: ["instagram"], formats: ["instagram_feed"], mediaAssetIds: [fotoPerla!.id], inputs: { title: "Zkouška" } }));
  const pubNav = await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: pubItem.itemId, userId: manazer.id }));
  const pubVar = await d.one<{ id: string }>("select id from marketing.content_variants where content_version_id = $1 and format = 'feed'", [pubNav.versionId]);
  await jako(d, manazer.id, (tx) => spustitRender(tx, { versionId: pubNav.versionId, variantId: pubVar!.id, userId: manazer.id }));
  const pubReq = await jako(d, manazer.id, (tx) => pozadatOSchvaleni(tx, { itemId: pubItem.itemId, userId: manazer.id }));
  await jako(d, schvalovatel.id, (tx) => rozhodnout(tx, { requestId: pubReq, userId: schvalovatel.id, decision: "approved", comment: "" }));
  const pubPlan = await jako(d, manazer.id, (tx) => naplanovat(tx, { itemId: pubItem.itemId, userId: manazer.id, datum: null, cas: null, tz: "Europe/Prague" }));
  const jobId = pubPlan.jobIds[0];
  const pubJobStav = await d.one<{ provider_key: string; social_account_id: string | null }>("select provider_key, social_account_id from marketing.publish_jobs where id = $1", [jobId]);
  check("publikace míří na Meta a na připojený účet", pubJobStav?.provider_key === "meta_graph" && Boolean(pubJobStav.social_account_id));

  metaOdpovi(190, "Error validating access token: Session has expired.");
  const zaklad = Date.now();
  let posledni: { status: string; attempts: number; last_error: string | null; next_attempt_at: string | null } | null = null;
  for (let i = 1; i <= 5; i++) {
    await zpracovatFrontu({ now: new Date(zaklad + i * 3600_000) });
    posledni = await d.one("select status, attempts, last_error, next_attempt_at from marketing.publish_jobs where id = $1", [jobId]);
    if (i === 1) check("první selhání se opakuje, nekončí (odstup je naplánovaný)", posledni?.status === "failed" && posledni.attempts === 1 && Boolean(posledni.next_attempt_at), JSON.stringify(posledni));
  }
  check("po vyčerpání pokusů úloha končí v dead_letter", posledni?.status === "dead_letter" && posledni.attempts === 5, JSON.stringify(posledni));
  check("důvod selhání je vidět a mluví o tokenu", /190|[Tt]oken/.test(posledni?.last_error ?? ""), posledni?.last_error ?? "");
  const zadnaPublikace = await d.one<{ n: number }>("select count(*)::int as n from marketing.publications where content_item_id = $1", [pubItem.itemId]);
  check("selhaná publikace nikdy nezaloží záznam o zveřejnění", zadnaPublikace?.n === 0);
  const stavPoPadu = await d.one<{ status: string }>("select status from marketing.content_items where id = $1", [pubItem.itemId]);
  check("obsah čeká na obnovení připojení, netváří se jako zveřejněný", stavPoPadu?.status === "connection_required");
  const upoz = await d.q<{ user_id: string }>("select user_id from marketing.notifications where kind = 'publish_failed'");
  check("o selhání se dozví lidé s právem publikovat", upoz.length > 0);

  // Překročený limit Meta (kód 4) se má opakovat později, ne selhat natrvalo.
  metaOdpovi(4, "Application request limit reached", 429);
  await jako(d, manazer.id, (tx) => zopakovatPublikaci(tx, jobId));
  const t0 = zaklad + 10 * 3600_000;
  await zpracovatFrontu({ now: new Date(t0) });
  const poLimitu = await d.one<{ status: string; next_attempt_at: string | null; last_error: string | null }>("select status, next_attempt_at, last_error from marketing.publish_jobs where id = $1", [jobId]);
  const odstupMin = poLimitu?.next_attempt_at ? Math.round((new Date(poLimitu.next_attempt_at).getTime() - t0) / 60000) : -1;
  check("překročený limit Meta se odloží o 15 minut, ne zahodí", poLimitu?.status === "failed" && odstupMin === 15, `${poLimitu?.status}, ${odstupMin} min`);

  globalThis.fetch = puvodniFetch;

  // --- (g) duplicitní webhook se přijme, ale nezpracuje podruhé ------
  const w1 = await d.one<{ id: string }>("insert into marketing.webhook_events (provider_key, external_event_id, signature_ok, payload) values ('n8n', 'ev-duplicita', true, '{}'::jsonb) on conflict (provider_key, external_event_id) do nothing returning id");
  const w2 = await d.one<{ id: string }>("insert into marketing.webhook_events (provider_key, external_event_id, signature_ok, payload) values ('n8n', 'ev-duplicita', true, '{}'::jsonb) on conflict (provider_key, external_event_id) do nothing returning id");
  check("stejná událost podruhé už nic nespustí", Boolean(w1?.id) && !w2);
  const kolikUdalosti = await d.one<{ n: number }>("select count(*)::int as n from marketing.webhook_events where provider_key = 'n8n' and external_event_id = 'ev-duplicita'");
  check("v evidenci webhooků je událost jen jednou", kolikUdalosti?.n === 1);
}

console.log("\n9. Spouštění fronty: kdo smí a co tím spustí");
{
  // Rozhraní pouští frontu pod servisní rolí, takže RLS tam neplatí.
  // Kdo smí, se proto musí zjistit předem — přesně tímhle dotazem
  // (app/api/v1/ulohy/zpracovat/route.ts).
  const smi = (uid: string) => jako(d, uid, (tx) => tx.q<{ organization_id: string }>(
    `select m.organization_id from marketing.memberships m
      where m.user_id = (select auth.uid()) and m.status = 'active' and m.deleted_at is null
        and marketing.has_access(m.organization_id, 'content.publish', null)`));
  check("manažer smí frontu spustit", (await smi(manazer.id)).length === 1);
  check("pozorovatel frontu spustit nesmí", (await smi(pozorovatel.id)).length === 0);
  check("schvalovatel bez práva publikovat frontu nespustí", (await smi(schvalovatel.id)).length === 0);
  const bistroOrgs = await smi(bistro.id);
  check("vlastník druhé firmy dostane jen svou organizaci", bistroOrgs.length === 1 && bistroOrgs[0].organization_id === DEMO_ORG_2.id);

  // A co spustí: úloha první firmy nesmí odejít, když frontu pouští druhá.
  const tpl = await d.one<{ id: string }>("select id from marketing.templates where key = 'atmosfera'");
  const foto = await d.one<{ id: string }>("select id from marketing.media_assets where venue_id = $1 limit 1", [PERLA]);
  const mock = await d.one<{ id: string }>("select id from marketing.integration_connections where organization_id = $1 and provider_key = 'mock_publisher' and revoked_at is null", [DEMO_ORG.id]);
  if (mock) await jako(d, vlastnik.id, (tx) => aktivovat(tx, DEMO_ORG.id, PERLA, "social_publishing", "mock_publisher", mock.id, vlastnik.id));
  const r = await jako(d, manazer.id, (tx) => vytvoritObsah(tx, { organizationId: DEMO_ORG.id, venueId: PERLA, userId: manazer.id, title: "Cizí frontu nespouštěj", purpose: "atmosfera", templateId: tpl!.id, brief: "Zkouška rozsahu fronty", channels: ["instagram"], formats: ["instagram_feed"], mediaAssetIds: [foto!.id], inputs: { title: "Zkouška" } }));
  await jako(d, manazer.id, (tx) => navrhnout(tx, { itemId: r.itemId, userId: manazer.id }));
  const zadost = await jako(d, manazer.id, (tx) => pozadatOSchvaleni(tx, { itemId: r.itemId, userId: manazer.id }));
  await jako(d, schvalovatel.id, (tx) => rozhodnout(tx, { requestId: zadost, userId: schvalovatel.id, decision: "approved", comment: "" }));
  const plan = await jako(d, manazer.id, (tx) => naplanovat(tx, { itemId: r.itemId, userId: manazer.id, datum: null, cas: null, tz: "Europe/Prague" }));

  await zpracovatFrontu({ organizationIds: [DEMO_ORG_2.id] });
  const poCizi = await d.one<{ status: string }>("select status from marketing.publish_jobs where id = $1", [plan.jobIds[0]]);
  check("fronta puštěná druhou firmou se úlohy první ani nedotkne", poCizi?.status === "scheduled", poCizi?.status);

  await zpracovatFrontu({ organizationIds: [DEMO_ORG.id] });
  const poSve = await d.one<{ status: string }>("select status from marketing.publish_jobs where id = $1", [plan.jobIds[0]]);
  check("vlastní firma svou úlohu zpracuje", poSve?.status === "published_mock", poSve?.status);
}

console.log("\n10. Zakládání organizací jen na pozvánku");
{
  // V rozhraní na tohle tlačítko není, ale u Supabase jde funkci zavolat
  // přímo přes PostgREST s tokenem kteréhokoli účtu. Proto se to musí
  // ubránit v databázi, ne v obrazovce.
  await ocekavatChybu("bez pozvánky si organizaci nezaloží ani vlastník jiné firmy", () =>
    jako(d, vlastnik.id, (tx) => tx.q("select marketing.create_organization('Podvržená firma', 'podvrzena')")), /pozvánk/i);
  await ocekavatChybu("vymyšlený token neprojde", () =>
    jako(d, pozorovatel.id, (tx) => tx.q("select marketing.create_organization('Podvržená firma', 'podvrzena', $1)", ["nejaky-vymysleny-token"])), /pozvánk/i);
  // Volání se dvěma parametry samo o sobě nic nedokazuje — nová funkce
  // má třetí parametr s výchozí hodnotou, takže se do ní trefí taky.
  // Ptáme se proto katalogu, jestli stará podoba opravdu zmizela.
  const podoby = await d.q<{ args: string }>(
    "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'marketing' and p.proname = 'create_organization'");
  check("existuje jediná podoba create_organization, a to se třetím parametrem na pozvánku",
    podoby.length === 1 && (podoby[0].args.match(/text/g) ?? []).length === 3, podoby.map((x) => x.args).join(" | "));
  await ocekavatChybu("pozvánku si přihlášený uživatel sám nevystaví", () =>
    jako(d, vlastnik.id, (tx) => tx.q("select marketing.create_founder_invitation('kdokoli@example.com')")), /permission denied|oprávnění/i);
  await ocekavatChybu("do tabulky pozvánek se přihlášený nepodívá", () =>
    jako(d, vlastnik.id, (tx) => tx.q("select * from marketing.founder_invitations")), /permission denied/i);

  // Správce (servisní role) pozvánku vystaví — token dostane jednou.
  const token = (await d.one<{ t: string }>("select marketing.create_founder_invitation($1, 'Nová restaurace', 14) as t", ["novy@example.com"]))!.t;
  check("token pozvánky je dost dlouhý a v databázi leží jen otisk", token.length === 64
    && (await d.one<{ n: number }>("select count(*)::int as n from marketing.founder_invitations where token_hash = $1", [token]))!.n === 0);

  // Účet, na který pozvánka nezní, ji nepoužije.
  await ocekavatChybu("cizí účet pozvánku nevyužije, i když zná token", () =>
    jako(d, vlastnik.id, (tx) => tx.q("select marketing.create_organization('Cizí pokus', 'cizi-pokus', $1)", [token])), /pozvánk/i);

  // Nový uživatel s tím e-mailem organizaci založí.
  const novy = await d.one<{ id: string }>("insert into auth.users (email) values ($1) returning id", ["novy@example.com"]);
  const orgId = (await jako(d, novy!.id, (tx) => tx.one<{ id: string }>("select marketing.create_organization('Nová restaurace', 'nova-restaurace', $1) as id", [token])))!.id;
  check("pozvaný uživatel organizaci založí a je v ní vlastníkem", Boolean(orgId)
    && (await d.one<{ n: number }>("select count(*)::int as n from marketing.memberships m join marketing.roles r on r.id = m.role_id where m.organization_id = $1 and m.user_id = $2 and r.is_owner", [orgId, novy!.id]))!.n === 1);

  await ocekavatChybu("stejná pozvánka podruhé neprojde", () =>
    jako(d, novy!.id, (tx) => tx.q("select marketing.create_organization('Druhá firma', 'druha-firma', $1)", [token])), /pozvánk/i);

  // Propadlá pozvánka je stejně neplatná jako použitá.
  const propadly = (await d.one<{ t: string }>("select marketing.create_founder_invitation($1, '', 1) as t", ["pozdni@example.com"]))!.t;
  await d.q("update marketing.founder_invitations set expires_at = now() - interval '26 hours' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [propadly]);
  const pozdni = await d.one<{ id: string }>("insert into auth.users (email) values ($1) returning id", ["pozdni@example.com"]);
  await ocekavatChybu("propadlá pozvánka neprojde", () =>
    jako(d, pozdni!.id, (tx) => tx.q("select marketing.create_organization('Pozdě', 'pozde', $1)", [propadly])), /pozvánk/i);
}

await d.close();
process.exit(souhrn());
