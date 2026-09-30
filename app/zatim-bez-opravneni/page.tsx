import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getContext, getUser, maOpravneni } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'
import Odhlaseni from '@/components/shell/Odhlaseni'
import CekajiciPozvanka, { nactiCekajici } from '@/app/cekajici-pozvanka'
import PrijmoutPozvanku from '@/app/prijmout-pozvanku'

export const dynamic = 'force-dynamic'

/**
 * Účet je hotový, oprávnění zatím žádné.
 *
 * Vlastní adresa mimo `/[rozsah]/` (docs/odpovedi-pozvanky-2026-09-01.md,
 * oddíl 2): tahle obrazovka se ze své podstaty ukazuje člověku, který
 * žádný rozsah nemá, takže by se na adresu s rozsahem nedostal.
 *
 * Musí to být VĚTA, ne prázdný rozcestník. Je to první, co člověk
 * z Foodtabu uvidí, a prázdná obrazovka bez vysvětlení vypadá jako
 * porucha.
 *
 * Kdo sem přijde omylem a oprávnění dávno má, se nemá kde zaseknout —
 * pošle se rovnou do aplikace.
 *
 * ČEKAJÍCÍ POZVÁNKA I S FIRMOU. Druhý Kateřinin účet je člen firmy bez
 * práv a končí právě tady. Když mu majitel vystaví přesun (pozvánku na
 * tuhle adresu pro Kateřinin záznam), musí ji tu vidět — dřív se čekající
 * pozvánky hledaly jen u účtu BEZ firmy a přijmout šlo jen z odkazu
 * v e-mailu (kontrola 28. 9. 2026). Přijetí jde stejnou cestou jako
 * odkaz (`app.prijmout_pozvanku`), i se stejnou kontrolou přesunu.
 */
export default async function ZatimBezOpravneni() {
  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    const cekajici = await nactiCekajici()
    if (cekajici.length > 0) return <CekajiciPozvanka pozvanky={cekajici} />

    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě" pata={<Odhlaseni varianta="samostatne" jinaAdresa />}>
        Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
        členství. Až vás někdo do firmy pozve, přijde vám e-mail
        s odkazem — stačí počkat, nebo se ozvat tomu, kdo firmu spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (ctx && maOpravneni(ctx)) redirect('/')

  const cekajici = await nactiCekajici()

  return (
    <main style={obal}>
      <div style={karta}>
        {cekajici.length > 0 ? (
          <section style={pozvanka} data-cekajici-pozvanka="">
            <h2 style={nadpisPozvanky}>
              {cekajici.length === 1
                ? `Čeká na vás pozvánka do firmy ${cekajici[0].firma}`
                : 'Čekají na vás pozvánky'}
            </h2>
            <p style={{ ...odstavec, margin: '0 0 12px' }}>
              Přišla na adresu, kterou jste se přihlásili. Po přijetí
              uvidíte, co vám ve firmě přidělili.
            </p>
            <div style={{ display: 'grid', gap: '10px' }}>
              {cekajici.map((p) => (
                <PrijmoutPozvanku
                  key={p.invitation_id}
                  id={p.invitation_id}
                  firma={p.firma}
                  jedina={cekajici.length === 1}
                />
              ))}
            </div>
          </section>
        ) : null}

        <h1 style={nadpis}>Účet je hotový</h1>
        <p style={odstavec}>
          Přihlášení proběhlo v pořádku a do firmy{' '}
          <strong>{ctx?.tenant.name ?? 'Foodtab'}</strong> patříte. Zatím
          vám ale nikdo nepřidělil oprávnění, takže tu není co otevřít —
          ozvěte se vedoucímu.
        </p>
        <p style={odstavec}>
          Jakmile vám oprávnění přidělí, uvidíte tady rovnou svůj rozpis
          směn a docházku. Do té doby si můžete zkontrolovat, co o vás
          aplikace vede.
        </p>
        {/* Hlavní (zlaté) tlačítko jen jedno: s pozvánkou je to Přijmout. */}
        <Link
          href="/moje-udaje"
          className={`ft-tl ${cekajici.length > 0 ? 'ft-tl-vedlejsi' : 'ft-tl-hlavni'}`}
        >
          Moje údaje
        </Link>
        {/*
          Tady přistál druhý Kateřinin účet (hlášení 25. 9. 2026): člen
          firmy bez záznamu v Lidech. Odhlášení bylo jen dole na Mých
          údajích — kdo se přihlásil špatnou adresou, má ho mít po ruce.
        */}
        <Odhlaseni varianta="samostatne" jinaAdresa />
      </div>
    </main>
  )
}

const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: 'var(--paper)',
} as const

const karta = {
  width: '100%',
  maxWidth: '480px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '32px',
} as const

const nadpis = {
  margin: '0 0 12px',
  fontSize: '20px',
  color: 'var(--branch)',
} as const

/* Mosazný rámeček jako okénko „jiný účet" na obrazovce pozvánky
   (app/pozvanka/[token]/jiny-ucet.tsx): je to nabídka, ne varování. */
const pozvanka = {
  margin: '0 0 24px',
  padding: '14px 16px',
  border: '1px solid var(--mosaz)',
  borderRadius: '12px',
  background: 'var(--paper)',
} as const

const nadpisPozvanky = {
  margin: '0 0 6px',
  fontSize: '17px',
  color: 'var(--ink)',
  lineHeight: 1.3,
} as const

const odstavec = {
  margin: '0 0 14px',
  color: 'var(--muted)',
  fontSize: '14px',
  lineHeight: 1.55,
} as const
