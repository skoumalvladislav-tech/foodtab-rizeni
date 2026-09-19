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
  mince: (
    <>
      <circle cx="7" cy="12.5" r="4.3" />
      <circle cx="13" cy="7.5" r="4.3" />
    </>
  ),
  praporek: (
    <>
      <path d="M4 12.5v-4l11-4.5v13L4 12.5z" />
      <path d="M7.5 12.5v4.5" />
    </>
  ),
  vozik: (
    <>
      <path d="M3 4h2l1.7 9.6a1.6 1.6 0 001.6 1.3h6.2a1.6 1.6 0 001.6-1.3L17.3 7H6.2" />
      <circle cx="8.3" cy="16.8" r="1.2" />
      <circle cx="14.3" cy="16.8" r="1.2" />
    </>
  ),
  blesk: <path d="M11.2 2.5L4.5 11.2H9l-.7 6.3 7.2-8.7H11l.2-6.3z" />,
  slunce: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
    </>
  ),
  lide: (
    <>
      <circle cx="7.5" cy="7.5" r="2.6" />
      <path d="M2.5 16.5c.6-2.8 2.5-4 5-4s4.4 1.2 5 4" />
      <circle cx="14" cy="8" r="2.1" />
      <path d="M13.6 12.6c2.2-.1 3.4 1 3.9 3.9" />
    </>
  ),
  sipkaVpravo: <path d="M7.5 4.5L13 10l-5.5 5.5" />,
  fajfkaKruh: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.6 10.3l2.4 2.4 4.4-4.8" />
    </>
  ),
  fajfkaCtverec: (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />
      <path d="M7 10.2l2.2 2.2 3.9-4.3" />
    </>
  ),
  vykricnik: <path d="M10 4v7.5M10 15v.5" />,
  fotka: (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
      <circle cx="7.3" cy="8.6" r="1.2" />
      <path d="M3 14l4.2-3.8 3.3 3 2.5-2.2 4 3.5" />
    </>
  ),
  faktura: (
    <>
      <path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z" />
      <path d="M11.5 2.5V6H15M8 10.5h4.5M8 13.5h4.5" />
    </>
  ),
  seznam: <path d="M4 6h12M4 10h12M4 14h7" />,
};

export default function Ikona({ klic, velikost }: { klic: IkonaKlic; velikost?: number }) {
  return (
    <svg
      className="ft-i"
      viewBox="0 0 20 20"
      aria-hidden="true"
      style={velikost ? { width: `${velikost}px`, height: `${velikost}px` } : undefined}
    >
      {TVARY[klic]}
    </svg>
  );
}
