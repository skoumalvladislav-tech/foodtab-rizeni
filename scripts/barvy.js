#!/usr/bin/env node
/**
 * Kontrola palety — kontrastní poměr a barevná vzdálenost.
 *
 * Pusť `node scripts/barvy.js`. Hodnoty se čtou z app/_tokeny.css, ne
 * z tabulky v zadání — kontroluje se to, co je opravdu v souboru.
 *
 * MĚŘÍ SE DVĚ RŮZNÉ VĚCI a jedna druhou nenahrazuje:
 *
 *   Přečtu ten text?          kontrastní poměr   4,5 text / 3,0 plochy
 *   Poznám ty dvě barvy?      ΔE2000             15 světlý / 14 tmavý
 *
 * Kontrast měří jen rozdíl světlosti. Fialová a růžová o stejné světlosti
 * mají poměr 1,00 a přitom je od sebe každý pozná; dvě zelené o stejné
 * světlosti mají taky 1,00 a od sebe je nepozná nikdo. Proto se přidala
 * ΔE — původní paleta měla u firmy proti emeraldu vzdálenost 2,4, tedy
 * pro oko tutéž barvu, a kontrastní tabulka na tom neviděla nic špatného.
 *
 * Proč má tmavý režim nižší hranici, je v docs/vzhled-oprava-1.md.
 *
 * Konec: 0 když všechno projde, 1 když ne. Dá se pověsit do CI.
 */

import fs from 'node:fs';
import path from 'node:path';

const TOKENY = path.join(import.meta.dirname, '..', 'app', '_tokeny.css');
const KLICE = ['firma', 'slate', 'indigo', 'violet', 'sky', 'teal', 'emerald', 'amber', 'rose'];
const MEZ_DE = { svetlo: 15, tma: 14 };

/* --- kontrastní poměr (WCAG 2.1) ------------------------------------ */

function slozky(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function jas(hex) {
  const [r, g, b] = slozky(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function pomer(a, b) {
  const x = jas(a);
  const y = jas(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* --- ΔE2000 --------------------------------------------------------- */

const stupne = (r) => (r * 180) / Math.PI;
const radiany = (d) => (d * Math.PI) / 180;

function lab(hex) {
  const [r, g, b] = slozky(hex).map((c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  // sRGB → XYZ, bílý bod D65
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;

  const e = Math.pow(6 / 29, 3);
  const f = (t) => (t > e ? Math.cbrt(t) : t / (3 * Math.pow(6 / 29, 2)) + 4 / 29);
  const fx = f(X / 0.95047);
  const fy = f(Y / 1.0);
  const fz = f(Z / 1.08883);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE00(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cstred = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cstred, 7) / (Math.pow(Cstred, 7) + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const uhel = (b, ap) => {
    if (b === 0 && ap === 0) return 0;
    const h = stupne(Math.atan2(b, ap));
    return h < 0 ? h + 360 : h;
  };
  const h1p = uhel(b1, a1p);
  const h2p = uhel(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(radiany(dhp) / 2);

  const Lstredp = (L1 + L2) / 2;
  const Cstredp = (C1p + C2p) / 2;

  let Hstredp;
  if (C1p * C2p === 0) Hstredp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) Hstredp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) Hstredp = (h1p + h2p + 360) / 2;
  else Hstredp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(radiany(Hstredp - 30)) +
    0.24 * Math.cos(radiany(2 * Hstredp)) +
    0.32 * Math.cos(radiany(3 * Hstredp + 6)) -
    0.20 * Math.cos(radiany(4 * Hstredp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((Hstredp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cstredp, 7) / (Math.pow(Cstredp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lstredp - 50, 2)) / Math.sqrt(20 + Math.pow(Lstredp - 50, 2));
  const Sc = 1 + 0.045 * Cstredp;
  const Sh = 1 + 0.015 * Cstredp * T;
  const Rt = -Math.sin(radiany(2 * dTheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

const de = (a, b) => deltaE00(lab(a), lab(b));

/* --- samokontrola vzorce -------------------------------------------- */

/**
 * Zveřejněná testovací data (Sharma, Wu, Dalal 2005).
 *
 * Bez tohohle by chyba ve vzorci prošla tiše: čísla by pořád vypadala
 * rozumně a nikdo by nepoznal, že měří něco jiného.
 */
function samokontrola() {
  const testy = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.6940], [23.0331, 14.9730, -42.5619], 2.0373],
  ];
  const spatne = testy.filter(([a, b, ocek]) => Math.abs(deltaE00(a, b) - ocek) >= 0.0002);
  if (spatne.length) {
    console.error('CHYBA: vzorec ΔE2000 nesedí na ' + spatne.length + ' referenčních hodnotách.');
    console.error('Výsledkům se nedá věřit, kontrola se nespouští.');
    process.exit(2);
  }
}

/* --- čtení tokenů ---------------------------------------------------- */

const HEX = '0123456789abcdef';

function hexZaKlicem(radek, od) {
  const i = radek.indexOf('#', od);
  if (i < 0) return null;
  const h = radek.slice(i, i + 7).toLowerCase();
  if (h.length !== 7) return null;
  for (let j = 1; j < 7; j++) if (!HEX.includes(h[j])) return null;
  return h;
}

/**
 * Dvě pomlčky před názvem stačí jako hranice slova: '--ink:' se
 * v '--branch-ink:' nevyskytuje, protože tam je před 'ink' jen jedna.
 */
function ctiToken(blok, jmeno) {
  for (const radek of blok.split('\n')) {
    const i = radek.indexOf('--' + jmeno + ':');
    if (i >= 0) {
      const h = hexZaKlicem(radek, i);
      if (h) return h;
    }
  }
  return null;
}

function vyrez(css, od, doo) {
  const a = css.indexOf(od);
  if (a < 0) return '';
  const b = doo ? css.indexOf(doo, a + od.length) : css.length;
  return css.slice(a, b < 0 ? css.length : b);
}

function ctiRail(css, klic, tmavy) {
  const cast = css.slice(css.indexOf('Klíč barvy z branches.color'));
  const hlava = (tmavy ? ':root[data-theme="dark"] ' : '') + '[data-branch="' + klic + '"]';
  const radky = cast.split('\n');
  for (let i = 0; i < radky.length; i++) {
    if (!radky[i].startsWith(hlava)) continue;
    const kus = radky.slice(i, i + (tmavy ? 1 : 3)).join('\n');
    return ['rail', 'rail-2', 'rail-tlum'].map((n) => ctiToken(kus, n));
  }
  return null;
}

/* --- kontrola -------------------------------------------------------- */

function main() {
  samokontrola();

  const css = fs.readFileSync(TOKENY, 'utf8');
  const bloky = {
    svetlo: vyrez(css, ':root {', '@media (prefers-color-scheme: dark)'),
    tma: vyrez(css, ':root[data-theme="dark"] {', '/* ---'),
  };
  const railInk = ctiToken(bloky.svetlo, 'rail-ink');

  const zavady = [];
  let overeno = 0;

  const zkus = (popis, a, b, mez) => {
    if (!a || !b) { zavady.push('chybí hodnota: ' + popis); return null; }
    overeno++;
    const v = pomer(a, b);
    if (v < mez) zavady.push(popis + ': ' + v.toFixed(2) + ' < ' + mez.toFixed(1));
    return v;
  };

  for (const rezim of ['svetlo', 'tma']) {
    const blok = bloky[rezim];
    const t = (n) => ctiToken(blok, n);
    const predZakladem = overeno;
    console.log('\n=== ' + (rezim === 'svetlo' ? 'SVĚTLÝ' : 'TMAVÝ') + ' REŽIM ===\n');

    zkus('--ink na --paper', t('ink'), t('paper'), 4.5);
    zkus('--ink na --card', t('ink'), t('card'), 4.5);
    zkus('--muted na --paper', t('muted'), t('paper'), 4.5);
    zkus('--muted na --card', t('muted'), t('card'), 4.5);
    zkus('--mosaz na --paper', t('mosaz'), t('paper'), 4.5);
    zkus('--mosaz na --card', t('mosaz'), t('card'), 4.5);
    zkus('--mosaz-ink na --mosaz-sv', t('mosaz-ink'), t('mosaz-sv'), 4.5);
    zkus('--accent-ink na --mosaz', t('accent-ink'), t('mosaz'), 4.5);
    zkus('--dobre na --dobre-bg', t('dobre'), t('dobre-bg'), 4.5);
    zkus('--pozor na --pozor-bg', t('pozor'), t('pozor-bg'), 4.5);
    zkus('--bad na --bad-bg', t('bad'), t('bad-bg'), 4.5);
    zkus('--faint na --paper (jen výzdoba)', t('faint'), t('paper'), 3.0);

    console.log('  kontrast základu: ' + (overeno - predZakladem) + ' dvojic');

    // devět klíčů rozsahu
    const hlavicka = ['klíč     ', 'ink/rail', 'ink/r-2', 'tlum/r', 'tlum/r-2', 'mosaz', 'br/pap', 'ink/fill', 'fill/pap', 'br/soft'];
    console.log('\n  ' + hlavicka.map((h, i) => (i ? h.padStart(9) : h)).join(''));

    for (const k of KLICE) {
      const rail = ctiRail(css, k, rezim === 'tma');
      if (!rail) { zavady.push('nenalezen blok ' + k); continue; }
      const [r1, r2, tlum] = rail;
      const br = ctiToken(blok, 'b-' + k);
      const fill = ctiToken(blok, 'b-' + k + '-fill');
      const soft = ctiToken(blok, 'b-' + k + '-soft');
      const hodnoty = [
        zkus(k + ' rail-ink/rail', railInk, r1, 4.5),
        zkus(k + ' rail-ink/rail-2', railInk, r2, 4.5),
        zkus(k + ' tlum/rail', tlum, r1, 4.5),
        zkus(k + ' tlum/rail-2', tlum, r2, 4.5),
        zkus(k + ' mosaz-sv vs rail-2', t('mosaz-sv'), r2, 3.0),
        zkus(k + ' branch/paper', br, t('paper'), 4.5),
        zkus(k + ' branch-ink/fill', t('branch-ink'), fill, 4.5),
        zkus(k + ' fill vs paper', fill, t('paper'), 3.0),
        zkus(k + ' branch/soft', br, soft, 4.5),
      ];
      console.log('  ' + k.padEnd(9) + hodnoty.map((v) => (v === null ? '—' : v.toFixed(2)).padStart(9)).join(''));
    }

    // matice ΔE mezi lištami
    const mez = MEZ_DE[rezim];
    let nej = Infinity;
    let nejDvojice = null;
    console.log('\n  ΔE2000 mezi --rail (hranice ' + mez + '):');
    console.log('  ' + 'klíč     ' + KLICE.map((k) => k.slice(0, 4).padStart(7)).join(''));
    for (const a of KLICE) {
      const radek = KLICE.map((b) => {
        if (a === b) return '      ·';
        const ra = ctiRail(css, a, rezim === 'tma');
        const rb = ctiRail(css, b, rezim === 'tma');
        if (!ra || !rb) return '      ?';
        const d = de(ra[0], rb[0]);
        if (d < nej) { nej = d; nejDvojice = a + '/' + b; }
        return d.toFixed(1).padStart(7);
      });
      console.log('  ' + a.padEnd(9) + radek.join(''));
    }
    console.log('  nejmenší ΔE: ' + nej.toFixed(1) + ' (' + nejDvojice + ')');
    if (nej < mez) zavady.push('ΔE ' + nejDvojice + ': ' + nej.toFixed(1) + ' < ' + mez);
  }

  console.log('\n' + '─'.repeat(60));
  if (zavady.length) {
    console.log('POD HRANICÍ (' + zavady.length + '):');
    zavady.forEach((z) => console.log('  ' + z));
    process.exit(1);
  }
  console.log('Ověřeno ' + overeno + ' kontrastních dvojic a dvě matice ΔE. Všechno projde.');
}

main();
