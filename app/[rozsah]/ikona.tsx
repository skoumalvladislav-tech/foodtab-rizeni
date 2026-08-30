import type { IkonaKlic } from "./nabidka";

/**
 * Tvary ikon, obkreslené z docs/rozvrzeni-nahled.html.
 *
 * Jsou to obrysy o tloušťce 1.7 na mřížce 20×20, aby v liště i ve
 * sloupci držely stejnou váhu jako text vedle nich.
 */
const TVARY: Record<IkonaKlic, React.ReactNode> = {
  kalendar: (
    <>
      <rect x="3" y="4.5" width="14" height="13" rx="2" />
      <path d="M3 8.5h14M7 2.5v4M13 2.5v4" />
    </>
  ),
  hodiny: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4.3l2.8 1.7" />
    </>
  ),
  fajfka: <path d="M4 10.5l3.6 3.5L16 5.5" />,
  zprava: <path d="M3.5 5.5a2 2 0 012-2h9a2 2 0 012 2v6a2 2 0 01-2 2H8l-4 3.2V5.5z" />,
  clovek: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M4 17c.7-3.2 3-4.6 6-4.6s5.3 1.4 6 4.6" />
    </>
  ),
  kniha: (
    <path d="M4 4.5h5.2c.9 0 1.8.6 1.8 1.6V17c0-.8-.9-1.4-1.8-1.4H4V4.5zM16 4.5h-5.2c-.9 0-1.8.6-1.8 1.6V17c0-.8.9-1.4 1.8-1.4H16V4.5z" />
  ),
  kolo: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2L4.8 4.8" />
    </>
  ),
  lupa: (
    <>
      <circle cx="8.8" cy="8.8" r="5.3" />
      <path d="M12.7 12.7L17 17" />
    </>
  ),
  tecky: (
    <>
      <circle cx="5" cy="10" r="1.3" />
      <circle cx="10" cy="10" r="1.3" />
      <circle cx="15" cy="10" r="1.3" />
    </>
  ),
};

export default function Ikona({ klic }: { klic: IkonaKlic }) {
  return (
    <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true">
      {TVARY[klic]}
    </svg>
  );
}
