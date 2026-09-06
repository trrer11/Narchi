import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 20, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export const Icons = {
  grid: (p: IconProps) => (
    <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  layers: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5" /><path d="m2 17 10 5 10-5" /></svg>
  ),
  cube: (p: IconProps) => (
    <svg {...base(p)}><path d="M21 7.5 12 2 3 7.5v9L12 22l9-5.5v-9Z" /><path d="M3 7.5 12 13l9-5.5" /><path d="M12 22V13" /></svg>
  ),
  refresh: (p: IconProps) => (
    <svg {...base(p)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
  ),
  scale: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 3v18" /><path d="M7 21h10" /><path d="M5 7h14" /><path d="m5 7-3 6h6l-3-6Z" /><path d="m19 7-3 6h6l-3-6Z" /></svg>
  ),
  shield: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
  ),
  cog: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></svg>
  ),
  search: (p: IconProps) => (
    <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  bell: (p: IconProps) => (
    <svg {...base(p)}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
  ),
  arrowRight: (p: IconProps) => (
    <svg {...base(p)}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
  ),
  arrowUpRight: (p: IconProps) => (
    <svg {...base(p)}><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
  ),
  check: (p: IconProps) => (
    <svg {...base(p)}><path d="m20 6-11 11-5-5" /></svg>
  ),
  upload: (p: IconProps) => (
    <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
  ),
  mic: (p: IconProps) => (
    <svg {...base(p)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" /><path d="M8 22h8" /></svg>
  ),
  // §100 — œil (afficher/masquer) : la loupe « search » occupait ce rôle
  // par défaut sur l'écran de connexion, ce qui prêtait à confusion.
  eye: (p: IconProps) => (
    <svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  eyeOff: (p: IconProps) => (
    <svg {...base(p)}><path d="M9.9 5.14A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-1.67 2.68" /><path d="M6.61 6.61A16 16 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.39-1.61" /><path d="M9.9 9.9a3 3 0 0 0 4.24 4.24" /><path d="m2 2 20 20" /></svg>
  ),
  x: (p: IconProps) => (
    <svg {...base(p)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
  ),
  alert: (p: IconProps) => (
    <svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
  ),
  clock: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  chevronRight: (p: IconProps) => (
    <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>
  ),
  chevronDown: (p: IconProps) => (
    <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
  ),
  chevronLeft: (p: IconProps) => (
    <svg {...base(p)}><path d="m15 6-6 6 6 6" /></svg>
  ),
  filter: (p: IconProps) => (
    <svg {...base(p)}><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3Z" /></svg>
  ),
  download: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
  ),
  spark: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m5.6 5.6 2.8 2.8" /><path d="m15.6 15.6 2.8 2.8" /><path d="m18.4 5.6-2.8 2.8" /><path d="m8.4 15.6-2.8 2.8" /></svg>
  ),
  leaf: (p: IconProps) => (
    <svg {...base(p)}><path d="M11 20A7 7 0 0 1 4 13c0-6 7-9 16-9 0 9-3 16-9 16Z" /><path d="M4 20c4-6 8-9 13-11" /></svg>
  ),
  bolt: (p: IconProps) => (
    <svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>
  ),
  pin: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
  ),
  users: (p: IconProps) => (
    <svg {...base(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></svg>
  ),
  building: (p: IconProps) => (
    <svg {...base(p)}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></svg>
  ),
  database: (p: IconProps) => (
    <svg {...base(p)}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></svg>
  ),
  branch: (p: IconProps) => (
    <svg {...base(p)}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7" /><path d="M18 10.5c0 4-6 2.5-6 7.5" /></svg>
  ),
  pulse: (p: IconProps) => (
    <svg {...base(p)}><path d="M3 12h4l2-7 4 14 2-7h6" /></svg>
  ),
  rocket: (p: IconProps) => (
    <svg {...base(p)}><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0Z" /><path d="M12 15 9 12c.5-3 2-7 6-9 4 0 6 2 6 6-2 4-6 5.5-9 6Z" /><circle cx="15" cy="9" r="1.2" /></svg>
  ),
  globe: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></svg>
  ),
  lock: (p: IconProps) => (
    <svg {...base(p)}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  ),
  link: (p: IconProps) => (
    <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
  ),
  target: (p: IconProps) => (
    <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
  ),
  menu: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
  ),
  calendar: (p: IconProps) => (
    <svg {...base(p)}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /><path d="M8 14h.01M12 14h.01M16 14h.01" /></svg>
  ),
  package: (p: IconProps) => (
    <svg {...base(p)}><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
  ),
  flag: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 21V4" /><path d="M4 4h13l-2 4 2 4H4" /></svg>
  ),
  box: (p: IconProps) => (
    <svg {...base(p)}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5" /><path d="M12 12v9" /></svg>
  ),
  gauge: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 14 16 9" /><path d="M3.5 18a9 9 0 1 1 17 0" /><circle cx="12" cy="14" r="1.4" /></svg>
  ),
  sliders: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></svg>
  ),
  wrench: (p: IconProps) => (
    <svg {...base(p)}><path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.4L3 17.8 6.2 21l6.9-6.9a3.5 3.5 0 0 0 4.4-4.6l-2.3 2.3-2.1-2.1 2.4-2.2Z" /></svg>
  ),
  // §110 — vidéo chantier (import vidéo, demande client) : clap de tournage.
  film: (p: IconProps) => (
    <svg {...base(p)}><rect x="3" y="7" width="13" height="12" rx="2" /><path d="m16 11 5-3v8l-5-3" /><path d="M6.5 7 5 3.5 9 4.5 7.5 7" /><path d="M11 7 9.5 3.5 13.5 4.5 12 7" /></svg>
  ),
  camera: (p: IconProps) => (
    <svg {...base(p)}><path d="M4 7.5h2.6L9 5h6l2.4 2.5H20A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" /><circle cx="12" cy="13" r="3.5" /></svg>
  ),
  fire: (p: IconProps) => (
    <svg {...base(p)}><path d="M12 2c1 3-1 5-2.5 6.5C8 10 7 11.5 7 14a5 5 0 0 0 10 0c0-2-1-3.5-2-4.5C14 11 13 9 13 7c0-2 0-3 1-5Z" /></svg>
  ),
  command: (p: IconProps) => (
    <svg {...base(p)}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" /></svg>
  ),
  maximize: (p: IconProps) => (
    <svg {...base(p)}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
  ),
};

export type IconName = keyof typeof Icons;
