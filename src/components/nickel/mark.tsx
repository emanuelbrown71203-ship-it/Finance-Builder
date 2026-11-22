/*
 * Nickel's head on a night-arcade tile: the app's mark (menu, sign-in) and the
 * picture on the home-screen icon (public/icon-nickel.svg and the nickel-*.png
 * icons are the same drawing, lit up).
 * Fixed neon colours on navy, so it looks the same in light and dark mode.
 */
export function NickelMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={className}>
      <rect x="1" y="1" width="62" height="62" rx="15" fill="#10123a" stroke="#3dffb5" strokeWidth="2.5" />
      <line x1="32" y1="9" x2="32" y2="15" stroke="#9ba4ff" strokeWidth="2" />
      <circle cx="32" cy="8.5" r="3.2" fill="#ff5fd2" />
      <path d="M17 26 L10 14 L23 20 Z" fill="#5a8cff" fillOpacity="0.25" stroke="#5a8cff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M47 26 L54 14 L41 20 Z" fill="#5a8cff" fillOpacity="0.25" stroke="#5a8cff" strokeWidth="2" strokeLinejoin="round" />
      <rect x="13" y="15" width="38" height="31" rx="11" fill="#1b1f4a" stroke="#9ba4ff" strokeWidth="2" />
      <rect x="18.5" y="22" width="27" height="15" rx="6.5" fill="#06071a" stroke="#3dffb5" strokeWidth="1.2" />
      <path d="M23.5 31.5 q3 -4.5 6 0 M34.5 31.5 q3 -4.5 6 0" fill="none" stroke="#3dffb5" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="22" y="48" width="20" height="10" rx="5" fill="#1b1f4a" stroke="#9ba4ff" strokeWidth="2" />
      <circle cx="32" cy="53" r="2.6" fill="#ffe45e" />
    </svg>
  );
}
