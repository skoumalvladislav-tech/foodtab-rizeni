import Badge from '@/components/ui/Badge'
import { datumACasSRokemVPasmu } from '@/lib/cas'
import { POSKYTOVATEL_PRIJMU } from '@/lib/rezervace-prijem-api'
import { SYSTEMY, najitSystem, popisStavuPripojeni, type PristupKApi } from '@/lib/rezervace-poskytovatele'

import { PanelHlava } from '../../dnes/prvky'
import Nadpis from '../../nadpis'
import { odpojitNapojeni, pripravitNapojeni } from '../akce'
import type { PobockaRezervaci } from '../pristup'
import { HlaskaAkce, ZalozkyRezervaci } from '../prvky'
import ImportFormular from './import-formular'
import KlicPrijmuRezervaci from './klic-prijmu'

const TONY = { dobre: 'success', info: 'accent', pozor: 'warning', bad: 'danger', neutral: 'neutral' } as const

const STITEK_API: Record<PristupKApi, { text: string; ton: 'success' | 'warning' | 'neutral' }> = {
  verejne: { text: 'veřejné API', ton: 'success' },
  partnerske: { text: 'API jen pro partnery', ton: 'warning' },
  neovereno: { text: 'API neověřené', ton: 'neutral' },
  zadne: { text: 'bez API', ton: 'neutral' },
}

export type Napojeni = {
  id: string
  branch_id: string
  poskytovatel: string
  stav: string
  nazev: string
  posledni_test_kdy: string | null
  posledni_sync_kdy: string | null
  posledni_sync_pocet_radku: number | null
  /** Jen pro správce napojení (`integrace.manage`), ostatním null. */
  posledni_chyba: string | null
}

/** Stav připojení příjmového API: dokud nepřišla první dávka, čeká na data — ne „na připojení“. */
function stavPrijmu(stav: string): { text: string; ton: keyof typeof TONY } {
  if (stav === 'pripojeno') return { text: 'Přijímá data', ton: 'dobre' }
  if (stav === 'nepripojeno') return { text: 'Čeká na první data', ton: 'info' }
  return popisStavuPripojeni(stav)
}

/**
 * Obsah obrazovky Napojení a import — ČISTĚ KRESLICÍ. Přístup, napojení
 * z databáze, právo `integrace.manage` a adresu příjmového API dodala
 * stránka (page.tsx).
 */
export function NapojeniObsah({
  rozsah,
  pobocky,
  napojeni,
  smiSpravovat,
  adresaPrijmu,
  stav,
  chyba,
}: {
  rozsah: string
  pobocky: PobockaRezervaci[]
  napojeni: Napojeni[]
  smiSpravovat: boolean
  /** `https://…/api/rezervace/prijem` */
  adresaPrijmu: string
  stav?: string
  chyba?: string
}) {
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.nazev]))
  const zona = pobocky[0].zona
  const kImportu = pobocky.filter((p) => p.zapis)
  const prijmy = napojeni.filter((n) => n.poskytovatel === POSKYTOVATEL_PRIJMU)
  const adaptery = napojeni.filter((n) => n.poskytovatel !== POSKYTOVATEL_PRIJMU)
  const bezKlice = pobocky.filter((p) => !prijmy.some((n) => n.branch_id === p.id))
  const sAdapterem = SYSTEMY.filter((s) => s.api === 'verejne' || s.api === 'partnerske')

  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis="Propojení s rezervačním systémem a načtení rezervací ze souboru.">
        Napojení a import
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="napojeni" />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <section className="ds-plocha">
          <PanelHlava ikona="schranka" nadpis="Univerzální příjmové API" />
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Napojení pro jakýkoli rezervační systém — i Choice. Systém sám (webhookem), nebo prostředník n8n, Make či Zapier
            posílá rezervace na adresu Foodtabu s klíčem. Klíč patří jedné pobočce. Čas, počet osob, stav a kontakt pak
            patří rezervačnímu systému; poznámky, dokumenty, prostor, menu a záloha zůstávají ve Foodtabu.
          </p>
          {prijmy.length === 0 ? (
            <p style={{ margin: '0 0 12px', fontSize: '14px' }}>Zatím žádná pobočka klíč nemá.</p>
          ) : (
            <ul className="ds-rez-prilohy" style={{ marginBottom: '14px' }}>
              {prijmy.map((n) => {
                const popis = stavPrijmu(n.stav)
                return (
                  <li key={n.id} style={{ display: 'grid', gap: '6px' }}>
                    <div className="ds-rez-priloha" style={{ flexWrap: 'wrap' }}>
                      <strong>{nazevPobocky.get(n.branch_id)}</strong>
                      <Badge tone={TONY[popis.ton]}>{popis.text}</Badge>
                      {n.posledni_sync_kdy ? (
                        <small>
                          naposledy {datumACasSRokemVPasmu(n.posledni_sync_kdy, zona)}
                          {n.posledni_sync_pocet_radku !== null ? ` · ${n.posledni_sync_pocet_radku} rezervací` : ''}
                        </small>
                      ) : null}
                      {smiSpravovat ? (
                        <form action={odpojitNapojeni}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="id" value={n.id} />
                          <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                            Odpojit
                          </button>
                        </form>
                      ) : null}
                    </div>
                    {n.posledni_chyba ? (
                      <p className="hlaska-chyba" style={{ margin: 0 }}>
                        {n.posledni_chyba}
                      </p>
                    ) : null}
                    {smiSpravovat ? <KlicPrijmuRezervaci rozsah={rozsah} id={n.id} /> : null}
                  </li>
                )
              })}
            </ul>
          )}

          {smiSpravovat && bezKlice.length > 0 ? (
            <KlicPrijmuRezervaci rozsah={rozsah} pobocky={bezKlice.map((p) => ({ id: p.id, nazev: p.nazev }))} />
          ) : !smiSpravovat ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              Klíč vydává ten, kdo má právo „Správa napojení na externí systémy“.
            </p>
          ) : null}

          <details style={{ marginTop: '14px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '13.5px', fontWeight: 600 }}>Jak vypadá zpráva (pro toho, kdo napojení nastavuje)</summary>
            <div className="ds-rez-formular" style={{ marginTop: '10px' }}>
              <pre className="ds-rez-kod">{`POST ${adresaPrijmu}
Authorization: Bearer ftrez_…
Content-Type: application/json

{
  "system": "choice",
  "rezervace": [
    {
      "id": "R-1042",
      "zacatek": "2026-11-20T19:00:00+01:00",
      "konec": "2026-11-20T21:30:00+01:00",
      "osob": 4,
      "stav": "confirmed",
      "jmeno": "Jan Novák",
      "telefon": "+420 777 111 222",
      "email": "jan@example.cz",
      "poznamka": "u okna, dort ve 20:00",
      "stul": "12",
      "zmeneno": "2026-11-01T10:00:00Z"
    }
  ]
}`}</pre>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                Povinné je jen <code>id</code> (číslo rezervace ve vašem systému) a čas: buď <code>zacatek</code> s časovým
                pásmem, nebo <code>datum</code> (RRRR-MM-DD) a <code>od</code> (HH:MM) jako čas na pobočce. Stejné{' '}
                <code>id</code> poslané znovu rezervaci upraví, nezdvojí. Zrušení = <code>&quot;stav&quot;: &quot;zrusena&quot;</code>.
                Úplný popis je v dokumentu <code>docs/rezervace-api.md</code>.
              </p>
            </div>
          </details>
        </section>

        <section className="ds-plocha">
          <PanelHlava ikona="kolo" nadpis="Přímé napojení na rezervační systém" />
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Systémy s vlastním API, u kterých se Foodtab jednou bude ptát sám. Dokud pro systém není hotové ověření, je
            napojení „čeká na připojení“ — pro Choice a ostatní použijte příjmové API výš nebo soubor.
          </p>
          {adaptery.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px' }}>Zatím žádné napojení.</p>
          ) : (
            <ul className="ds-rez-prilohy">
              {adaptery.map((n) => {
                const popis = popisStavuPripojeni(n.stav)
                return (
                  <li key={n.id} className="ds-rez-priloha" style={{ flexWrap: 'wrap' }}>
                    <strong>{najitSystem(n.poskytovatel)?.nazev ?? n.poskytovatel}</strong>
                    <span style={{ color: 'var(--muted)' }}>{nazevPobocky.get(n.branch_id)}</span>
                    <Badge tone={TONY[popis.ton]}>{popis.text}</Badge>
                    {n.posledni_test_kdy ? <small>ověřeno {datumACasSRokemVPasmu(n.posledni_test_kdy, zona)}</small> : null}
                    {smiSpravovat ? (
                      <form action={odpojitNapojeni}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={n.id} />
                        <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                          Odpojit
                        </button>
                      </form>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {smiSpravovat ? (
            <form action={pripravitNapojeni} className="ds-rez-formular" style={{ marginTop: '16px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <div className="ds-rez-mrizka">
                <label className="ds-field">
                  <span className="ds-field-label">Pobočka</span>
                  <select className="ds-input" name="pobocka" defaultValue={pobocky[0].id}>
                    {pobocky.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nazev}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ds-field">
                  <span className="ds-field-label">Rezervační systém</span>
                  <select className="ds-input" name="system" defaultValue={sAdapterem[0].klic}>
                    {sAdapterem.map((s) => (
                      <option key={s.klic} value={s.klic}>
                        {s.nazev}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="ds-rez-tlacitka">
                <button type="submit" className="ft-tl ft-tl-vedlejsi">
                  Připravit napojení
                </button>
              </div>
            </form>
          ) : null}
        </section>

        {kImportu.length > 0 ? (
          <section className="ds-plocha">
            <PanelHlava ikona="faktura" nadpis="Načíst rezervace ze souboru" />
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
              Export z rezervačního systému ve formátu CSV. Appka pozná sloupce Datum, Čas (Od, Do), Jméno, Počet osob,
              Telefon, E-mail, Poznámka, Stav, Stůl a Číslo rezervace (česky i anglicky). Opakované načtení stejného souboru
              nic nezdvojí; poznámky a dokumenty, které jste k rezervacím přidali ve Foodtabu, zůstanou.
            </p>
            <ImportFormular rozsah={rozsah} pobocky={kImportu.map((p) => ({ id: p.id, nazev: p.nazev }))} systemy={SYSTEMY} />
          </section>
        ) : null}

        <section className="ds-plocha">
          <PanelHlava ikona="lupa" nadpis="Které systémy jde napojit" />
          <div className="ds-rez-systemy">
            {SYSTEMY.map((s) => (
              <article key={s.klic} className="ds-rez-system">
                <h3>{s.nazev}</h3>
                <div className="ds-rez-system-stitky">
                  <Badge tone={STITEK_API[s.api].ton}>{STITEK_API[s.api].text}</Badge>
                  {s.webhooky ? <Badge tone="accent">hlásí změny</Badge> : null}
                  {s.exportSouboru ? <Badge>export do souboru</Badge> : null}
                </div>
                <p>{s.popis}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
