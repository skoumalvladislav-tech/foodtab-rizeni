#!/usr/bin/env node
/**
 * Univerzální napojení pokladen — čistá logika, bez sítě a databáze.
 *
 *   lib/pokladna-poskytovatele.ts — seznam pokladen a pole formuláře
 *   lib/pokladna-cas.ts           — provozní den, okno od–do, plán dnů
 *   lib/pokladna-prijem-api.ts    — klíč a dávka příjmového API
 *   lib/pokladna-prirazeni.ts     — přiřazení provozoven k pobočkám
 *   lib/pokladna-beh.ts           — jeden běh synchronizace (pořadí dnů, kurzory, chyby)
 *
 * Pusť `node scripts/pokladna-napojeni.test.mjs`. Výsledek nesmí
 * záviset na pásmu stroje — časy se počítají v Europe/Prague výslovně.
 */

const { POKLADNY, najitPokladnu, prectiUdaje, zdrojPokladny } = await import('../lib/pokladna-poskytovatele.ts')
const { mistniCasNaMs, oknoProvoznihoDne, planDnu, provozniDen, posunoutDen, vychoziHistorieOd } = await import('../lib/pokladna-cas.ts')
const { MAX_RADKU, overitDavku, rozebratKlicPrijmu, slozitKlicPrijmu } = await import('../lib/pokladna-prijem-api.ts')
const { automatickePrirazeni, prirazeneProvozovny, sloucitProvozovny, zkontrolovatPrirazeni } = await import('../lib/pokladna-prirazeni.ts')
const { probehnoutBeh } = await import('../lib/pokladna-beh.ts')

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

  // Výpadek: poslední běh doběhl 3. 10., dnes je 11. 10. → mezera 3.–8. 10. (3. 10. znovu, tehdy byl rozběhnutý).
  const vypadek = planDnu({ dnes: '2026-10-11', historieOd: '2026-01-01', dohnanoOd: '2026-01-01', souvisleDo: '2026-10-03' })
  ok('po výpadku se dotáhne mezera mezi posledním souvislým dnem a posledními dny, od nejstaršího',
    JSON.stringify(vypadek.mezera) === JSON.stringify(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']))
  ok('… a historie, která je kompletní, se nestahuje znovu', vypadek.dohnat.length === 0)
  const bezVypadku = planDnu({ dnes: '2026-10-11', historieOd: '2026-01-01', dohnanoOd: '2026-01-01', souvisleDo: '2026-10-11' })
  ok('bez výpadku (souvisle do dneška) žádná mezera', bezVypadku.mezera.length === 0)
  const vcera = planDnu({ dnes: '2026-10-11', historieOd: '2026-01-01', dohnanoOd: '2026-01-01', souvisleDo: '2026-10-09' })
  ok('souvisle do dne, který je mezi posledními dny → žádná mezera (poslední dny ho přepíšou)', vcera.mezera.length === 0)
  ok('nová provozovna (bez souvisle_do) mezeru nemá', prvni.mezera.length === 0)
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
  const sloucenoSouvisle = sloucitProvozovny([{ externiId: '1', nazev: 'P' }], [{ id: '1', nazev: 'P', branch_id: A, dohnano_od: '2026-03-01', souvisle_do: '2026-10-05', uvazl: { den: '2026-09-01', pokusu: 1 } }])
  ok('nové přihlášení zachová souvisle_do (mezera po výpadku se pak dotáhne)', sloucenoSouvisle[0].souvisle_do === '2026-10-05')
  ok('… i uvázlý den (počítání pokusů pokračuje)', sloucenoSouvisle[0].uvazl?.pokusu === 1)
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
  ok('pobočka, kterou plní jiné napojení pokladny → chyba', jinde.stav === 'chyba' && jinde.duvod.includes('jiného napojení'))
  const vypnuta = zkontrolovatPrirazeni([{ id: '1', nazev: 'Perla', branch_id: C, dohnano_od: '2026-03-01' }], { 1: C }, firma, new Set([C]))
  ok('nezměněné přiřazení k (mezitím vypnuté) pobočce projde a nic neuklízí',
    vypnuta.stav === 'ok' && vypnuta.provozovny[0].branch_id === C && vypnuta.provozovny[0].dohnano_od === '2026-03-01' && vypnuta.opustenePobocky.length === 0)

  const presun = zkontrolovatPrirazeni(dve, { 1: B, 2: '' }, firma, nic)
  ok('přesun provozovny do jiné pobočky vynuluje kurzor', presun.stav === 'ok' && presun.provozovny[0].branch_id === B && presun.provozovny[0].dohnano_od === null)
  const presunSouvisle = zkontrolovatPrirazeni([{ id: '1', nazev: 'P', branch_id: A, dohnano_od: '2026-03-01', souvisle_do: '2026-10-10', uvazl: { den: '2026-09-01', pokusu: 2 } }], { 1: B }, firma, nic)
  ok('… i souvisle_do (nová pobočka začíná od nuly, ne od mezery staré)', presunSouvisle.stav === 'ok' && presunSouvisle.provozovny[0].souvisle_do === null)
  ok('… i uvázlý den staré pobočky', presunSouvisle.stav === 'ok' && presunSouvisle.provozovny[0].uvazl === null)
  ok('… a původní pobočka se uklidí', presun.stav === 'ok' && JSON.stringify(presun.opustenePobocky) === JSON.stringify([A]))

  const odebrat = zkontrolovatPrirazeni(dve, { 1: '', 2: '' }, firma, nic)
  ok('zrušení přiřazení uklidí pobočku a provozovna se nestahuje', odebrat.stav === 'ok' && odebrat.provozovny[0].branch_id === null && odebrat.opustenePobocky[0] === A)

  const vymena = zkontrolovatPrirazeni(
    [{ id: '1', nazev: 'P', branch_id: A, dohnano_od: '2026-01-01' }, { id: '2', nazev: 'B', branch_id: B, dohnano_od: '2026-01-01' }],
    { 1: B, 2: A }, firma, nic)
  ok('prohození dvou provozoven uklidí obě pobočky (do dohnání by tam zůstala cizí čísla)',
    vymena.stav === 'ok' && vymena.opustenePobocky.length === 2 && vymena.provozovny.every((p) => p.dohnano_od === null))
}

console.log('\n== Běh synchronizace (pořadí, kurzory, chyby po provozovnách) ==')
{
  const plan = (dnes, souvisleDo, dohnanoOd, historieOd = '2026-10-01') => planDnu({ dnes, historieOd, dohnanoOd, souvisleDo })
  const ukol = (id, { dohnanoOd = null, souvisleDo = null, dnes = '2026-10-11', uvazl = null } = {}) => ({ id, nazev: `P${id}`, dnes, dohnanoOd, souvisleDo, uvazl, plan: plan(dnes, souvisleDo, dohnanoOd) })
  const chyba = (druh, duvod = druh, celoplosna = undefined) => ({ stav: 'chyba', druh, duvod, ...(celoplosna ? { celoplosna } : {}) })
  const zaznam = () => {
    const dny = []
    return { dny, zpracovat: (vysledky = {}) => async (u, den) => { dny.push(`${u.id}:${den}`); return vysledky[`${u.id}:${den}`] ?? null } }
  }

  // Nová provozovna: poslední 3 dny, pak historie dozadu; souvisle_do = dnes.
  const z1 = zaznam()
  const b1 = await probehnoutBeh([ukol('A')], z1.zpracovat(), () => false)
  const a1 = b1.postup[0]
  ok('nová provozovna: nejdřív poslední dny, pak historie od novější ke starší',
    z1.dny.slice(0, 4).join() === 'A:2026-10-11,A:2026-10-10,A:2026-10-09,A:2026-10-08' && z1.dny.at(-1) === 'A:2026-10-01')
  ok('… kurzory: historie dohnaná do historie_od, souvisle do dneška', a1.dohnanoOd === '2026-10-01' && a1.souvisleDo === '2026-10-11' && b1.zbyvaDnu === 0)

  // Den v historii, kterému appka nerozumí (jina): zastaví jen tu provozovnu, druhá jede dál.
  const z2 = zaznam()
  const b2 = await probehnoutBeh([ukol('A'), ukol('B')], z2.zpracovat({ 'A:2026-10-05': chyba('jina', 'divný den') }), () => false)
  const [a2, bb2] = b2.postup
  ok('chyba jednoho dne v historii provozovny A nezastaví historii provozovny B',
    bb2.dohnanoOd === '2026-10-01' && z2.dny.includes('B:2026-10-01') && !b2.globalni)
  ok('… A má chybu a kurzor stojí za posledním dobrým dnem', a2.chyba?.duvod === 'divný den' && a2.dohnanoOd === '2026-10-06')

  // Neplatný token (pristup) nebo nedostupná pokladna (docasna) zastaví všechno.
  const z3 = zaznam()
  const b3 = await probehnoutBeh([ukol('A'), ukol('B')], z3.zpracovat({ 'A:2026-10-10': chyba('pristup', 'token') }), () => false)
  ok('neplatný přístup u jedné provozovny zastaví celý běh (token je společný)', b3.globalni?.druh === 'pristup' && !z3.dny.some((d) => d.startsWith('B:')))
  const z3b = zaznam()
  const b3b = await probehnoutBeh([ukol('A'), ukol('B')], z3b.zpracovat({ 'A:2026-10-11': chyba('docasna', 'limit', true) }), () => false)
  ok('celoplošná dočasná chyba (limit dotazů) taky zastaví celý běh', b3b.globalni?.druh === 'docasna' && z3b.dny.length === 1)
  const z3c = zaznam()
  const b3c = await probehnoutBeh([ukol('A'), ukol('B')], z3c.zpracovat({ 'A:2026-10-05': chyba('docasna', '5xx jednoho dne') }), () => false)
  ok('výpadek jednoho dne (5xx, timeout) zastaví jen tu provozovnu, ne historii ostatních',
    !b3c.globalni && b3c.postup[0].chyba?.duvod === '5xx jednoho dne' && b3c.postup[1].dohnanoOd === '2026-10-01')

  // Výpadek: souvisle do 3. 10., dnes 11. 10. → poslední dny, pak mezera 3.–8. 10. od nejstaršího.
  const z4 = zaznam()
  const b4 = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-03' })], z4.zpracovat(), () => false)
  ok('po výpadku: poslední dny, pak mezera od nejstaršího dne',
    z4.dny.join() === 'A:2026-10-11,A:2026-10-10,A:2026-10-09,A:2026-10-03,A:2026-10-04,A:2026-10-05,A:2026-10-06,A:2026-10-07,A:2026-10-08')
  ok('… a souvisle_do je zase dnešek', b4.postup[0].souvisleDo === '2026-10-11' && b4.zbyvaDnu === 0)

  // Mezera přerušená časem: souvisle_do = poslední hotový den mezery, zbytek se počítá.
  const z5 = zaznam()
  let kroku = 0
  const b5 = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-03' })], z5.zpracovat(), () => ++kroku > 5)
  ok('přerušená mezera: souvisle_do = poslední hotový den, zbývající dny se hlásí',
    b5.postup[0].souvisleDo === '2026-10-04' && b5.zbyvaDnu === 4)

  // Poslední dny nedoběhly → souvisle_do se neposune (jinak by „souvisle do dneška" lhalo).
  const z6 = zaznam()
  const b6 = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-03' })], z6.zpracovat({ 'A:2026-10-09': chyba('jina') }), () => false)
  ok('nedoběhlé poslední dny → souvisle_do i mezera beze změny', b6.postup[0].souvisleDo === '2026-10-03' && !z6.dny.includes('A:2026-10-03'))

  // Prázdná mezera (souvisle do včerejška), ale den v posledních dnech selhal → souvisle_do se NESMÍ posunout na dnešek,
  // jinak by ten den po vypadnutí z okna posledních dní už nikdo nestáhl.
  const z6b = zaznam()
  const b6b = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-10' })], z6b.zpracovat({ 'A:2026-10-10': chyba('jina') }), () => false)
  ok('chyba v posledních dnech při prázdné mezeře → souvisle_do zůstane (ne „dnešek")', b6b.postup[0].souvisleDo === '2026-10-10')
  const z6c = zaznam()
  let kroku6c = 0
  const b6c = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-10' })], z6c.zpracovat(), () => ++kroku6c > 1)
  ok('došel čas v posledních dnech při prázdné mezeře → souvisle_do zůstane', b6c.postup[0].souvisleDo === '2026-10-10')

  // Nová provozovna, poslední dny nedoběhly → historie se nezačne (kurzor neexistuje).
  const z7 = zaznam()
  const b7 = await probehnoutBeh([ukol('A')], z7.zpracovat({ 'A:2026-10-10': chyba('jina') }), () => false)
  ok('nová provozovna s chybou v posledních dnech: ostatní poslední dny ano, kurzor ani historie ne',
    b7.postup[0].dohnanoOd === null && z7.dny.join() === 'A:2026-10-11,A:2026-10-10,A:2026-10-09')

  // Spravedlivé pořadí: na kterou se nejdéle nedostalo (nejstarší souvisle_do), jde první.
  const z8 = zaznam()
  await probehnoutBeh([
    ukol('A', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-11' }),
    ukol('B', { dohnanoOd: '2026-10-01', souvisleDo: '2026-10-08' }),
  ], z8.zpracovat(), () => z8.dny.length >= 3)
  ok('při krátkém čase dostane přednost provozovna, na kterou se nejdéle nedostalo', z8.dny.every((d) => d.startsWith('B:')))
  const z8b = zaznam()
  const b8b = await probehnoutBeh([ukol('A'), ukol('B')], z8b.zpracovat(), () => z8b.dny.length >= 2)
  ok('nestihnuté poslední dny se počítají do zbývajících (A: 1 poslední + 8 historie, B: 3 + 8)', b8b.zbyvaDnu === 20)

  // Den, který pořád selhává: počítá se, po 3. pokusu se přeskočí a ohlásí.
  const den = '2026-10-05'
  const z9 = zaznam()
  const b9 = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-06', souvisleDo: '2026-10-11' })], z9.zpracovat({ [`A:${den}`]: chyba('jina', 'vadný den') }), () => false)
  ok('1. selhání dne: uvázlo (pokus 1), kurzor stojí', b9.postup[0].uvazl?.den === den && b9.postup[0].uvazl.pokusu === 1 && b9.postup[0].dohnanoOd === '2026-10-06')
  const z9b = zaznam()
  const b9b = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-06', souvisleDo: '2026-10-11', uvazl: { den, pokusu: 1 } })], z9b.zpracovat({ [`A:${den}`]: chyba('jina', 'vadný den') }), () => false)
  ok('2. selhání: pokus 2', b9b.postup[0].uvazl?.pokusu === 2 && b9b.postup[0].dohnanoOd === '2026-10-06')
  const z9c = zaznam()
  const b9c = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-06', souvisleDo: '2026-10-11', uvazl: { den, pokusu: 2 } })], z9c.zpracovat({ [`A:${den}`]: chyba('jina', 'vadný den') }), () => false)
  ok('3. selhání: den se přeskočí a ohlásí, historie jde dál', b9c.postup[0].uvazl === null && b9c.postup[0].preskocene[0]?.den === den
    && b9c.postup[0].dohnanoOd === '2026-10-01' && !b9c.postup[0].chyba)
  const z9d = zaznam()
  const b9d = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-06', souvisleDo: '2026-10-11', uvazl: { den, pokusu: 2 } })], z9d.zpracovat(), () => false)
  ok('den, který se mezitím povedl, uvázlost zruší', b9d.postup[0].uvazl === null && b9d.postup[0].preskocene.length === 0)
  const z9e = zaznam()
  const b9e = await probehnoutBeh([ukol('A', { dohnanoOd: '2026-10-06', souvisleDo: '2026-10-11', uvazl: { den: '2026-10-04', pokusu: 2 } })], z9e.zpracovat({ [`A:${den}`]: chyba('jina') }), () => false)
  ok('selhání JINÉHO dne počítá od jedné', b9e.postup[0].uvazl?.den === den && b9e.postup[0].uvazl.pokusu === 1)
}

console.log('\n== Příjmové API: limity, které databáze unese ==')
{
  const dnes = '2026-10-11'
  const radek = (produkt, trzba) => ({ datum: '2026-10-10', produkt, mnozstvi: 1, trzba })
  const preteceni = overitDavku({ prodeje: [radek('Pivo', 15_000_000), radek('Pivo', 15_000_000)] }, dnes)
  ok('stejný produkt za den nad 21 474 836 Kč (součet) → chyba dávky, ne pád databáze', preteceni.stav === 'chyba' && preteceni.duvod.includes('haléře'))
  const jeden = overitDavku({ prodeje: [radek('Pivo', 21_000_000)] }, dnes)
  ok('jedna položka nad 20 mil. Kč (pod limitem sloupce) → chyba, i když by se do databáze vešla', jeden.stav === 'chyba' && jeden.duvod.includes('Položka 1'))
  const ridici = overitDavku({ prodeje: [radek('Ko\u0000la\t', 10)] }, dnes)
  ok('řídicí znaky v názvu produktu pryč (\\u0000 by databáze odmítla)', ridici.stav === 'ok' && ridici.radky[0].produktNazev === 'Ko la')
  const mezery = overitDavku({ prodeje: [radek('Pilsner  0,5 l', 10)] }, dnes)
  ok('vnitřní mezery v názvu zůstávají (shoda s recepturou)', mezery.stav === 'ok' && mezery.radky[0].produktNazev === 'Pilsner  0,5 l')
}

console.log(chyb ? `\n${chyb} kontrol SELHALO` : '\nVšechny kontroly prošly')
process.exit(chyb ? 1 : 0)
