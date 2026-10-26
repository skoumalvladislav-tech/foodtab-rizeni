import Link from 'next/link'

import Badge from '@/components/ui/Badge'
import { datumACasSRokemVPasmu, hodinaVPasmu } from '@/lib/cas'
import {
  NAZVY_POHLEDU,
  POHLEDY,
  denKratce,
  hosteText,
  jeVikend,
  nazevDneKratce,
  nazevPohledu,
  posunPohledu,
  souhrnDne,
  type DenMrizky,
  type Pohled,
} from '@/lib/rezervace-kalendar'
import { velikostText, jeObrazek } from '@/lib/rezervace-prilohy'
import {
  NAZVY_DRUHU,
  NAZVY_STAVU,
  NAZVY_ZDROJE,
  TON_STAVU,
  halereNaKoruny,
  pocitaSeDoHostu,
  type DruhRezervace,
  type StavRezervace,
  type ZdrojRezervace,
} from '@/lib/rezervace-typy'

import Ikona from '../ikona'
import { odebratPrilohu, pridatPoznamku, smazatPoznamku, upravitPoznamku } from './akce'
import NahratPrilohy from './prilohy-nahrat'

/**
 * Kreslicí kousky Rezervací a akcí.
 *
 * ČISTĚ KRESLICÍ, stejně jako dnes/prvky.tsx: žádný dotaz, žádné právo.
 * Co se smí ukázat a kdo smí zapisovat, rozhodla stránka a poslala to sem.
 * Formuláře volají serverové akce, které si právo ověří znovu.
 *
 * Vzhled je v app/_rezervace.css (`ds-rez-*`).
 */

export type RezervaceRadek = {
  id: string
  branch_id: string
  den: string
  druh: DruhRezervace
  stav: StavRezervace
  nazev: string
  jmeno_hosta: string
  zacatek: string
  konec: string | null
  pocet_osob: number | null
  prostor: string
  typ_akce: string
  zdroj: ZdrojRezervace
  /** Pásmo pobočky rezervace — časy se ukazují v něm (lib/cas.ts). */
  zona: string
}

export type Poznamka = {
  id: string
  nadpis: string
  obsah: string
  autor: string | null
  vytvoreno_kdy: string
  zmeneno_kdy: string
}

export type Priloha = {
  id: string
  nazev: string
  mime: string
  velikost: number
  nahrano: string
}

const TONY_BADGE = { dobre: 'success', info: 'accent', pozor: 'warning', bad: 'danger', neutral: 'neutral' } as const

export function StitekStavu({ stav }: { stav: StavRezervace }) {
  return <Badge tone={TONY_BADGE[TON_STAVU[stav]]}>{NAZVY_STAVU[stav]}</Badge>
}

/** Jak se rezervace jmenuje v seznamu: akce názvem, rezervace jménem hosta. */
export function titulek(r: Pick<RezervaceRadek, 'druh' | 'nazev' | 'jmeno_hosta'>): string {
  if (r.druh === 'akce') return r.nazev || r.jmeno_hosta || 'Akce bez názvu'
  return r.jmeno_hosta || r.nazev || 'Rezervace bez jména'
}

export function casRezervace(r: Pick<RezervaceRadek, 'zacatek' | 'konec'>, zona: string): string {
  const od = hodinaVPasmu(r.zacatek, zona)
  return r.konec ? `${od}–${hodinaVPasmu(r.konec, zona)}` : od
}

function osobyText(n: number | null): string {
  if (n === null) return 'počet neuveden'
  return `${n} ${n === 1 ? 'osoba' : n >= 2 && n <= 4 ? 'osoby' : 'osob'}`
}

/* ---------- záložky modulu ------------------------------------------ */

export function ZalozkyRezervaci({ rozsah, aktivni }: { rozsah: string; aktivni: 'kalendar' | 'napojeni' }) {
  return (
    <nav className="ds-zalozky" aria-label="Rezervace a akce">
      <Link href={`/${rozsah}/rezervace`} aria-current={aktivni === 'kalendar' ? 'page' : undefined}>
        <Ikona klic="rezervace" />
        Kalendář
      </Link>
      <Link href={`/${rozsah}/rezervace/napojeni`} aria-current={aktivni === 'napojeni' ? 'page' : undefined}>
        <Ikona klic="kolo" />
        Napojení a import
      </Link>
    </nav>
  )
}

/* ---------- nástroje pohledu ---------------------------------------- */

export function adresaPohledu(rozsah: string, pohled: Pohled, datum: string): string {
  if (pohled === 'den') return `/${rozsah}/rezervace/den/${datum}`
  return `/${rozsah}/rezervace?pohled=${pohled}&datum=${datum}`
}

export function NastrojePohledu({
  rozsah,
  pohled,
  datum,
  dnes,
  smiZapisovat,
}: {
  rozsah: string
  pohled: Pohled
  datum: string
  dnes: string
  smiZapisovat: boolean
}) {
  return (
    <div className="ds-rez-nastroje">
      <div className="ds-rez-prepinac" role="group" aria-label="Pohled kalendáře">
        {POHLEDY.map((p) => (
          <Link key={p} href={adresaPohledu(rozsah, p, datum)} className="ft-tl ft-tl-vedlejsi" aria-pressed={p === pohled}>
            {NAZVY_POHLEDU[p]}
          </Link>
        ))}
      </div>
      <div className="ds-rez-sipky">
        <Link href={adresaPohledu(rozsah, pohled, posunPohledu(pohled, datum, -1))} className="ft-tl ft-tl-vedlejsi" aria-label="Předchozí">
          ‹
        </Link>
        <Link href={adresaPohledu(rozsah, pohled, dnes)} className="ft-tl ft-tl-vedlejsi">
          Dnes
        </Link>
        <Link href={adresaPohledu(rozsah, pohled, posunPohledu(pohled, datum, 1))} className="ft-tl ft-tl-vedlejsi" aria-label="Další">
          ›
        </Link>
      </div>
      {/* U dne nese datum už nadpis stránky — druhý by byl jen opakování. */}
      {pohled === 'den' ? null : <h2 className="ds-rez-obdobi">{nazevPohledu(pohled, datum)}</h2>}
      {smiZapisovat ? (
        <div className="ds-rez-vpravo">
          <Link href={`/${rozsah}/rezervace/nova?datum=${datum}`} className="ft-tl ft-tl-hlavni">
            <Ikona klic="plus" /> Nová rezervace
          </Link>
          <Link href={`/${rozsah}/rezervace/nova?datum=${datum}&druh=akce`} className="ft-tl ft-tl-vedlejsi">
            <Ikona klic="praporek" /> Nová akce
          </Link>
        </div>
      ) : null}
    </div>
  )
}

/* ---------- týden ------------------------------------------------------ */

export type DenTydne = {
  den: string
  rezervace: RezervaceRadek[]
  poznamek: number
  priloh: number
}

export function TydenKalendar({
  rozsah,
  dny,
  dnes,
  smiZapisovat,
  zkratkyPobocek,
}: {
  rozsah: string
  dny: DenTydne[]
  dnes: string
  smiZapisovat: boolean
  /** Na firemním rozsahu s víc pobočkami: id → zkratka. Jinak prázdné. */
  zkratkyPobocek: Map<string, string>
}) {
  return (
    <div className="ds-rez-tyden">
      {dny.map((d) => {
        const s = souhrnDne(d.rezervace)
        const [, , den] = d.den.split('-').map(Number)
        return (
          <section
            key={d.den}
            className="ds-plocha ds-rez-den"
            data-dnes={d.den === dnes ? '' : undefined}
            data-vikend={jeVikend(d.den) ? '' : undefined}
            aria-label={denKratce(d.den)}
          >
            <Link href={`/${rozsah}/rezervace/den/${d.den}`} className="ds-rez-den-hlava">
              <span className="ds-rez-den-nazev">
                {nazevDneKratce(d.den)}
                {d.den === dnes ? ' · dnes' : ''}
              </span>
              <span className="ds-rez-den-cislo ds-cislo">{den}.</span>
            </Link>
            <p className="ds-rez-den-souhrn">
              {s.rezervaci + s.akci === 0
                ? 'Nic zapsaného'
                : `${s.rezervaci} rez.${s.akci ? ` · ${s.akci} ${s.akci === 1 ? 'akce' : 'akcí'}` : ''} · ${hosteText(s)}`}
            </p>
            {d.poznamek + d.priloh > 0 ? (
              <div className="ds-rez-den-znacky">
                {d.poznamek > 0 ? (
                  <span title="Poznámky ke dni">
                    <Ikona klic="tuzka" /> {d.poznamek}
                  </span>
                ) : null}
                {d.priloh > 0 ? (
                  <span title="Přílohy ke dni">
                    <Ikona klic="sponka" /> {d.priloh}
                  </span>
                ) : null}
              </div>
            ) : null}
            {d.rezervace.map((r) => (
              <Link
                key={r.id}
                href={`/${rozsah}/rezervace/${r.id}`}
                className="ds-rez-polozka"
                data-druh={r.druh}
                data-neplati={pocitaSeDoHostu(r.stav) ? undefined : ''}
              >
                <strong>
                  {hodinaVPasmu(r.zacatek, r.zona)} {titulek(r)}
                </strong>
                <small>
                  {[
                    r.druh === 'akce' ? r.typ_akce || 'Akce' : null,
                    r.pocet_osob !== null ? `${r.pocet_osob} os.` : null,
                    pocitaSeDoHostu(r.stav) ? (r.stav === 'ceka' ? 'předběžná' : null) : NAZVY_STAVU[r.stav].toLowerCase(),
                    zkratkyPobocek.get(r.branch_id) ?? null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </Link>
            ))}
            {smiZapisovat ? (
              <Link href={`/${rozsah}/rezervace/nova?datum=${d.den}`} className="ds-rez-den-pridat">
                + Přidat
              </Link>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/* ---------- měsíc ------------------------------------------------------ */

export type DenMesice = DenMrizky & { rezervace: RezervaceRadek[]; poznamek: number }

export function MesicKalendar({ rozsah, tydny, dnes }: { rozsah: string; tydny: DenMesice[][]; dnes: string }) {
  const nic = tydny.every((t) => t.every((d) => !d.vMesici || (d.rezervace.length === 0 && d.poznamek === 0)))
  return (
    <div>
      <div className="ds-rez-mesic">
        {['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'].map((n) => (
          <div key={n} className="ds-rez-mesic-hlava" aria-hidden="true">
            {n}
          </div>
        ))}
        {tydny.flat().map((d) => {
          const s = souhrnDne(d.rezervace)
          const akce = d.rezervace.filter((r) => r.druh === 'akce' && pocitaSeDoHostu(r.stav))
          const [, , den] = d.den.split('-').map(Number)
          const prazdny = d.rezervace.length === 0 && d.poznamek === 0
          return (
            <Link
              key={d.den}
              href={`/${rozsah}/rezervace/den/${d.den}`}
              className="ds-rez-bunka"
              data-mimo={d.vMesici ? undefined : ''}
              data-dnes={d.den === dnes ? '' : undefined}
              data-vikend={jeVikend(d.den) && d.vMesici ? '' : undefined}
              data-prazdny={prazdny ? '' : undefined}
              aria-label={`${denKratce(d.den)}: ${prazdny ? 'nic zapsaného' : `${s.rezervaci} rezervací, ${s.akci} akcí, ${hosteText(s)}`}`}
            >
              <span className="ds-rez-bunka-cislo ds-cislo">{den}.</span>
              <span className="ds-rez-bunka-den-nazev">{denKratce(d.den)}</span>
              {s.rezervaci + s.akci > 0 ? <span className="ds-rez-bunka-souhrn">{s.rezervaci ? `${s.rezervaci} rez. · ` : ''}{hosteText(s)}</span> : null}
              {akce.slice(0, 2).map((r) => (
                <span key={r.id} className="ds-rez-bunka-akce" title={titulek(r)}>
                  {titulek(r)}
                </span>
              ))}
              {akce.length > 2 ? <span className="ds-rez-bunka-souhrn">+ {akce.length - 2} další</span> : null}
              {d.poznamek > 0 ? <span className="ds-rez-bunka-souhrn">poznámky: {d.poznamek}</span> : null}
            </Link>
          )
        })}
      </div>
      {nic ? <p className="ds-rez-mesic-prazdny">V tomhle měsíci zatím nic zapsaného.</p> : null}
    </div>
  )
}

/* ---------- seznam rezervací dne ------------------------------------- */

export function SeznamRezervaci({ rozsah, rezervace }: { rozsah: string; rezervace: RezervaceRadek[] }) {
  if (rezervace.length === 0) return <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Na tenhle den nic zapsaného.</p>
  return (
    <ul className="ds-rez-seznam">
      {rezervace.map((r) => (
        <li key={r.id}>
          <Link href={`/${rozsah}/rezervace/${r.id}`} className="ds-rez-radek" data-neplati={pocitaSeDoHostu(r.stav) ? undefined : ''}>
            <span className="ds-rez-cas">
              {hodinaVPasmu(r.zacatek, r.zona)}
              {r.konec ? <small>do {hodinaVPasmu(r.konec, r.zona)}</small> : null}
            </span>
            <span>
              <span className="ds-rez-jmeno">{titulek(r)}</span>
              <p className="ds-rez-meta">
                {[
                  osobyText(r.pocet_osob),
                  r.prostor || null,
                  r.druh === 'akce' ? r.typ_akce || 'Akce' : null,
                  r.druh === 'akce' && r.jmeno_hosta && r.nazev ? `objednal ${r.jmeno_hosta}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </span>
            <span className="ds-rez-stitky">
              {r.druh === 'akce' ? <Badge tone="vino">{NAZVY_DRUHU.akce}</Badge> : null}
              <StitekStavu stav={r.stav} />
              {r.zdroj !== 'rucne' ? <Badge>{r.zdroj === 'csv' ? 'ze souboru' : 'ze systému'}</Badge> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ---------- údaje rezervace ------------------------------------------ */

export function UdajeRezervace({
  r,
  nazevPobocky,
  zaloha,
  menu,
  poznamkaZdroje,
  kontakt,
}: {
  r: RezervaceRadek
  nazevPobocky: string
  zaloha: { haleru: number | null; stav: string }
  menu: string
  poznamkaZdroje: string
  /** `null` = člověk kontakt vidět nesmí (nemá `rezervace.manage`). */
  kontakt: { telefon: string; email: string } | null
}) {
  const zalohaText =
    zaloha.stav === 'zadna' && !zaloha.haleru
      ? 'bez zálohy'
      : `${zaloha.haleru ? halereNaKoruny(zaloha.haleru) : 'částka neuvedena'} · ${
          { zadna: 'bez zálohy', pozadovana: 'požadovaná', zaplacena: 'zaplacená', vracena: 'vrácená' }[zaloha.stav] ?? zaloha.stav
        }`
  return (
    <dl className="ds-rez-udaje">
      <dt>Kdy</dt>
      <dd>
        {denKratce(r.den)} · {casRezervace(r, r.zona)}
      </dd>
      <dt>Počet osob</dt>
      <dd>{osobyText(r.pocet_osob)}</dd>
      <dt>{r.druh === 'akce' ? 'Objednatel' : 'Host'}</dt>
      <dd>{r.jmeno_hosta || '—'}</dd>
      {r.druh === 'akce' ? (
        <>
          <dt>Typ akce</dt>
          <dd>{r.typ_akce || '—'}</dd>
        </>
      ) : null}
      <dt>Stůl / prostor</dt>
      <dd>{r.prostor || '—'}</dd>
      <dt>Pobočka</dt>
      <dd>{nazevPobocky}</dd>
      <dt>Záloha od hosta</dt>
      <dd>{zalohaText}</dd>
      {menu ? (
        <>
          <dt>Menu</dt>
          <dd>{menu}</dd>
        </>
      ) : null}
      {poznamkaZdroje ? (
        <>
          <dt>Poznámka hosta</dt>
          <dd>{poznamkaZdroje}</dd>
        </>
      ) : null}
      {kontakt ? (
        <>
          <dt>Telefon</dt>
          <dd>{kontakt.telefon ? <a href={`tel:${kontakt.telefon.replace(/\s+/g, '')}`}>{kontakt.telefon}</a> : '—'}</dd>
          <dt>E-mail</dt>
          <dd>{kontakt.email ? <a href={`mailto:${kontakt.email}`}>{kontakt.email}</a> : '—'}</dd>
        </>
      ) : null}
      <dt>Zápis</dt>
      <dd>{NAZVY_ZDROJE[r.zdroj]}</dd>
    </dl>
  )
}

/* ---------- poznámky a další informace -------------------------------- */

export type CilZapisu = { rezervace: string } | { den: string; pobocka: string }

function SkryteCile({ rozsah, cil, zpet }: { rozsah: string; cil: CilZapisu; zpet: string }) {
  return (
    <>
      <input type="hidden" name="rozsah" value={rozsah} />
      <input type="hidden" name="zpet" value={zpet} />
      {'rezervace' in cil ? (
        <input type="hidden" name="rezervace" value={cil.rezervace} />
      ) : (
        <>
          <input type="hidden" name="den" value={cil.den} />
          <input type="hidden" name="pobocka" value={cil.pobocka} />
        </>
      )}
    </>
  )
}

export function PanelPoznamek({
  rozsah,
  cil,
  zpet,
  poznamky,
  zona,
  smiZapisovat,
  nadpis = 'Poznámky a další informace',
}: {
  rozsah: string
  cil: CilZapisu
  zpet: string
  poznamky: Poznamka[]
  zona: string
  smiZapisovat: boolean
  nadpis?: string
}) {
  return (
    <section className="ds-plocha" aria-labelledby={`poznamky-${'rezervace' in cil ? cil.rezervace : `${cil.pobocka}-${cil.den}`}`}>
      <div className="ds-plocha-hlava">
        <Ikona klic="tuzka" />
        <h2 id={`poznamky-${'rezervace' in cil ? cil.rezervace : `${cil.pobocka}-${cil.den}`}`}>{nadpis}</h2>
      </div>
      {poznamky.length === 0 ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné.</p>
      ) : (
        <ul className="ds-rez-poznamky" style={{ marginBottom: smiZapisovat ? '14px' : 0 }}>
          {poznamky.map((p) => (
            <li key={p.id} className="ds-rez-poznamka">
              {p.nadpis ? <strong>{p.nadpis}</strong> : null}
              <p>{p.obsah}</p>
              <div className="ds-rez-poznamka-pata">
                <span>
                  {p.autor ?? 'Bez autora'} · {datumACasSRokemVPasmu(p.vytvoreno_kdy, zona)}
                  {p.zmeneno_kdy !== p.vytvoreno_kdy ? ' (upraveno)' : ''}
                </span>
                {smiZapisovat ? (
                  <form action={smazatPoznamku}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="zpet" value={zpet} />
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Smazat
                    </button>
                  </form>
                ) : null}
              </div>
              {smiZapisovat ? (
                <details style={{ marginTop: '6px' }}>
                  <summary>Upravit</summary>
                  <form action={upravitPoznamku} className="ds-rez-formular">
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="zpet" value={zpet} />
                    <input type="hidden" name="id" value={p.id} />
                    <input className="ds-input" name="nadpis" defaultValue={p.nadpis} maxLength={80} aria-label="Nadpis" />
                    <textarea className="ds-input ds-rez-text" name="obsah" defaultValue={p.obsah} maxLength={4000} required aria-label="Text" />
                    <div className="ds-rez-tlacitka">
                      <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">
                        Uložit úpravu
                      </button>
                    </div>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {smiZapisovat ? (
        <form action={pridatPoznamku} className="ds-rez-formular">
          <SkryteCile rozsah={rozsah} cil={cil} zpet={zpet} />
          <label className="ds-field">
            <span className="ds-field-label">Nadpis (nepovinný)</span>
            <input className="ds-input" name="nadpis" maxLength={80} placeholder="Alergie, Dort, Kontakt na DJ…" />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Poznámka</span>
            <textarea className="ds-input ds-rez-text" name="obsah" maxLength={4000} required />
          </label>
          <div className="ds-rez-tlacitka">
            <button type="submit" className="ft-tl ft-tl-vedlejsi">
              <Ikona klic="plus" /> Přidat poznámku
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}

/* ---------- přílohy ---------------------------------------------------- */

export function PanelPriloh({
  rozsah,
  cil,
  zpet,
  prilohy,
  zona,
  smiZapisovat,
  tenantId,
  branchId,
}: {
  rozsah: string
  cil: CilZapisu
  zpet: string
  prilohy: Priloha[]
  zona: string
  smiZapisovat: boolean
  tenantId: string
  branchId: string
}) {
  return (
    <section className="ds-plocha">
      <div className="ds-plocha-hlava">
        <Ikona klic="sponka" />
        <h2>Dokumenty a přílohy</h2>
      </div>
      {prilohy.length === 0 ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné.</p>
      ) : (
        <ul className="ds-rez-prilohy" style={{ marginBottom: smiZapisovat ? '14px' : 0 }}>
          {prilohy.map((p) => (
            <li key={p.id} className="ds-rez-priloha">
              <Ikona klic={jeObrazek(p.mime) ? 'fotka' : 'faktura'} />
              <a href={`/api/rezervace/soubor/${p.id}`} target="_blank" rel="noopener noreferrer" title={p.nazev}>
                {p.nazev}
              </a>
              <small>
                {velikostText(p.velikost)} · {datumACasSRokemVPasmu(p.nahrano, zona)}
              </small>
              {smiZapisovat ? (
                <form action={odebratPrilohu}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="zpet" value={zpet} />
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-label={`Odebrat ${p.nazev}`}>
                    Odebrat
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {smiZapisovat ? (
        <NahratPrilohy rozsah={rozsah} cil={cil} tenantId={tenantId} branchId={branchId} uzMa={prilohy.length} />
      ) : null}
    </section>
  )
}

/** Hláška po akci podle kódu z adresy (`?stav=` / `?chyba=`). */
export function HlaskaAkce({ stav, chyba }: { stav?: string; chyba?: string }) {
  const STAVY: Record<string, string> = {
    ulozeno: 'Uloženo.',
    'stav-zmenen': 'Stav je změněný.',
    poznamka: 'Poznámka je uložená.',
    'poznamka-smazana': 'Poznámka je smazaná.',
    'priloha-odebrana': 'Příloha je odebraná.',
    pripraveno: 'Napojení je připravené a čeká na připojení.',
    odpojeno: 'Napojení je odpojené.',
    // Choice — jen kódy, důvod chyby je u napojení (adresa nikdy nenese text).
    'choice-pripojeno': 'Choice je připojený a přístup ověřený. První rezervace se právě načítají — za minutu obnovte stránku.',
    'choice-overeno': 'Přístup do Choice je ověřený.',
    'choice-nacteno': 'Rezervace z Choice jsou načtené.',
    'choice-nacteno-cast': 'Část rezervací z Choice je načtená, zbytek se načte při dalším běhu (Choice pustí jen 1 dotaz za 5 sekund).',
  }
  const CHYBY: Record<string, string> = {
    pravo: 'Na tohle nemáte oprávnění.',
    nepovedlo: 'Nepovedlo se to. Zkuste to znovu.',
    poznamka: 'Poznámka je prázdná nebo moc dlouhá.',
    zdroj: 'Stav rezervace z rezervačního systému se mění tam, ne ve Foodtabu.',
    'uz-je': 'Tenhle systém už je u pobočky připravený.',
    'choice-nenastaveno': 'Napojení Choice čeká na nastavení — na serveru chybí CHOICE_CLIENT_ID a CHOICE_CLIENT_SECRET.',
    'choice-podnik': 'Odkaz na připojení z Choice nesedí. Zkopírujte ho z Choice znovu, celý (začíná https://…choiceqr.com/admin/open-api/connect).',
    'choice-odkaz-chybi': 'Vložte celý odkaz na připojení z Choice — jen adresa podniku nestačí. V Choice u aplikace Foodtab: Connected company list → adresa podniku → Connect, a vzniklý odkaz zkopírujte sem.',
    'choice-odkaz-aplikace': 'Odkaz z Choice je vygenerovaný pro jinou aplikaci než Foodtab — v Choice ho vytvořte u aplikace „Foodtab“.',
    'choice-odkaz-callback': 'Odkaz z Choice vrací jinam než do Foodtabu. U aplikace Foodtab v Choice musí být jako Authorization callback URL adresa Foodtabu končící /api/rezervace/choice/callback.',
    'choice-uz-pripojeno': 'Pobočka už má Choice připojený. Jiný podnik jde připojit až po odpojení.',
    'choice-pokus': 'Tenhle odkaz na připojení už neplatí nebo nepatří vašemu účtu. Připojte podnik znovu.',
    'choice-propadly': 'Odkaz na připojení vypršel (platí 10 minut). Připojte podnik znovu.',
    'choice-prihlaseni': 'Pro dokončení připojení musíte být přihlášení. Přihlaste se a připojte podnik znovu.',
    'choice-zamitnuto': 'V Choice se připojení nepovolilo.',
    'choice-kod': 'Choice připojení nedokončil — důvod je u napojení. Připojte podnik znovu.',
    'choice-jinde': 'Tenhle podnik Choice je už připojený u jiné pobočky.',
    'choice-test': 'Choice přístup neověřil — důvod je u napojení.',
    'choice-test-pozdeji': 'Token od Choice je uložený, ale ověřit se teď nepodařilo (Choice neodpovídá nebo omezuje dotazy). Za chvíli klikněte na „Ověřit znovu“.',
    'choice-bez-tokenu': 'U napojení chybí token. Připojte podnik znovu.',
    'choice-neovereno': 'Choice ještě není ověřený — načítat půjde po ověření.',
    'choice-chvili': 'Z Choice se právě načítá, nebo se načítalo před chvílí (Choice pustí jen 1 dotaz za 5 sekund). Zkuste to za minutu.',
    'choice-overeno-chvili': 'Přístup do Choice se ověřoval před chvílí. Znovu to jde za minutu.',
    'choice-nacteni': 'Načtení z Choice se nepovedlo — důvod je u napojení.',
  }
  // Rezervace se zapsala, ale některý dokument z formuláře se nepřipojil —
  // není to úspěch bez výhrad, proto vzhled chyby.
  if (stav === 'ulozeno-bez-priloh') {
    return (
      <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
        Rezervace je uložená, ale některé dokumenty se nepřipojily — přidejte je znovu v panelu Dokumenty a přílohy.
      </p>
    )
  }
  if (chyba && CHYBY[chyba]) {
    return (
      <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
        {CHYBY[chyba]}
      </p>
    )
  }
  if (stav && STAVY[stav]) {
    return (
      <p className="ds-rez-hlaska" role="status">
        {STAVY[stav]}
      </p>
    )
  }
  return null
}
