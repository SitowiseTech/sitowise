import {gaussianPair, mulberry32, type Layout} from "@/components/home/hero-diagram/geometry";
import {rgba, type Palette} from "@/components/home/hero-diagram/palette";

/**
 * The spectral core behind the hook: five gaussian stipple clouds, warm above
 * and cool below. Painted once into the cached layer, never per frame.
 */
type Cloud = {
  wash: number;
  /** Offsets from the hook, in fractions of width and height. */
  dx: number;
  dy: number;
  rx: number;
  ry: number;
  count: number;
  alpha: number;
};

/**
 * A spectral core sitting on the hook, warm above and cool below.
 *
 * It is wide and shallow rather than a tall column: the flow through this
 * diagram is horizontal, and a vertical smear behind a horizontal fan reads as
 * dirt on the page. Kept just larger than the lattice so it kindles the centre
 * without reaching the labels.
 */
const CLOUDS: Cloud[] = [
  {wash: 0, dx: 0.002, dy: -0.084, rx: 0.075, ry: 0.05, count: 900, alpha: 0.28},
  {wash: 1, dx: 0.02, dy: -0.032, rx: 0.075, ry: 0.05, count: 900, alpha: 0.25},
  {wash: 2, dx: 0.008, dy: 0.016, rx: 0.084, ry: 0.056, count: 1150, alpha: 0.31},
  {wash: 3, dx: -0.014, dy: 0.066, rx: 0.07, ry: 0.045, count: 760, alpha: 0.24},
  {wash: 4, dx: 0.008, dy: 0.106, rx: 0.056, ry: 0.036, count: 560, alpha: 0.28},
];

export function paintWash(
  context: CanvasRenderingContext2D,
  palette: Palette,
  layout: Layout,
): void {
  const {width, height, hookX, hookY} = layout;
  context.save();
  // Multiply lets overlapping clouds deepen instead of stacking into mud. On a
  // transparent backdrop the first cloud comes through as itself, which is what
  // the reference build relies on too.
  context.globalCompositeOperation = "multiply";

/**
 * The spectral core behind the hook: five gaussian stipple clouds, warm above
 * and cool below. Painted once into the cached layer, never per frame.
 */
  for (const cloud of CLOUDS) {
    const color = palette.washes[cloud.wash];
    const x = hookX + cloud.dx * width;
    const y = hookY + cloud.dy * height;
    context.save();
    context.translate(x, y);
    context.scale(cloud.rx * width, cloud.ry * height);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, rgba(color, cloud.alpha * 0.5));
    gradient.addColorStop(0.45, rgba(color, cloud.alpha * 0.3));
    gradient.addColorStop(1, rgba(color, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  const random = mulberry32(7331);
  const pair: [number, number] = [0, 0];
  const density = Math.max(0.7, Math.min(1.35, width / 520));

  for (const cloud of CLOUDS) {
    const color = palette.washes[cloud.wash];
    const originX = hookX + cloud.dx * width;
    const originY = hookY + cloud.dy * height;
    const count = Math.round(cloud.count * density);
    for (let index = 0; index < count; index += 1) {
      gaussianPair(random, pair);
      const spread = Math.sqrt(pair[0] * pair[0] + pair[1] * pair[1]);
      if (spread > 2.7) continue;
      const x = originX + pair[0] * cloud.rx * width;
      const y = originY + pair[1] * cloud.ry * height;
      if (x < -2 || x > width + 2 || y < -2 || y > height + 2) continue;
      const edge = Math.max(0, 1 - spread / 2.7);
      const alpha = cloud.alpha * (0.26 + edge * 0.74) * (0.7 + random() * 0.5);
      const radius = 0.54 * (0.62 + random() * 0.9);
      context.fillStyle = rgba(color, alpha);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.restore();
}
