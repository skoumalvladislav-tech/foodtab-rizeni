import { formatHaleru, haleruNaText, mnozstviNaText } from '@/lib/jine-platby-castky'
import type { PodkladyFaktury } from '@/lib/jine-platby-faktura'
import { popisStavuFaktury, popisStavuUhrady, type AkceJinePlatby } from '@/lib/jine-platby-stav'
import type { ZaznamJinePlatby } from '@/lib/jine-platby-typy'

import { PanelHlava } from '../../../../dnes/prvky'
import { evidovatUhradu, faktura } from '../akce'
import ZnackaStavu from '../znacka-stavu'
import FormularAkce from './formular-akce'
import { datumCesky, HLASKA_BEZ_FINANCI_FIRMY } from './logika'
import { MRIZKA_POLI, Oddil, PoleDuvodu, Udaj, Udaje, VSTUP, Vysvetleni } from './prvky'

type Zakl = { zaznam: string; verze: number; rozsah: string }

/**
 * Sekce (d) Faktura. Appka vydané faktury NEVYSTAVUJE (rozhodnutí čeká,
 * otázka 51) — připraví podklady a propojí fakturu vystavenou jinde.
 * Do databáze Faktur nic nezapisuje. Faktura není tržba ani úhrada.
 */
export function SekceFaktura({
  zakl,
  z,
  akce,
  podklady,
  kontakty,
}: {
  zakl: Zakl
  z: ZaznamJinePlatby
  akce: ReadonlySet<AkceJinePlatby>
  podklady: { podklady: PodkladyFaktury; chybi: string[] }
  /** Odběratelé firmy (RLS finance.read); `null` = člověk je nevidí → jen ruční číslo faktury. */
  kontakty: { id: string; nazev: string; ico: string | null }[] | null
}) {
  const p = podklady.podklady
  const castka = (h: number | null) => (h === null ? '—' : formatHaleru(h, p.mena ?? z.mena))
  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="faktura" nadpis="Faktura" />
      <div>
        <ZnackaStavu popis={popisStavuFaktury(z.stavFaktury)} />
      </div>
      <Vysvetleni dulezite>
        Appka zatím vydané faktury nevystavuje (blokováno — čeká na rozhodnutí, otázka 51 v docs/hlaseni/otazky.md). Fakturu vystavte v pokladně
        nebo v účetním programu a sem ji propojte. Faktura není tržba ani úhrada.
      </Vysvetleni>

      {z.stavFaktury === 'propojena' ? (
        <Udaje>
          <Udaj nazev="Číslo faktury">{z.fakturaCislo}</Udaj>
          <Udaj nazev="Vystavena">{z.fakturaZdroj === 'pos' ? 'v pokladně' : z.fakturaZdroj === 'externi' ? 'v jiném systému' : '—'}</Udaj>
          <Udaj nazev="Částka faktury">{castka(z.fakturaCastkaHaleru)}</Udaj>
        </Udaje>
      ) : null}

      <Oddil nadpis="Podklady pro fakturu">
        <Udaje>
          <Udaj nazev="Odběratel">
            {p.odberatel ? `${p.odberatel.nazev}${p.odberatel.ico ? `, IČO ${p.odberatel.ico}` : ''}${p.odberatel.dic ? `, DIČ ${p.odberatel.dic}` : ''}` : '—'}
          </Udaj>
          <Udaj nazev="Datum plnění">{p.datumPlneni ? datumCesky(p.datumPlneni) : '—'}</Udaj>
          <Udaj nazev="Celkem">{castka(p.celkemHaleru)}</Udaj>
        </Udaje>
        {p.polozky.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '14px' }}>
            {p.polozky.map((r, i) => (
              <li key={i} style={{ overflowWrap: 'anywhere' }}>
                {r.nazev} · {r.mnozstvi ? `${mnozstviNaText(r.mnozstvi)} ${r.jednotka ?? ''}` : 'množství —'} · {castka(r.cenaCelkemHaleru)} · DPH{' '}
                {r.sazbaDph ? `${r.sazbaDph.replace('.', ',')} %` : '—'}
              </li>
            ))}
          </ul>
        ) : null}
        {podklady.chybi.length > 0 ? (
          <div style={{ fontSize: '13.5px' }}>
            <span>Chybí (nic se nedomýšlí):</span>
            <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
              {podklady.chybi.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : (
          <Vysvetleni>Podklady jsou úplné.</Vysvetleni>
        )}
        {akce.has('faktura') ? (
          <FormularAkce akce={faktura} {...zakl} skryte={{ akce: 'podklady' }} tlacitko="Uložit podklady">
            {kontakty !== null ? (
              <label className="ds-field">
                <span className="ds-field-label">Odběratel</span>
                <select className="ds-input" style={VSTUP} name="kontakt" defaultValue={z.kontaktId ?? ''}>
                  <option value="">— ponechat —</option>
                  {kontakty.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.nazev}
                      {k.ico ? ` (IČO ${k.ico})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Vysvetleni>{HLASKA_BEZ_FINANCI_FIRMY}</Vysvetleni>
            )}
          </FormularAkce>
        ) : null}
      </Oddil>

      {akce.has('faktura') && z.stavFaktury !== 'propojena' ? (
        <Oddil nadpis="Propojit vystavenou fakturu">
          <FormularAkce akce={faktura} {...zakl} skryte={{ akce: 'propojit' }} tlacitko="Propojit fakturu" vycistit>
            {z.stavTrzby === 'zapsano' ? (
              <Vysvetleni>
                Tržba je zapsaná v Ostatních tržbách. Fakturu vystavenou v pokladně k ní propojit nejde — pokladna má tržbu z faktury sama a byla by
                dvakrát. Nejdřív Ostatní tržbu stornujte, nebo propojte fakturu z jiného systému.
              </Vysvetleni>
            ) : null}
            <div style={MRIZKA_POLI}>
              <label className="ds-field">
                <span className="ds-field-label">Číslo faktury</span>
                <input className="ds-input" style={VSTUP} name="cislo" required maxLength={100} />
              </label>
              <label className="ds-field">
                <span className="ds-field-label">Kde byla vystavena</span>
                <select className="ds-input" style={VSTUP} name="zdroj" required defaultValue="">
                  <option value="" disabled>
                    — vyberte —
                  </option>
                  <option value="pos">V pokladně</option>
                  <option value="externi">V jiném systému (účetní program)</option>
                </select>
              </label>
              <label className="ds-field">
                <span className="ds-field-label">Částka faktury (nepovinné)</span>
                <input className="ds-input" style={VSTUP} name="castka" inputMode="decimal" />
              </label>
            </div>
          </FormularAkce>
        </Oddil>
      ) : null}

      {akce.has('faktura') && z.stavFaktury === 'propojena' ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '14px', minHeight: '44px', display: 'flex', alignItems: 'center' }}>Odpojit fakturu</summary>
          <div style={{ marginTop: '8px' }}>
            <FormularAkce akce={faktura} {...zakl} skryte={{ akce: 'odpojit' }} tlacitko="Odpojit fakturu" vycistit>
              <PoleDuvodu />
            </FormularAkce>
          </div>
        </details>
      ) : null}
    </section>
  )
}

export type PlatbaBanky = { id: string; datum: string; castkaHaleru: number; mena: string; protistrana: string; vs: string }

/**
 * Sekce (e) Úhrada. „Úhrada neověřena“, dokud k záznamu není napárovaná
 * příchozí bankovní platba (appka tím do cashflow nic nepřidá). Bankovní
 * platby pustí RLS jen s finančním přehledem.
 */
export function SekceUhrada({
  zakl,
  z,
  akce,
  platby,
  naparovana,
}: {
  zakl: Zakl
  z: ZaznamJinePlatby
  akce: ReadonlySet<AkceJinePlatby>
  /** Příchozí platby téže měny za 60 dní; `null` = člověk bankovní data nevidí. */
  platby: PlatbaBanky[] | null
  naparovana: PlatbaBanky | null
}) {
  const popisPlatby = (t: PlatbaBanky) =>
    `${datumCesky(t.datum)} · ${formatHaleru(t.castkaHaleru, t.mena)}${t.protistrana ? ` · ${t.protistrana}` : ''}${t.vs ? ` · VS ${t.vs}` : ''}`
  return (
    <section className="ds-plocha" style={{ display: 'grid', gap: '14px', minWidth: 0 }}>
      <PanelHlava ikona="fajfkaCtverec" nadpis="Úhrada" />
      <div>
        <ZnackaStavu popis={popisStavuUhrady(z.stavUhrady)} />
      </div>
      <Vysvetleni dulezite>
        Vystavení faktury ani výdej skladu neznamenají zaplacení. Úhradu ověří jen napárovaná příchozí bankovní platba.
      </Vysvetleni>

      {z.stavUhrady !== 'neovereno' ? (
        <Udaje>
          <Udaj nazev="Bankovní platba">{naparovana ? popisPlatby(naparovana) : 'napárovaná (detail vidí jen finanční přehled)'}</Udaj>
          <Udaj nazev="Část k tomuto záznamu">{z.uhradaCastkaHaleru !== null ? formatHaleru(z.uhradaCastkaHaleru, z.mena) : '—'}</Udaj>
        </Udaje>
      ) : null}

      {akce.has('uhrada') ? (
        platby === null ? (
          <Vysvetleni>{HLASKA_BEZ_FINANCI_FIRMY}</Vysvetleni>
        ) : z.mena === null ? (
          <Vysvetleni>Doplňte nejdřív měnu záznamu — platbu jde napárovat jen ve stejné měně.</Vysvetleni>
        ) : (
          <Oddil nadpis="Napárovat bankovní platbu">
            {platby.length === 0 ? (
              <Vysvetleni>Za posledních 60 dní není žádná příchozí platba v {z.mena}.</Vysvetleni>
            ) : (
              <FormularAkce akce={evidovatUhradu} {...zakl} tlacitko="Napárovat platbu">
                <div style={MRIZKA_POLI}>
                  <label className="ds-field">
                    <span className="ds-field-label">Příchozí platba (posledních 60 dní)</span>
                    <select className="ds-input" style={VSTUP} name="transakce" required defaultValue="">
                      <option value="" disabled>
                        — vyberte —
                      </option>
                      {platby.map((t) => (
                        <option key={t.id} value={t.id}>
                          {popisPlatby(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ds-field">
                    <span className="ds-field-label">Kolik z platby patří k tomuto záznamu</span>
                    <input className="ds-input" style={VSTUP} name="castka" inputMode="decimal" required defaultValue={haleruNaText(z.castkaHaleru)} />
                  </label>
                </div>
              </FormularAkce>
            )}
          </Oddil>
        )
      ) : null}

      {akce.has('uhrada') && z.stavUhrady !== 'neovereno' ? (
        <FormularAkce
          akce={evidovatUhradu}
          {...zakl}
          skryte={{ transakce: '' }}
          tlacitko="Odpojit úhradu"
          potvrzeni={{ text: 'Úhrada se odpojí a stav bude „Úhrada neověřena“. Bankovní platba zůstane, jak je. Pokračovat?', ano: 'Ano, odpojit' }}
        />
      ) : null}
    </section>
  )
}
