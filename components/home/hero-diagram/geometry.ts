import {INPUTS, LANES, MAP_N, OUTPUTS, STRIDE} from "@/components/home/hero-diagram/constants";

/**
 * Where everything sits. The layout is measured rather than guessed: the label
 * gutters are as wide as the longest label, and each connector carries an
 * arc-length table so both the dots on it and the particles along it can be
 * spaced by distance instead of by curve parameter.
 */

/** Deterministic noise: the stipple must look identical on every render. */
export function mulberry32(seed: number): () => number {
  let state = seed;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianPair(random: () => number, out: [number, number]): void {
  const u = Math.max(random(), 1e-7);
  const v = Math.max(random(), 1e-7);
  const magnitude = Math.sqrt(-2 * Math.log(u));
  out[0] = magnitude * Math.cos(2 * Math.PI * v);
  out[1] = magnitude * Math.sin(2 * Math.PI * v);
}

/** Scalar cubic Bezier. Scalar, not vector, so the hot loop stays allocation free. */
export function cubicAt(p0: number, c0: number, c1: number, p1: number, t: number): number {
  const m = 1 - t;
  const m2 = m * m;
  const t2 = t * t;
  return m2 * m * p0 + 3 * m2 * t * c0 + 3 * m * t2 * c1 + t2 * t * p1;
}

/**
 * Invert one curve's arc length into MAP_N samples of t, and return its length.
 *
 * These curves flatten hard at both ends, so a particle stepped in uniform t
 * crawls beside the markers and bolts through the middle, and dots placed in
 * uniform t bunch the same way. Walking arc length instead costs one table per
 * curve, built once per resize. The length is what lets the paths be trimmed by
 * a distance in pixels rather than by a guessed fraction.
 */
function buildArcMap(path: Float32Array, lane: number, map: Float32Array): number {
  const i = lane * STRIDE;
  const samples = 96;
  const lengths = new Float32Array(samples + 1);
  let previousX = path[i];
  let previousY = path[i + 1];
  let total = 0;

  for (let step = 1; step <= samples; step += 1) {
    const t = step / samples;
    const x = cubicAt(path[i], path[i + 2], path[i + 4], path[i + 6], t);
    const y = cubicAt(path[i + 1], path[i + 3], path[i + 5], path[i + 7], t);
    total += Math.hypot(x - previousX, y - previousY);
    lengths[step] = total;
    previousX = x;
    previousY = y;
  }

  const base = lane * MAP_N;
  let cursor = 0;
  for (let entry = 0; entry < MAP_N; entry += 1) {
    const target = (entry / (MAP_N - 1)) * total;
    while (cursor < samples && lengths[cursor + 1] < target) cursor += 1;
    const spanStart = lengths[cursor];
    const span = lengths[cursor + 1] - spanStart;
    const within = span > 0 ? (target - spanStart) / span : 0;
    map[base + entry] = (cursor + within) / samples;
  }
  map[base + MAP_N - 1] = 1;
  return total;
}

/** Uniform-distance position `s` in 0..1 mapped back to a curve parameter. */
export function sampleT(map: Float32Array, lane: number, s: number): number {
  const scaled = s * (MAP_N - 1);
  const index = scaled < 0 ? 0 : scaled > MAP_N - 2 ? MAP_N - 2 : scaled | 0;
  const base = lane * MAP_N + index;
  return map[base] + (map[base + 1] - map[base]) * (scaled - index);
}

/* ------------------------------------------------------------------ layout */

export type Layout = {
  width: number;
  height: number;
  /** Marker and hairline sizes track the box so the diagram never looks coarse. */
  scale: number;
  hookX: number;
  hookY: number;
  leftX: number;
  rightX: number;
  /** Half width and half height of the lattice the hook sits inside. */
  fieldA: number;
  fieldB: number;
  inbound: Float32Array;
  outbound: Float32Array;
  inMap: Float32Array;
  outMap: Float32Array;
  inLen: Float32Array;
  outLen: Float32Array;
  inY: Float32Array;
  outY: Float32Array;
  font: string;
  fontSize: number;
  tracking: number;
  labelGap: number;
};

/** Advance width of `text` once per-character tracking is added. */
export function trackedWidth(
  context: CanvasRenderingContext2D,
  text: string,
  tracking: number,
): number {
  let total = 0;
  for (const character of text) total += context.measureText(character).width + tracking;
  return total - tracking;
}

export function drawTracked(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  let cursor = x;
  for (const character of text) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + tracking;
  }
}

/**
 * Gutters are measured, not guessed: the label column is exactly as wide as its
 * longest label, so nothing clips and the hook always lands in the optical
 * centre of whatever box the hero gives us.
 */
export function buildLayout(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  family: string,
): Layout {
  const fontSize = width >= 520 ? 12 : width >= 400 ? 11 : 10;
  const tracking = fontSize * 0.08;
  const font = `500 ${fontSize}px ${family}`;
  context.font = font;

  let leftLabel = 0;
  for (const label of INPUTS) {
    leftLabel = Math.max(leftLabel, trackedWidth(context, label.toUpperCase(), tracking));
  }
  let rightLabel = 0;
  for (const label of OUTPUTS) {
    rightLabel = Math.max(rightLabel, trackedWidth(context, label.toUpperCase(), tracking));
  }

  const labelGap = Math.round(fontSize * 1.3);
  const edge = Math.max(6, width * 0.018);
  let leftX = edge + leftLabel + labelGap;
  let rightX = width - edge - rightLabel - labelGap;
  // Absurdly narrow boxes would fold the fan flat; keep a minimum span and let
  // the labels run to the edge instead.
  if (rightX - leftX < width * 0.3) {
    const centre = width / 2;
    const half = Math.max(width * 0.15, 44);
    leftX = centre - half;
    rightX = centre + half;
  }

  const hookX = (leftX + rightX) / 2;
  const hookY = height * 0.5;
  const scale = Math.max(0.82, Math.min(1.3, width / 520));
  const fieldA = Math.min((rightX - hookX) * 0.44, height * 0.27);
  const fieldB = fieldA * 0.62;

  const inY = new Float32Array(LANES);
  const outY = new Float32Array(LANES);
  const inbound = new Float32Array(LANES * STRIDE);
  const outbound = new Float32Array(LANES * STRIDE);

  // Inputs fan wider than outputs, which reads as convergence into the hook.
  const inTop = height * 0.12;
  const inSpan = height * 0.76;
  const outTop = height * 0.17;
  const outSpan = height * 0.66;

  for (let lane = 0; lane < LANES; lane += 1) {
    const fraction = lane / (LANES - 1);
    inY[lane] = inTop + inSpan * fraction;
    outY[lane] = outTop + outSpan * fraction;

    // Control points leave the marker at 0.42 of the run and arrive at the hook
    // at 0.58, so the four curves flatten before they crowd the centre.
    const inRun = hookX - leftX;
    const i = lane * STRIDE;
    inbound[i] = leftX;
    inbound[i + 1] = inY[lane];
    inbound[i + 2] = leftX + inRun * 0.42;
    inbound[i + 3] = inY[lane];
    inbound[i + 4] = hookX - inRun * 0.58;
    inbound[i + 5] = hookY;
    inbound[i + 6] = hookX;
    inbound[i + 7] = hookY;

    const outRun = rightX - hookX;
    outbound[i] = hookX;
    outbound[i + 1] = hookY;
    outbound[i + 2] = hookX + outRun * 0.58;
    outbound[i + 3] = hookY;
    outbound[i + 4] = rightX - outRun * 0.42;
    outbound[i + 5] = outY[lane];
    outbound[i + 6] = rightX;
    outbound[i + 7] = outY[lane];
  }

  const inMap = new Float32Array(LANES * MAP_N);
  const outMap = new Float32Array(LANES * MAP_N);
  const inLen = new Float32Array(LANES);
  const outLen = new Float32Array(LANES);
  for (let lane = 0; lane < LANES; lane += 1) {
    inLen[lane] = buildArcMap(inbound, lane, inMap);
    outLen[lane] = buildArcMap(outbound, lane, outMap);
  }

  return {
    width,
    height,
    scale,
    hookX,
    hookY,
    leftX,
    rightX,
    fieldA,
    fieldB,
    inbound,
    outbound,
    inMap,
    outMap,
    inLen,
    outLen,
    inY,
    outY,
    font,
    fontSize,
    tracking,
    labelGap,
  };
}
