// The one place the paper's frame and the world frame are allowed to meet.
//
// model.js speaks the PAPER's coordinates: x downstream from the rotor plane, y lateral
// from the tower centreline, z height above ground, all in metres. Three.js wants y up.
// Rather than scatter axis swaps through six view files (which is how a sign error gets
// in and stays in), every conversion lives here:
//
//     paper x (downstream) <-> world  z
//     paper y (lateral)    <-> world  x
//     paper z (height)     <-> world  y
//
// Note the downstream axis is a straight identity, NOT a negation: world +Z is
// downstream, the same convention filtration-walk used, so "walk forward from spawn"
// means "increasing x/D" in both frames.

import { TURBINE, WALK_XD, CALIBRATED_XD } from '../wake/model.js';

export const D = TURBINE.D;

/** Downstream distance in rotor diameters -> world Z, metres. */
export function toWorldZ(xOverD) { return xOverD * D; }

/** World Z, metres -> downstream distance in rotor diameters. */
export function toXOverD(z) { return z / D; }

/** Full walk extent in metres along the downstream axis. */
export const WALK_LENGTH = toWorldZ(WALK_XD.max);

/**
 * Lateral half-extent of the walkable box. The widest modelled sigma_y is about
 * 0.61 D at the far edge of the band, so +/- 2.5 D puts the boundary at roughly four
 * standard deviations out — far enough that you can stand fully outside the wake and
 * watch it from the side, which is half of how the shape reads.
 */
export const HALF_WIDTH = 2.5 * D;

/** Ceiling of the walkable box. The wake centreline starts at 90 m and its upper
 *  flank reaches past 200 m at the widest tilt; 320 m clears all of it. */
export const CEILING = 320;

export const EYE_HEIGHT = 1.7;

/** The 3-D box clamp. */
export const BOUNDS = {
  minX: -HALF_WIDTH,
  maxX: HALF_WIDTH,
  minZ: toWorldZ(WALK_XD.min),
  maxZ: toWorldZ(WALK_XD.max),
  minY: EYE_HEIGHT,
  maxY: CEILING,
  eyeHeight: EYE_HEIGHT,
};

/**
 * Spawn: on the ground, off to one side and just downstream of the rotor plane, turned
 * BACK toward the machine and pitched up.
 *
 * The first version spawned on the centreline facing downstream, which put the turbine
 * squarely behind the camera — while the entry card told the viewer to look up at a
 * 126 m rotor. The opening beat of this walk is craning your neck at that rotor,
 * because every sense of scale for the next 1700 m is calibrated against it, so the
 * spawn has to be somewhere it is actually in frame.
 *
 * Off the centreline rather than under the tower for two reasons: the rotor reads as a
 * disc rather than an edge, and the wake's direction is legible from the start.
 * facingDeg -116 points from here back at the hub (forward = (sin f, 0, cos f)).
 */
export const SPAWN = {
  z: toWorldZ(0.35),
  x: 90,
  height: EYE_HEIGHT,
  facingDeg: -116,
  pitch: 0.42,
};

/** Downstream stations to mark on the ground, in rotor diameters. */
export const MARKERS = (() => {
  const out = [];
  for (let xd = 1; xd <= WALK_XD.max; xd++) {
    out.push({
      xOverD: xd,
      z: toWorldZ(xd),
      metres: Math.round(toWorldZ(xd)),
      major: xd === CALIBRATED_XD.min || xd === CALIBRATED_XD.max,
    });
  }
  return out;
})();
