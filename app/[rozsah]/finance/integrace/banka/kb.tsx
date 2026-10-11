import Link from 'next/link'

import type { ExterniUcetKb, ProstrediKb } from '@/lib/kb-adaa'
import { obnovitSouhlasKb, vybratUcetKb, zahajitPripojeniKb } from './akce'

/**
 * Komerční banka (ADAA) na stránce Banka — karta „Připojit" a detail
 * u připojení (účet v KB, platnost souhlasu, výběr účtu, obnova souhlasu).
 * Bez dotazů: data v props, ať jde vykreslit i v dočasném náhledu.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

export function KartaKb({
  rozsah,
  prostredi,
  smiPsat,
  volneUcty,
  dnesIso,
}: {
  rozsah: string
  /** `null` = napojení na KB není na serveru nastavené. */
  prostredi: ProstrediKb | null
  smiPsat: boolean
  volneUcty: { id: string; nazev: string }[]
  dnesIso: string
}) {
  return (
    <div style={{ ...karta, display: 'grid', gap: '10px' }}>
      <h2 style={{ margin: 0, fontSize: '15px' }}>Komerční banka — přímé napojení</h2>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
        Služba KB „Přímý přístup k účtu“ pro firemní účty. Přihlásíte se do Komerční banky KB Klíčem a vyberete účet,
        appka dostane přístup jen ke čtení na 12 měsíců. Pohyby i s variabilním symbolem a zůstatky stahuje sama,
        výchozí 1× denně (KB: 50 stažení měsíčně zdarma, častější stahování je u KB placené).
      </p>
      {prostredi ? (
        smiPsat ? (
          volneUcty.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Nejdřív založte platební účet (nebo uvolněte existující) na stránce{' '}
              <Link href={`/${rozsah}/finance/platby`} className="ft-tl">Platby</Link>.
            </p>
          ) : (
            <form action={zahajitPripojeniKb} style={{ display: 'grid', gap: '12px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <label>
                  <span style={popisek}>Platební účet *</span>
                  <select name="platebni_ucet_id" required style={pole}>
                    {volneUcty.map((u) => (
                      <option key={u.id} value={u.id}>{u.nazev}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span style={popisek}>Načíst pohyby od</span>
                  <input type="date" name="historie_od" defaultValue={`${dnesIso.slice(0, 4)}-01-01`} style={pole} />
                </label>
              </div>
              {prostredi === 'sandbox' ? (
                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--pozor)' }}>Server je nastavený na testovací prostředí KB — připojí se ukázkový účet, ne skutečný.</p>
              ) : null}
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Připojit Komerční banku</button>
              </div>
            </form>
          )
        ) : null
      ) : (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          Čeká na nastavení: registrace aplikace na portálu KB (developers.kb.cz), API klíče a „software statement“
          v proměnných <code>KB_ADAA_*</code> na serveru. Postup krok za krokem: <code>docs/kb-adaa-navod.md</code>.
        </p>
      )}
    </div>
  )
}

export function DetailKb({
  rozsah,
  pripojeni,
  nazevPlatebnihoUctu,
  smiPsat,
  prostrediServeru,
  dnesIso,
  zaMesicIso,
}: {
  rozsah: string
  pripojeni: { id: string; stav: string; platebni_ucet_id: string | null; externi_ucet: ExterniUcetKb | null }
  nazevPlatebnihoUctu: string
  smiPsat: boolean
  /** `null` = napojení na KB není na serveru nastavené. */
  prostrediServeru: ProstrediKb | null
  dnesIso: string
  zaMesicIso: string
}) {
  const ucet = pripojeni.externi_ucet ?? {}
  const souhlasDo = ucet.souhlas_do
  const brzy = Boolean(souhlasDo && souhlasDo <= zaMesicIso)
  const vyberUctu = !ucet.account_id && (ucet.ucty?.length ?? 0) > 1
  // Registrace v KB nedoběhla (člověk se nevrátil, nebo selhala) — bez
  // tohohle by zbylo jen „Odpojit“ a založit znovu.
  const nedokonceno = !ucet.client_id && (pripojeni.stav === 'pripojuje_se' || pripojeni.stav === 'chyba')
  // Připojení z jiného prostředí KB (sandbox × produkce) nejde obnovit ani dokončit — client_id platí jen tam, kde vzniklo.
  const jineProstredi = Boolean(prostrediServeru && ucet.prostredi && ucet.prostredi !== prostrediServeru)
  const lzeVKb = Boolean(prostrediServeru) && !jineProstredi

  return (
    <>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', display: 'grid', gap: '4px' }}>
        <span>
          {ucet.iban ? `Účet v KB: ${ucet.nazev_uctu ?? ''} ${ucet.iban}` : 'Účet v KB zatím nevybraný.'}
          {ucet.prostredi === 'sandbox' ? ' · testovací prostředí KB' : ''}
        </span>
        {jineProstredi ? (
          <span style={{ color: 'var(--pozor)' }}>
            Připojení vzniklo v {ucet.prostredi === 'sandbox' ? 'testovacím' : 'ostrém'} prostředí KB, server je teď nastavený jinak — odpojte ho a připojte znovu.
          </span>
        ) : null}
        {/* U jiného prostředí se souhlas obnovit nedá (viz výš) — „obnovte ho" by radilo něco, co nejde. */}
        {souhlasDo && !jineProstredi ? (
          <span style={{ color: brzy ? 'var(--pozor)' : undefined }}>
            {souhlasDo < dnesIso
              ? 'Souhlas v KB vypršel — obnovte ho.'
              : `Souhlas v KB platí do ${new Date(`${souhlasDo}T12:00:00Z`).toLocaleDateString('cs-CZ')}${brzy ? ' — brzy vyprší, obnovte ho.' : '.'}`}
          </span>
        ) : null}
      </div>
      {smiPsat && vyberUctu ? (
        <form action={vybratUcetKb} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="id" value={pripojeni.id} />
          <span style={{ fontSize: '12.5px' }}>V KB jste vybrali víc účtů — který patří k účtu „{nazevPlatebnihoUctu}“?</span>
          {/* Dlouhý IBAN v názvu volby nesmí roztáhnout stránku na mobilu. */}
          <select name="account_id" required style={{ ...pole, flex: '1 1 220px', width: '100%', minWidth: 0, minHeight: '36px' }}>
            {(ucet.ucty ?? []).map((u) => (
              <option key={u.account_id} value={u.account_id}>{u.nazev} {u.iban} ({u.mena})</option>
            ))}
          </select>
          <button type="submit" className="ft-tl ft-tl-hlavni">Vybrat účet</button>
        </form>
      ) : null}
      {smiPsat && nedokonceno && lzeVKb && pripojeni.platebni_ucet_id ? (
        <form action={zahajitPripojeniKb}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="platebni_ucet_id" value={pripojeni.platebni_ucet_id} />
          {ucet.historie_od ? <input type="hidden" name="historie_od" value={ucet.historie_od} /> : null}
          <button type="submit" className="ft-tl ft-tl-hlavni">Dokončit připojení v KB</button>
        </form>
      ) : null}
      {smiPsat && ucet.client_id && lzeVKb ? (
        <form action={obnovitSouhlasKb}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <input type="hidden" name="id" value={pripojeni.id} />
          <button type="submit" className={pripojeni.stav === 'vyzaduje_pozornost' || brzy ? 'ft-tl ft-tl-hlavni' : 'ft-tl'}>Obnovit souhlas v KB</button>
        </form>
      ) : null}
    </>
  )
}
