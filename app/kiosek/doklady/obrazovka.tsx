import type { FormEvent } from 'react'

import { MAX_ZNAKU_OZNACENI } from '@/lib/jine-platby-kiosek'

/**
 * Obrazovka kiosku Jiných plateb na telefonu — jen zobrazení podle stavu
 * (logika je v ./kiosek-doklady.tsx). Žádná finanční data: telefon zná
 * jen název pobočky a zařízení a po odeslání počet fotek a čas.
 */

export type FotkaNaObrazovce = { id: string; nahled: string | null; nazev: string; pdf: boolean; odeslana: boolean }

export type StavObrazovky =
  | { druh: 'pripojuji' }
  | { druh: 'parovani'; chyba: string; zPlochy: boolean }
  | { druh: 'odpojeno' }
  | { druh: 'vypnuto'; chyba: string }
  | { druh: 'vypadek'; chyba: string }
  | { druh: 'foceni'; pobocka: string; zarizeni: string; fotky: FotkaNaObrazovce[]; oznaceni: string; chyba: string; odesilam: boolean; postup: string }
  | { druh: 'odeslano'; pobocka: string; pocet: number; cas: string }

export type AkceObrazovky = {
  registrovat: (e: FormEvent<HTMLFormElement>) => void
  sparovatZnovu: () => void
  zkusitZnovu: () => void
  pridatFotky: (soubory: FileList | null) => void
  odebratFotku: (id: string) => void
  zmenitOznaceni: (text: string) => void
  odeslat: () => void
  dalsiDoklad: () => void
}

export default function ObrazovkaKiosku({ stav, akce }: { stav: StavObrazovky; akce: AkceObrazovky }) {
  if (stav.druh === 'pripojuji') {
    return (
      <main style={obal}>
        <div style={karta}>
          <p style={popis}>Připojuji…</p>
        </div>
      </main>
    )
  }

  if (stav.druh === 'parovani') {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Spárovat telefon</h1>
          <p style={popis}>
            V aplikaci na <strong>Nastavení → Zařízení</strong> si nechte vystavit registrační kód a opište ho sem. Platí pár
            minut a jde použít jednou. Pak tam u telefonu zapněte <strong>Kiosek Jiných plateb</strong>.
          </p>
          {!stav.zPlochy ? (
            <p role="note" style={upozorneni}>
              Doporučujeme kiosek nejdřív přidat na plochu (Android, Chrome: ⋮ → <strong>Přidat na plochu</strong>; iPhone,
              Safari: Sdílet → <strong>Přidat na plochu</strong>), otevřít ho ikonou a kód zadat až tam — aplikace z plochy má
              na iPhonu jiné úložiště než Safari.
            </p>
          ) : null}
          {stav.chyba ? <p style={chybaStyl}>{stav.chyba}</p> : null}
          <form onSubmit={akce.registrovat}>
            <label style={popisek} htmlFor="kod">
              Registrační kód
            </label>
            <input id="kod" name="kod" required maxLength={8} autoComplete="off" placeholder="A1B2C3D4" style={{ ...pole, textTransform: 'uppercase' }} />
            <button type="submit" className="ft-tl ft-tl-hlavni" style={tlacitko}>
              Spárovat
            </button>
          </form>
        </div>
      </main>
    )
  }

  if (stav.druh === 'odpojeno') {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Telefon není spárovaný</h1>
          <p style={popis}>
            Zařízení bylo v aplikaci odvolané, nebo ho server nezná. Doklady z něj už odeslat nejde. Nechte si vystavit nový
            registrační kód a telefon spárujte znovu.
          </p>
          <button type="button" className="ft-tl ft-tl-hlavni" style={tlacitko} onClick={akce.sparovatZnovu}>
            Spárovat znovu
          </button>
        </div>
      </main>
    )
  }

  if (stav.druh === 'vypnuto' || stav.druh === 'vypadek') {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>{stav.druh === 'vypnuto' ? 'Kiosek Jiných plateb je vypnutý' : 'Čekám na spojení'}</h1>
          <p style={popis}>
            {stav.druh === 'vypnuto'
              ? 'Telefon je spárovaný, ale doklady z něj posílat nejde. Kiosek Jiných plateb u něj zapne správce v Nastavení → Zařízení.'
              : stav.chyba}
          </p>
          <button type="button" className="ft-tl ft-tl-vedlejsi" style={tlacitko} onClick={akce.zkusitZnovu}>
            Zkusit znovu
          </button>
        </div>
      </main>
    )
  }

  if (stav.druh === 'odeslano') {
    return (
      <main style={obal}>
        <div style={karta}>
          <h1 style={nadpis}>Odesláno</h1>
          <p style={{ ...popis, fontSize: '16px', color: 'var(--ink)' }} role="status">
            Doklad ({stav.pocet} {stav.pocet === 1 ? 'fotka' : stav.pocet < 5 ? 'fotky' : 'fotek'}) odešel v {stav.cas} do Jiných plateb pobočky{' '}
            {stav.pobocka}. Zkontroluje ho ten, kdo má na starosti Finance.
          </p>
          <button type="button" className="ft-tl ft-tl-hlavni" style={tlacitko} onClick={akce.dalsiDoklad}>
            Vyfotit další doklad
          </button>
        </div>
      </main>
    )
  }

  const zbyva = stav.fotky.filter((f) => !f.odeslana).length
  return (
    <main style={obal}>
      <div style={karta}>
        <p style={popisek}>
          {stav.pobocka} · {stav.zarizeni}
        </p>
        <h1 style={nadpis}>Vyfotit účet</h1>
        <p style={popis}>Vyfoťte celý účet nebo sjetinu, klidně na víc fotek. Doklad odejde do Jiných plateb téhle pobočky.</p>

        <div style={{ display: 'grid', gap: '10px' }}>
          <label className="ft-tl ft-tl-hlavni" style={{ ...tlacitko, marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            Vyfotit
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={skryte}
              disabled={stav.odesilam}
              onChange={(e) => {
                akce.pridatFotky(e.currentTarget.files)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <label className="ft-tl ft-tl-vedlejsi" style={{ ...tlacitko, marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            Vybrat z galerie
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              style={skryte}
              disabled={stav.odesilam}
              onChange={(e) => {
                akce.pridatFotky(e.currentTarget.files)
                e.currentTarget.value = ''
              }}
            />
          </label>
        </div>

        {stav.fotky.length > 0 ? (
          <ul style={seznam} aria-label="Fotky dokladu">
            {stav.fotky.map((f, i) => (
              <li key={f.id} style={polozka}>
                {f.nahled && !f.pdf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.nahled} alt={`Fotka ${i + 1}`} style={nahled} />
                ) : (
                  <span style={{ ...nahled, display: 'grid', placeItems: 'center', fontSize: '12px', color: 'var(--muted)' }}>PDF</span>
                )}
                <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '14px', overflowWrap: 'anywhere' }}>
                  {/* Název z fotoaparátu (IMG_2026…) je dlouhý a nic neříká — stačí pořadí. */}
                  {f.pdf ? 'PDF' : 'Fotka'} {i + 1}
                  {f.odeslana ? <span style={{ display: 'block', fontSize: '12px', color: 'var(--dobre)' }}>odesláno</span> : null}
                </span>
                {!f.odeslana ? (
                  <button type="button" className="ft-tl ft-tl-vedlejsi ft-tl-male" style={{ minHeight: '44px' }} disabled={stav.odesilam} onClick={() => akce.odebratFotku(f.id)}>
                    Odebrat
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <label style={{ ...popisek, display: 'block', marginTop: '16px' }} htmlFor="oznaceni">
          Označení účtu nebo poznámka (nepovinné)
        </label>
        <textarea
          id="oznaceni"
          value={stav.oznaceni}
          maxLength={MAX_ZNAKU_OZNACENI}
          rows={2}
          placeholder="třeba stůl 4, firma Novák"
          disabled={stav.odesilam}
          onChange={(e) => akce.zmenitOznaceni(e.currentTarget.value)}
          style={poznamka}
        />

        {stav.chyba ? (
          <p style={chybaStyl} role="alert">
            {stav.chyba}
          </p>
        ) : null}
        {stav.odesilam && stav.postup ? (
          <p style={popis} role="status">
            {stav.postup}
          </p>
        ) : null}

        <button type="button" className="ft-tl ft-tl-hlavni" style={tlacitko} disabled={stav.odesilam || zbyva === 0} onClick={akce.odeslat}>
          {stav.odesilam ? 'Odesílám…' : zbyva > 0 ? `Odeslat doklad (${zbyva} ${zbyva === 1 ? 'fotka' : zbyva < 5 ? 'fotky' : 'fotek'})` : 'Odeslat doklad'}
        </button>
        <p style={{ ...popis, margin: '12px 0 0' }}>Po odeslání tu nic dalšího vidět není — doklad zkontrolují ve Financích.</p>
      </div>
    </main>
  )
}

const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'start center',
  padding: 'max(16px, var(--vlozka-nahore)) max(16px, var(--vlozka-vpravo)) max(16px, var(--vlozka-dole)) max(16px, var(--vlozka-vlevo))',
  background: 'var(--paper)',
} as const

const karta = {
  width: '100%',
  maxWidth: '520px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '18px',
  boxShadow: 'var(--shadow)',
  padding: '20px',
  minWidth: 0,
} as const

const nadpis = { margin: '0 0 8px', fontSize: '24px', color: 'var(--ink)' } as const
const popis = { margin: '8px 0 16px', fontSize: '14px', color: 'var(--muted)', maxWidth: '52ch' } as const
const popisek = { margin: '0 0 6px', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em' } as const
const pole = {
  width: '100%',
  padding: '14px',
  fontSize: '22px',
  textAlign: 'center' as const,
  borderRadius: '12px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  boxSizing: 'border-box' as const,
} as const
const poznamka = {
  width: '100%',
  padding: '12px',
  fontSize: '16px',
  borderRadius: '12px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  boxSizing: 'border-box' as const,
  resize: 'vertical' as const,
} as const
const tlacitko = { width: '100%', minHeight: '56px', fontSize: '17px', marginTop: '14px' } as const
const chybaStyl = { margin: '12px 0 0', fontSize: '14px', color: 'var(--bad)' } as const
const upozorneni = {
  margin: '8px 0 12px',
  padding: '10px 12px',
  fontSize: '14px',
  borderRadius: '12px',
  border: '1px solid var(--mosaz)',
  background: 'var(--paper)',
  color: 'var(--ink)',
} as const
const skryte = { position: 'absolute' as const, width: '1px', height: '1px', opacity: 0, overflow: 'hidden' as const, pointerEvents: 'none' as const } as const
const seznam = { listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: '8px' } as const
const polozka = { display: 'flex', gap: '10px', alignItems: 'center', padding: '8px', border: '1px solid var(--line)', borderRadius: '12px', minWidth: 0 } as const
const nahled = { width: '56px', height: '56px', objectFit: 'cover' as const, borderRadius: '8px', border: '1px solid var(--line)', flex: '0 0 auto', background: 'var(--sunken)' } as const
