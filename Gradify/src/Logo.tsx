// Gradify mark: a rounded tile with a soft mesh gradient (the same light →
// colour blend the plugin paints) and a white "G". It is drawn from the
// user's colour, so the logo always matches the current gradient.

import { useId } from "react";
import { shade } from "./spec";

export function Logo({ color, size = 34 }: { color: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const light = shade(color, 15);
  const mid = shade(color, 35);
  const deep = shade(color, 55);

  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 36 36" aria-label="Gradify">
      <defs>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={mid} />
          <stop offset="1" stopColor={deep} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.22" cy="0.18" r="0.62">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-blob`} cx="0.85" cy="0.9" r="0.55">
          <stop offset="0" stopColor={color} stopOpacity="0.9" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill={`url(#${id}-base)`} />
      <rect width="36" height="36" rx="10" fill={`url(#${id}-blob)`} />
      <rect width="36" height="36" rx="10" fill={`url(#${id}-glow)`} />
      <rect x="0.5" y="0.5" width="35" height="35" rx="9.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" />
      {/* The G: an open ring closing into a bar towards the centre. */}
      <path
        d="M24.6 13.2A8 8 0 1 0 26 18.2H18.8"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.6" cy="9.4" r="1.6" fill="#FFFFFF" />
    </svg>
  );
}
