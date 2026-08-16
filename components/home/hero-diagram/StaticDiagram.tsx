import {HOOK_LABEL, INPUTS, OUTPUTS} from "@/components/home/hero-diagram/constants";

/** Geometry mirrors buildLayout at a 560 by 460 box. */
const FALLBACK_IN_Y = [55, 172, 288, 405];
const FALLBACK_OUT_Y = [78, 179, 281, 382];
const FALLBACK_LEFT = 118;
const FALLBACK_RIGHT = 442;
const FALLBACK_HOOK_X = 280;
const FALLBACK_HOOK_Y = 230;

function FallbackMatrix({x, y}: {x: number; y: number}) {
  const cells = [];
  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      cells.push(
        <rect key={`${row}:${column}`} x={x + column * 4 - 1} y={y + row * 4 - 1} width="2" height="2" />,
      );
    }
  }
  return <>{cells}</>;
}

/**
 * Canvas-less rendering: same composition, no field and no motion. Dashes stand
 * in for the stipple, which is the one thing SVG cannot afford.
 */
export function StaticDiagram() {
  return (
    <svg
      viewBox="0 0 560 460"
      className="block h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="1 6"
      >
        {FALLBACK_IN_Y.map((y) => (
          <path key={`in-${y}`} d={`M128,${y} C186,${y} 186,${FALLBACK_HOOK_Y} 232,${FALLBACK_HOOK_Y}`} />
        ))}
        {FALLBACK_OUT_Y.map((y) => (
          <path key={`out-${y}`} d={`M328,${FALLBACK_HOOK_Y} C374,${FALLBACK_HOOK_Y} 374,${y} 432,${y}`} />
        ))}
      </g>

      <g fill="none" stroke="var(--ink)" strokeWidth="0.85" strokeLinecap="round" opacity="0.34">
        <path d="M136,55 C124,140 124,320 136,405" />
        <path d="M424,78 C436,155 436,305 424,382" />
      </g>

      <g fill="var(--ink)" opacity="0.86">
        {FALLBACK_IN_Y.map((y) => (
          <FallbackMatrix key={`inm-${y}`} x={FALLBACK_LEFT} y={y} />
        ))}
        {FALLBACK_OUT_Y.map((y) => (
          <FallbackMatrix key={`outm-${y}`} x={FALLBACK_RIGHT} y={y} />
        ))}
      </g>

      <path
        d={`M${FALLBACK_HOOK_X},${FALLBACK_HOOK_Y - 46} L${FALLBACK_HOOK_X + 48},${FALLBACK_HOOK_Y} L${FALLBACK_HOOK_X},${FALLBACK_HOOK_Y + 46} L${FALLBACK_HOOK_X - 48},${FALLBACK_HOOK_Y} Z`}
        fill="none"
        stroke="var(--line-dark)"
        strokeWidth="1"
      />
      <path
        d={`M${FALLBACK_HOOK_X},${FALLBACK_HOOK_Y - 6} L${FALLBACK_HOOK_X + 7},${FALLBACK_HOOK_Y} L${FALLBACK_HOOK_X},${FALLBACK_HOOK_Y + 6} L${FALLBACK_HOOK_X - 7},${FALLBACK_HOOK_Y} Z`}
        fill="var(--orange)"
      />

      <rect
        x={FALLBACK_HOOK_X - 58}
        y={FALLBACK_HOOK_Y - 79}
        width="116"
        height="26"
        rx="3"
        fill="var(--paper-bright)"
        stroke="var(--line)"
      />

      <g fontSize="12" fontFamily="var(--mono)" letterSpacing="0.08em" fill="var(--faint)">
        {INPUTS.map((label, index) => (
          <text
            key={label}
            x={FALLBACK_LEFT - 16}
            y={FALLBACK_IN_Y[index]}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label.toUpperCase()}
          </text>
        ))}
        {OUTPUTS.map((label, index) => (
          <text
            key={label}
            x={FALLBACK_RIGHT + 16}
            y={FALLBACK_OUT_Y[index]}
            dominantBaseline="middle"
          >
            {label.toUpperCase()}
          </text>
        ))}
        <text
          x={FALLBACK_HOOK_X}
          y={FALLBACK_HOOK_Y - 66}
          textAnchor="middle"
          fill="var(--ink)"
        >
          {HOOK_LABEL.toUpperCase()}
        </text>
      </g>
    </svg>
  );
}
