'use client'

import { useState } from 'react'

import { prideleniOpravneni } from './akce'

/**
 * Přidělení oprávnění a rozsahu jednomu člověku.
 *
 * Oprávnění nese od 9. 9. 2026 ZAŘAZENÍ u zaměstnance, rozsah zůstal
 * na členství. Obojí je pořád na jedné obrazovce, protože ani jedno
 * samo nic neotevře: zařazení bez rozsahu nedá právo nikde, rozsah
 * bez zařazení nedá právo žádné.
 * Viz docs/odpovedi-pozvanky-2026-09-01.md, oddíl 1.
 *
 * Rozdíl oproti starému stavu: zařazení jde nastavit i člověku BEZ
 * účtu. Uloží se a začne platit, jakmile se přihlásí — zadání
 * docs/zarazeni-misto-roli.md, oddíl 3. Za členstvím zůstává jen
 * rozsah.
 *
 * Klientské je to jen kvůli tomu, aby seznam poboček zmizel, když se
 * vybere celá firma. Zápis dělá serverová akce a rozhoduje databáze.
 */
export default function PanelOpravneni({
  rozsah,
  jmeno,
  zamestnanec,
  zarazeni,
  katalog,
  pravaZarazeni,
  vyjimky,
  smiMenitPrava,
  pobocky,
  smiFiremni,
  nynejsiZarazeni,
  nynejsiUroven,
  nynejsiPobocky,
  maUcet,
  maClenstvi,
  jaSam,
  posledniMajitel,
}: {
  rozsah: string
  jmeno: string
  zamestnanec: string
  /** Zařazení, která smí přihlášený přidělit — už prosejtá stropem. */
  zarazeni: { id: string; label: string }[]
  /** Pobočky, na které přihlášený sám vidí. */
  pobocky: { id: string; nazev: string }[]
  /** Firemní rozsah nabízí jen ten, kdo ho má sám. */
  smiFiremni: boolean
  nynejsiZarazeni: string | null
  nynejsiUroven: 'tenant' | 'branch'
  nynejsiPobocky: string[]
  /** Práva, která smí přihlášený vůbec nabídnout — už prosetá stropem. */
  katalog: { key: string; label: string }[]
  /** Co dává které zařazení. Podle toho se zaškrtávátka předvyplní. */
  pravaZarazeni: Record<string, string[]>
  /** Výjimky toho člověka. `false` je platná hodnota — právo odebrané. */
  vyjimky: Record<string, boolean>
  /** Měnit práva smí settings.manage; people.manage je jen vidí. */
  smiMenitPrava: boolean
  /** Bez účtu se oprávnění uloží, ale zatím nic neotevře. */
  maUcet: boolean
  /** Bez členství nejde nastavit rozsah — není u koho ho vést. */
  maClenstvi: boolean
  /** Vlastní členství nejde měnit — ani vlastníkem. */
  jaSam: boolean
  /** Jediný majitel firmy. Přeřadit ho nejde, jinak firma zůstane bez majitele. */
  posledniMajitel: boolean
}) {
  const [uroven, setUroven] = useState<'tenant' | 'branch'>(
    smiFiremni ? nynejsiUroven : 'branch',
  )

  /*
    ZAŠKRTÁVÁTKA SE PŘEDVYPLNÍ ZE ZAŘAZENÍ a co se od něj liší, je
    VÝJIMKA (zadání 6.2).

    Zařazení je proto řízené — po jeho přepnutí se předvyplnění
    přepočítá. Ručně přenastavená políčka se přitom NEZAHAZUJÍ: co
    člověk zaškrtl, zůstane zaškrtnuté, jen se u toho může změnit,
    jestli je to výjimka. Tiché smazání výjimky je horší než ta, která
    po přepnutí zbyde navíc — a je vidět.
  */
  const [vybraneZarazeni, setVybraneZarazeni] = useState(nynejsiZarazeni ?? '')
  const [prepsano, setPrepsano] = useState<Record<string, boolean>>({})

  const zeZarazeni = (klic: string) =>
    (pravaZarazeni[vybraneZarazeni] ?? []).includes(klic)

  // Výjimka u člověka rozhoduje, jinak zařazení — stejné pravidlo jako
  // v databázi (`app.ma_pravo_clovek`). Dvě různá by se rozešla.
  const zaskrtnuto = (klic: string) =>
    prepsano[klic] ?? vyjimky[klic] ?? zeZarazeni(klic)

  // Obojí zavírá formulář ze stejného důvodu: změna by neprošla.
  const zamceno = jaSam || posledniMajitel

  // Zařazení, které má člověk dnes, ale přihlášený ho přidělit nesmí.
  // Do nabídky patří, jinak by ho odeslání formuláře tiše sebralo.
  const chybejici =
    nynejsiZarazeni && !zarazeni.some((o) => o.id === nynejsiZarazeni)
      ? [{ id: nynejsiZarazeni, label: 'Nynější zařazení (přidělit ho neumíte)' }]
      : []

  return (
    <section style={karta}>
      <h2 style={nadpis}>Oprávnění pro {jmeno}</h2>

      {jaSam ? (
        <p style={ramecek}>
          <strong>Vlastní členství měnit nejde</strong>, ani vlastníkem.
          Povyšovat se nemá nikdo; kdo se potřebuje přeřadit, požádá
          někoho jiného.
        </p>
      ) : null}

      {/*
        Druhá obranná linie (docs/vlastniku-muze-byt-vic.md). Rozhodnutí
        padá ve spoušti v databázi — tohle jen říká proč dřív, než na to
        někdo klikne.
      */}
      {posledniMajitel ? (
        <p style={ramecek}>
          <strong>Tohle je jediný majitel firmy.</strong> Ve firmě musí
          zůstat aspoň jeden — nejdřív jmenujte dalšího, teprve pak jde
          tenhle přeřadit.
        </p>
      ) : null}

      {maUcet ? null : (
        <p style={ramecek}>
          <strong>{jmeno} zatím nemá účet.</strong> Zařazení se uloží
          a začne platit, jakmile se přihlásí. Rozsah se nastavuje až
          s členstvím — bez přihlášení není u koho ho vést.
        </p>
      )}

      {maUcet && !maClenstvi ? (
        <p style={ramecek}>
          <strong>{jmeno} má účet, ale ve firmě zatím žádné členství.</strong>{' '}
          Pozvánku nejspíš ještě nepřijal. Zařazení uložit jde, rozsah
          se doplní po přijetí.
        </p>
      ) : null}

      <p style={popis}>
        Zařazení říká <em>co</em> smí, rozsah <em>kde</em>. Jedno bez
        druhého neotevře nic — člověk se zařazením a bez pobočky se
        přihlásí a nic neuvidí.
      </p>

      <form action={prideleniOpravneni} style={{ display: 'grid', gap: '16px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="zamestnanec" value={zamestnanec} />

        <label style={poleLabel}>
          <span>Zařazení</span>
          <select
            name="zarazeni"
            value={vybraneZarazeni}
            onChange={(e) => setVybraneZarazeni(e.target.value)}
            disabled={zamceno}
            style={pole}
          >
            <option value="">Žádné — čeká na přidělení</option>
            {[...chybejici, ...zarazeni].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/*
          OPRÁVNĚNÍ. Předvyplněná ze zařazení; co se od něj liší, je
          označené jako výjimka a jde vrátit zpátky.

          Měnit je smí jen `settings.manage` — zpřísnění z migrace
          20260901090000 („kdo zakládá lidi, nesmí rozhodovat, kdo vidí
          mzdy"). Vedoucí s `people.manage` je vidí, ale neuloží; kdyby
          se to tu povolilo, obešla by se ta díra jinými dveřmi.
        */}
        <fieldset style={skupina} disabled={zamceno || !smiMenitPrava}>
          <legend style={legenda}>Oprávnění</legend>

          {!smiMenitPrava ? (
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>
              Měnit oprávnění může jen ten, kdo spravuje nastavení firmy.
              Tady je vidíte, jak jsou.
            </p>
          ) : null}

          {katalog.map((p) => {
            const ze = zeZarazeni(p.key)
            const je = zaskrtnuto(p.key)
            const jeVyjimka = je !== ze
            return (
              <div key={p.key} style={{ marginBottom: '6px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                  }}
                >
                  {/*
                    `nabizeno` veze, co obrazovka VŮBEC nabízela. Bez
                    toho by uložení sebralo práva, která se nekreslila
                    (mrtvý modul, nebo je nemá ani ten, kdo přiděluje)
                    — a nikdo by je neodškrtl.
                  */}
                  <input type="hidden" name="nabizeno" value={p.key} />
                  <input
                    type="checkbox"
                    name="pravo"
                    value={p.key}
                    checked={je}
                    onChange={(e) =>
                      setPrepsano((s) => ({ ...s, [p.key]: e.target.checked }))
                    }
                  />
                  <span>{p.label}</span>
                </label>
                {jeVyjimka ? (
                  <p
                    style={{
                      margin: '2px 0 0 26px',
                      fontSize: '12px',
                      color: 'var(--pozor)',
                    }}
                  >
                    {je ? 'výjimka — navíc oproti zařazení' : 'výjimka — odebráno'}
                    {smiMenitPrava ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() =>
                            setPrepsano((s) => ({ ...s, [p.key]: ze }))
                          }
                          style={odkazovaButton}
                        >
                          vrátit na zařazení
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            )
          })}

          {katalog.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Nemáte žádné právo, které byste mohli přidělit dál.
            </p>
          ) : null}
        </fieldset>

        {/*
          Rozsah se schovává, dokud člověk nemá členství. Není to
          zákaz „pro jistotu“: bez členství není řádek, do kterého by
          se rozsah zapsal, takže by tlačítko slíbilo něco, co se
          nestane.
        */}
        <fieldset style={skupina} disabled={zamceno || !maClenstvi} hidden={!maClenstvi}>
          <legend style={legenda}>Rozsah</legend>

          {smiFiremni ? (
            <label style={volba}>
              <input
                type="radio"
                name="uroven"
                value="tenant"
                checked={uroven === 'tenant'}
                onChange={() => setUroven('tenant')}
              />
              <span>
                <strong>Celá firma</strong>
                <span style={vysvetlivka}>
                  Vidí všechny pobočky, i ty, které přibudou později.
                </span>
              </span>
            </label>
          ) : null}

          <label style={volba}>
            <input
              type="radio"
              name="uroven"
              value="branch"
              checked={uroven === 'branch'}
              onChange={() => setUroven('branch')}
            />
            <span>
              <strong>Vybrané pobočky</strong>
              <span style={vysvetlivka}>
                Nová pobočka se sama nepřidá — musí se sem doplnit.
              </span>
            </span>
          </label>

          {uroven === 'branch' ? (
            <div style={seznamPobocek}>
              {pobocky.length === 0 ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                  Nevidíte žádnou pobočku, kterou byste mohli přidělit.
                </p>
              ) : (
                pobocky.map((p) => (
                  <label key={p.id} style={volba}>
                    <input
                      type="checkbox"
                      name="pobocka"
                      value={p.id}
                      defaultChecked={nynejsiPobocky.includes(p.id)}
                    />
                    <span>{p.nazev}</span>
                  </label>
                ))
              )}
            </div>
          ) : null}
        </fieldset>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={zamceno}>
            Uložit oprávnění
          </button>
          <a
            href={`/${rozsah}/nastaveni/lide`}
            className="ft-tl ft-tl-vedlejsi"
          >
            Zpět
          </a>
        </div>
      </form>

      <p style={{ ...popis, margin: '16px 0 0' }}>
        Nabízí se jen to, co smíte přidělit sami — nikdo nepřidělí víc,
        než má. Kdyby se sem něco propašovalo jinudy, odmítne to
        databáze.
      </p>
    </section>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '16px 18px',
  marginTop: '16px',
  maxWidth: '640px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.5,
} as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const skupina = {
  border: '1px solid var(--line)',
  borderRadius: '10px',
  padding: '12px 14px',
  display: 'grid',
  gap: '10px',
  margin: 0,
} as const

const legenda = {
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
  padding: '0 6px',
} as const

const volba = {
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-start',
  fontSize: '14px',
  color: 'var(--ink)',
  minHeight: '32px',
  cursor: 'pointer',
} as const

const vysvetlivka = {
  display: 'block',
  fontSize: '12.5px',
  color: 'var(--muted)',
  marginTop: '2px',
} as const

const seznamPobocek = {
  display: 'grid',
  gap: '4px',
  paddingLeft: '26px',
  borderLeft: '2px solid var(--line)',
  marginLeft: '6px',
} as const

const ramecek = {
  margin: '0 0 14px',
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const

/*
  „vrátit na zařazení" je akce, ne odkaz jinam — proto `button`
  ostylovaný jako odkaz. `<a>` bez cíle by sliboval navigaci
  a klávesnice by se k němu chovala jinak.
*/
const odkazovaButton = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--pozor)',
  textDecoration: 'underline',
  cursor: 'pointer',
}
