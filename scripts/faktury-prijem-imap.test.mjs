#!/usr/bin/env node
/**
 * Čtení schránky pro příjem faktur (lib/faktury-prijem-imap.ts) nad
 * FALEŠNOU schránkou — žádná síť.
 *
 * Pusť: node --experimental-strip-types --conditions=react-server scripts/faktury-prijem-imap.test.mjs
 */

const { nactiDavkuZprav, MAX_BAJTU_DAVKY } = await import('../lib/faktury-prijem-imap.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}

const PRIHLASENI = { host: 'imap.example.cz', port: 993, zabezpeceni: 'tls', uzivatel: 'faktury@example.cz', heslo: 'h' }

function pdfZprava(uid, { velikost = 50_000, od = 'Dodavatel@Example.CZ', datum = `2026-09-${String(10 + (uid % 15)).padStart(2, '0')}T08:00:00Z`, prilohy = 1 } = {}) {
  return {
    uid,
    envelope: { messageId: `<m${uid}@example.cz>`, subject: `Faktura ${uid}`, from: [{ name: 'Dodavatel', address: od }] },
    internalDate: new Date(datum),
    bodyStructure: {
      type: 'multipart/mixed',
      childNodes: [
        { part: '1', type: 'text/plain', size: 200 },
        ...Array.from({ length: prilohy }, (_, i) => ({
          part: String(2 + i), type: 'application/pdf', disposition: 'attachment',
          dispositionParameters: { filename: `FV${uid}-${i}.pdf` }, size: velikost,
        })),
      ],
    },
  }
}

/** Falešná schránka: zaznamená příkazy a hlídá, že během FETCH nepadne jiný. */
function falesnaSchranka({ uidValidity = 1700000000n, zpravy = [], obsah = (uid) => new Uint8Array(1000).fill(uid % 251), chybaPri = null, hledaniSelze = false } = {}) {
  const prikazy = []
  const stav = { vIteraci: false, poruseni: [], posluchacChyb: false, odhlaseno: false, zavreno: false, zamekUvolnen: false, pripojeniPredPosluchacem: false }
  const zaznam = (nazev) => {
    prikazy.push(nazev)
    if (stav.vIteraci) stav.poruseni.push(nazev)
    if (chybaPri === nazev) throw new Error(`simulovaná chyba při ${nazev}`)
  }
  const klient = {
    on(udalost) { if (udalost === 'error') stav.posluchacChyb = true },
    async connect() { if (!stav.posluchacChyb) stav.pripojeniPredPosluchacem = true; zaznam('connect') },
    async getMailboxLock(cesta, moznosti) { zaznam('lock'); stav.cesta = cesta; stav.readOnly = moznosti.readOnly; return { release: () => { stav.zamekUvolnen = true } } },
    get mailbox() { return { uidValidity } },
    async search(dotaz) {
      zaznam('search')
      stav.posledniHledani = dotaz
      if (hledaniSelze) return false
      const uids = zpravy.map((z) => z.uid).sort((a, b) => a - b)
      if (dotaz.since) return uids.filter((u) => zpravy.find((z) => z.uid === u).internalDate >= dotaz.since)
      const [odUid] = String(dotaz.uid).split(':').map(Number)
      const vysledek = uids.filter((u) => u >= odUid)
      // IMAP: „n:*" vrátí vždycky i nejvyšší zprávu, i když je pod n.
      if (uids.length && !vysledek.includes(uids[uids.length - 1])) vysledek.push(uids[uids.length - 1])
      return vysledek
    },
    fetch(rozsah) {
      zaznam('fetch')
      const vybrane = zpravy.filter((z) => rozsah.includes(z.uid))
      return (async function* () {
        stav.vIteraci = true
        try { for (const z of vybrane) yield z } finally { stav.vIteraci = false }
      })()
    },
    async download(uid, cast) {
      zaznam('download')
      stav.stazeno = (stav.stazeno ?? 0) + 1
      if (cast === 'chybi') return {}
      const data = obsah(Number(uid), cast)
      return { content: (async function* () { yield data.subarray(0, Math.floor(data.length / 2)); yield data.subarray(Math.floor(data.length / 2)) })() }
    },
    async logout() { zaznam('logout'); stav.odhlaseno = true },
    close() { stav.zavreno = true },
  }
  return { tovarna: () => klient, prikazy, stav }
}

const vzdy = async () => true

console.log('\n== Prázdný kurzor: SEARCH SINCE „od", nejstarší první, limit ==')
{
  const s = falesnaSchranka({ zpravy: [pdfZprava(12), pdfZprava(10), pdfZprava(11), pdfZprava(13)] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 3, vzdy, Infinity, s.tovarna)
  ok('hledá podle data (since)', s.stav.posledniHledani?.since instanceof Date)
  ok('schránka otevřená jen pro čtení', s.stav.readOnly === true && s.stav.cesta === 'INBOX')
  ok('vezme 3 nejstarší v pořadí UID', d.zpravy.map((z) => z.uid).join(',') === '10,11,12')
  ok('kurzor na 12, ještě není hotovo', d.posledniUid === 12 && d.hotovo === false)
  ok('UIDVALIDITY jako text', d.uidvalidity === '1700000000')
  ok('odesílatel holou adresou malými písmeny, Message-ID, čas ISO', d.zpravy[0].odesilatel === 'dodavatel@example.cz' && d.zpravy[0].messageId === '<m10@example.cz>' && d.zpravy[0].prijatoKdy?.endsWith('Z'))
  ok('PDF stažené (obě půlky složené)', d.zpravy[0].stazene.get('2')?.length === 1000)
  ok('během FETCH nepadl žádný jiný příkaz', s.stav.poruseni.length === 0)
  ok('posluchač chyb je nastavený PŘED připojením', s.stav.posluchacChyb && !s.stav.pripojeniPredPosluchacem)
  ok('zámek uvolněn a odhlášeno', s.stav.zamekUvolnen && s.stav.odhlaseno && !s.stav.zavreno)
}

console.log('\n== Pokračování za kurzorem (vč. „n:*" vrací nejvyšší zprávu) ==')
{
  const s = falesnaSchranka({ zpravy: [pdfZprava(10), pdfZprava(11), pdfZprava(12)] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: '1700000000', posledniUid: 12 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna)
  ok('hledá podle UID za kurzorem', s.stav.posledniHledani?.uid === '13:*')
  ok('nic nového: žádné zprávy, kurzor beze změny, hotovo', d.zpravy.length === 0 && d.posledniUid === 12 && d.hotovo === true)
  ok('nic se nefetchovalo ani nestahovalo', !s.prikazy.includes('fetch') && !s.prikazy.includes('download'))
  const s2 = falesnaSchranka({ zpravy: [pdfZprava(10), pdfZprava(11), pdfZprava(12), pdfZprava(15)] })
  const d2 = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: '1700000000', posledniUid: 11 }, '2026-01-01', 50, vzdy, Infinity, s2.tovarna)
  ok('nové zprávy 12 a 15, hotovo', d2.zpravy.map((z) => z.uid).join(',') === '12,15' && d2.posledniUid === 15 && d2.hotovo)
}

console.log('\n== Změna UIDVALIDITY = starý kurzor neplatí ==')
{
  const s = falesnaSchranka({ uidValidity: 999n, zpravy: [pdfZprava(1), pdfZprava(2)] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: '1700000000', posledniUid: 500 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna)
  ok('resetKurzoru a čte se znovu od „od"', d.resetKurzoru === true && s.stav.posledniHledani?.since instanceof Date && d.zpravy.length === 2 && d.uidvalidity === '999')
}

console.log('\n== Příjem rozhoduje, co stáhnout ==')
{
  const s = falesnaSchranka({ zpravy: [pdfZprava(10), pdfZprava(11)] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, async (z) => z.uid !== 10, Infinity, s.tovarna)
  ok('zpráva, kterou příjem nechce (třeba už ji zapsal n8n), se nestáhne', d.zpravy.find((z) => z.uid === 10)?.stazene.size === 0 && d.zpravy.find((z) => z.uid === 11)?.stazene.size === 1)
  ok('ale v dávce je (příjem si ji zapíše jako existující)', d.zpravy.length === 2 && d.posledniUid === 11)
}

console.log('\n== Strop 60 MB na dávku končí na hranici celé zprávy ==')
{
  const velky = Math.ceil(MAX_BAJTU_DAVKY / 2) + 10
  const s = falesnaSchranka({ zpravy: [pdfZprava(10), pdfZprava(11), pdfZprava(12)], obsah: () => new Uint8Array(velky) })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna)
  ok('po překročení stropu dávka skončí — 2 zprávy celé, třetí nestažená', d.zpravy.length === 2 && s.stav.stazeno === 2)
  ok('kurzor na poslední CELÉ zprávě, není hotovo', d.posledniUid === 11 && d.hotovo === false)
}

console.log('\n== Chybějící část a zmizelá zpráva ==')
{
  const zprava = pdfZprava(10)
  zprava.bodyStructure.childNodes[1].part = 'chybi'
  const s = falesnaSchranka({ zpravy: [zprava] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna)
  ok('část, kterou server nevrátí ({}), se přeskočí bez výjimky', d.zpravy.length === 1)
}

console.log('\n== Chyba uprostřed: spojení se vždy zavře a chyba vyletí ven ==')
{
  const s = falesnaSchranka({ zpravy: [pdfZprava(10)], chybaPri: 'download' })
  let vyhodilo = false
  try { await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna) } catch { vyhodilo = true }
  ok('chyba vyletí (příjem pak schránku označí)', vyhodilo)
  ok('zámek uvolněn a spojení zavřené', s.stav.zamekUvolnen && s.stav.zavreno)
  const s2 = falesnaSchranka({ chybaPri: 'connect' })
  let vyhodilo2 = false
  try { await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, Infinity, s2.tovarna) } catch { vyhodilo2 = true }
  ok('selhané připojení: chyba ven, spojení zavřené', vyhodilo2 && s2.stav.zavreno)
}

console.log('\n== Selhané hledání a časový limit dávky ==')
{
  const s = falesnaSchranka({ zpravy: [pdfZprava(10)], hledaniSelze: true })
  let vyhodilo = false
  try { await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, Infinity, s.tovarna) } catch { vyhodilo = true }
  ok('SEARCH vrátí false (chyba příkazu) → chyba, ne „schránka přečtená"', vyhodilo && s.stav.zavreno)
  const s2 = falesnaSchranka({ zpravy: [pdfZprava(10), pdfZprava(11), pdfZprava(12)] })
  const d = await nactiDavkuZprav(PRIHLASENI, 'INBOX', { uidvalidity: null, posledniUid: 0 }, '2026-01-01', 50, vzdy, 0, s2.tovarna)
  ok('po čase dávka skončí na hranici zprávy: jedna celá, kurzor na ní, není hotovo', d.zpravy.length === 1 && d.posledniUid === 10 && d.hotovo === false && s2.stav.stazeno === 1)
}

console.log(chyb === 0 ? '\nVŠECHNY KONTROLY PROŠLY\n' : `\n${chyb} KONTROL SPADLO\n`)
process.exit(chyb === 0 ? 0 : 1)
