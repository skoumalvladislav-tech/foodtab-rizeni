import Ikona from '../ikona'
import { zalozitVzkazVedeni } from './akce'
import TlacitkoOdeslat from './tlacitko-odeslat'

/**
 * „Napsat vedení“ — formulář vzkazu vedení na seznamu rozhovorů.
 *
 * Vytažený ze stránky 27. 9., ať se dá vykreslit i v dočasném náhledu
 * (data přes props, žádné dotazy).
 *
 * VZKAZ VEDENÍ. Odesílatel vybírá adresáta a — když dosáhne na víc
 * poboček — i pobočku. Odvozovat ji z domovského záznamu nestačí: člověk,
 * co dělá na dvou provozovnách, si stěžuje na to, co zažil tam, kde zrovna
 * byl, a vzkaz by přistál u vedoucího té druhé. Rozhodnutí Šéfíka 6. 9. 2026.
 *
 * Kdo to uvidí, se vypisuje JMENOVITĚ a jména si stránka bere
 * z `kdo_uvidi_vzkaz` — z téže funkce, kterou se pak vybírají účastníci.
 * Kdyby si to obrazovka počítala po svém, slíbila by jeden okruh
 * a konverzace by vznikla s jiným.
 *
 * SBALENÉ POD TLAČÍTKEM (27. 9.): na telefonu stál celý formulář nad
 * seznamem rozhovorů a zabíral půl obrazovky. Rozbalený se ukáže jen po
 * chybě, ať je hláška vidět u formuláře, ke kterému patří.
 *
 * ZPRÁVA JE POVINNÁ (27. 9.). Dřív se zakládal jen název a text se psal
 * až v rozhovoru. Upozornění vedení ale vzniká až první zprávou — kdo po
 * založení odešel, vedení nic nedoručil (11 ze 14 vzkazů vedení v ostré
 * databázi bylo prázdných). Klientské id brání zdvojení zprávy.
 */
export default function FormularVedeni({
  rozsah,
  otevreno,
  chyba,
  vedouciJmena,
  majitelJmena,
  pobocky,
  vychoziPobocka,
  klientId,
}: {
  rozsah: string
  /** Rozbalený — po chybě z téhož formuláře (`?vedeni=1`). */
  otevreno: boolean
  chyba: string | null
  vedouciJmena: string[]
  majitelJmena: string[]
  /** Pobočky, na které člověk dosáhne. Výběr se ukáže jen u víc než jedné. */
  pobocky: { id: string; name: string }[]
  vychoziPobocka: string | null
  /** Klientské id první zprávy (vyrobí ho stránka při vykreslení). */
  klientId: string
}) {
  return (
    <details className="pc-vedeni" open={otevreno}>
      <summary className="ft-tl ft-tl-vedlejsi ft-tl-male">
        <Ikona klic="praporek" /> Napsat vedení
      </summary>

      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: '12px 0 0' }}>
          {chyba}
        </p>
      ) : null}

      <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--muted)' }}>
        Anonymní to není. Ve dvanáctičlenném provozu je anonymita
        stejně průhledná a zve to k útokům, na které se nedá
        odpovědět. Místo toho platí úzký okruh adresátů — a je
        vypsaný níž, ať víte, komu píšete, dřív než začnete.
      </p>

      <form action={zalozitVzkazVedeni} style={{ marginTop: '12px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />

        <fieldset style={poleSkupina}>
          <legend style={popisek}>Komu</legend>

          <label style={volba}>
            <input type="radio" name="adresat" value="vedouci" defaultChecked />
            vedoucí pobočky
          </label>
          {vedouciJmena.length > 0 ? (
            <p style={kdoUvidi}>Uvidí: {vedouciJmena.join(', ')}</p>
          ) : (
            <p style={kdoUvidi}>Na vybrané pobočce zatím nikdo s právem spravovat lidi není.</p>
          )}

          <label style={{ ...volba, marginTop: '10px' }}>
            <input type="radio" name="adresat" value="majitel" />
            majitel firmy
          </label>
          <p style={kdoUvidi}>
            Uvidí: {majitelJmena.length > 0 ? majitelJmena.join(', ') : '—'}.
            Vedoucí pobočky se k tomu nedostane, ani nikdo se správou
            lidí.
          </p>
        </fieldset>

        {/*
          Pobočku vybírá jen ten, kdo dosáhne na víc než jednu.
          Ostatním se otázka neklade — odvodí se.
        */}
        {pobocky.length > 1 ? (
          <fieldset style={poleSkupina}>
            <legend style={popisek}>Které pobočky se to týká</legend>
            <select name="pobocka" style={pole} defaultValue={vychoziPobocka ?? ''}>
              <option value="">— vyberte —</option>
              {pobocky.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p style={kdoUvidi}>Platí pro volbu „vedoucí pobočky“. U majitele na pobočce nezáleží.</p>
          </fieldset>
        ) : null}

        <fieldset style={poleSkupina}>
          <legend style={popisek}>Čeho se to týká</legend>
          <input type="text" name="nazev" required maxLength={120} placeholder="Krátce, o co jde" style={pole} />
        </fieldset>

        <fieldset style={poleSkupina}>
          <legend style={popisek}>Zpráva</legend>
          <textarea
            name="zprava"
            required
            rows={4}
            maxLength={4000}
            placeholder="Co chcete vedení vzkázat"
            aria-label="Zpráva pro vedení"
            style={{ ...pole, resize: 'vertical' }}
          />
          <input type="hidden" name="klient_id" value={klientId} />
        </fieldset>

        <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" pracuje="Odesílá se…">
          Odeslat vzkaz
        </TlacitkoOdeslat>
      </form>
    </details>
  )
}

const poleSkupina: React.CSSProperties = {
  border: 'none',
  padding: 0,
  margin: '14px 0 0',
}

const popisek: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--muted)',
  padding: 0,
  marginBottom: '6px',
}

const volba: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: 'var(--ink)',
}

/*
  Věta „kdo to uvidí“. Schválně blízko u té volby, ke které patří —
  odsazená, aby bylo vidět, že mluví o ní, a ne o té pod ní.
*/
const kdoUvidi: React.CSSProperties = {
  margin: '4px 0 0 26px',
  fontSize: '12px',
  color: 'var(--muted)',
  lineHeight: 1.45,
}

const pole: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  // 16 px schválně: iOS jinak při zaostření pole zoomuje celou stránku.
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
}
