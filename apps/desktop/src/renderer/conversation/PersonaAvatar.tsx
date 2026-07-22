import type { ReactElement } from "react";
import { Cog, PackageCheck, Wrench, type LucideIcon } from "lucide-react";
import type { Persona, PersonaIconKey, PersonaMarkKey, PersonaStatus } from "./personas.ts";

const personaIcons: Record<PersonaIconKey, LucideIcon> = {
  "cog": Cog,
  "package-check": PackageCheck,
  "wrench": Wrench,
};

/**
 * Persona marks: one hand-drawn glyph per persona, white on the persona's
 * duotone tile. Stroke-based 24×24 geometry; never a letter or monogram.
 */
const PERSONA_MARKS: Record<PersonaMarkKey, ReactElement> = {
  swap: (
    <g>
      <path d="M4 8h12l-3.5-3.5" />
      <path d="M20 16H8l3.5 3.5" />
    </g>
  ),
  nib: (
    <g>
      <path d="M12 3.5 16.5 9.5 12 20.5 7.5 9.5z" />
      <path d="M12 9.5v3.8" />
      <circle cx="12" cy="15" r="0.9" fill="currentColor" stroke="none" />
    </g>
  ),
  "lens-check": (
    <g>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
      <path d="M8 10.5l1.8 1.8 3.2-3.4" />
    </g>
  ),
  seal: (
    <g>
      <path d="M12 3l6.5 2.5v5.7c0 4.3-2.7 7.2-6.5 8.8-3.8-1.6-6.5-4.5-6.5-8.8V5.5z" />
      <path d="M9.3 11.8l2 2 3.6-3.8" />
    </g>
  ),
  compass: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <path d="M15.2 8.8l-2.4 5-4.4 1.6 2.4-5z" />
    </g>
  ),
  scan: (
    <g>
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0120 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 014 18.5V16" />
      <path d="M7.5 12h9" />
    </g>
  ),
  clapper: (
    <g>
      <path d="M4.5 9.5h15v8a1.5 1.5 0 01-1.5 1.5H6a1.5 1.5 0 01-1.5-1.5z" />
      <path d="M4.5 9.5 6.2 5h13.3l-1.7 4.5" />
      <path d="M9.6 5 7.9 9.5" />
      <path d="M14.1 5l-1.7 4.5" />
    </g>
  ),
  globe: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4c2.8 2.2 4.2 4.9 4.2 8s-1.4 5.8-4.2 8c-2.8-2.2-4.2-4.9-4.2-8S9.2 6.2 12 4z" />
    </g>
  ),
  flag: (
    <g>
      <path d="M6.5 20.5v-16" />
      <path d="M6.5 4.5H18l-2.8 3.8L18 12H6.5" />
    </g>
  ),
  person: (
    <g>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M6 19.5c1-3.6 3.2-5.4 6-5.4s5 1.8 6 5.4" />
    </g>
  ),
};

export type PersonaAvatarSize = "sm" | "md" | "lg";

/**
 * Duotone persona tile with the persona's mark + status dot at the corner.
 * Hue comes only from --la-persona-* tokens via data-hue; the status dot
 * pulses in the persona hue while running (2.4s) and goes static under
 * prefers-reduced-motion (see conversation.css).
 */
export function PersonaAvatar({
  persona,
  size = "md",
  status,
}: {
  persona: Persona;
  size?: PersonaAvatarSize;
  status?: PersonaStatus | null;
}): ReactElement {
  const Icon = persona.deterministic ? personaIcons[persona.icon ?? "cog"] : null;
  return (
    <span className="persona-avatar" data-size={size} data-hue={persona.hueKey} data-deterministic={persona.deterministic || undefined}>
      <span className="persona-avatar__tile" aria-hidden="true">
        {Icon ? <Icon aria-hidden="true" /> : (
          <svg
            className="persona-avatar__mark"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {PERSONA_MARKS[persona.mark]}
          </svg>
        )}
      </span>
      {status ? <span className="persona-avatar__status" data-status={status} aria-hidden="true" /> : null}
    </span>
  );
}
