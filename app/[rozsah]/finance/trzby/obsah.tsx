import Link from 'next/link'

import { koruny } from '@/lib/mzdy'
import {
  NAZVY_DRUHU_PLATEB,
  obdobiVRozsahu,
  popisObdobi,
  pouziteDruhy,
  radkyPoObdobich,
  radkyPoPobockach,
  soucet,
  zpusobyVRozsahu,
  type Cleneni,
  type PrehledTrzeb,
  type RadekObdobi,
  type RadekPobocky,
  type SouhrnTrzeb,
} from '@/lib/pokladna-trzby'
import type { DruhPlatby } from '@/lib/pos-provider-contract'
import DataTable, { type SloupecTabulky } from '@/components/ui/DataTable'
import LineChart from '@/components/ui/LineChart'
import FinanceKpiKarta from '../kpi-karta'

/**
 * Obsah stránky Finance → Tržby — čistě kreslicí: data a odkazy dostane
 * od stránky (page.tsx), sám nic nenačítá ani nekontroluje práva. Díky
 * tomu se dá vykreslit i s ukázkovými daty bez přihlášení.
 */

export const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

export const NAZVY_CLENENI: Record<Cleneni, string> = { den: 'Po dnech', mesic: 'Po měsících', rok: 'Po rocích' }

function procento(cast: number, celek: number): string {
  if (celek <= 0) return '–'
  return `${((cast / celek) * 100).toFixed(1).replace('.', ',')} %`
}

const cislo = { fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' } as const

export default function Obsah({
  prehled,
  cleneni,
  od,
  doData,
  vybranaPobocka,
  nazevRozsahu,
  nazvyPobocek,
  poradiPobocek,
  bankaVidi,
  maBankovniUcet,
  maPokladnu,
  rozsah,
  odkazNaObdobi,
  odkazNaPobocku,
}: {
  prehled: PrehledTrzeb
  cleneni: Cleneni
  od: string
  doData: string
  vybranaPobocka: string | null
  nazevRozsahu: string
  nazvyPobocek: Map<string, string>
  poradiPobocek: string[]
  bankaVidi: boolean
  maBankovniUcet: boolean
  maPokladnu: boolean
  rozsah: string
  odkazNaObdobi: (obdobi: string) => string | null
  /** Proklik na provozovnu ve stejném členění a období. */
  odkazNaPobocku: (branchId: string) => string
}) {
  const vsechnaObdobi = obdobiVRozsahu(od, doData, cleneni)
  const radkyVse = radkyPoObdobich(prehled, vsechnaObdobi, { branchId: vybranaPobocka, bankaVidi })
  // Po rocích: od prvního roku, kdy něco je (deset prázdných let nahoře nikomu nepomůže).
  const prvniSData = radkyVse.findIndex((r) => r.dnu > 0 || r.platbyCelkemHaleru !== 0 || (r.bankaHaleru ?? 0) !== 0)
  const radky = cleneni === 'rok' ? radkyVse.slice(prvniSData < 0 ? radkyVse.length - 1 : prvniSData) : radkyVse
  const celkem = soucet(radky, bankaVidi)
  const druhy = pouziteDruhy([...radky, celkem])
  const bankaZobrazit = bankaVidi && maBankovniUcet
  const platbyCastecne = celkem.dnu > 0 && celkem.dnuSPlatbami < celkem.dnu

  if (celkem.dnu === 0 && celkem.platbyCelkemHaleru === 0 && (celkem.bankaHaleru ?? 0) === 0) {
    return (
      <div style={karta}>
        <h2 style={{ margin: '0 0 6px', fontSize: '15px' }}>Za tohle období tu nic není</h2>
        <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
          {maPokladnu
            ? 'Pokladna za tohle období žádné prodeje neposlala — buď bylo zavřeno, nebo je synchronizace ještě nestáhla.'
            : 'Zatím není připojená žádná pokladna.'}{' '}
          <Link href={`/${rozsah}/finance/integrace/pokladna`} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>Pokladní systémy →</Link>
        </p>
      </div>
    )
  }

  const popisRozsahu = `${nazevRozsahu} · ${cleneni === 'rok' ? `${popisObdobi(radky[0].obdobi, 'rok')}–${popisObdobi(radky[radky.length - 1].obdobi, 'rok')}` : popisObdobi(od, cleneni === 'den' ? 'mesic' : 'rok')}`

  const sloupcePlateb = <T extends SouhrnTrzeb>(): SloupecTabulky<T>[] =>
    druhy.map((d: DruhPlatby) => ({
      klic: `platba-${d}`,
      hlavicka: NAZVY_DRUHU_PLATEB[d],
      zarovnaniVpravo: true,
      vykresli: (r: T) => <span style={cislo}>{r.platbyPoDruhu[d] !== undefined ? koruny(r.platbyPoDruhu[d]!) : ''}</span>,
    }))

  const sloupecBanky = <T extends SouhrnTrzeb>(): SloupecTabulky<T>[] =>
    bankaZobrazit
      ? [{ klic: 'banka', hlavicka: 'Banka (příjmy)', zarovnaniVpravo: true, vykresli: (r: T) => <span style={cislo}>{r.bankaHaleru ? koruny(r.bankaHaleru) : ''}</span> }]
      : []

  const radkyTabulky = [...radky].reverse()
  const zpusoby = zpusobyVRozsahu(prehled, vybranaPobocka)
  const poPobockach: RadekPobocky[] = vybranaPobocka === null ? radkyPoPobockach(prehled, poradiPobocek, bankaZobrazit) : []

  return (
    <>
      <div className="ds-kpi-mrizka">
        <FinanceKpiKarta ikona="mince" titulek="Tržby z pokladen" hodnota={celkem.dnu > 0 ? koruny(celkem.trzbaHaleru) : '–'} zdroj={popisRozsahu} trend={null} />
        <FinanceKpiKarta
          ikona="fajfkaKruh"
          titulek="Zaplaceno v pokladně"
          hodnota={celkem.dnuSPlatbami > 0 ? koruny(celkem.platbyCelkemHaleru) : '–'}
          zdroj={
            celkem.dnuSPlatbami === 0
              ? 'pokladna rozpad plateb zatím neposlala'
              : platbyCastecne
                ? 'platby zatím jen za část dní — viz níže'
                : 'hotovost, karta, stravenky…'
          }
          trend={null}
        />
        <FinanceKpiKarta
          ikona="kniha"
          titulek="Příjmy na bankovní účty"
          hodnota={bankaZobrazit ? koruny(celkem.bankaHaleru ?? 0) : '–'}
          zdroj={!bankaVidi ? 'jen s právem pro celou firmu' : !maBankovniUcet ? 'banka zatím není napojená' : vybranaPobocka ? 'účty této provozovny' : 'všechny bankovní účty'}
          trend={null}
        />
        <FinanceKpiKarta ikona="tecky" titulek="Ostatní platby" hodnota="–" zdroj="modul se připravuje" trend={null} />
      </div>

      {platbyCastecne ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          Rozpad podle způsobu platby stahuje appka od 12. 10. 2026. Starší dny se doplňují postupně při hodinové synchronizaci —
          do té doby pokrývají platby jen část tržeb.
        </p>
      ) : null}

      {radky.length >= 2 ? (
        <div style={{ ...karta, minWidth: 0 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Tržby z pokladen — {NAZVY_CLENENI[cleneni].toLowerCase()}</h2>
          <LineChart
            body={radky.map((r) => ({ popisek: popisObdobi(r.obdobi, cleneni), hodnotaHaleru: r.trzbaHaleru, budouci: false }))}
            formatovatOsu={zkratka}
            formatovatHodnotu={koruny}
            nazev={`Tržby z pokladen ${NAZVY_CLENENI[cleneni].toLowerCase()}`}
            popisekPosledni={popisObdobi(radky[radky.length - 1].obdobi, cleneni)}
          />
        </div>
      ) : null}

      <section style={{ display: 'grid', gap: '8px', minWidth: 0 }} aria-labelledby="trzby-obdobi">
        <h2 id="trzby-obdobi" style={{ margin: 0, fontSize: '15px' }}>
          {NAZVY_CLENENI[cleneni]} — {nazevRozsahu}
        </h2>
        <DataTable<RadekObdobi | (SouhrnTrzeb & { obdobi: 'celkem' })>
          zebra
          klicRadku={(r) => r.obdobi}
          sloupce={[
            {
              klic: 'obdobi',
              hlavicka: cleneni === 'den' ? 'Den' : cleneni === 'mesic' ? 'Měsíc' : 'Rok',
              vykresli: (r) => {
                if (r.obdobi === 'celkem') return <strong>Celkem</strong>
                const href = odkazNaObdobi(r.obdobi)
                // Bez zalomení: „po 12. 10." se na telefonu jinak lámal na dva řádky.
                const text = <span style={{ whiteSpace: 'nowrap' }}>{popisObdobi(r.obdobi, cleneni)}</span>
                return href ? <Link href={href} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>{text}</Link> : text
              },
            },
            {
              klic: 'trzby',
              hlavicka: 'Tržby',
              zarovnaniVpravo: true,
              vykresli: (r) => (
                <span style={{ ...cislo, fontWeight: r.obdobi === 'celkem' ? 700 : 600 }}>{r.dnu > 0 ? koruny(r.trzbaHaleru) : '–'}</span>
              ),
            },
            ...sloupcePlateb<RadekObdobi | (SouhrnTrzeb & { obdobi: 'celkem' })>(),
            ...sloupecBanky<RadekObdobi | (SouhrnTrzeb & { obdobi: 'celkem' })>(),
          ]}
          radky={[{ ...celkem, obdobi: 'celkem' as const }, ...radkyTabulky]}
        />
      </section>

      {poPobockach.length > 0 ? (
        <section style={{ display: 'grid', gap: '8px', minWidth: 0 }} aria-labelledby="trzby-pobocky">
          <h2 id="trzby-pobocky" style={{ margin: 0, fontSize: '15px' }}>Po provozovnách — {popisRozsahu.replace(/^Celá firma · /, '')}</h2>
          <DataTable<RadekPobocky>
            zebra
            klicRadku={(r) => r.branchId ?? 'firma'}
            sloupce={[
              {
                klic: 'pobocka',
                hlavicka: 'Provozovna',
                vykresli: (r) =>
                  r.branchId === null ? (
                    <span style={{ color: 'var(--muted)' }}>Firemní účty bez provozovny</span>
                  ) : poradiPobocek.includes(r.branchId) ? (
                    <Link href={odkazNaPobocku(r.branchId)} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>
                      {nazvyPobocek.get(r.branchId) ?? 'Provozovna'}
                    </Link>
                  ) : (
                    nazvyPobocek.get(r.branchId) ?? 'Jiná provozovna'
                  ),
              },
              { klic: 'trzby', hlavicka: 'Tržby', zarovnaniVpravo: true, vykresli: (r) => <span style={{ ...cislo, fontWeight: 600 }}>{r.dnu > 0 ? koruny(r.trzbaHaleru) : '–'}</span> },
              { klic: 'podil', hlavicka: 'Podíl', zarovnaniVpravo: true, vykresli: (r) => <span style={cislo}>{r.dnu > 0 ? procento(r.trzbaHaleru, celkem.trzbaHaleru) : ''}</span> },
              ...sloupcePlateb<RadekPobocky>(),
              ...sloupecBanky<RadekPobocky>(),
            ]}
            radky={poPobockach}
          />
        </section>
      ) : null}

      <section style={{ display: 'grid', gap: '8px', minWidth: 0 }} aria-labelledby="trzby-zpusoby">
        <h2 id="trzby-zpusoby" style={{ margin: 0, fontSize: '15px' }}>Způsoby platby — {popisRozsahu}</h2>
        <DataTable<(typeof zpusoby)[number]>
          zebra
          klicRadku={(r) => r.zpusob}
          prazdno="Pokladna za tohle období rozpad plateb neposlala."
          sloupce={[
            { klic: 'nazev', hlavicka: 'Způsob', vykresli: (r) => r.nazev },
            { klic: 'druh', hlavicka: 'Skupina', vykresli: (r) => <span style={{ color: 'var(--muted)' }}>{NAZVY_DRUHU_PLATEB[r.druh]}</span> },
            { klic: 'pocet', hlavicka: 'Plateb', zarovnaniVpravo: true, vykresli: (r) => <span style={cislo}>{r.pocet.toLocaleString('cs-CZ')}</span> },
            { klic: 'castka', hlavicka: 'Částka', zarovnaniVpravo: true, vykresli: (r) => <span style={{ ...cislo, fontWeight: 600 }}>{koruny(r.castkaHaleru)}</span> },
            { klic: 'podil', hlavicka: 'Podíl', zarovnaniVpravo: true, vykresli: (r) => <span style={cislo}>{procento(r.castkaHaleru, celkem.platbyCelkemHaleru)}</span> },
          ]}
          radky={zpusoby}
        />
      </section>

      <div style={karta}>
        <h2 style={{ margin: '0 0 6px', fontSize: '15px' }}>Ostatní platby</h2>
        <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
          Samostatný modul, který se teprve připravuje. Až vznikne, objeví se jeho platby tady vedle pokladny a banky.
        </p>
      </div>

      <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
        Tržby jsou za provozní den pobočky, jak je posílá pokladna.{' '}
        <Link href={`/${rozsah}/finance/integrace/prodeje`} className="ds-plocha-odkaz" style={{ marginLeft: 0 }}>Prodeje po produktech →</Link>
      </p>
    </>
  )
}

/** Zkrácený tvar pro osu grafu — „1,2 mil. Kč" / „600 tis. Kč". */
function zkratka(haleru: number): string {
  const kc = haleru / 100
  if (Math.abs(kc) >= 1_000_000) return `${(kc / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil. Kč`
  if (Math.abs(kc) >= 1_000) return `${(kc / 1_000).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} tis. Kč`
  return koruny(haleru)
}
