import {
  HOOK_LABEL,
  INPUTS,
  LANES,
  OUTPUTS,
  STRIDE,
} from "@/components/home/hero-diagram/constants";
import type {Field} from "@/components/home/hero-diagram/field";
import {
  cubicAt,
  drawTracked,
  sampleT,
  trackedWidth,
  type Layout,
} from "@/components/home/hero-diagram/geometry";
import {
  paintBracket,
  paintHookMark,
  paintLattice,
  paintMatrix,
  paintPath,
} from "@/components/home/hero-diagram/marks";
import {rgba, type Palette} from "@/components/home/hero-diagram/palette";
import {paintWash} from "@/components/home/hero-diagram/wash";

/**
 * The two passes. `paintStatic` composes the cached layer; `paintFrame` blits
 * that layer and draws the live particles and glows over it sixty times a
 * second, allocating nothing.
 */

export function paintStatic(
  context: CanvasRenderingContext2D,
  palette: Palette,
  layout: Layout,
): void {
  const {width, height, scale, hookX, hookY, leftX, rightX, inY, outY, fieldA} = layout;
  context.clearRect(0, 0, width, height);
  paintWash(context, palette, layout);

  const markerTrim = 9 * scale;
  const centreTrim = fieldA + 5 * scale;
  for (let lane = 0; lane < LANES; lane += 1) {
    paintPath(
      context,
      palette,
      layout.inbound,
      layout.inMap,
      layout.inLen[lane],
      lane,
      scale,
      markerTrim,
      centreTrim,
    );
    paintPath(
      context,
      palette,
      layout.outbound,
      layout.outMap,
      layout.outLen[lane],
      lane,
      scale,
      centreTrim,
      markerTrim,
    );
  }

  paintBracket(context, palette, leftX, inY, 1, scale);
  paintBracket(context, palette, rightX, outY, -1, scale);
  paintLattice(context, palette, layout);

  for (let lane = 0; lane < LANES; lane += 1) {
    paintMatrix(context, leftX, inY[lane], scale, palette.inkStr, 0.86);
    paintMatrix(context, rightX, outY[lane], scale, palette.inkStr, 0.86);
  }

  paintHookMark(context, palette, layout, 0);

  // Labels.
  context.font = layout.font;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = palette.faintStr;
  for (let lane = 0; lane < LANES; lane += 1) {
    const label = INPUTS[lane].toUpperCase();
    const w = trackedWidth(context, label, layout.tracking);
    drawTracked(context, label, leftX - layout.labelGap - w, inY[lane], layout.tracking);
    drawTracked(
      context,
      OUTPUTS[lane].toUpperCase(),
      rightX + layout.labelGap,
      outY[lane],
      layout.tracking,
    );
  }

  // The hook is named in a boxed label above the lattice: it is the subject of
  // the diagram, so it gets a plate of its own rather than more grey type.
  const hookLabel = HOOK_LABEL.toUpperCase();
  const textWidth = trackedWidth(context, hookLabel, layout.tracking);
  const padX = 9 * scale;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = layout.fontSize + 11 * scale;
  const boxX = hookX - boxWidth / 2;
  // Tucked onto the lattice's top vertex rather than floating above it.
  const boxY = hookY - layout.fieldB - 2 * scale - boxHeight;

  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(boxX, boxY, boxWidth, boxHeight, 3);
  } else {
    context.rect(boxX, boxY, boxWidth, boxHeight);
  }
  context.fillStyle = palette.paperBrightStr;
  context.fill();
  context.strokeStyle = rgba(palette.line, 1);
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = rgba(palette.ink, 0.88);
  drawTracked(context, hookLabel, boxX + padX, boxY + boxHeight / 2, layout.tracking);
}

/**
 * One frame: blit the cached layer, then the live parts. Everything below runs
 * 60 times a second, so it holds no strings, builds no objects and calls no
 * text metrics.
 */
export function paintFrame(
  context: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  palette: Palette,
  layout: Layout,
  field: Field,
): void {
  const {width, height, scale, hookX, hookY, rightX, outY} = layout;
  context.clearRect(0, 0, width, height);
  // Dimensions are CSS pixels; the context transform already carries the DPR.
  context.drawImage(layer, 0, 0, width, height);

  const hookGlow = field.hookGlow[0];
  if (hookGlow > 0.01) {
    const radius = layout.fieldA * (0.55 + 0.35 * hookGlow);
    const gradient = context.createRadialGradient(hookX, hookY, 0, hookX, hookY, radius);
    gradient.addColorStop(0, rgba(palette.orange, 0.22 * hookGlow));
    gradient.addColorStop(1, rgba(palette.orange, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(hookX, hookY, radius, 0, Math.PI * 2);
    context.fill();
  }

  for (let lane = 0; lane < LANES; lane += 1) {
    const glow = field.outGlow[lane];
    if (glow <= 0.01) continue;
    const y = outY[lane];
    const radius = 10 * scale + 15 * scale * glow;
    const gradient = context.createRadialGradient(rightX, y, 0, rightX, y, radius);
    gradient.addColorStop(0, rgba(palette.orange, 0.36 * glow));
    gradient.addColorStop(1, rgba(palette.orange, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(rightX, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Two passes so the fill colour is set twice per frame instead of per dot.
  // Inbound flow is neutral, outbound flow is accrual, hence the accent.
  const inboundRadius = 1.4 * scale;
  const outboundRadius = 1.75 * scale;
  for (let pass = 0; pass < 2; pass += 1) {
    context.fillStyle = pass === 0 ? palette.mutedStr : palette.orangeStr;
    for (let index = 0; index < field.count; index += 1) {
      const t = field.t[index];
      const outbound = t >= 0.5;
      if ((pass === 1) !== outbound) continue;

      const s = outbound ? (t - 0.5) * 2 : t * 2;
      const path = outbound ? layout.outbound : layout.inbound;
      const map = outbound ? layout.outMap : layout.inMap;
      const lane = outbound ? field.exit[index] : field.lane[index];
      const offset = lane * STRIDE;
      // Progress is distance travelled, not curve parameter, so the dot holds a
      // steady speed the whole way instead of surging through the middle.
      const u = sampleT(map, lane, s);
      const x = cubicAt(path[offset], path[offset + 2], path[offset + 4], path[offset + 6], u);
      const y =
        cubicAt(path[offset + 1], path[offset + 3], path[offset + 5], path[offset + 7], u) +
        field.drift[index] * Math.sin(s * Math.PI) * scale;

      const fade = t < 0.06 ? t / 0.06 : 1;
      context.globalAlpha = (outbound ? 0.94 : 0.9) * fade;
      context.beginPath();
      context.arc(x, y, outbound ? outboundRadius : inboundRadius, 0, Math.PI * 2);
      context.fill();

      // Short trail, one dot, lower alpha. Cheaper than a stroked tail and it
      // gives the dot a direction.
      const trailS = s - 0.05;
      if (trailS > 0) {
        const trail = sampleT(map, lane, trailS);
        context.globalAlpha *= 0.4;
        context.beginPath();
        context.arc(
          cubicAt(path[offset], path[offset + 2], path[offset + 4], path[offset + 6], trail),
          cubicAt(
            path[offset + 1],
            path[offset + 3],
            path[offset + 5],
            path[offset + 7],
            trail,
          ) + field.drift[index] * Math.sin(trailS * Math.PI) * scale,
          inboundRadius * 0.72,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
  }
  context.globalAlpha = 1;

  // Markers and the hook go back on last: a glow is drawn behind the thing it
  // lights, never over it. A lit output crossfades from ink to accent.
  for (let lane = 0; lane < LANES; lane += 1) {
    const glow = field.outGlow[lane];
    if (glow <= 0.01) continue;
    paintMatrix(context, rightX, outY[lane], scale, palette.inkStr, 0.86);
    paintMatrix(context, rightX, outY[lane], scale, palette.orangeStr, glow);
  }
  paintHookMark(context, palette, layout, hookGlow);
}
