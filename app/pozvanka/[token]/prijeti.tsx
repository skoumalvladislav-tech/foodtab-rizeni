'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { prihlasitSeAdresouZPozvanky, prijmoutPozvankuAction } from './akce'

/**
 * Přijetí pozvánky.
 *
 * Dvě věci, které se dnes ukázaly na ostré aplikaci:
 *
 *  * hláška z databáze se PROPOUŠTÍ (bod 5). „Pozvánka byla vystavena
 *    na jinou e-mailovou adresu“ řekne víc než „Token není platný“ —
 *    a hlavně je to pravda;
 *  * kdo je přihlášený pod jinou adresou, dostane tlačítko, které mu
 *    pošle odkaz na tu správnou (bod 6). Nic neopisuje a nevybírá.
 */
export default function PrijmoutPozvankuFormular({
  token,
  adresaZkracena,
}: {
  token: string
  /** Zkrácená adresa z pozvánky, např. „l…a@seznam.cz“. Celá do prohlížeče nejde. */
  adresaZkracena: string | null
}) {
  const router = useRouter()
  const [ceka, setCeka] = useState(false)
  const [chyba, setChyba] = useState<string | null>(null)
  const [jinaAdresa, setJinaAdresa] = useState(false)
  const [odkazPoslan, setOdkazPoslan] = useState(false)

  async function prijmout(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCeka(true)
    setChyba(null)

    const v = await prijmoutPozvankuAction(token)

    if (v.ok) {
      router.push('/')
      return
    }

    setChyba(v.chyba ?? 'Pozvánku se nepodařilo přijmout.')
    setJinaAdresa(v.jinaAdresa === true)
    setCeka(false)
  }

  async function prepnoutUcet() {
    setCeka(true)
    const v = await prihlasitSeAdresouZPozvanky(token)
    if (v.ok) {
      setOdkazPoslan(true)
      setChyba(null)
    } else {
      setChyba(v.chyba ?? 'Odkaz se nepodařilo poslat.')
    }
    setCeka(false)
  }

  if (odkazPoslan) {
    return (
      <div style={formular}>
        <p style={{ margin: 0, fontSize: '15px', color: 'var(--dobre)' }}>
          Odkaz k přihlášení odešel{adresaZkracena ? ` na ${adresaZkracena}` : ''}.
        </p>
        <p style={text}>
          Otevřete ho ve stejném prohlížeči. Po přihlášení uvidíte
          čekající pozvánku rovnou na úvodní obrazovce a přijmete ji
          jedním kliknutím.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={prijmout} style={formular}>
      <p style={text}>
        Kliknutím na tlačítko níže potvrdíte, že chcete vstoupit do firmy.
      </p>

      {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

      {/*
        Vazba pozvánky na adresu se nerozvolňuje — je to jediné, čím se
        ověří, že odkaz použil ten, komu byl poslaný. Nabízí se cesta,
        ne výjimka z pravidla.
      */}
      {jinaAdresa ? (
        <div style={ramecek}>
          <p style={{ margin: '0 0 10px', fontSize: '13.5px', lineHeight: 1.5 }}>
            Tahle pozvánka byla vystavena na jinou adresu, než pod kterou
            jste přihlášený. Můžeme vám poslat přihlašovací odkaz na tu
            správnou.
          </p>
          <button
            type="button"
            className="ft-tl ft-tl-hlavni"
            disabled={ceka}
            onClick={prepnoutUcet}
          >
            {ceka
              ? 'Posílám…'
              : adresaZkracena
                ? `Přihlásit se jako ${adresaZkracena}`
                : 'Poslat odkaz na správnou adresu'}
          </button>
        </div>
      ) : (
        <button type="submit" disabled={ceka} className="ft-tl ft-tl-hlavni">
          {ceka ? 'Přijímám…' : 'Přijmout pozvánku'}
        </button>
      )}
    </form>
  )
}

/* --- Styly --- */

const formular = {
  display: 'grid',
  gap: '16px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: 'var(--shadow)',
} as const

const text = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--muted)',
  lineHeight: 1.55,
} as const

const ramecek = {
  padding: '14px 16px',
  border: '1px solid var(--mosaz)',
  borderRadius: '12px',
  background: 'var(--paper)',
  color: 'var(--ink)',
} as const
