// BEACON — deck.gl semantic palette (E8·T-345/T-346). deck.gl consumes RGBA NUMBER tuples, not CSS tokens
// or hex strings — so this is the one place map colors live, as named semantic constants (NO raw hex).
// Color is never the sole signal (T-346): shapes/labels/badges carry meaning too; these hues only reinforce.
import type { LayerId } from '../../_lib/types.js';

export type RGBA = readonly [number, number, number, number];

/** One reinforcing hue per toggle group. Meaning is ALSO carried by shape/label/legend (never color-alone). */
export const COLOR_BY_GROUP: Record<LayerId, RGBA> = {
  fire: [214, 69, 45, 210], // ember
  flood: [45, 120, 214, 200], // water
  // storm: bright cyan — the coolest, highest-chroma hue left in the set, so it separates from cell's muted
  // teal [70,170,160] by BOTH lightness and chroma under a deuteranopia/protanopia simulation (the red-green
  // axis, where this palette's collisions live, does not carry it at all). Per this file's invariant, hue only
  // reinforces: the storm layer's three sub-kinds are told apart by GEOMETRY (track = line, cone/surge =
  // polygons) and by their per-datum text labels + caveats — never by colour, and never by three colours.
  storm: [0, 200, 220, 215],
  floodzone: [45, 120, 214, 90], // regulatory zone (translucent water)
  infra: [120, 130, 150, 210], // slate
  weather: [160, 200, 235, 210], // wind (sky)
  cameras: [168, 85, 247, 220], // live cameras (violet — distinct from outage's magenta-violet)
  outage: [180, 90, 200, 190], // outage violet
  cell: [70, 170, 160, 190], // teal
  exposure: [230, 160, 40, 210], // amber
  reports: [225, 200, 60, 220], // unverified yellow
  prediction: [200, 90, 120, 150], // projection (translucent)
  route: [60, 200, 120, 230], // egress green
  shelters: [90, 150, 230, 230], // shelter blue
};

/** Neutral label color for text layers (shelter capacity numerics, etc.). */
export const LABEL_COLOR: RGBA = [235, 238, 245, 255];
