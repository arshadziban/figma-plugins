// CardGlow mark: a small tilted glossy card, like the reference "AI Consulting"
// card, drawn from the user's colour with a white highlight and a sparkle.

import { useId } from "react";
import { shade } from "./spec";

export function Logo({ color, size = 34 }: { color: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 36 36" aria-label="CardGlow">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26262A" />
          <stop offset="1" stopColor="#1B1B1E" />
        </linearGradient>
        <linearGradient id={`${id}-card`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(color, 35)} />
          <stop offset="0.55" stopColor={color} />
          <stop offset="1" stopColor={shade(color, 68)} />
        </linearGradient>
        <radialGradient id={`${id}-hi`} cx="0.25" cy="0.15" r="0.7">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-low`} cx="0.5" cy="1" r="0.55">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill={`url(#${id}-bg)`} />
      <g transform="rotate(8 18 18)">
        <rect x="8" y="7" width="20" height="22" rx="5" fill={`url(#${id}-card)`} />
        <rect x="8" y="7" width="20" height="22" rx="5" fill={`url(#${id}-hi)`} />
        <rect x="8" y="7" width="20" height="22" rx="5" fill={`url(#${id}-low)`} />
        <rect x="8.5" y="7.5" width="19" height="21" rx="4.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" />
        <rect x="11.5" y="19" width="13" height="2.4" rx="1.2" fill="#FFFFFF" fillOpacity="0.85" />
        <rect x="11.5" y="23" width="9" height="2.4" rx="1.2" fill="#FFFFFF" fillOpacity="0.45" />
      </g>
      <path d="M27.5 4.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" fill="#FFFFFF" />
    </svg>
  );
}
