import { hodinyAMinuty } from '@/lib/mzdy'
import { delkaSmenyMinut } from '@/lib/cas'
import { VETA_JEN_NOVE } from '@/lib/sablony-text'
import { prepnoutSablonu, ulozitSablonu } from './akce'

/**
 * Nastavení → Šablony směn, samotné vykreslení.
 *
 * Oddělené od `page.tsx` schválně: stránka načítá data a ověřuje
 * přístup, tohle jen kreslí. Díky tomu jde vykreslit v kontrole
 * (`scripts/sablony.test.mjs`) a ověřit z hotového HTML, co uvidí
 * člověk — ne z toho, co jsem chtěl napsat.
 */

export type SablonaRadek = {
  id: string
  key: string
  label: string
  starts_at: string
  ends_at: string
  poradi: number
  active: boolean
  branch_id: string | null
  position_id: string | null
}

export default function ObrazovkaSablon({
  rozsah,
  sablony,
  pobocky,
  pozice,
  chyba,
  stav,
}: {
  rozsah: string
  sablony: SablonaRadek[]
  pobocky: { id: string; nazev: string }[]
  pozice: { id: string; label: string }[]
  chyba?: string
  stav?: string
}) {
  const nazvyPobocek = new Map(pobocky.map((b) => [b.id, b.nazev]))
  const nazvyPozic = new Map(pozice.map((p) => [p.id, p.label]))

  return (
    <div style={{ padding: '16px', paddingBottom: '32px' }}>
      {/*
        Věta stojí NAHOŘE, ne v patičce. Kdo přijde šablonu přepsat,
        musí ji vidět dřív, než klikne na Uložit — ne až potom.
      */}
      <p style={vetaNahore}>{VETA_JEN_NOVE}</p>

      <form action={ulozitSablonu} style={formular}>
        <input type="hidden" name="rozsah" value={rozsah} />

        <h2 style={{ margin: '0 0 12px', fontSize: '16px', color: 'var(--ink)' }}>
          Nová šablona
        </h2>

        <div style={dvaSloupce}>
          <label style={poleLabel}>
            <span>Zkratka</span>
            <input
              name="klic"
              required
              maxLength={4}
              placeholder="D"
              style={pole}
            />
            <span style={vysvetlivka}>Nejvýš čtyři znaky. Tohle uvidí lidé v rozpisu.</span>
          </label>

          <label style={poleLabel}>
            <span>Název</span>
            <input
              name="nazev"
              required
              maxLength={60}
              placeholder="Denní"
              style={pole}
            />
          </label>
        </div>

        <div style={dvaSloupce}>
          <label style={poleLabel}>
            <span>Od</span>
            <input name="od" type="time" required defaultValue="08:00" style={pole} />
          </label>
          <label style={poleLabel}>
            <span>Do</span>
            <input name="do" type="time" required defaultValue="16:00" style={pole} />
          </label>
        </div>

        <p style={{ ...vysvetlivka, margin: '0 0 12px' }}>
          Konec dřív než začátek znamená, že směna končí druhý den —
          22:00–06:00 je osm hodin, ne mínus šestnáct.
        </p>

        <div style={dvaSloupce}>
          <label style={poleLabel}>
            <span>Pobočka</span>
            {/*
              Prázdné je platná volba, ne chybějící údaj: šablona bez
              pobočky platí pro celou firmu. Proto „všechny pobočky“,
              ne prázdný řádek — prázdný řádek vypadá jako nedodělek.
            */}
            <select name="pobocka" defaultValue="" style={pole}>
              <option value="">všechny pobočky</option>
              {pobocky.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nazev}
                </option>
              ))}
            </select>
          </label>

          <label style={poleLabel}>
            <span>Pozice</span>
            <select name="pozice" defaultValue="" style={pole}>
              <option value="">všechny pozice</option>
              {pozice.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label style={{ ...poleLabel, maxWidth: '160px' }}>
          <span>Pořadí</span>
          <input
            name="poradi"
            type="number"
            step={10}
            placeholder="100"
            style={pole}
          />
          <span style={vysvetlivka}>V jakém pořadí se nabízejí. Menší číslo je výš.</span>
        </label>

        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {stav ? (
          <p style={{ margin: '12px 0 0', fontSize: '13px', color: popisStavu(stav).barva }}>
            {popisStavu(stav).text}
          </p>
        ) : null}

        <button type="submit" className="ft-tl ft-tl-hlavni" style={{ marginTop: '16px' }}>
          Přidat šablonu
        </button>
      </form>

      <h2 style={nadpisSekce}>
        {sablony.length === 0 ? 'Zatím žádné šablony' : 'Šablony ve firmě'}
      </h2>

      {sablony.length === 0 ? (
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)', maxWidth: '62ch' }}>
          Žádná zatím není. Šablona je pojmenovaná směna s časy — „D“ od
          osmi do čtyř, „N“ od desíti večer do šesti ráno. Ve formuláři
          směny se pak vybere jedním kliknutím místo vypisování hodin.
        </p>
      ) : (
        <ul style={seznam}>
          {sablony.map((s) => {
            const minut = delkaSmenyMinut(s.starts_at, s.ends_at)
            const pobocka = s.branch_id
              ? (nazvyPobocek.get(s.branch_id) ?? 'neznámá pobočka')
              : 'všechny pobočky'
            const poz = s.position_id
              ? (nazvyPozic.get(s.position_id) ?? 'neznámá pozice')
              : 'všechny pozice'

            return (
              <li key={s.id} style={{ ...karta, opacity: s.active ? 1 : 0.6 }}>
                <form action={ulozitSablonu} style={{ display: 'grid', gap: '10px' }}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="sablona" value={s.id} />

                  <div style={dvaSloupce}>
                    <label style={poleLabel}>
                      <span>Zkratka</span>
                      <input
                        name="klic"
                        defaultValue={s.key}
                        required
                        maxLength={4}
                        style={pole}
                        aria-label={`Zkratka šablony ${s.label}`}
                      />
                    </label>
                    <label style={poleLabel}>
                      <span>Název</span>
                      <input
                        name="nazev"
                        defaultValue={s.label}
                        required
                        maxLength={60}
                        style={pole}
                        aria-label={`Název šablony ${s.key}`}
                      />
                    </label>
                  </div>

                  <div style={dvaSloupce}>
                    <label style={poleLabel}>
                      <span>Od</span>
                      <input
                        name="od"
                        type="time"
                        required
                        defaultValue={s.starts_at.slice(0, 5)}
                        style={pole}
                        aria-label={`Začátek šablony ${s.key}`}
                      />
                    </label>
                    <label style={poleLabel}>
                      <span>Do</span>
                      <input
                        name="do"
                        type="time"
                        required
                        defaultValue={s.ends_at.slice(0, 5)}
                        style={pole}
                        aria-label={`Konec šablony ${s.key}`}
                      />
                    </label>
                  </div>

                  <div style={dvaSloupce}>
                    <label style={poleLabel}>
                      <span>Pobočka</span>
                      <select
                        name="pobocka"
                        defaultValue={s.branch_id ?? ''}
                        style={pole}
                        aria-label={`Pobočka šablony ${s.key}`}
                      >
                        <option value="">všechny pobočky</option>
                        {pobocky.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nazev}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={poleLabel}>
                      <span>Pozice</span>
                      <select
                        name="pozice"
                        defaultValue={s.position_id ?? ''}
                        style={pole}
                        aria-label={`Pozice šablony ${s.key}`}
                      >
                        <option value="">všechny pozice</option>
                        {pozice.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div style={dvaSloupce}>
                    <label style={poleLabel}>
                      <span>Pořadí</span>
                      <input
                        name="poradi"
                        type="number"
                        step={10}
                        defaultValue={s.poradi}
                        style={pole}
                        aria-label={`Pořadí šablony ${s.key}`}
                      />
                    </label>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                        Uložit změnu
                      </button>
                    </div>
                  </div>
                </form>

                <div style={patickaKarty}>
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    {s.starts_at.slice(0, 5)}–{s.ends_at.slice(0, 5)} ·{' '}
                    {hodinyAMinuty(minut)} · {pobocka} · {poz}
                    {s.active ? '' : ' · vyřazená z nabídky'}
                  </span>

                  <form action={prepnoutSablonu} style={{ marginLeft: 'auto' }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="sablona" value={s.id} />
                    <input type="hidden" name="zapnout" value={s.active ? 'ne' : 'ano'} />
                    <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      {s.active ? 'Vyřadit z nabídky' : 'Vrátit do nabídky'}
                    </button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p style={{ margin: '20px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
        Šablony se nemažou, jen vyřazují z nabídky. Zkratku lidé znají
        a visí na ní historie — kdyby se uvolnila, mohl by pod stejným
        „D“ někdo založit jiné časy.
      </p>

      <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
        Když má stejnou zkratku víc šablon, platí ta nejužší: pobočka
        i pozice před samotnou pobočkou, ta před firemní pro danou
        pozici, a nakonec firemní pro všechny.
      </p>
    </div>
  )
}

/* --- hlášky ------------------------------------------------------ */

function popisStavu(stav: string): { barva: string; text: string } {
  switch (stav) {
    case 'zalozena':
      return { barva: 'var(--good)', text: 'Šablona přidaná.' }
    case 'upravena':
      return { barva: 'var(--good)', text: `Uloženo. ${VETA_JEN_NOVE}` }
    case 'vyrazena':
      return {
        barva: 'var(--muted)',
        text: 'Vyřazeno z nabídky. Už zadané směny zůstávají, jak jsou.',
      }
    case 'vracena':
      return { barva: 'var(--good)', text: 'Vráceno do nabídky.' }
    default:
      return { barva: 'var(--muted)', text: '' }
  }
}

/* --- styly ------------------------------------------------------- */

const vetaNahore = {
  margin: '0 0 16px',
  padding: '12px 14px',
  border: '1px solid var(--line-2)',
  borderRadius: '10px',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: '14px',
  lineHeight: 1.5,
  maxWidth: '62ch',
} as const

const formular = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '16px 18px',
  boxShadow: 'var(--shadow)',
  maxWidth: '620px',
} as const

const dvaSloupce = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
  marginBottom: '12px',
} as const

const poleLabel = {
  display: 'grid',
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

const vysvetlivka = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
  textTransform: 'none' as const,
  letterSpacing: 'normal',
} as const

const nadpisSekce = {
  margin: '24px 0 12px',
  fontSize: '16px',
  color: 'var(--muted)',
  fontWeight: 500,
} as const

const seznam = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '12px',
} as const

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '14px',
} as const

const patickaKarty = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap' as const,
  marginTop: '10px',
} as const
