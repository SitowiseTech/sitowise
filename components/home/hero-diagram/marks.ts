import {LANES, STRIDE} from "@/components/home/hero-diagram/constants";
import {cubicAt, sampleT, type Layout} from "@/components/home/hero-diagram/geometry";
import {rgba, type Palette} from "@/components/home/hero-diagram/palette";

/**
 * The drawn parts of the diagram: connectors, the bracket gathering each
 * column, the node matrices, the lattice around the hook and the hook itself.
 * The matrices and the hook mark are also called each frame, because a lit
 * output is repainted over its own glow.
 */
/**
 * One connector: a hairline carrying a run of dots, trimmed at both ends by a
 * distance in pixels so it stops clear of the marker it leaves and of the
 * lattice it arrives at.
 */
export function paintPath(
  context: CanvasRenderingContext2D,
  palette: Palette,
  path: Float32Array,
  map: Float32Array,
  length: number,
  lane: number,
  scale: number,
  trimStart: number,
  trimEnd: number,
): void {
  const i = lane * STRIDE;
  const x0 = path[i];
  const y0 = path[i + 1];
  const c0x = path[i + 2];
  const c0y = path[i + 3];
  const c1x = path[i + 4];
  const c1y = path[i + 5];
  const x1 = path[i + 6];
  const y1 = path[i + 7];

  const from = Math.min(0.45, trimStart / length);
  const to = Math.max(0.55, 1 - trimEnd / length);

  context.strokeStyle = rgba(palette.ink, 0.22);
  context.lineWidth = 0.7 * scale;
  context.lineCap = "round";
  context.beginPath();
  let started = false;
  const outline = 26;
  for (let step = 0; step <= outline; step += 1) {
    const s = from + ((to - from) * step) / outline;
    const t = sampleT(map, lane, s);
    const x = cubicAt(x0, c0x, c1x, x1, t);
    const y = cubicAt(y0, c0y, c1y, y1, t);
    if (started) context.lineTo(x, y);
    else {
      context.moveTo(x, y);
      started = true;
    }
  }
  context.stroke();

  // Stepped in arc length, so the gap between dots is constant along the whole
  // curve instead of clumping where the curve flattens.
  const gap = 5.8 * scale;
  const steps = Math.max(4, Math.round(((to - from) * length) / gap));
  context.fillStyle = rgba(palette.muted, 0.78);
  for (let step = 0; step <= steps; step += 1) {
    const s = from + ((to - from) * step) / steps;
    const t = sampleT(map, lane, s);
    context.beginPath();
    context.arc(
      cubicAt(x0, c0x, c1x, x1, t),
      cubicAt(y0, c0y, c1y, y1, t),
      0.8 * scale,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

/**
 * The bracket gathering one column. It bows towards the hook between the end
 * markers, which puts every marker outside it and makes the column read as one
 * boundary rather than four loose points.
 */
export function paintBracket(
  context: CanvasRenderingContext2D,
  palette: Palette,
  x: number,
  ys: Float32Array,
  direction: number,
  scale: number,
): void {
  const top = ys[0];
  const bottom = ys[LANES - 1];
  const span = bottom - top;
  const endX = x + direction * 24 * scale;
  // x at t=0.5 is 0.25*end + 0.75*control, solved for a midpoint 14px nearer.
  const controlX = x + direction * 5.33 * scale;

  context.strokeStyle = rgba(palette.ink, 0.34);
  context.lineWidth = 0.85 * scale;
  context.lineCap = "round";

/**
 * The drawn parts of the diagram: connectors, the bracket gathering each
 * column, the node matrices, the lattice around the hook and the hook itself.
 * The matrices and the hook mark are also called each frame, because a lit
 * output is repainted over its own glow.
 */
  context.beginPath();
  context.moveTo(endX, top);
  context.bezierCurveTo(controlX, top + span * 0.3, controlX, bottom - span * 0.3, endX, bottom);
  context.stroke();
}

/**
 * Node marker: a three by three matrix of squares, the reference build's motif.
 * Drawn from scratch on every lit frame, so it takes its colour as a string the
 * caller already holds.
 */
export function paintMatrix(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  alpha: number,
): void {
  const square = 1.9 * scale;
  const pitch = 3.9 * scale;
  const origin = -pitch;
  context.fillStyle = color;
  context.globalAlpha = alpha;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      context.fillRect(
        x + origin + column * pitch - square / 2,
        y + origin + row * pitch - square / 2,
        square,
        square,
      );
    }
  }
  context.globalAlpha = 1;
}

/**
 * The lattice the hook sits in: a diamond of dots that thins towards its edge,
 * where the connector paths stop. Static, like everything else here.
 */
export function paintLattice(
  context: CanvasRenderingContext2D,
  palette: Palette,
  layout: Layout,
): void {
  const {hookX, hookY, fieldA, fieldB, scale} = layout;
  const pitch = 6.2 * scale;
  const columns = Math.round(fieldA / pitch);
  const rows = Math.round(fieldB / pitch);
  // Hollow centre, sized to the hook mark rather than to the field, so the void
  // stays tight around it at every diagram size.
  const hollow = 13 * scale;

  for (let row = -rows; row <= rows; row += 1) {
    // Stagger alternate rows: a square grid reads as a screen, a staggered one
    // reads as a field. Half-pitch columns keep each staggered row symmetric
    // about the hook, which a plain offset would not.
    const stagger = row % 2 !== 0;
    const last = stagger ? columns - 1 : columns;
    for (let column = -columns; column <= last; column += 1) {
      const dx = (column + (stagger ? 0.5 : 0)) * pitch;
      const dy = row * pitch;
      const edge = Math.abs(dx) / fieldA + Math.abs(dy) / fieldB;
      if (edge > 1) continue;
      if (dx * dx + dy * dy < hollow * hollow) continue;
      context.fillStyle = rgba(palette.ink, 0.4 + (1 - edge) * 0.52);
      context.beginPath();
      context.arc(hookX + dx, hookY + dy, 0.95 * scale, 0, Math.PI * 2);
      context.fill();
    }
  }
}

/** The hook itself: an orange lozenge on a paper halo, punched out of the wash. */
export function paintHookMark(
  context: CanvasRenderingContext2D,
  palette: Palette,
  layout: Layout,
  lift: number,
): void {
  const {hookX, hookY, scale} = layout;
  context.fillStyle = palette.paperStr;
  context.globalAlpha = 0.82;
  context.beginPath();
  context.arc(hookX, hookY, 8.5 * scale, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  const r = (5.6 + lift * 0.8) * scale;
  context.fillStyle = palette.orangeStr;
  context.beginPath();
  context.moveTo(hookX, hookY - r);
  context.lineTo(hookX + r * 1.18, hookY);
  context.lineTo(hookX, hookY + r);
  context.lineTo(hookX - r * 1.18, hookY);
  context.closePath();
  context.fill();
}
