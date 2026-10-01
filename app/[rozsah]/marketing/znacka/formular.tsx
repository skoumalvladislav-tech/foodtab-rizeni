'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { ulozitZnacku } from './akce'
import { navrhnoutZnackuZOdkazu, type StavNavrhuZnacky } from './akce-ai'

/**
 * Formulář značky — pole tónu/barev/sítí a návrh z webu.
 *
 * Klientský kvůli návrhu z webu: po úspěchu se musí PŘEDVYPLNIT pole
 * TÉHOŽ formuláře, který se ukládá přes `ulozitZnacku` (server akce bez
 * vráceného stavu) — a to jde jen přes řízený (controlled) vstup se
 * společným stavem, ne přes dvě oddělené akce nad týmiž `<input>`.
 *
 * NIC se z návrhu neuloží samo: `uloziteZnacku` zůstává tlačítko
 * „Uložit“ dole, úplně stejné jako dřív. Návrh jen předvyplní vstupy —
 * člověk je před uložením vidí a může je přepsat.
 */

type Znacka = {
  ton_hlasu: string
  pouzivat_emoji: boolean
  barva_hlavni: string | null
  barva_doplnkova: string | null
  barva_pozadi: string | null
  pismo_nadpisy: string | null
  pismo_text: string | null
  podpis: string
  kontakt: string
  vyrazy_ano: string[]
  vyrazy_ne: string[]
  video_sekundy: number
  popis_firmy: string
  web_url: string
  instagram_url: string
  facebook_url: string
}

type PoleZnacky = {
  ton_hlasu: string
  pouzivat_emoji: boolean
  barva_hlavni: string
  barva_doplnkova: string
  barva_pozadi: string
  pismo_nadpisy: string
  pismo_text: string
  podpis: string
  kontakt: string
  vyrazy_ano: string
  vyrazy_ne: string
  video_sekundy: string
  popis_firmy: string
  web_url: string
  instagram_url: string
  facebook_url: string
}

/** Klíče `PoleZnacky`, které umí vyplnit návrh z webu. Zbytek (tón, emoji, písmo, video) návrh nemění. */
const NAVRHOVATELNA_POLE = [
  'popis_firmy',
  'barva_hlavni',
  'barva_doplnkova',
  'barva_pozadi',
  'web_url',
  'instagram_url',
  'facebook_url',
] as const

type NavrhovatelnePole = (typeof NAVRHOVATELNA_POLE)[number]

function zacatecniPole(z: Znacka | null): PoleZnacky {
  return {
    ton_hlasu: z?.ton_hlasu ?? 'neformalni',
    pouzivat_emoji: z?.pouzivat_emoji ?? true,
    barva_hlavni: z?.barva_hlavni ?? '',
    barva_doplnkova: z?.barva_doplnkova ?? '',
    barva_pozadi: z?.barva_pozadi ?? '',
    pismo_nadpisy: z?.pismo_nadpisy ?? '',
    pismo_text: z?.pismo_text ?? '',
    podpis: z?.podpis ?? '',
    kontakt: z?.kontakt ?? '',
    vyrazy_ano: (z?.vyrazy_ano ?? []).join(', '),
    vyrazy_ne: (z?.vyrazy_ne ?? []).join(', '),
    video_sekundy: String(z?.video_sekundy ?? 20),
    popis_firmy: z?.popis_firmy ?? '',
    web_url: z?.web_url ?? '',
    instagram_url: z?.instagram_url ?? '',
    facebook_url: z?.facebook_url ?? '',
  }
}

export default function ZnackaFormular({
  rozsah,
  smiMenit,
  znacka,
  logoMediaId: pocatecniLogoMediaId,
  logoNahled: pocatecniLogoNahled,
}: {
  rozsah: string
  smiMenit: boolean
  znacka: Znacka | null
  logoMediaId: string | null
  logoNahled: string | null
}) {
  const [pole, setPole] = useState<PoleZnacky>(() => zacatecniPole(znacka))
  const [logoMediaId, setLogoMediaId] = useState(pocatecniLogoMediaId)
  const [logoNahled, setLogoNahled] = useState(pocatecniLogoNahled)
  const [navrzeno, setNavrzeno] = useState<Set<NavrhovatelnePole>>(new Set())

  const zmenit = (klic: keyof PoleZnacky, hodnota: string | boolean) => {
    setPole((p) => ({ ...p, [klic]: hodnota }))
    // Ruční úprava přebíjí štítek „navrženo“ — jakmile to člověk sám upraví,
    // přestává to být jen návrh k posouzení.
    if ((NAVRHOVATELNA_POLE as readonly string[]).includes(klic)) {
      setNavrzeno((s) => {
        if (!s.has(klic as NavrhovatelnePole)) return s
        const d = new Set(s)
        d.delete(klic as NavrhovatelnePole)
        return d
      })
    }
  }

  const [stavNavrhu, spustitNavrh, cekaNaNavrh] = useActionState<StavNavrhuZnacky, FormData>(
    navrhnoutZnackuZOdkazu,
    { stav: 'nic' },
  )

  /*
    Promítnutí výsledku akce do stavu formuláře — BĚHEM VYKRESLENÍ, ne
    v `useEffect`. Je to zdokumentovaný vzor „Adjusting state when
    a prop changes" (react.dev/learn/you-might-not-need-an-effect):
    React dovolí volat `setState` přímo v těle komponenty, když se
    mění něco zvenčí (tady výsledek server akce) — porovná se s
    poslední ZPRACOVANOU hodnotou, aby se totéž nesloučilo znovu při
    každém překreslení, a ne až o kolo později v efektu.
  */
  const [zpracovanyNavrh, setZpracovanyNavrh] = useState<StavNavrhuZnacky | null>(null)

  if (stavNavrhu !== zpracovanyNavrh) {
    setZpracovanyNavrh(stavNavrhu)

    if (stavNavrhu.stav === 'hotovo') {
      const n = stavNavrhu.navrh
      const prave = new Set<NavrhovatelnePole>()
      const dalsi = { ...pole }

      if (n.popis) { dalsi.popis_firmy = n.popis; prave.add('popis_firmy') }
      if (n.barva_hlavni) { dalsi.barva_hlavni = n.barva_hlavni; prave.add('barva_hlavni') }
      if (n.barva_doplnkova) { dalsi.barva_doplnkova = n.barva_doplnkova; prave.add('barva_doplnkova') }
      if (n.barva_pozadi) { dalsi.barva_pozadi = n.barva_pozadi; prave.add('barva_pozadi') }
      if (n.web_url) { dalsi.web_url = n.web_url; prave.add('web_url') }
      if (n.instagram_url) { dalsi.instagram_url = n.instagram_url; prave.add('instagram_url') }
      if (n.facebook_url) { dalsi.facebook_url = n.facebook_url; prave.add('facebook_url') }

      setPole(dalsi)
      setNavrzeno(prave)

      if (n.logo_media_id) {
        setLogoMediaId(n.logo_media_id)
        setLogoNahled(n.logo_nahled)
      }
    }
  }

  return (
    <>
      {smiMenit ? (
        <section style={{ ...karta, display: 'grid', gap: '12px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: '15px' }}>Najít značku na webu</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
              Vložte odkaz na web, Instagram nebo Facebook firmy — nástroj z něj zkusí
              přečíst logo, barvy, popis a odkazy na sítě. Nic se tím hned neuloží:
              návrh se jen předvyplní níž do formuláře a vy ho před uložením zkontrolujete.
            </p>
          </div>

          <form
            action={spustitNavrh}
            style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input type="hidden" name="rozsah" value={rozsah} />
            <input
              name="odkaz"
              placeholder="https://www.vase-restaurace.cz"
              style={{ ...pole_, flex: '1 1 280px', minWidth: '240px' }}
              disabled={cekaNaNavrh}
            />
            <button type="submit" className="ft-tl ft-tl-hlavni" disabled={cekaNaNavrh}>
              {cekaNaNavrh ? 'Hledám…' : 'Najít na webu'}
            </button>
          </form>

          {stavNavrhu.stav === 'chyba' ? <p className="hlaska-chyba">{stavNavrhu.text}</p> : null}

          {stavNavrhu.stav === 'hotovo' ? (
            <div style={{ display: 'grid', gap: '6px', fontSize: '13px' }}>
              <p style={{ margin: 0, color: 'var(--mosaz)' }}>
                Návrh je vyplněný níž ve formuláři — co se povedlo, je označené štítkem
                „navrženo“. Zkontrolujte to a uložte, nebo si přepište, co nesedí.
              </p>

              {stavNavrhu.navrh.zdroje.length > 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Zdroje: {stavNavrhu.navrh.zdroje.join(', ')}
                </p>
              ) : null}

              {stavNavrhu.navrh.nejiste.length > 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Nepodařilo se zjistit jistě: {stavNavrhu.navrh.nejiste.join('; ')}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <form action={ulozitZnacku} style={{ ...karta, display: 'grid', gap: '16px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <input type="hidden" name="logo_media_id" value={logoMediaId ?? ''} />

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label>
            <span style={popisek}>Tón hlasu</span>
            <select
              name="ton_hlasu"
              value={pole.ton_hlasu}
              onChange={(e) => zmenit('ton_hlasu', e.target.value)}
              style={pole_}
              disabled={!smiMenit}
            >
              <option value="formalni">Formální — vykáme, bez nadsázky</option>
              <option value="neformalni">Neformální — vykáme, ale lidsky</option>
              <option value="hrave">Hravý — nadsázka, kratší věty</option>
            </select>
          </label>

          <label>
            <span style={popisek}>Emoji v textu</span>
            <select
              name="pouzivat_emoji"
              value={pole.pouzivat_emoji ? 'ano' : 'ne'}
              onChange={(e) => zmenit('pouzivat_emoji', e.target.value === 'ano')}
              style={pole_}
              disabled={!smiMenit}
            >
              <option value="ano">Používat</option>
              <option value="ne">Nepoužívat</option>
            </select>
          </label>

          <label>
            <Popisek text="Hlavní barva" navrzeno={navrzeno.has('barva_hlavni')} />
            <input
              name="barva_hlavni"
              value={pole.barva_hlavni}
              onChange={(e) => zmenit('barva_hlavni', e.target.value)}
              placeholder="#7a1f2b"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <Popisek text="Doplňková barva" navrzeno={navrzeno.has('barva_doplnkova')} />
            <input
              name="barva_doplnkova"
              value={pole.barva_doplnkova}
              onChange={(e) => zmenit('barva_doplnkova', e.target.value)}
              placeholder="#d8ab4e"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <Popisek text="Barva pozadí" navrzeno={navrzeno.has('barva_pozadi')} />
            <input
              name="barva_pozadi"
              value={pole.barva_pozadi}
              onChange={(e) => zmenit('barva_pozadi', e.target.value)}
              placeholder="#f6efe4"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <span style={popisek}>Písmo nadpisů</span>
            <input
              name="pismo_nadpisy"
              value={pole.pismo_nadpisy}
              onChange={(e) => zmenit('pismo_nadpisy', e.target.value)}
              placeholder="Newsreader"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <span style={popisek}>Písmo textu</span>
            <input
              name="pismo_text"
              value={pole.pismo_text}
              onChange={(e) => zmenit('pismo_text', e.target.value)}
              placeholder="Archivo"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          <span style={popisek}>Logo</span>
          {logoNahled ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoNahled}
              alt="Logo firmy"
              style={{ maxWidth: '160px', maxHeight: '160px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line-2)' }}
            />
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Zatím žádné. Najděte ho tlačítkem „Najít na webu“ výš.
            </p>
          )}
        </div>

        <label>
          <span style={popisek}>Popis firmy</span>
          <textarea
            name="popis_firmy"
            value={pole.popis_firmy}
            onChange={(e) => zmenit('popis_firmy', e.target.value)}
            placeholder="Rodinná restaurace s poctivou domácí kuchyní…"
            rows={3}
            style={{ ...pole_, minHeight: '80px', resize: 'vertical' as const }}
            disabled={!smiMenit}
          />
          {navrzeno.has('popis_firmy') ? <StitekNavrzeno /> : null}
        </label>

        <label>
          <span style={popisek}>Podpis pod příspěvkem</span>
          <input
            name="podpis"
            value={pole.podpis}
            onChange={(e) => zmenit('podpis', e.target.value)}
            placeholder="Černá Perla"
            style={pole_}
            disabled={!smiMenit}
          />
        </label>

        <label>
          <span style={popisek}>Kontakt do patičky obrázku</span>
          <input
            name="kontakt"
            value={pole.kontakt}
            onChange={(e) => zmenit('kontakt', e.target.value)}
            placeholder="Náměstí 1, Tábor · 777 123 456"
            style={pole_}
            disabled={!smiMenit}
          />
        </label>

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label>
            <Popisek text="Web" navrzeno={navrzeno.has('web_url')} />
            <input
              name="web_url"
              value={pole.web_url}
              onChange={(e) => zmenit('web_url', e.target.value)}
              placeholder="https://www.vase-restaurace.cz"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <Popisek text="Instagram" navrzeno={navrzeno.has('instagram_url')} />
            <input
              name="instagram_url"
              value={pole.instagram_url}
              onChange={(e) => zmenit('instagram_url', e.target.value)}
              placeholder="https://www.instagram.com/vase_restaurace"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <Popisek text="Facebook" navrzeno={navrzeno.has('facebook_url')} />
            <input
              name="facebook_url"
              value={pole.facebook_url}
              onChange={(e) => zmenit('facebook_url', e.target.value)}
              placeholder="https://www.facebook.com/vaserestaurace"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>
        </div>

        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          Tohle jsou jen odkazy na profily, ne přihlášení. Chcete-li z appky rovnou
          publikovat na sociální sítě, připojte účty na{' '}
          <Link href={`/${rozsah}/marketing/nastroje`}>Marketing → Nástroje</Link>.
        </p>

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <label>
            <span style={popisek}>Výrazy, které používáme (oddělené čárkou)</span>
            <input
              name="vyrazy_ano"
              value={pole.vyrazy_ano}
              onChange={(e) => zmenit('vyrazy_ano', e.target.value)}
              placeholder="poctivé, domácí, sezónní"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>

          <label>
            <span style={popisek}>Výrazy, kterým se vyhýbáme</span>
            <input
              name="vyrazy_ne"
              value={pole.vyrazy_ne}
              onChange={(e) => zmenit('vyrazy_ne', e.target.value)}
              placeholder="levné, akce, mňam"
              style={pole_}
              disabled={!smiMenit}
            />
          </label>
        </div>

        <label style={{ maxWidth: '220px' }}>
          <span style={popisek}>Délka videa v sekundách (3–90)</span>
          <input
            name="video_sekundy"
            type="number"
            min={3}
            max={90}
            value={pole.video_sekundy}
            onChange={(e) => zmenit('video_sekundy', e.target.value)}
            style={pole_}
            disabled={!smiMenit}
          />
        </label>

        {smiMenit ? (
          <div>
            <button type="submit" className="ft-tl ft-tl-hlavni">Uložit značku</button>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
            Značku mění ten, kdo smí připravovat příspěvky. Vy ji vidíte,
            ale neuložíte.
          </p>
        )}
      </form>
    </>
  )
}

function Popisek({ text, navrzeno }: { text: string; navrzeno: boolean }) {
  return (
    <span style={popisek}>
      {text}
      {navrzeno ? <StitekNavrzeno /> : null}
    </span>
  )
}

function StitekNavrzeno() {
  return (
    <span
      style={{
        marginLeft: '8px',
        padding: '1px 7px',
        borderRadius: '999px',
        background: 'var(--mosaz-bg, var(--card))',
        border: '1px solid var(--mosaz)',
        color: 'var(--mosaz)',
        fontSize: '11px',
        textTransform: 'none',
        letterSpacing: 'normal',
      }}
    >
      navrženo, zkontrolujte
    </span>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole_ = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '14px',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const
