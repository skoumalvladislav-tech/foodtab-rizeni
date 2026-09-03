#!/usr/bin/env node
/**
 * Vygeneruje ikony pro kioskový manifest.
 *
 * Pusť `node scripts/kiosek-ikona.mjs`. Zapíše do `public/`:
 *
 *   kiosek-icon-192.png            zakulacená, pro „any“
 *   kiosek-icon-512.png            zakulacená, pro „any“
 *   kiosek-icon-maskable-512.png   na celou plochu, pro „maskable“
 *
 * ---------------------------------------------------------------------
 * PROČ JE TO SKRIPT, A NE JEN OBRÁZEK V REPOZITÁŘI
 *
 * Aby bylo vidět, JAK vznikla, a šla předělat. Binárka v repozitáři se
 * za rok nedá změnit bez hádání, jaký odstín to vlastně byl.
 *
 * ---------------------------------------------------------------------
 * PROČ TAKHLE VYPADÁ
 *
 * Hlavní ikona je TMAVÁ dlaždice se světlým „F“. Kioskovou dělám
 * SVĚTLOU dlaždici s tmavým znakem — obrácený poměr barev. Je to
 * jediný rozdíl, který přežije zmenšení na plochu: na 48 pixelech se
 * tvar znaku ztratí, ale „tmavá vs. světlá“ se pozná i koutkem oka.
 *
 * Znak je oko QR kódu (tři vnořené čtverce), protože to je to, co na
 * kiosku svítí a co s ním člověk dělá. Kdo se u baru dívá na plochu,
 * hledá to, co viděl na obrazovce.
 *
 * Zadání: docs/kiosek-vlastni-manifest.md — „ty dvě ikony se octnou
 * vedle sebe na téže ploše a nesmí jít splést“.
 *
 * ---------------------------------------------------------------------
 * MASKABLE ZVLÁŠŤ
 *
 * Android si maskovatelnou ikonu obřízne do svého tvaru, takže nesmí
 * mít průhledné rohy — jinak z ní zbude dlaždice s uhryzanými kraji.
 * Proto je varianta na celou plochu vedle zakulacené. Hlavní manifest
 * dnes používá jeden obrázek na obojí; tady to nekopíruju.
 */

import { deflateSync } from 'node:zlib'
import fs from 'node:fs'

/* --- paleta projektu (app/_tokeny.css) ------------------------------ */

const MOSAZ = [0xd8, 0xab, 0x4e] // --mosaz-sv
const INK = [0x16, 0x21, 0x1c] // --ink

/* --- kreslení ------------------------------------------------------- */

/** Je bod uvnitř zakulaceného čtverce? */
function vZakulacenem(x, y, x0, y0, sirka, r) {
  const x1 = x0 + sirka
  const y1 = y0 + sirka
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  // Rohy: vzdálenost od středu zakulacení.
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * Barva bodu.
 *
 * Oko QR kódu má sedm jednotek: prstenec o jedné, mezera o jedné,
 * střed o třech. Drží se to skutečného QR, ne odhadu — pak to i na
 * dlaždici vypadá jako to, co je na obrazovce.
 */
function barva(x, y, velikost, naCelou) {
  const rDlazdice = naCelou ? 0 : velikost * 0.22

  if (!naCelou && !vZakulacenem(x, y, 0, 0, velikost, rDlazdice)) {
    return null // průhledný roh
  }

  // Oko: 58 % šířky, na střed.
  const strana = velikost * 0.58
  const okoX = (velikost - strana) / 2
  const jednotka = strana / 7
  const rOka = jednotka * 0.28

  const vnejsi = vZakulacenem(x, y, okoX, okoX, strana, rOka)
  if (!vnejsi) return MOSAZ

  const mezeraStrana = strana - 2 * jednotka
  const vMezere = vZakulacenem(
    x, y,
    okoX + jednotka, okoX + jednotka,
    mezeraStrana, rOka * 0.8,
  )
  if (!vMezere) return INK

  const stredStrana = strana - 4 * jednotka
  const vStredu = vZakulacenem(
    x, y,
    okoX + 2 * jednotka, okoX + 2 * jednotka,
    stredStrana, rOka * 0.6,
  )
  return vStredu ? INK : MOSAZ
}

/**
 * Vykreslí ikonu s vyhlazením.
 *
 * Vzorkuje se 3×3 na bod. Bez toho jsou hrany oka na 192 pixelech
 * rozsekané a na ploše to je vidět.
 */
function ikona(velikost, naCelou) {
  const data = Buffer.alloc(velikost * velikost * 4)
  const VZORKU = 3

  for (let y = 0; y < velikost; y++) {
    for (let x = 0; x < velikost; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < VZORKU; sy++) {
        for (let sx = 0; sx < VZORKU; sx++) {
          const px = x + (sx + 0.5) / VZORKU
          const py = y + (sy + 0.5) / VZORKU
          const c = barva(px, py, velikost, naCelou)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = VZORKU * VZORKU
      const i = (y * velikost + x) * 4
      // Barva se váží jen přes vzorky, které něco trefily — jinak by
      // hrana táhla k černé.
      const trefy = a / 255
      data[i] = trefy ? Math.round(r / trefy) : 0
      data[i + 1] = trefy ? Math.round(g / trefy) : 0
      data[i + 2] = trefy ? Math.round(b / trefy) : 0
      data[i + 3] = Math.round(a / n)
    }
  }
  return data
}

/* --- zápis PNG ------------------------------------------------------ */

const CRC_TABULKA = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABULKA[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(typ, data) {
  const delka = Buffer.alloc(4)
  delka.writeUInt32BE(data.length)
  const telo = Buffer.concat([Buffer.from(typ, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(telo))
  return Buffer.concat([delka, telo, crc])
}

function png(velikost, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(velikost, 0)
  ihdr.writeUInt32BE(velikost, 4)
  ihdr[8] = 8 // bitů na kanál
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Řádky s filtrem 0. Filtry by soubor zmenšily, ale tady jde
  // o čitelnost, ne o bajty.
  const radky = Buffer.alloc(velikost * (velikost * 4 + 1))
  for (let y = 0; y < velikost; y++) {
    radky[y * (velikost * 4 + 1)] = 0
    rgba.copy(radky, y * (velikost * 4 + 1) + 1, y * velikost * 4, (y + 1) * velikost * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(radky, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* --- a zapsat ------------------------------------------------------- */

const KAM = new URL('../public/', import.meta.url)

const soubory = [
  ['kiosek-icon-192.png', 192, false],
  ['kiosek-icon-512.png', 512, false],
  ['kiosek-icon-maskable-512.png', 512, true],
]

for (const [jmeno, velikost, naCelou] of soubory) {
  const buf = png(velikost, ikona(velikost, naCelou))
  fs.writeFileSync(new URL(jmeno, KAM), buf)
  console.log(`  ${jmeno.padEnd(30)} ${velikost}×${velikost}  ${buf.length} B`)
}

console.log('\nHotovo. Ikony jsou v public/.')
