/**
 * Every colour the hero diagram draws with, read back out of the custom
 * properties on :root. Nothing here names a colour, so retuning the tokens in
 * globals.css retunes the diagram.
 */

export type Rgb = [number, number, number];

export type Palette = {
  ink: Rgb;
  muted: Rgb;
  line: Rgb;
  orange: Rgb;
  washes: Rgb[];
  inkStr: string;
  mutedStr: string;
  faintStr: string;
  orangeStr: string;
  paperStr: string;
  paperBrightStr: string;
};

function parseColor(raw: string, fallback: Rgb): Rgb {
  const value = raw.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  const parts = value.match(/-?\d+(?:\.\d+)?/g);
  if (value.startsWith("rgb") && parts && parts.length >= 3) {
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }
  return fallback;
}

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

/**
 * The wash tokens are pastels, tuned for use as flat fills. Multiplied over each
 * other at low alpha, pastels cancel into grey, so each one is pushed away from
 * white before it is stippled. The hue is the token's; only the tint is removed.
 */
function deepen(color: Rgb, amount: number): Rgb {
  return [
    Math.max(0, Math.round(255 - (255 - color[0]) * amount)),
    Math.max(0, Math.round(255 - (255 - color[1]) * amount)),
    Math.max(0, Math.round(255 - (255 - color[2]) * amount)),
  ];
}

/**
 * The diagram is on-brand only because it never names a colour: every value
 * comes back out of the custom properties declared on :root in globals.css.
 */
export function readPalette(root: Element): Palette {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: Rgb) =>
    parseColor(style.getPropertyValue(name), fallback);

  const ink = read("--ink", [17, 18, 16]);
  const muted = read("--muted", [89, 90, 84]);
  const faint = read("--faint", [144, 145, 138]);
  const line = read("--line", [226, 222, 215]);
  const orange = read("--orange", [255, 79, 20]);
  const paper = read("--paper", [252, 250, 247]);
  const paperBright = read("--paper-bright", [255, 253, 249]);

  return {
    ink,
    muted,
    line,
    orange,
    // Violet and blue start out far more saturated than the warm three, so they
    // need less of a push to sit level with them.
    washes: [
      deepen(read("--wash-orange", [255, 189, 136]), 1.7),
      deepen(read("--wash-pink", [243, 165, 209]), 1.6),
      deepen(read("--wash-violet", [136, 105, 239]), 1.15),
      deepen(read("--wash-blue", [130, 167, 247]), 1.3),
      deepen(read("--wash-lime", [216, 237, 145]), 1.5),
    ],
    inkStr: rgba(ink, 1),
    mutedStr: rgba(muted, 1),
    faintStr: rgba(faint, 1),
    orangeStr: rgba(orange, 1),
    paperStr: rgba(paper, 1),
    paperBrightStr: rgba(paperBright, 1),
  };
}
