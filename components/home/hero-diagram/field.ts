import {LANES} from "@/components/home/hero-diagram/constants";
import {mulberry32} from "@/components/home/hero-diagram/geometry";

/**
 * The particle field. State lives in parallel typed arrays and particles are
 * recycled in place, so stepping the field allocates nothing.
 */
export type Field = {
  count: number;
  t: Float32Array;
  speed: Float32Array;
  lane: Uint8Array;
  exit: Uint8Array;
  drift: Float32Array;
  outGlow: Float32Array;
  hookGlow: Float32Array;
  random: () => number;
};

function seedParticle(field: Field, index: number, spread: boolean): void {
  const random = field.random;
  field.lane[index] = Math.floor(random() * LANES);
  field.exit[index] = Math.floor(random() * LANES);
  field.speed[index] = 0.2 + random() * 0.16;
  field.drift[index] = (random() - 0.5) * 3.4;
  if (spread) field.t[index] = random();
}

export function createField(count: number): Field {
  const field: Field = {
    count,
    t: new Float32Array(count),
    speed: new Float32Array(count),
    lane: new Uint8Array(count),
    exit: new Uint8Array(count),
    drift: new Float32Array(count),
    outGlow: new Float32Array(LANES),
    hookGlow: new Float32Array(1),
    random: mulberry32(4663),
  };
  for (let index = 0; index < count; index += 1) seedParticle(field, index, true);
  return field;
}

export function stepField(field: Field, dt: number): void {
  for (let index = 0; index < field.count; index += 1) {
    const previous = field.t[index];
    let t = previous + field.speed[index] * dt;
    // Crossing the centre is what brightens the hook: the pulse is caused by
    // flow, it is not a timer.
    if (previous < 0.5 && t >= 0.5) {
      field.hookGlow[0] = Math.min(1, field.hookGlow[0] + 0.2);
    }
    if (t >= 1) {
      const exit = field.exit[index];
      field.outGlow[exit] = Math.min(1, field.outGlow[exit] + 0.8);
      t -= 1;
      seedParticle(field, index, false);
    }
    field.t[index] = t;
  }

  const decay = dt * 3.4;
  for (let lane = 0; lane < LANES; lane += 1) {
    const value = field.outGlow[lane] - decay;
    field.outGlow[lane] = value > 0 ? value : 0;
  }
  const hook = field.hookGlow[0] - dt * 2.8;
  field.hookGlow[0] = hook > 0 ? hook : 0;
}
