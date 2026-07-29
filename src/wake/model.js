// The tilted-turbine wake, in METRES and SI. This is the file the tokamak build called
// "the product": the renderer is a delivery mechanism for the numbers in here.
//
// SOURCE — everything below is transcribed from a single published paper:
//
//   J. Cutler, C. Bay, and A. Ning, "Introduction to and comparison of deep learning
//   and optimization approaches to analytical wake modeling of a tilted wind turbine",
//   Wind Energy Science 11, 37-49, 2026.  https://doi.org/10.5194/wes-11-37-2026
//   (Copernicus, CC BY 4.0. Cutler and Ning: BYU Mechanical Engineering. Bay: NREL.)
//
// Equation numbers in the comments below are that paper's. The coefficients in
// DEFLECTION_C / DEFLECTION_D are its Eqs. (6) and (7) verbatim; the wake-growth and
// initial-width fits are its Figs. 9, 10, 12 and 14.
//
// This walk is NOT a simulator. It evaluates a published analytical model at the exact
// inflow conditions that model was calibrated at, and renders the result. There is no
// CFD here, no solver, no time stepping of a flow field. Anything the paper did not
// publish is marked `inferred: true` and renders behind an APPROX tag — those are the
// first things a domain reader should check.
//
// COORDINATES. The paper works in (x downstream, y lateral, z up-from-ground) with the
// hub at z_h. Three.js wants (x right, y up, z toward camera). The mapping used
// everywhere in this project is:
//
//     paper x (downstream)  ->  world +Z      paper y (lateral)  ->  world +X
//     paper z (height)      ->  world +Y
//
// so world +Z is downstream and you walk the arrow, same convention as filtration-walk.
// Functions in THIS file speak the PAPER's frame. Conversion happens at the view edge.

/** NREL 5 MW reference turbine, as simulated in SOWFA for the paper (Sect. 2.1). */
export const TURBINE = {
  name: 'NREL 5 MW reference',
  D: 126.0, // rotor diameter, m
  hubHeight: 90.0, // z_h, m
  CT: 0.8, // coefficient of thrust
  // Rotor speed is NOT given in the paper. 9.1 rpm is the NREL 5 MW's approximate
  // speed at this inflow; it affects only how fast the blades spin on screen and
  // nothing in the wake model.
  rpm: 9.1,
  rpmInferred: true,
};

/** Inflow the model was calibrated at (Sect. 2.1). Every number here is published. */
export const INFLOW = {
  U: 8.0, // m/s, hub-height wind speed
  TI: 0.08, // turbulence intensity
  shear: 0.15, // power-law shear exponent
  // Veer (alpha, = b10 in the paper's optimization) is fitted but its value is not
  // printed. Zero is the no-veer case and makes the horizontal term of Eq. (3)
  // independent of x, which is the honest default when the number is unavailable.
  veerRad: 0.0,
  veerInferred: true,
};

/**
 * The five tilt angles the paper actually analyzed (Eq. 16).
 *
 * The tilt control snaps to exactly these and nothing between. That is deliberate: at
 * any other angle the calibration is an interpolation the authors did not publish, and
 * a walk whose whole pitch is "grounded in a real paper" should never be showing a
 * state the paper does not contain. It is also forced by the arithmetic — the
 * locally-optimized sigma_z0 fit is 0.168 - 0.014*ln(gamma - 0.0419), which is
 * undefined at or below gamma = 0.0419 rad = 2.4 deg. There is no zero-tilt state.
 */
export const TILT_STOPS_DEG = [2.5, 5.0, 7.5, 10.0, 12.5];

/**
 * Downstream extent the calibration covers (Eq. 17): x/D = 7 through 12.
 *
 * You can walk outside it. When you do the HUD says so, because a model quoted beyond
 * where it was fit is the single most common way a demo like this tells a lie.
 */
export const CALIBRATED_XD = { min: 7.0, max: 12.0 };

/**
 * How far the walk extends, in rotor diameters. Runs past the calibrated band on both
 * sides so that walking OUT of the model's validity is something you can do with your
 * feet — 14 D is 1764 m.
 */
export const WALK_XD = { min: 0.0, max: 14.0 };

/**
 * Hard ceiling on tilt from the paper's own limitations discussion (Sect. 2.1.2): past
 * roughly 15 deg the wake forms a kidney-bean shape that a single Gaussian cannot
 * describe at all, and the optimization in Sect. 3.2.1 suggests the real limit is
 * nearer 10 deg. Kept here so a future edit that adds a 20 deg stop trips a test.
 */
export const TILT_LIMIT_DEG = 15.0;

const DEG = Math.PI / 180;

/**
 * Vertical deflection surrogate, Eq. (4), coefficients c1..c8 from Eq. (6).
 * Horizontal deflection surrogate, Eq. (5), coefficients d1..d7 from Eq. (7).
 *
 * gamma is in RADIANS in both. The paper plots tilt in degrees and states the
 * radians convention in prose only (Sect. 3.1) — feeding degrees in here produces a
 * plausible-looking wake that is wrong by a factor of ~57, which is exactly the kind
 * of silent error the tests below exist to catch.
 */
const DEFLECTION_C = [2.0921, -7.9725, -0.0854, 0.0041, -0.3663, 0.9701, 0.0045, 0.2840];
const DEFLECTION_D = [-1.7558, 2.4323, -0.0125, 0.3187, -0.3131, -0.0081, 0.0212];

/**
 * The two published calibrations of the modified Bastankhah model.
 *
 * The paper fits the model twice and reports both, so the walk carries both and lets
 * you switch between them (K). That switch IS the paper's contribution, made into
 * something you can see with your body rather than read off a chart:
 *
 *  - `local` fits the observed wake growth and deflection directly (Figs. 9, 10).
 *  - `optimized` re-fits the same coefficients to minimize RMS error against the
 *    SOWFA velocity field (Figs. 12, 14) — about 17% better overall, 10-20% better
 *    between 2.5 and 10 deg, but about 5% WORSE past 10 deg (Sect. 3.2.1).
 *
 * All four functions take gamma in radians.
 */
export const CALIBRATIONS = {
  local: {
    id: 'local',
    label: 'Locally optimized',
    short: 'local fit',
    note: 'Fit directly to observed wake growth and deflection (Figs. 9-10).',
    ky: (g) => 0.048 * g + 0.018,
    kz: (g) => -0.563 * g * g + 0.108 * g + 0.027,
    sigmaY0: () => 0.266,
    sigmaZ0: (g) => 0.168 - 0.014 * Math.log(g - 0.0419),
  },
  optimized: {
    id: 'optimized',
    label: 'Additional optimization',
    short: 'RMS-optimized',
    note: 'Re-fit to minimize velocity-field RMS error (Figs. 12, 14). ~17% better overall; ~5% worse past 10 deg.',
    ky: (g) => 0.038 * g + 0.019,
    kz: (g) => 0.106 * g * g - 0.046 * g + 0.03,
    sigmaY0: () => 0.255,
    sigmaZ0: (g) => 0.15 - 0.057 * Math.log(g + 0.212),
  },
};

export const CALIBRATION_IDS = Object.keys(CALIBRATIONS);

/** Vertical deflection of the wake centre, in metres. Eq. (4). Negative = downward. */
export function deflectionZ(tiltDeg, xOverD) {
  const g = tiltDeg * DEG;
  const [c1, c2, c3, c4, c5, c6, c7, c8] = DEFLECTION_C;
  const dOverD =
    c1 * g +
    c2 * g * g +
    c3 * xOverD +
    c4 * xOverD * xOverD +
    c5 * xOverD * g +
    c6 * g * g * xOverD +
    c7 * xOverD * xOverD * g +
    c8;
  return dOverD * TURBINE.D;
}

/** Lateral deflection of the wake centre, in metres. Eq. (5). */
export function deflectionY(tiltDeg, xOverD) {
  const g = tiltDeg * DEG;
  const [d1, d2, d3, d4, d5, d6, d7] = DEFLECTION_D;
  const dOverD =
    d1 * g +
    d2 * g * g +
    d3 * xOverD +
    d4 * xOverD * g +
    d5 * g * g * xOverD +
    d6 * xOverD * xOverD * g +
    d7;
  return dOverD * TURBINE.D;
}

/**
 * Wake half-widths at a downstream station, in metres. Eqs. (1) and (2).
 *
 * x_0 (the potential-core length) is not published, so it is taken as 0 and the
 * downstream term is x/D directly. This is the single largest unpublished assumption
 * in the whole file: it makes the far-wake slightly wider and its centre deficit
 * slightly weaker than the SOWFA figures. Flagged in the HUD, and the reason the
 * deficit readout is labelled "model" and never "measured".
 */
export function sigmas(tiltDeg, xOverD, calibrationId = 'local') {
  const cal = CALIBRATIONS[calibrationId];
  if (!cal) throw new Error(`Unknown calibration: ${calibrationId}`);
  const g = tiltDeg * DEG;
  return {
    y: (cal.ky(g) * xOverD + cal.sigmaY0(g)) * TURBINE.D,
    z: (cal.kz(g) * xOverD + cal.sigmaZ0(g)) * TURBINE.D,
  };
}

/**
 * Peak (centreline) velocity deficit at a downstream station — the leading amplitude
 * term of Eq. (3), factored out.
 *
 * It lives on its own because the renderer needs it: the wake volume is drawn as one
 * Gaussian blob per station, and the GPU is given this amplitude plus the two sigmas
 * rather than being taught the wake model. Keeping the physics in exactly one
 * implementation is the point — a GLSL copy of Eq. (3) would be a second source of
 * truth that no test can reach.
 */
export function peakDeficit(tiltDeg, xOverD, calibrationId = 'local') {
  const s = sigmas(tiltDeg, xOverD, calibrationId);
  if (s.y <= 0 || s.z <= 0) return 0;
  const g = tiltDeg * DEG;
  const ratio = (TURBINE.CT * Math.cos(g)) / (8 * (s.y * s.z) / (TURBINE.D * TURBINE.D));
  return 1 - Math.sqrt(Math.max(0, 1 - ratio));
}

/**
 * Normalized streamwise velocity deficit at a point, Eq. (3).
 *
 * Arguments are in the PAPER's frame and in metres: x downstream from the rotor plane,
 * y lateral from the tower centreline, z height above ground. Returns dU/U_inf in
 * 0..1 — multiply by INFLOW.U for m/s.
 *
 * The radicand is clamped at zero. Near the rotor the Gaussian widths are small enough
 * that C_T*cos(gamma) / (8*sigma_y*sigma_z/D^2) exceeds 1 and the square root goes
 * imaginary — that is the far-wake model being evaluated in the near wake, where it was
 * never meant to apply. Clamping saturates the deficit there instead of producing NaN,
 * and `withinCalibration()` is what actually tells the viewer not to trust it.
 */
export function deficit(x, y, z, tiltDeg, calibrationId = 'local') {
  const xOverD = x / TURBINE.D;
  const s = sigmas(tiltDeg, xOverD, calibrationId);

  if (s.y <= 0 || s.z <= 0) return 0;

  const amplitude = peakDeficit(tiltDeg, xOverD, calibrationId);
  const dy = deflectionY(tiltDeg, xOverD);
  const dz = deflectionZ(tiltDeg, xOverD);

  const lateral = (y + dy + x * Math.tan(INFLOW.veerRad)) / s.y;
  const vertical = (z - TURBINE.hubHeight - dz) / s.z;

  return amplitude * Math.exp(-0.5 * lateral * lateral) * Math.exp(-0.5 * vertical * vertical);
}

/** Streamwise wind speed at a point, m/s. Freestream minus the modelled deficit. */
export function windSpeed(x, y, z, tiltDeg, calibrationId = 'local') {
  return INFLOW.U * (1 - deficit(x, y, z, tiltDeg, calibrationId));
}

/** Height of the wake centreline above ground at a station, m. */
export function wakeCentreHeight(tiltDeg, xOverD) {
  return TURBINE.hubHeight + deflectionZ(tiltDeg, xOverD);
}

/** Is this downstream station inside the band the paper calibrated? (Eq. 17) */
export function withinCalibration(xOverD) {
  return xOverD >= CALIBRATED_XD.min && xOverD <= CALIBRATED_XD.max;
}

/**
 * The honesty line, GENERATED from the constants above rather than typed.
 *
 * deep-time-walk shipped a title card reading "vertical scale compressed 3x" for a full
 * production deploy after the vertical scale had already gone to 1:1. The fix was not
 * correcting the number, it was removing the ability to type one: a hand-written number
 * describing a constant will always eventually rot. Every figure in this sentence comes
 * from INFLOW and CALIBRATED_XD, and a test asserts it still names them.
 */
export const INTEGRITY =
  `Not a simulation. This evaluates a published analytical wake model at the one inflow ` +
  `condition it was calibrated at (${INFLOW.U.toFixed(1)} m/s, turbulence intensity ` +
  `${INFLOW.TI}) and draws the result. The model was fit between ${CALIBRATED_XD.min} and ` +
  `${CALIBRATED_XD.max} rotor diameters downstream; outside that band the HUD tells you it ` +
  `is extrapolating.`;

/** Named viewpoints for `?at=`. Positions are (xOverD, lateral m, height m). */
export const VIEWPOINTS = {
  // Matches SPAWN: off the centreline, turned back at the machine. See the note on
  // SPAWN in view/scene-frame.js for why this is not on the centreline facing forward.
  base: { xOverD: 0.35, y: 90, height: 1.7, facingDeg: -116, pitch: 0.42 },
  near: { xOverD: 3.0, y: 0, height: 1.7, facingDeg: 0, pitch: 0.14 },
  entry: { xOverD: CALIBRATED_XD.min, y: 0, height: 1.7, facingDeg: 0, pitch: 0.05 },
  core: { xOverD: 9.5, y: 0, height: 60, facingDeg: 0, pitch: 0.0 },
  // Facing ACROSS the flow, standing ON the wake boundary. Two separate reasons this
  // viewpoint is placed exactly here and not further out:
  //
  //   1. A streak seen end-on is a point no matter how it is drawn, so the speed
  //      contrast only reads in profile.
  //   2. The streak field is a box that follows the player. Stand 190 m out — which is
  //      where this viewpoint was first put — and the wake core is outside that box
  //      entirely, so every streak on screen is freestream and there is no contrast to
  //      see. Roughly 1.6 sigma_y puts the core well inside the box while still leaving
  //      undisturbed air on the near side of you.
  //
  // Height 57 m is the wake centreline at this station and tilt (90 m hub + a 33 m
  // sink), so the eye is level with the strongest part of the deficit.
  profile: { xOverD: 9.5, y: 100, height: 57, facingDeg: -90, pitch: 0.0 },
  hub: { xOverD: 9.5, y: 0, height: TURBINE.hubHeight, facingDeg: 0, pitch: 0.0 },
  far: { xOverD: CALIBRATED_XD.max, y: 0, height: 45, facingDeg: 0, pitch: 0.0 },
  lookback: { xOverD: 13.0, y: 0, height: 50, facingDeg: 180, pitch: 0.06 },
};
