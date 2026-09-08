/**
 * Scénáře nad PGlite — náhrada `supabase/tests/run.sh` pro stroj, na
 * kterém není PostgreSQL.
 *
 * PROČ TOHLE EXISTUJE. `run.sh` potřebuje lokální PostgreSQL a psql.
 * Na Windows stroji, na kterém se pracuje, není ani jedno, takže se
 * databázová práce psala naslepo a čekalo se, až ji Šéfík prožene
 * proti opravdové databázi. Tohle to zkracuje: chyby v SQL, překlepy
 * ve jménech sloupců a rozbité scénáře se poznají hned.
 *
 * ---------------------------------------------------------------------
 * CO TENHLE BĚH NEOVĚŘÍ — a je to důležitější než co ověří
 *
 * PGlite běží jako JEDINÝ uživatel a je to superuživatel. Z toho plyne:
 *
 *   * `set role authenticated` neudělá to, co na Supabase. RLS se tedy
 *     ve velké části scénářů NEUPLATNÍ a kontroly typu „cizí firma to
 *     nevidí" tu můžou projít i nad rozbitou politikou. Přesně tahle
 *     past je popsaná v CLAUDE.md u `krok9`.
 *   * Sloupcové granty (`permission denied for column`) se neprojeví.
 *   * `pgcrypto` a `citext` v PGlite nejsou; harness je zakládá jen
 *     proto, aby test odhalil, kdyby na nich migrace omylem stály.
 *     Tady se ty dva příkazy přeskočí a vypíše se to.
 *
 * ZELENÝ BĚH ODSUD TEDY NENÍ DŮKAZ, ŽE JE HOTOVO. Je to důkaz, že se
 * SQL dá spustit a že logika bez RLS sedí. Rozhoduje workflow Databáze
 * proti PostgreSQL 16 — tenhle skript ho nenahrazuje a nemá ambici.
 *
 * Použití:
 *   node scripts/scenare-pglite.mjs              (všechny scénáře)
 *   node scripts/scenare-pglite.mjs krok29_scenar krok30_scenar
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACE = path.join(ROOT, "supabase/migrations");
const TESTY = path.join(ROOT, "supabase/tests");

/* ---------------------------------------------------------------------
   Rozdělení souboru na kousky.

   Není to plnohodnotný psql. Umí jen to, co scénáře v tomhle
   repozitáři opravdu používají: \echo, \set, \gset, \ir, \i a příkazy
   oddělené středníkem s respektem k dollar-quoting ($$ … $$).

   Meta-příkaz se pozná podle zpětného lomítka na začátku řádku. Když
   se to lomítko ztratí — a už se to v tomhle repozitáři dvakrát stalo
   —, spadne to tady jako neznámý SQL příkaz, ne tiše.
--------------------------------------------------------------------- */
export function kousky(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let tag = null;
  let naZacatkuRadku = true;

  const pushSql = () => {
    if (buf.trim()) out.push({ typ: "sql", text: buf.trim() });
    buf = "";
  };

  while (i < sql.length) {
    const c = sql[i];

    if (tag) {
      if (sql.startsWith(tag, i)) { buf += tag; i += tag.length; tag = null; continue; }
      buf += c; i++; continue;
    }

    // Meta-příkaz: zpětné lomítko na začátku řádku, nebo `\gset` na konci
    // dotazu (tam mu předchází mezera, ne začátek řádku).
    if (c === "\\") {
      const konecRadku = sql.indexOf("\n", i);
      const radek = (konecRadku === -1 ? sql.slice(i) : sql.slice(i, konecRadku)).trim();
      if (naZacatkuRadku || /^\\gset\b/.test(radek)) {
        const dotaz = buf.trim();
        buf = "";
        out.push({ typ: "meta", text: radek, dotaz });
        i = konecRadku === -1 ? sql.length : konecRadku + 1;
        naZacatkuRadku = true;
        continue;
      }
    }

    if (c === "-" && sql[i + 1] === "-") {
      const k = sql.indexOf("\n", i);
      const kus = k === -1 ? sql.slice(i) : sql.slice(i, k + 1);
      buf += kus; i += kus.length; naZacatkuRadku = true; continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const k = sql.indexOf("*/", i + 2);
      const kus = k === -1 ? sql.slice(i) : sql.slice(i, k + 2);
      buf += kus; i += kus.length; naZacatkuRadku = false; continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      buf += sql.slice(i, j); i = j; naZacatkuRadku = false; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') { j += 2; continue; }
        if (sql[j] === '"') { j++; break; }
        j++;
      }
      buf += sql.slice(i, j); i = j; naZacatkuRadku = false; continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (m) { tag = m[0]; buf += tag; i += tag.length; naZacatkuRadku = false; continue; }
    }
    if (c === ";") { pushSql(); i++; naZacatkuRadku = false; continue; }

    buf += c;
    naZacatkuRadku = c === "\n";
    i++;
  }
  pushSql();
  return out;
}

/* ---------------------------------------------------------------------
   Dosazení psql proměnných.

   `:'jmeno'` je hodnota v apostrofech, `:jmeno` holá. Nedefinovaná
   proměnná se NEDOSAZUJE — dotaz pak spadne na syntaktické chybě
   u dvojtečky, přesně jako v psql. Je to schválně: `\gset` nad NULL
   proměnnou nezaloží a tahle vlastnost tu chybu odhalí místo aby ji
   schovala (CLAUDE.md, „\gset nad prázdnou hodnotou").
--------------------------------------------------------------------- */
export function dosad(text, prom) {
  let out = text.replace(/:'([A-Za-z_][A-Za-z_0-9]*)'/g, (celé, jm) =>
    Object.prototype.hasOwnProperty.call(prom, jm)
      ? `'${String(prom[jm]).split("'").join("''")}'`
      : celé,
  );
  out = out.replace(/(^|[^:\w]):([A-Za-z_][A-Za-z_0-9]*)\b/g, (celé, pred, jm) =>
    Object.prototype.hasOwnProperty.call(prom, jm) ? `${pred}${prom[jm]}` : celé,
  );
  return out;
}

/*
  Kontroly se počítají z NOTICE, ne z počtu příkazů.

  `pg_temp.check` při úspěchu dělá `raise notice '  OK    %'`. Kdyby se
  místo toho počítaly příkazy obsahující `pg_temp.check(`, vyšlo by
  míň: scénáře volají kontroly i uvnitř `do $$ … $$`, což je JEDEN
  příkaz s libovolným počtem kontrol uvnitř. Číslo by pak nešlo
  porovnat s během `run.sh` — a číslo, které nejde porovnat, je horší
  než žádné.
*/
let kontrolyOK = 0;
// `onNotice` je volba DOTAZU, ne spojení — musí se předat každému
// `exec`/`query`, jinak se mlčky nic nepočítá.
const NA_NOTICE = (n) => {
  if (/^\s*OK\s\s+/.test(String(n?.message ?? ""))) kontrolyOK++;
};
const db = await PGlite.create();

/*
  `\gset` musí uložit TEXTOVOU podobu, jakou by vypsal server — psql
  žádné typy nepřevádí. PGlite ale bez tohohle vrací javascriptové
  hodnoty: z `true` je `true` místo `t` a z `date` celý ISO okamžik
  včetně času a pásma. Scénáře přitom porovnávají `:'v_praci' = 'f'`
  a `= :'dnes'`, takže by se rozešly na typech, ne na logice — a to je
  ta nejhorší podoba červené: vypadá jako chyba v kódu.

  Identická funkce jako parser vrátí surový text ze serveru. NULL se
  parserem nežene, takže zůstane NULL a proměnná se nezaloží — přesně
  jak to dělá psql.
*/
const SUROVY_TEXT = {};
for (const oid of [
  // skaláry
  16, 17, 20, 21, 23, 25, 26, 114, 700, 701, 1082, 1083, 1114, 1184, 1700,
  2950, 3802,
  // POLE. Bez nich je z `text[]` javascriptové pole a `String()` z něj
  // udělá „a,b" místo `{a,b}` — dotaz, který tu hodnotu vrátí zpátky do
  // funkce s parametrem `text[]`, pak spadne na „malformed array
  // literal". psql ukládá literál i s krajními složenými závorkami.
  1000, 1001, 1005, 1007, 1009, 1015, 1016, 1021, 1022, 1115, 1182, 1183,
  1185, 1231, 2951,
]) {
  SUROVY_TEXT[oid] = (v) => v;
}

const prom = Object.create(null);
const preskocene = [];

async function pustSql(sql, kdeInfo) {
  await db.exec(dosad(sql, prom), { onNotice: NA_NOTICE });
  void kdeInfo;
}

async function pustSoubor(cesta) {
  const jmeno = path.basename(cesta);
  const sql = readFileSync(cesta, "utf8");
  for (const k of kousky(sql)) {
    if (k.typ === "sql") {
      if (/^\s*create\s+extension\b/i.test(k.text)) {
        preskocene.push(`${jmeno}: ${k.text.replace(/\s+/g, " ").slice(0, 70)}`);
        continue;
      }
      await pustSql(k.text, jmeno);
      continue;
    }

    const m = k.text;
    if (/^\\echo\b/.test(m)) {
      const t = m.slice(5).trim().replace(/^'([\s\S]*)'$/, "$1");
      console.log(t);
    } else if (/^\\set\b/.test(m)) {
      const [, jm, ...zbytek] = m.split(/\s+/);
      if (jm && !/^ON_ERROR_STOP$/i.test(jm)) prom[jm] = zbytek.join(" ");
    } else if (/^\\gset\b/.test(m)) {
      const dotaz = dosad(k.dotaz, prom);
      const r = await db.query(dotaz, [], { parsers: SUROVY_TEXT, onNotice: NA_NOTICE });
      // Do hlášky patří ten dotaz, ne komentáře nad ním — jinak se
      // nepozná, který `\gset` to byl.
      const holy = dotaz
        .split("\n")
        .filter((r2) => r2.trim() && !r2.trim().startsWith("--"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!r.rows.length) throw new Error(`\\gset nevrátil žádný řádek: ${holy.slice(0, 160)}`);
      if (r.rows.length > 1) throw new Error(`\\gset vrátil víc řádků: ${holy.slice(0, 160)}`);
      for (const [kl, hod] of Object.entries(r.rows[0])) {
        // NULL proměnnou NEZALOŽÍ — stejně jako psql. Pomocná vrstva,
        // která z NULL udělá prázdný řetězec, tuhle třídu chyb schová
        // a scénář spadne až proti opravdovému PostgreSQL.
        if (hod === null || hod === undefined) continue;
        prom[kl] = String(hod);
      }
    } else if (/^\\i[r]?\b/.test(m)) {
      const rel = m.replace(/^\\i[r]?\s+/, "").trim();
      await pustSoubor(path.resolve(path.dirname(cesta), rel));
    } else {
      throw new Error(`neznámý meta-příkaz: ${m}`);
    }
  }
}

/* --------------------------------------------------------------- běh */
const vybrane = process.argv.slice(2);

const h = path.join(TESTY, "00_harness.sql");
await pustSoubor(h);

for (const m of readdirSync(MIGRACE).filter((f) => f.endsWith(".sql")).sort()) {
  await pustSoubor(path.join(MIGRACE, m));
}
console.log(`\n(migrace prošly, kontroly se počítají až od scénářů)`);
kontrolyOK = 0;

// Pořadí se čte z run.sh, ať se nemůže rozejít se skutečným během.
const runSh = readFileSync(path.join(TESTY, "run.sh"), "utf8");
const poradi = [...runSh.matchAll(/^for t in ([^;]+);\s*do$/gm)]
  .flatMap((m) => m[1].trim().split(/\s+/));

const scenare = (vybrane.length ? vybrane : poradi).filter((s) =>
  existsSync(path.join(TESTY, `${s}.sql`)),
);

const spadle = [];
for (const s of scenare) {
  const pred = kontrolyOK;
  try {
    /*
      `run.sh` pouští každý scénář VLASTNÍM psql, takže mu začíná čisté
      sezení: žádná zděděná role, prázdné pg_temp a žádné proměnné
      z předchozího souboru. Tady jde všechno jedním spojením, takže se
      to musí napodobit ručně — jinak scénář zdědí `set role
      authenticated` od předchozího a `create or replace function
      pg_temp.check` spadne na „must be owner of function check".

      Prázdné proměnné jsou u toho to podstatné: kdyby se přenášely,
      scénář, který si zapomene `\gset` svůj `:tenant`, by tu prošel
      a proti opravdovému psql spadl.
    */
    await db.exec("reset role; discard temp;");
    for (const k of Object.keys(prom)) delete prom[k];

    await pustSoubor(path.join(TESTY, `${s}.sql`));
    console.log(`   ${s}: ${kontrolyOK - pred} kontrol`);
  } catch (e) {
    spadle.push(s);
    console.log(`\n=== SELHALO: ${s} ===`);
    console.log(`   ${e.message}`);
    console.log(`   (do pádu prošlo v tomhle scénáři ${kontrolyOK - pred} kontrol)\n`);
  }
}

console.log(`\n=====================================================`);
console.log(`KONTROL PROŠLO: ${kontrolyOK}   (PGlite, ne PostgreSQL)`);
if (preskocene.length) {
  console.log(`PŘESKOČENO ${preskocene.length}: ${preskocene.map((p) => p.split(": ")[1]).join(", ")}`);
}
if (spadle.length) {
  console.log(`SPADLO ${spadle.length} scénářů: ${spadle.join(", ")}`);
  process.exit(1);
}
console.log(`Žádný scénář nespadl. Rozhoduje ale běh proti PostgreSQL.`);
