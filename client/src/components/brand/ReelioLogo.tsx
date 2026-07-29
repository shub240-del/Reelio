/**
 * Reelio brand mark — original artwork, drawn entirely in code.
 *
 * Deliberately an inline SVG rather than a raster asset: it inherits the brand
 * gradient from CSS custom properties, stays sharp at any density, needs no
 * network request, and cannot 404 the way the previous /manus-storage/*.png
 * references did.
 *
 * The mark is a film aperture (rounded square) with a play triangle cut from it
 * and two sprocket holes on the left edge — "a reel that plays".
 */

export interface ReelioLogoProps {
  /** Height of the mark in px. Width follows the 1:1 aspect. */
  size?: number;
  /** Render the wordmark next to the glyph. */
  withWordmark?: boolean;
  className?: string;
}

let gradientSeed = 0;

export function ReelioMark({ size = 32, className }: { size?: number; className?: string }) {
  // Unique gradient ids: multiple marks on one page must not collide.
  const id = `reelio-grad-${++gradientSeed}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="Reelio"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--reelio-violet)" />
          <stop offset="100%" stopColor="var(--reelio-cyan)" />
        </linearGradient>
      </defs>

      {/* Aperture body */}
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill={`url(#${id})`} />

      {/* Play triangle, knocked out of the aperture */}
      <path
        d="M17.2 13.4a1.6 1.6 0 0 1 2.44-1.37l8.1 5.24a1.6 1.6 0 0 1 0 2.69l-8.1 5.24a1.6 1.6 0 0 1-2.44-1.35V13.4Z"
        fill="#0A0A0F"
        fillOpacity="0.92"
      />

      {/* Sprocket holes — the "reel" read */}
      <circle cx="10.6" cy="15.4" r="2.1" fill="#0A0A0F" fillOpacity="0.92" />
      <circle cx="10.6" cy="24.6" r="2.1" fill="#0A0A0F" fillOpacity="0.92" />
    </svg>
  );
}

export function ReelioLogo({ size = 32, withWordmark = true, className }: ReelioLogoProps) {
  if (!withWordmark) return <ReelioMark size={size} className={className} />;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <ReelioMark size={size} />
      <span
        className="font-extrabold tracking-tight text-foreground"
        style={{ fontSize: size * 0.66, letterSpacing: "-0.02em" }}
      >
        Reelio
      </span>
    </span>
  );
}

export default ReelioLogo;
