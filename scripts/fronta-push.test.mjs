#!/usr/bin/env node
/**
 * Fronta push — odeslání hned po zprávě i plánovačem, bez zdvojení.
 *
 * Pusť `node --experimental-strip-types scripts/fronta-push.test.mjs`.
 *
 * ---------------------------------------------------------------------
 * CO TO OVĚŘUJE A CO NE
 *
 * `lib/komunikace/fronta-push.ts` nad FALEŠNOU databází v paměti (jen
 * dotazy, které modul opravdu dělá) a s falešným odesláním místo push
 * služby. Ověřuje, KTERÉ řádky se pošlou, jak se označí a že dva
 * odesílatelé naráz nepošlou tentýž push dvakrát — ať se potkají před
 * zabráním řádku, nebo během odesílání.
 *
 * Neověřuje skutečné doručení do telefonu (šifrování a VAPID hlídá
 * `scripts/web-push.test.mjs` proti příkladu z RFC), ani to, KDY databáze
 * řádek do fronty zařadí (`app.zaradit_doruceni`, scénáře), ani chování
 * PostgRESTu u vnořeného filtru (`notifications!inner`) — to je
 * v falešné databázi napodobené.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'

import { NEDOKONCENO, NEJVIC_POKUSU, odeslatFrontu } from '../lib/komunikace/fronta-push.ts'

let selhalo = 0
let proslo = 0
async function test(nazev, fn) {
  try {
    await fn()
    proslo++
    console.log(`  OK    ${nazev}`)
  } catch (e) {
    selhalo++
    console.log(`  CHYBA ${nazev}\n        ${e?.message ?? e}`)
  }
}

/* ---------------------------------------------------------------------
   Falešná databáze: from(t).select/update + eq/in/is/order/limit,
   vnořené `notifications` (i `!inner` s filtrem `notifications.x`).
   ------------------------------------------------------------------- */

function falesnaDb(data) {
  const db = structuredClone(data)
  db.predZapisem = null // háček: zavolá se těsně před prvním zápisem
  db.chybaTabulky = {} // { tabulka: {message, code} } — dotaz vrátí chybu

  class Dotaz {
    constructor(tabulka) {
      this.tabulka = tabulka
      this.filtry = []
      this.vnorene = []
      this.zmena = null
      this.vratit = false
      this.limitN = null
      this.inner = false
    }
    select(sloupce) {
      if (this.zmena) this.vratit = true
      else if (sloupce && sloupce.includes('notifications!inner')) this.inner = true
      return this
    }
    update(zmena) {
      this.zmena = zmena
      return this
    }
    eq(k, v) {
      if (k.startsWith('notifications.')) {
        const kk = k.slice('notifications.'.length)
        this.vnorene.push((n) => n !== null && n[kk] === v)
      } else this.filtry.push((r) => r[k] === v)
      return this
    }
    in(k, v) {
      this.filtry.push((r) => v.includes(r[k]))
      return this
    }
    is(k, v) {
      this.filtry.push((r) => r[k] === v)
      return this
    }
    order() {
      return this
    }
    limit(n) {
      this.limitN = n
      return this
    }
    provest() {
      if (db.chybaTabulky[this.tabulka]) return { data: null, error: db.chybaTabulky[this.tabulka] }
      const tab = db[this.tabulka]
      if (this.zmena) {
        if (db.predZapisem) {
          const h = db.predZapisem
          db.predZapisem = null
          h(this)
        }
        const zasazene = tab.filter((r) => this.filtry.every((f) => f(r)))
        for (const r of zasazene) Object.assign(r, this.zmena)
        return { data: this.vratit ? zasazene.map((r) => ({ id: r.id })) : null, error: null }
      }
      let radky = tab.filter((r) => this.filtry.every((f) => f(r)))
      if (this.tabulka === 'notifikace_doruceni') {
        radky = radky
          .map((r) => ({ ...r, notifications: db.notifications.find((n) => n.id === r.notification_id) ?? null }))
          .filter((r) => (this.inner ? r.notifications !== null && this.vnorene.every((f) => f(r.notifications)) : true))
      }
      if (this.limitN !== null) radky = radky.slice(0, this.limitN)
      return { data: radky.map((r) => structuredClone(r)), error: null }
    }
    then(ok, chyba) {
      return Promise.resolve(this.provest()).then(ok, chyba)
    }
  }

  return { db, klient: { from: (t) => new Dotaz(t) } }
}

const KLICE = { verejny: 'x', soukromy: 'y', subjekt: 'mailto:test@foodtab.cz' }

/** Zdroj „zpráva m1" — od 25. 9. se push hned filtruje obecným zdrojem, ne jen zprávou. */
const ZPRAVA_M1 = { typ: 'zprava', id: 'm1' }

function zaklad() {
  return {
    notifications: [
      { id: 'n1', druh: 'vzkaz.novy', telo: { od: 'Petra' }, priorita: 'urgent', zdroj_typ: 'zprava', zdroj_id: 'm1' },
      { id: 'n2', druh: 'vzkaz.novy', telo: { od: 'Petra' }, priorita: 'normal', zdroj_typ: 'zprava', zdroj_id: 'm1' },
      { id: 'n3', druh: 'vzkaz.novy', telo: { od: 'Marek' }, priorita: 'normal', zdroj_typ: 'zprava', zdroj_id: 'm2' },
      { id: 'n9', druh: 'ukol.pridelen', telo: {}, priorita: 'normal', zdroj_typ: 'ukol', zdroj_id: 'm1' },
    ],
    notifikace_doruceni: [
      { tenant_id: 't1', id: 'd1', user_id: 'u1', notification_id: 'n1', typ: 'jedna', pocet: 1, pokusu: 0, stav: 'k_odeslani' },
      // Příjemce mimo směnu — čeká na plánovač, ne na odeslání hned.
      { tenant_id: 't1', id: 'd2', user_id: 'u2', notification_id: 'n2', typ: 'jedna', pocet: 1, pokusu: 0, stav: 'ceka_na_smenu' },
      // Jiná zpráva a jiný zdroj se stejným id — odeslání ke zprávě m1 na ně nesahá.
      { tenant_id: 't1', id: 'd3', user_id: 'u1', notification_id: 'n3', typ: 'jedna', pocet: 1, pokusu: 0, stav: 'k_odeslani' },
      { tenant_id: 't1', id: 'd9', user_id: 'u1', notification_id: 'n9', typ: 'jedna', pocet: 1, pokusu: 0, stav: 'k_odeslani' },
    ],
    push_odbery: [
      { id: 'o1', user_id: 'u1', endpoint: 'https://fcm.googleapis.com/x', p256dh: 'a', auth_secret: 'b', vypnuto_kdy: null, posledni_uspech_kdy: null },
      { id: 'o2', user_id: 'u1', endpoint: 'https://web.push.apple.com/y', p256dh: 'a', auth_secret: 'b', vypnuto_kdy: null, posledni_uspech_kdy: null },
    ],
  }
}

const radek = (db, id) => db.notifikace_doruceni.find((r) => r.id === id)
const vzdyOdeslano = async () => ({ stav: 'odeslano' })

console.log('\n== Fronta push ==========================================')

await test('odeslání ke zprávě pošle JEN její řádky k_odeslani a označí je', async () => {
  const { db, klient } = falesnaDb(zaklad())
  const poslano = []
  const v = await odeslatFrontu(klient, KLICE, {
    zdroj: ZPRAVA_M1, firma: 't1',
    odeslat: async (z) => { poslano.push(z.id); return { stav: 'odeslano' } },
  })
  assert.equal(v.odeslano, 1)
  assert.deepEqual(poslano.sort(), ['o1', 'o2'], 'oba telefony člověka u1, jednou')
  assert.equal(radek(db, 'd1').stav, 'odeslano')
  assert.equal(radek(db, 'd1').chyba, null)
  assert.equal(radek(db, 'd2').stav, 'ceka_na_smenu', 'mimo směnu zůstává')
  assert.equal(radek(db, 'd3').stav, 'k_odeslani', 'jiná zpráva nedotčená')
  assert.equal(radek(db, 'd9').stav, 'k_odeslani', 'jiný zdroj se stejným id nedotčený')
  assert.ok(db.push_odbery.every((o) => o.posledni_uspech_kdy !== null))
})

/*
  Záloha (25. 9. 2026): push hned po výplatě a po potvrzení jde stejnou
  cestou jako u zprávy, jen s jiným zdrojem. Id schválně SHODNÉ se
  zprávou m1 i úkolem m1 — kdyby filtr bral jen id (nebo typ napevno
  „zprava"), pošle se cizí řádek.
*/
await test('odeslání k ZÁLOZE pošle jen její řádky, ne zprávu ani úkol se stejným id', async () => {
  const data = zaklad()
  data.notifications.push({ id: 'n7', druh: 'zaloha.potvrzena', telo: {}, priorita: 'normal', zdroj_typ: 'zaloha', zdroj_id: 'm1' })
  data.notifikace_doruceni.push({ tenant_id: 't1', id: 'd7', user_id: 'u1', notification_id: 'n7', typ: 'jedna', pocet: 1, pokusu: 0, stav: 'k_odeslani' })
  const { db, klient } = falesnaDb(data)
  const v = await odeslatFrontu(klient, KLICE, { zdroj: { typ: 'zaloha', id: 'm1' }, firma: 't1', odeslat: vzdyOdeslano })
  assert.equal(v.ve_fronte, 1)
  assert.equal(radek(db, 'd7').stav, 'odeslano')
  assert.equal(radek(db, 'd1').stav, 'k_odeslani', 'zpráva se stejným id nedotčená')
  assert.equal(radek(db, 'd9').stav, 'k_odeslani', 'úkol se stejným id nedotčený')
})

await test('naléhavá zpráva jde s vysokou naléhavostí', async () => {
  const { klient } = falesnaDb(zaklad())
  const urgency = []
  await odeslatFrontu(klient, KLICE, {
    zdroj: ZPRAVA_M1, firma: 't1',
    odeslat: async (_z, _m, _k, volby) => { urgency.push(volby?.urgency); return { stav: 'odeslano' } },
  })
  assert.deepEqual([...new Set(urgency)], ['high'])
})

await test('zpráva bez řádků ve frontě nic nepošle a na nic nesáhne', async () => {
  const { db, klient } = falesnaDb(zaklad())
  let volano = 0
  const v = await odeslatFrontu(klient, KLICE, { zdroj: { typ: 'zprava', id: 'm-neznama' }, firma: 't1', odeslat: async () => { volano++; return { stav: 'odeslano' } } })
  assert.equal(volano, 0)
  assert.equal(v.ve_fronte, 0)
  assert.ok(db.notifikace_doruceni.every((r) => r.stav !== 'odeslano'))
})

await test('cizí firma: odeslání ke zprávě s jinou firmou nic nepošle', async () => {
  const { db, klient } = falesnaDb(zaklad())
  let volano = 0
  const v = await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't-cizi', odeslat: async () => { volano++; return { stav: 'odeslano' } } })
  assert.equal(volano, 0)
  assert.equal(v.ve_fronte, 0)
  assert.equal(radek(db, 'd1').stav, 'k_odeslani')
})

await test('souběh PŘED zabráním: řádek zabraný jiným se nepošle', async () => {
  const { db, klient } = falesnaDb(zaklad())
  db.predZapisem = () => {
    Object.assign(radek(db, 'd1'), { stav: 'selhalo', pokusu: 1, chyba: NEDOKONCENO })
  }
  let volano = 0
  const v = await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: async () => { volano++; return { stav: 'odeslano' } } })
  assert.equal(volano, 0, 'push se neposlal podruhé')
  assert.equal(v.nezabrano, 1)
})

await test('souběh BĚHEM odesílání: plánovač řádek, který se právě posílá, nevidí', async () => {
  const { db, klient } = falesnaDb(zaklad())
  let odeslani = 0
  let pustit
  const brana = new Promise((r) => { pustit = r })
  // Odeslání hned: zabere d1 a „posílá" (čeká na bránu).
  const hned = odeslatFrontu(klient, KLICE, {
    zdroj: ZPRAVA_M1, firma: 't1',
    odeslat: async () => { odeslani++; await brana; return { stav: 'odeslano' } },
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(radek(db, 'd1').stav, 'selhalo', 'během odesílání je d1 mimo frontu')
  // Mezitím doběhne plánovač nad celou frontou.
  const planovac = await odeslatFrontu(klient, KLICE, { odeslat: async () => { odeslani++; return { stav: 'odeslano' } } })
  assert.equal(planovac.ve_fronte, 2, 'plánovač vidí jen d3 a d9, ne d1')
  pustit()
  await hned
  assert.equal(radek(db, 'd1').stav, 'odeslano')
  assert.equal(odeslani, 2 + 4, 'd1 jednou na 2 zařízení, d3 a d9 po 2 — nic dvakrát')
})

await test('zrušení během odesílání se nepřepíše (řádek už není náš)', async () => {
  const { db, klient } = falesnaDb(zaklad())
  await odeslatFrontu(klient, KLICE, {
    zdroj: ZPRAVA_M1, firma: 't1',
    odeslat: async () => {
      // Jiná transakce řádek mezitím změní (např. ruční zásah / úklid).
      Object.assign(radek(db, 'd1'), { stav: 'zruseno', chyba: 'Zrušeno jinde.' })
      return { stav: 'selhalo', chyba: 'HTTP 503' }
    },
  })
  assert.equal(radek(db, 'd1').stav, 'zruseno')
  assert.equal(radek(db, 'd1').chyba, 'Zrušeno jinde.')
})

await test('chyba dotazu na zařízení: výjimka, řádek zůstane ve frontě (ne „bez zařízení")', async () => {
  const { db, klient } = falesnaDb(zaklad())
  db.chybaTabulky.push_odbery = { message: 'timeout', code: '57014' }
  await assert.rejects(() => odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: vzdyOdeslano }))
  assert.equal(radek(db, 'd1').stav, 'k_odeslani')
})

await test('člověk bez zařízení: řádek se zruší, nic se neposílá', async () => {
  const data = zaklad()
  data.push_odbery = []
  const { db, klient } = falesnaDb(data)
  const v = await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: vzdyOdeslano })
  assert.equal(v.bez_zarizeni, 1)
  assert.equal(radek(db, 'd1').stav, 'zruseno')
})

await test(`dočasná chyba: zpátky do fronty, po ${NEJVIC_POKUSU}. pokusu selhalo`, async () => {
  const { db, klient } = falesnaDb(zaklad())
  const chyba = async () => ({ stav: 'selhalo', chyba: 'HTTP 503' })
  for (let i = 1; i <= NEJVIC_POKUSU; i++) {
    await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: chyba })
    const r = radek(db, 'd1')
    assert.equal(r.pokusu, i, `pokus ${i} se započítal jednou`)
    assert.equal(r.stav, i < NEJVIC_POKUSU ? 'k_odeslani' : 'selhalo', `po pokusu ${i}`)
    assert.equal(r.chyba, 'HTTP 503')
  }
})

await test('zrušené zařízení (410) se vypne a řádek skončí selhalo', async () => {
  const { db, klient } = falesnaDb(zaklad())
  await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: async () => ({ stav: 'vyprselo' }) })
  assert.ok(db.push_odbery.every((o) => o.vypnuto_kdy !== null))
  assert.equal(radek(db, 'd1').stav, 'selhalo')
})

await test('pád uprostřed odesílání: řádek zůstane selhalo („nedokončilo se") a znovu se nepošle', async () => {
  const { db, klient } = falesnaDb(zaklad())
  await assert.rejects(() => odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: async () => { throw new Error('funkce utnuta') } }))
  assert.equal(radek(db, 'd1').stav, 'selhalo')
  assert.equal(radek(db, 'd1').chyba, NEDOKONCENO)
  let volano = 0
  await odeslatFrontu(klient, KLICE, { zdroj: ZPRAVA_M1, firma: 't1', odeslat: async () => { volano++; return { stav: 'odeslano' } } })
  assert.equal(volano, 0)
})

await test('plánovač (bez zprávy) vezme celou frontu k_odeslani, čekající na směnu ne', async () => {
  const { db, klient } = falesnaDb(zaklad())
  const v = await odeslatFrontu(klient, KLICE, { odeslat: vzdyOdeslano })
  assert.equal(v.odeslano, 3)
  assert.equal(radek(db, 'd2').stav, 'ceka_na_smenu')
})

await test('vyčerpaný čas dávky: zbytek se odloží a zůstane k_odeslani', async () => {
  const { db, klient } = falesnaDb(zaklad())
  let t = 0
  const v = await odeslatFrontu(klient, KLICE, {
    rozpocetMs: 10,
    ted: () => t,
    odeslat: async () => { t += 100; return { stav: 'odeslano' } },
  })
  assert.equal(v.odeslano, 1)
  assert.equal(v.odlozeno, 2)
  assert.equal(db.notifikace_doruceni.filter((r) => r.stav === 'k_odeslani').length, 2)
})

// Odeslání hned musí být OPRAVDU zapojené — a až PO úspěšném uložení
// zprávy, jinak se ověřuje modul, na který z odeslání zprávy nic nevede.
await test('všechny cesty odeslání zprávy plánují push hned, a až po kontrole chyby', async () => {
  const cesty = [
    ['../app/[rozsah]/vzkazy/akce.ts', 3],
    ['../app/[rozsah]/vzkazy/[konverzace]/akce-prilohy.ts', 1],
  ]
  for (const [soubor, cekam] of cesty) {
    const t = fs.readFileSync(new URL(soubor, import.meta.url), 'utf8')
    const vyskyty = [...t.matchAll(/naplanovatPushKeZprave\(zpravaId, z\.tenantId\)/g)].map((m) => m.index)
    assert.equal(vyskyty.length, cekam, soubor)
    for (const i of vyskyty) {
      const rpc = t.lastIndexOf("rpc('poslat_zpravu'", i)
      assert.ok(rpc >= 0, `${soubor}: před plánováním není poslat_zpravu`)
      assert.ok(t.slice(rpc, i).includes('if (error)'), `${soubor}: push se plánuje před kontrolou chyby`)
    }
  }
})

console.log(`\n${proslo} prošlo, ${selhalo} selhalo`)
if (selhalo > 0) process.exit(1)
