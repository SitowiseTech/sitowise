import type {SVGProps} from "react";

/**
 * Inline icons. Kept in one file, on one 24-unit grid, with stroke width 1.6
 * so mixing them never reads as two icon sets. `currentColor` throughout, so
 * colour comes from the CSS variables via text utilities.
 */

type IconProps = SVGProps<SVGSVGElement> & {size?: number};

function base({size = 16, ...rest}: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
    ...rest,
  } as const;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The X mark. Solid, since the brand glyph has no stroke form. */
export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M3.5 7h17M3.5 12h17M3.5 17h17" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M4 12h15.5M13.5 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M7 17L17 7M8.5 7H17v8.5" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect {...stroke} x="9" y="9" width="11" height="11" rx="1.6" />
      <path {...stroke} d="M15.5 5.6A1.6 1.6 0 0 0 13.9 4H5.6A1.6 1.6 0 0 0 4 5.6v8.3A1.6 1.6 0 0 0 5.6 15.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle {...stroke} cx="12" cy="12" r="8.5" />
      <path {...stroke} d="M12 11v5.5M12 7.6v.1" />
    </svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path {...stroke} d="M12 3.8L21.2 19.8H2.8z" />
      <path {...stroke} d="M12 10v4.4M12 17.3v.1" />
    </svg>
  );
}

/** Indeterminate spinner. Tailwind's animate-spin drives the rotation. */
export function SpinnerIcon({size = 16, className, ...rest}: IconProps) {
  return (
    <svg
      {...base({size, ...rest})}
      className={className ? `animate-spin ${className}` : "animate-spin"}
    >
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={1.8} opacity={0.28} />
      <path
        {...stroke}
        strokeWidth={1.8}
        d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5"
      />
    </svg>
  );
}
