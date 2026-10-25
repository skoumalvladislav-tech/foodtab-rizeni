import Badge from '@/components/ui/Badge'
import { datumACasSRokemVPasmu } from '@/lib/cas'
import { KLIC_CHOICE } from '@/lib/rezervace-choice'
import { popisStavuPripojeni } from '@/lib/rezervace-poskytovatele'

import { PanelHlava } from '../../dnes/prvky'
import TlacitkoOdeslat from '../../vzkazy/tlacitko-odeslat'
import { nacistChoiceTed, odpojitNapojeni, overitChoice, pripojitChoice } from '../akce'
import type { PobockaRezervaci } from '../pristup'
import type { Napojeni } from './obsah'

const TONY = { dobre: 'success', info: 'accent', pozor: 'warning', bad: 'danger', neutral: 'neutral' } as const

/** Stav u Choice: „připojuje se“ = majitel je na stránce Choice, nebo se nevrátil. */
function stavChoice(stav: string): { text: string; ton: keyof typeof TONY } {
  if (stav === 'nepripojeno') return { text: 'Čeká na ověření', ton: 'info' }
  if (stav === 'pripojuje_se') return { text: 'Čeká na povolení v Choice', ton: 'info' }
  return popisStavuPripojeni(stav)
}

/**
 * Karta Choice na obrazovce Napojení a import — ČISTĚ KRESLICÍ. Co je
 * nastavené, kdo smí co a připojení z databáze dodala stránka.
 *
 * Bez CHOICE_CLIENT_ID a CHOICE_CLIENT_SECRET na serveru karta řekne
 * „čeká na nastavení“ a připojit nenabízí. Nic se nepředstírá:
 * „Připojeno“ ukáže jen připojení, které prošlo živým testem.
 */
export function ChoiceKarta({
  rozsah,
  pobocky,
  napojeni,
  nastaveno,
  spravaPobocek,
}: {
  rozsah: string
  pobocky: PobockaRezervaci[]
  /** Připojení Choice v rozsahu (poskytovatel `choice`). */
  napojeni: Napojeni[]
  /** CHOICE_CLIENT_ID, CHOICE_CLIENT_SECRET a šifrovací klíč jsou na serveru. */
  nastaveno: boolean
  /** Pobočky, kde člověk spravuje napojení (`integrace.manage`). */
  spravaPobocek: string[]
}) {
  const choice = napojeni.filter((n) => n.poskytovatel === KLIC_CHOICE)
  const nazevPobocky = new Map(pobocky.map((p) => [p.id, p.nazev]))
  const zona = pobocky[0].zona
  const kPripojeni = pobocky.filter((p) => spravaPobocek.includes(p.id) && !choice.some((n) => n.branch_id === p.id && n.stav === 'pripojeno'))

  return (
    <section className="ds-plocha">
      <PanelHlava ikona="kalendar" nadpis="Choice — rezervace načítané přímo" />
      <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--muted)', lineHeight: 1.5 }}>
        Foodtab se Choice ptá na rezervace sám, každých 15 minut (Choice je neumí poslat). Do Choice nic nezapisuje. Čas,
        počet osob, stav, jméno a kontakt patří Choice; poznámky, dokumenty, záloha od hosta a stůl zůstávají ve Foodtabu.
      </p>

      {!nastaveno ? (
        <div className="ds-rez-priloha" style={{ flexWrap: 'wrap', marginBottom: '12px' }}>
          <Badge tone="warning">Čeká na nastavení</Badge>
          <span style={{ fontSize: '13.5px' }}>
            Na serveru zatím chybí klíče aplikace Foodtab z Choice (CHOICE_CLIENT_ID a CHOICE_CLIENT_SECRET). Doplní je správce
            ve Vercelu — postup je v dokumentu docs/rezervace-choice.md.
          </span>
        </div>
      ) : null}

      {choice.length === 0 ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px' }}>Zatím žádná pobočka nemá Choice připojený.</p>
      ) : (
        <ul className="ds-rez-prilohy" style={{ marginBottom: '14px' }}>
          {choice.map((n) => {
            const popis = stavChoice(n.stav)
            const spravuje = spravaPobocek.includes(n.branch_id)
            const nacist = n.stav === 'pripojeno' && (spravuje || pobocky.some((p) => p.id === n.branch_id && p.zapis))
            return (
              <li key={n.id} style={{ display: 'grid', gap: '6px' }}>
                <div className="ds-rez-priloha" style={{ flexWrap: 'wrap' }}>
                  <strong>{nazevPobocky.get(n.branch_id)}</strong>
                  <span style={{ color: 'var(--muted)' }}>{n.nazev}</span>
                  <Badge tone={TONY[popis.ton]}>{popis.text}</Badge>
                  {n.posledni_sync_kdy ? (
                    <small>
                      naposledy načteno {datumACasSRokemVPasmu(n.posledni_sync_kdy, zona)}
                      {n.posledni_sync_pocet_radku !== null ? ` · ${n.posledni_sync_pocet_radku} rezervací` : ''}
                    </small>
                  ) : n.posledni_test_kdy ? (
                    <small>ověřeno {datumACasSRokemVPasmu(n.posledni_test_kdy, zona)}</small>
                  ) : null}
                </div>
                {n.posledni_chyba ? (
                  <p className="hlaska-chyba" style={{ margin: 0 }}>
                    {n.posledni_chyba}
                  </p>
                ) : null}
                {nacist || spravuje ? (
                  <div className="ds-rez-tlacitka">
                    {nacist ? (
                      <form action={nacistChoiceTed}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={n.id} />
                        <TlacitkoOdeslat className="ft-tl ft-tl-vedlejsi ft-tl-male" pracuje="Načítám z Choice…">
                          Načíst teď
                        </TlacitkoOdeslat>
                      </form>
                    ) : null}
                    {spravuje && n.stav !== 'pripojuje_se' ? (
                      <form action={overitChoice}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={n.id} />
                        <TlacitkoOdeslat className="ft-tl ft-tl-vedlejsi ft-tl-male" pracuje="Ověřuji…">
                          Ověřit znovu
                        </TlacitkoOdeslat>
                      </form>
                    ) : null}
                    {spravuje ? (
                      <form action={odpojitNapojeni}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={n.id} />
                        <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                          Odpojit
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {nastaveno && kPripojeni.length > 0 ? (
        <form action={pripojitChoice} className="ds-rez-formular" style={{ marginTop: '4px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />
          <div className="ds-rez-mrizka">
            {kPripojeni.length > 1 ? (
              <label className="ds-field">
                <span className="ds-field-label">Pobočka</span>
                <select className="ds-input" name="pobocka" defaultValue={kPripojeni[0].id}>
                  {kPripojeni.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nazev}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="pobocka" value={kPripojeni[0].id} />
            )}
            <label className="ds-field">
              <span className="ds-field-label">Adresa podniku v Choice</span>
              <input className="ds-input" name="podnik" required maxLength={2000} placeholder="mojerestaurace.choiceqr.com" autoComplete="off" />
            </label>
          </div>
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.5 }}>
            Stačí adresa podniku. Můžete vložit i celý odkaz na připojení, který vygeneruje Choice u aplikace Foodtab. Choice se
            pak zeptá na ChoiceQR token — ten posílá api@choiceqr.com. Odkaz platí 10 minut.
          </p>
          <div className="ds-rez-tlacitka">
            <button type="submit" className="ft-tl ft-tl-hlavni">
              Připojit podnik v Choice
            </button>
          </div>
        </form>
      ) : nastaveno && spravaPobocek.length === 0 ? (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
          Choice připojuje ten, kdo má právo „Správa napojení na externí systémy“.
        </p>
      ) : null}
    </section>
  )
}
