import Link from 'next/link'

import { ZONA_VYCHOZI, datumACasVPasmu } from '@/lib/cas'
import Ikona from '../../../ikona'

/**
 * Detail úkolu — jen vykreslení. Data dodá stránka, komponenta nesahá do
 * databáze, takže se dá vykreslit i v dočasném náhledu.
 */

export type UkolDetail = {
  id: string
  title: string
  note: string | null
  due_at: string | null
  priority: 'normal' | 'high'
  status: 'open' | 'done' | 'cancelled'
  created_at: string
  done_at: string | null
  konverzace_id?: string | null
  zprava_id?: string | null
}

const STAV: Record<UkolDetail['status'], string> = {
  open: 'Otevřený',
  done: 'Hotovo',
  cancelled: 'Zrušený',
}

export default function DetailUkolu({
  rozsah,
  ukol,
  komu,
  pobocka,
  chyba,
  akceDokoncit,
}: {
  rozsah: string
  ukol: UkolDetail
  komu: string
  pobocka: string
  chyba?: string | null
  akceDokoncit: (formData: FormData) => void | Promise<void>
}) {
  const poTerminu = ukol.status === 'open' && ukol.due_at !== null && new Date(ukol.due_at).getTime() < Date.now()

  return (
    <div className="pc-detail">
      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {chyba}
        </p>
      ) : null}

      <section className="ds-plocha">
        <div className="pc-detail-hlava">
          <span className="pc-avatar" aria-hidden="true">
            <Ikona klic={ukol.status === 'done' ? 'fajfkaKruh' : 'fajfkaCtverec'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2>{ukol.title}</h2>
            <p style={{ margin: '6px 0 0', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span className="pc-chip" data-stav={ukol.status === 'done' ? 'hotovo' : poTerminu ? 'pozde' : undefined}>
                {poTerminu ? 'Po termínu' : STAV[ukol.status]}
              </span>
              {ukol.priority === 'high' ? (
                <span className="pc-chip" data-stav="high">
                  Důležitý
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <dl className="pc-detail-pole" style={{ marginTop: '18px' }}>
          <dt>Termín</dt>
          <dd>{ukol.due_at ? datumACasVPasmu(ukol.due_at, ZONA_VYCHOZI) : 'Bez termínu'}</dd>
          <dt>Komu</dt>
          <dd>{komu}</dd>
          <dt>Pobočka</dt>
          <dd>{pobocka}</dd>
          <dt>Založeno</dt>
          <dd>{datumACasVPasmu(ukol.created_at, ZONA_VYCHOZI)}</dd>
          {ukol.done_at ? (
            <>
              <dt>Splněno</dt>
              <dd>{datumACasVPasmu(ukol.done_at, ZONA_VYCHOZI)}</dd>
            </>
          ) : null}
        </dl>

        {ukol.note && ukol.note.trim() !== '' ? (
          <p style={{ margin: '16px 0 0', fontSize: '15px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{ukol.note}</p>
        ) : null}

        {ukol.status === 'open' ? (
          <form action={akceDokoncit} style={{ marginTop: '18px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="ukol" value={ukol.id} />
            <button type="submit" className="ft-tl ft-tl-hlavni">
              Označit jako hotové
            </button>
          </form>
        ) : null}
      </section>

      {ukol.konverzace_id ? (
        <section className="ds-plocha">
          <h3 style={{ margin: '0 0 8px', fontSize: '15px' }}>Odkud úkol je</h3>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            Vznikl ze zprávy v rozhovoru.{' '}
            <Link href={`/${rozsah}/vzkazy/${ukol.konverzace_id}${ukol.zprava_id ? `#z-${ukol.zprava_id}` : ''}`}>
              Otevřít zprávu
            </Link>
            {' '}(Otevře se jen účastníkům toho rozhovoru — ostatní úkol vidí, zprávu ne.) Diskuse k úkolu
            samostatně zatím není — mluví se o něm v tom rozhovoru.
          </p>
        </section>
      ) : null}
    </div>
  )
}
