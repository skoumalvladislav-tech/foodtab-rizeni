#!/usr/bin/env node
/**
 * Univerzální napojení pokladen — čistá logika, bez sítě a databáze.
 *
 *   lib/pokladna-poskytovatele.ts — seznam pokladen a pole formuláře
 *   lib/pokladna-cas.ts           — provozní den, okno od–do, plán dnů
 *   lib/pokladna-prijem-api.ts    — klíč a dávka příjmového API
 *   lib/pokladna-prirazeni.ts     — přiřazení provozoven k pobočkám
 *
 * Pusť `node scripts/pokladna-napojeni.test.mjs`. Výsledek nesmí
 * záviset na pásmu stroje — časy se počítají v Europe/Prague výslovně.
 */

const { POKLADNY, najitPokladnu, prectiUdaje, zdrojPokladny } = await import('../lib/pokladna-poskytovatele.ts')
const { mistniCasNaMs, oknoProvoznihoDne, planDnu, provozniDen, posunoutDen, vychoziHistorieOd } = await import('../lib/pokladna-cas.ts')
const { MAX_RADKU, overitDavku, rozebratKlicPrijmu, slozitKlicPrijmu } = await import('../lib/pokladna-prijem-api.ts')
const { automatickePrirazeni, prirazeneProvozovny, sloucitProvozovny, zkontrolovatPrirazeni } = await import('../lib/pokladna-prirazeni.ts')

let chyb = 0
const ok = (popis, podminka) => {
  if (!podminka) chyb++
  console.log(`  ${podminka ? 'OK   ' : 'CHYBA'} ${popis}`)
}
const PRAHA = 'Europe/Prague'
const HODINA = 3_600_000

console.log('\n== Seznam pokladen a pole formuláře ==')
{
  const d = najitPokladnu('dotykacka')
  ok('Dotykačka je pokladna s tokenem', d?.zpusob === 'token')
  ok('Dotykačka chce refresh token (tajný) a Cloud ID (netajné)',
    d?.pole.length === 2 && d.pole[0].klic === 'refresh_token' && d.pole[0].tajne && d.pole[1].klic === 'cloud_id' && !d.pole[1].tajne)
  ok('„Jiná pokladna" je příjmové API bez polí', najitPokladnu('obecne')?.zpusob === 'prijem' && najitPokladnu('obecne')?.pole.length === 0)
  ok('neznámá pokladna → null', najitPokladnu('storyous') === null)
  ok('zdroj řádků = <klíč>_api', zdrojPokladny('dotykacka') === 'dotykacka_api')
  ok('zdroj každé pokladny projde CHECKem v databázi (^[a-z][a-z0-9_]{1,39}$)',
    POKLADNY.every((p) => /^[a-z][a-z0-9_]{1,39}$/.test(zdrojPokladny(p.klic))))
  ok('klíče pokladen jsou jedinečné', new Set(POKLADNY.map((p) => p.klic)).size === POKLADNY.length)

  const hodnoty = { refresh_token: '  abcdefghijklmnopqrstuvwxyz0123456789  ', cloud_id: ' 123456 ' }
  const v = prectiUdaje(d, (k) => hodnoty[k])
  ok('platná pole projdou a ořízne se mezera kolem', v.stav === 'ok' && v.udaje.refresh_token === 'abcdefghijklmnopqrstuvwxyz0123456789' && v.udaje.cloud_id === '123456')
  const prazdne = prectiUdaje(d, (k) => (k === 'cloud_id' ? '' : hodnoty[k]))
  ok('prázdné povinné pole → chyba s jeho názvem', prazdne.stav === 'chyba' && prazdne.duvod.includes('Cloud ID'))
  const pismena = prectiUdaje(d, (k) => (k === 'cloud_id' ? '12a' : hodnoty[k]))
  ok('Cloud ID s písmenem → chyba', pismena.stav === 'chyba' && pismena.duvod.includes('Cloud ID'))
  const mezera = prectiUdaje(d, (k) => (k === 'refresh_token' ? 'abcdefghij klmnopqrstuvwxyz' : hodnoty[k]))
  ok('token s mezerou uvnitř → chyba (vložený napůl/zalomený)', mezera.stav === 'chyba' && mezera.duvod.includes('token'))
}

console.log('\n== Provozní den a okno od–do (Praha, začátek dne 05:00) ==')
{
  ok('28. 3. 2026 05:00 SEČ = 04:00 UTC', mistniCasNaMs('2026-03-28', '05:00', PRAHA) === Date.UTC(2026, 2, 28, 4, 0))
  ok('29. 3. 2026 05:00 SELČ (po přechodu) = 03:00 UTC', mistniCasNaMs('2026-03-29', '05:00', PRAHA) === Date.UTC(2026, 2, 29, 3, 0))
  ok('čas ve tvaru sloupce `time` (05:00:00) funguje stejně', mistniCasNaMs('2026-10-10', '05:00:00', PRAHA) === mistniCasNaMs('2026-10-10', '05:00', PRAHA))

  const delka = (den) => { const o = oknoProvoznihoDne(den, '05:00', PRAHA); return (o.doMs - o.odMs) / HODINA }
  ok('běžný den má 24 h', delka('2026-10-10') === 24)
  ok('den přechodu na letní čas má 23 h', delka('2026-03-28') === 23)
  ok('den přechodu na zimní čas má 25 h', delka('2026-10-24') === 25)
  ok('okna na sebe navazují (konec dne = začátek dalšího)',
    oknoProvoznihoDne('2026-10-10', '05:00', PRAHA).doMs === oknoProvoznihoDne('2026-10-11', '05:00', PRAHA).odMs)

  // 10. 10. 23:30 UTC = 11. 10. 01:30 SELČ → ještě provozní den 10. 10.
  ok('pivo ve 1:30 v noci patří k předchozímu dni', provozniDen(Date.UTC(2026, 9, 10, 23, 30), '05:00', PRAHA) === '2026-10-10')
  ok('v 5:30 ráno už běží nový den', provozniDen(Date.UTC(2026, 9, 11, 3, 30), '05:00', PRAHA) === '2026-10-11')
  ok('pobočka s dnem od půlnoci: 1:30 je už nový den', provozniDen(Date.UTC(2026, 9, 10, 23, 30), '00:00', PRAHA) === '2026-10-11')
  ok('posun dne přes konec měsíce', posunoutDen('2026-10-31', 1) === '2026-11-01' && posunoutDen('2026-03-01', -1) === '2026-02-28')
  ok('výchozí historie = 1. 1. letošního roku', vychoziHistorieOd('2026-10-11') === '2026-01-01')
}

console.log('\n== Plán dnů (poslední dny + dohánění historie) ==')
{
  const prvni = planDnu({ dnes: '2026-10-11', historieOd: '2026-10-01', dohnanoOd: null })
  ok('poslední 3 dny: dnes a dva zpátky', JSON.stringify(prvni.posledni) === JSON.stringify(['2026-10-11', '2026-10-10', '2026-10-09']))
  ok('dohánění začíná den před posledními a jde ke staršímu až k historii',
    prvni.dohnat[0] === '2026-10-08' && prvni.dohnat.at(-1) === '2026-10-01' && prvni.dohnat.length === 8)

  const pokracovani = planDnu({ dnes: '2026-10-11', historieOd: '2026-10-01', dohnanoOd: '2026-10-05' })
  ok('přerušené dohánění pokračuje za kurzorem', JSON.stringify(pokracovani.dohnat) === JSON.stringify(['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01']))

  const hotovo = planDnu({ dnes: '2026-10-11', historieOd: '2026-10-01', dohnanoOd: '2026-10-01' })
  ok('kompletní historie → nic k dohnání, poslední dny dál ano', hotovo.dohnat.length === 0 && hotovo.posledni.length === 3)

  const kratka = planDnu({ dnes: '2026-10-11', historieOd: '2026-10-11', dohnanoOd: null })
  ok('historie od dneška → jen dnešek, nic před historií', JSON.stringify(kratka.posledni) === '["2026-10-11"]' && kratka.dohnat.length === 0)

  const novejsiKurzor = planDnu({ dnes: '2026-10-11', historieOd: '2026-10-01', dohnanoOd: '2026-10-10' })
  ok('kurzor novější než poslední dny (dnes posunutý) → dohánění od konce posledních', novejsiKurzor.dohnat[0] === '2026-10-08')
}

console.log('\n== Příjmové API: klíč ==')
{
  const id = '0b7c2f1e-4d2a-4c1b-9f3e-1a2b3c4d5e6f'
  const nahodne = 'A'.repeat(42) + '_'
  const klic = slozitKlicPrijmu(id, nahodne)
  ok('klíč nese id připojení', rozebratKlicPrijmu(klic)?.pripojeniId === id)
  ok('mezera kolem klíče nevadí (kopírování)', rozebratKlicPrijmu(`  ${klic} `)?.pripojeniId === id)
  ok('cizí předpona → neplatný', rozebratKlicPrijmu(klic.replace('ftpos_', 'ftbank_')) === null)
  ok('krátká náhodná část → neplatný', rozebratKlicPrijmu(slozitKlicPrijmu(id, 'A'.repeat(20))) === null)
  ok('nesmysl → neplatný', rozebratKlicPrijmu('Bearer cokoli') === null)
}

console.log('\n== Příjmové API: dávka ==')
{
  const dnes = '2026-10-11'
  const v = overitDavku({
    prodeje: [
      { datum: '2026-10-10', produkt: '  Pilsner 0,5 l ', mnozstvi: 120, trzba: 7800 },
      { datum: '2026-10-09', produkt: 'Svíčková', mnozstvi: '18', trzba: '4140,50' },
      { datum: '2026-10-10', produkt: 'Kofola', mnozstvi: 3.5, trzba: 0.1 + 0.2 },
    ],
  }, dnes)
  ok('platná dávka projde', v.stav === 'ok')
  ok('dny jsou seřazené a jen jednou', v.stav === 'ok' && JSON.stringify(v.dny) === '["2026-10-09","2026-10-10"]')
  ok('tržba v Kč → haléře, i z textu s čárkou', v.stav === 'ok' && v.radky[1].trzbaHaleru === 414050)
  ok('haléře se zaokrouhlí (0,1 + 0,2 Kč = 30 h, ne 30,000000000000004)', v.stav === 'ok' && v.radky[2].trzbaHaleru === 30)
  ok('název produktu se ořízne', v.stav === 'ok' && v.radky[0].produktNazev === 'Pilsner 0,5 l')

  const spatne = (telo, popis, cast) => {
    const r = overitDavku(telo, dnes)
    ok(popis, r.stav === 'chyba' && (!cast || r.duvod.includes(cast)))
  }
  spatne({}, 'bez pole „prodeje" → chyba', 'prodeje')
  spatne({ prodeje: [{ datum: '2026-02-30', produkt: 'X', mnozstvi: 1, trzba: 1 }] }, 'neexistující datum (30. 2.) → chyba s číslem položky', 'Položka 1')
  spatne({ prodeje: [{ datum: '2026-10-13', produkt: 'X', mnozstvi: 1, trzba: 1 }] }, 'datum pozítří → chyba', 'mimo')
  ok('zítřek ještě projde (pokladna v jiném pásmu)', overitDavku({ prodeje: [{ datum: '2026-10-12', produkt: 'X', mnozstvi: 1, trzba: 1 }] }, dnes).stav === 'ok')
  spatne({ prodeje: [{ datum: '2026-10-10', produkt: '   ', mnozstvi: 1, trzba: 1 }] }, 'prázdný produkt → chyba', 'produkt')
  spatne({ prodeje: [{ datum: '2026-10-10', produkt: 'X', mnozstvi: -1, trzba: 1 }] }, 'záporné množství → chyba', 'mnozstvi')
  spatne({ prodeje: [{ datum: '2026-10-10', produkt: 'X', mnozstvi: 1, trzba: 'zdarma' }] }, 'tržba jako slovo → chyba', 'trzba')
  spatne({ prodeje: [{ datum: '2026-10-10', produkt: 'X', mnozstvi: 1, trzba: 1e9 }] }, 'tržba miliarda Kč (haléře místo korun) → chyba', 'trzba')
  spatne({ prodeje: Array.from({ length: MAX_RADKU + 1 }, () => ({ datum: '2026-10-10', produkt: 'X', mnozstvi: 1, trzba: 1 })) }, `víc než ${MAX_RADKU} položek → chyba`, `${MAX_RADKU}`)
  spatne({ prodeje: [] }, 'prázdná dávka bez dnů → chyba', 'prázdná')
  const jenDny = overitDavku({ prodeje: [], dny: ['2026-10-10'] }, dnes)
  ok('den bez prodejů (vše stornováno) jde poslat přes „dny"', jenDny.stav === 'ok' && jenDny.radky.length === 0 && jenDny.dny[0] === '2026-10-10')
  spatne({ prodeje: [], dny: ['10. 10. 2026'] }, '„dny" v jiném tvaru → chyba', 'dny')
}

console.log('\n== Přiřazení provozoven k pobočkám ==')
{
  const A = 'aaaaaaaa-0000-0000-0000-000000000001'
  const B = 'bbbbbbbb-0000-0000-0000-000000000002'
  const C = 'cccccccc-0000-0000-0000-000000000003'
  const firma = new Set([A, B])
  const nic = new Set()

  const dosavadni = [
    { id: '1', nazev: 'Perla (starý název)', branch_id: A, dohnano_od: '2026-03-01' },
    { id: '9', nazev: 'Zrušená', branch_id: B, dohnano_od: null },
  ]
  const slouceno = sloucitProvozovny([{ externiId: '1', nazev: 'Černá Perla' }, { externiId: '2', nazev: 'Bernard' }], dosavadni)
  ok('známá provozovna si nechá pobočku i kurzor, název se obnoví',
    slouceno[0].branch_id === A && slouceno[0].dohnano_od === '2026-03-01' && slouceno[0].nazev === 'Černá Perla')
  ok('nová provozovna je nepřiřazená', slouceno[1].id === '2' && slouceno[1].branch_id === null)
  ok('provozovna zrušená v pokladně z přiřazení vypadne', slouceno.length === 2 && !slouceno.some((p) => p.id === '9'))
  ok('přiřazené = jen ty s pobočkou', prirazeneProvozovny({ provozovny: slouceno }).length === 1)

  const jedna = [{ id: '1', nazev: 'Perla', branch_id: null, dohnano_od: null }]
  ok('jedna provozovna + jedna pobočka → přiřadí sama', automatickePrirazeni(jedna, [A], nic)[0].branch_id === A)
  ok('dvě pobočky → nehádá', automatickePrirazeni(jedna, [A, B], nic)[0].branch_id === null)
  ok('dvě provozovny → nehádá', automatickePrirazeni([...jedna, { id: '2', nazev: 'B', branch_id: null, dohnano_od: null }], [A], nic).every((p) => p.branch_id === null))
  ok('jediná pobočka už obsazená jinde → nehádá', automatickePrirazeni(jedna, [A], new Set([A]))[0].branch_id === null)

  const dve = [
    { id: '1', nazev: 'Perla', branch_id: A, dohnano_od: '2026-03-01' },
    { id: '2', nazev: 'Bernard', branch_id: null, dohnano_od: null },
  ]
  const nove = zkontrolovatPrirazeni(dve, { 1: A, 2: B }, firma, nic)
  ok('přiřazení dvou provozoven do dvou poboček projde', nove.stav === 'ok' && nove.provozovny[1].branch_id === B)
  ok('beze změny pobočky zůstane kurzor historie', nove.stav === 'ok' && nove.provozovny[0].dohnano_od === '2026-03-01')
  ok('nic se neopouští → nic se neuklízí', nove.stav === 'ok' && nove.opustenePobocky.length === 0)

  const cizi = zkontrolovatPrirazeni(dve, { 1: A, 2: C }, firma, nic)
  ok('pobočka jiné firmy → chyba', cizi.stav === 'chyba' && cizi.duvod.includes('nepatří'))
  const dvakrat = zkontrolovatPrirazeni(dve, { 1: A, 2: A }, firma, nic)
  ok('jedna pobočka dvakrát → chyba', dvakrat.stav === 'chyba' && dvakrat.duvod.includes('jen jednu'))
  const jinde = zkontrolovatPrirazeni(dve, { 1: A, 2: B }, firma, new Set([B]))
  ok('pobočka, kterou tahle pokladna plní v jiném připojení → chyba', jinde.stav === 'chyba' && jinde.duvod.includes('jinde'))

  const presun = zkontrolovatPrirazeni(dve, { 1: B, 2: '' }, firma, nic)
  ok('přesun provozovny do jiné pobočky vynuluje kurzor', presun.stav === 'ok' && presun.provozovny[0].branch_id === B && presun.provozovny[0].dohnano_od === null)
  ok('… a původní pobočka se uklidí', presun.stav === 'ok' && JSON.stringify(presun.opustenePobocky) === JSON.stringify([A]))

  const odebrat = zkontrolovatPrirazeni(dve, { 1: '', 2: '' }, firma, nic)
  ok('zrušení přiřazení uklidí pobočku a provozovna se nestahuje', odebrat.stav === 'ok' && odebrat.provozovny[0].branch_id === null && odebrat.opustenePobocky[0] === A)

  const vymena = zkontrolovatPrirazeni(
    [{ id: '1', nazev: 'P', branch_id: A, dohnano_od: '2026-01-01' }, { id: '2', nazev: 'B', branch_id: B, dohnano_od: '2026-01-01' }],
    { 1: B, 2: A }, firma, nic)
  ok('prohození dvou provozoven uklidí obě pobočky (do dohnání by tam zůstala cizí čísla)',
    vymena.stav === 'ok' && vymena.opustenePobocky.length === 2 && vymena.provozovny.every((p) => p.dohnano_od === null))
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
