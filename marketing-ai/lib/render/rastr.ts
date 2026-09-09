import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Převod vykresleného SVG na PNG nebo JPEG.
 *
 * PROČ to tu je: Instagram ani Facebook SVG nepřijmou. Bez tohohle kroku
 * by šlo obrázek jen stáhnout a nahrát ručně — vestavěné vykreslení by
 * se nedalo doopravdy zveřejnit.
 *
 * FONTY. Sazbu dělá fontconfig zabalený uvnitř sharpu — ne ten systémový.
 * Řídí se proměnnou FONTCONFIG_PATH, která ukazuje na SLOŽKU se souborem
 * `fonts.conf` (FONTCONFIG_FILE si sharp nevšímá).
 *
 * V Lambdě (Vercel) nejsou žádné systémové fonty. Text tam ale nezmizí:
 * pango si sáhne po vlastním záložním písmu. Zmizí ZNAČKA — nadpisy
 * v Newsreaderu a texty v Archivu se vysází něčím jiným a obrázek se
 * tváří, že je v pořádku. Proto:
 *
 *  1. písma jsou v repozitáři (`assets/fonty`, licence OFL),
 *  2. fontconfig na ně dostane ukazatel dřív, než se poprvé sáhne
 *     na sharp,
 *  3. při prvním převodu se OVĚŘÍ, že se opravdu použijí: stejný text
 *     se vysází v Newsreaderu a v neexistujícím písmu. Když vyjdou
 *     stejně, naše složka registrovaná není a převod skončí chybou —
 *     místo aby se roznesly příspěvky v cizím písmu.
 */

const SLOZKA_FONTU = join(process.cwd(), "assets", "fonty");

/** PNG větší než tohle se uloží jako JPEG — fotografie dělají obrovské PNG. */
const STROP_PNG_BAJTU = 2 * 1024 * 1024;

type Sharp = typeof import("sharp");
let sharpPromise: Promise<Sharp> | null = null;
let fontyOvereny: Promise<void> | null = null;

/**
 * Napíše fontconfigu konfiguraci s naší složkou písem. Systémovou
 * konfiguraci přibírá, ale nespoléhá na ni (`ignore_missing`), takže
 * to funguje stejně na notebooku i v Lambdě.
 */
function pripravitFontconfig(): void {
  // Vlastní nastavení správce serveru má přednost — ověření níž pak
  // řekne, jestli v něm naše písma jsou.
  if (process.env.FONTCONFIG_PATH) return;
  const kam = join(tmpdir(), "foodtab-fontconfig");
  const cache = join(kam, "cache");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(kam, "fonts.conf"), `<?xml version="1.0"?>
<fontconfig>
  <dir>${SLOZKA_FONTU}</dir>
  <cachedir>${cache}</cachedir>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Archivo</string></edit>
  </match>
  <match target="pattern">
    <test qual="any" name="family"><string>serif</string></test>
    <edit name="family" mode="prepend" binding="same"><string>Newsreader</string></edit>
  </match>
</fontconfig>
`, "utf8");
  process.env.FONTCONFIG_PATH = kam;
}

async function nacistSharp(): Promise<Sharp> {
  if (!sharpPromise) {
    pripravitFontconfig();
    sharpPromise = import("sharp").then((m) => (m.default ?? m) as unknown as Sharp);
  }
  return sharpPromise;
}

/**
 * Ověří, že se sází NAŠIMI písmy. Newsreader je patkový a od každého
 * bezpatkového náhradníka se liší na první pohled — když vyjde stejně
 * jako neexistující písmo, žádné naše se nenašlo.
 */
async function overitSazbu(): Promise<void> {
  if (!existsSync(SLOZKA_FONTU)) {
    throw new Error(`Chybí složka s písmy (${SLOZKA_FONTU}). Obrázky by se vysázely cizím písmem.`);
  }
  const sharp = await nacistSharp();
  const zkouska = (pismo: string) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="80">'
    + '<rect width="360" height="80" fill="#ffffff"/>'
    + `<text x="6" y="58" font-family="${pismo}" font-size="42" fill="#000000">Řízek 169 Kč</text></svg>`, "utf8");
  const [nase, nahradnik] = await Promise.all([
    sharp(zkouska("Newsreader")).png().toBuffer(),
    sharp(zkouska("Takove Pismo Neexistuje")).png().toBuffer(),
  ]);
  if (nase.equals(nahradnik)) {
    throw new Error(
      `Písma z ${SLOZKA_FONTU} se nepoužila — sází se náhradníkem, takže by obrázky nedržely vzhled značky. `
      + "Zkontrolujte FONTCONFIG_PATH a to, že se složka s písmy dostala do nasazeného balíčku.");
  }
}

function fontySeSazi(): Promise<void> {
  if (!fontyOvereny) fontyOvereny = overitSazbu();
  return fontyOvereny;
}

export interface Rastr {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  pripona: "png" | "jpg";
  width: number;
  height: number;
}

/**
 * SVG → PNG (a při velkém objemu JPEG). Rozměry se vynucují, aby výstup
 * přesně odpovídal formátu, i kdyby se šablona spletla o pixel.
 */
export async function rastrovat(svg: string, o: { width: number; height: number; kvalitaJpeg?: number; stropPngBajtu?: number }): Promise<Rastr> {
  await fontySeSazi();
  const sharp = await nacistSharp();
  const zdroj = () => sharp(Buffer.from(svg, "utf8"), { density: 96 }).resize(o.width, o.height, { fit: "fill" });

  const png = await zdroj().png({ compressionLevel: 9 }).toBuffer();
  if (png.length <= (o.stropPngBajtu ?? STROP_PNG_BAJTU)) {
    return { bytes: new Uint8Array(png), mime: "image/png", pripona: "png", width: o.width, height: o.height };
  }
  const jpeg = await zdroj().flatten({ background: "#ffffff" }).jpeg({ quality: o.kvalitaJpeg ?? 88, mozjpeg: true }).toBuffer();
  return { bytes: new Uint8Array(jpeg), mime: "image/jpeg", pripona: "jpg", width: o.width, height: o.height };
}
