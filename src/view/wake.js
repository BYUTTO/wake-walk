// The wake volume, raymarched.
//
// HOW THIS GOT HERE, because the two dead ends are worth keeping:
//
//   v1 — a stack of 64 cross-stream quads, additive. Additive has no ceiling, so any
//   view down the wake AXIS put all 64 quad centres on one ray, summed past 1, and
//   clipped to a blinding white disc with no shape. Lowering the per-quad density only
//   moved where the blowout started; it cannot remove it, because the sum is unbounded
//   by construction.
//
//   v2 — the same stack, alpha-composited back-to-front. That fixed the blowout (n
//   layers converge on 1-(1-a)^n and stop) but exposed the deeper flaw: a cross-stream
//   quad viewed from the SIDE is edge-on and projects to nearly zero area, so the wake
//   almost vanished in profile — which is the one angle where its shape reads best and
//   where the tilt payoff lives. Additive had been hiding that by summing 64 slivers
//   into something visible.
//
//   v3 — this. March a ray through the volume and accumulate transmittance. Correct
//   from every angle, no ordering to get wrong, and saturation is analytic rather than
//   something to tune around: T decays multiplicatively and alpha is 1-T, which cannot
//   exceed 1 no matter how dense the wake or how long the ray.
//
// THE GPU STILL DOES NOT KNOW THE WAKE MODEL. Same rule as before and it survives the
// rewrite: the CPU calls model.js for sigma, deflection and peak deficit at each of 128
// stations and bakes them into a lookup texture. The shader interpolates that table and
// evaluates a Gaussian. It has no idea what a wind turbine is, and model.js remains the
// only implementation of the physics — the one that test/model.test.js can actually
// reach.

import * as THREE from 'three';
import {
  TURBINE, sigmas, deflectionY, deflectionZ, peakDeficit, withinCalibration,
  CALIBRATED_XD, WALK_XD,
} from '../wake/model.js';
import { HALF_WIDTH, CEILING, WALK_LENGTH } from './scene-frame.js';

const BINS = 128;
const STEPS = 80;

// Absorption coefficient, per unit deficit per metre. Sets how quickly the volume
// reaches full opacity along a ray. Unlike the old per-quad density this is a physical
// dial with a bounded outcome: raising it makes the core saturate sooner, and saturated
// means "the wake's own colour", never white.
//
// Both extremes fail and the window is narrower than it looks. Too LOW (0.010) and every
// ray integrates the full 1.7 km of wake it passes through, the Gaussian contrast washes
// out along the way, and the result is uniform haze with no boundary. Too HIGH (0.05)
// and every ray saturates within a few steps — since the wake is a 1.7 km tube and the
// viewer is beside it, almost every ray hits it eventually, so the whole screen becomes
// one flat sheet of wake colour. 0.022 is dense enough to show a surface and thin enough
// that the far side of the wake still falls off.
const ABSORB = 0.022;

const WAKE_COLOR_CORE = new THREE.Color(0xbcd8ff);
const WAKE_COLOR_EDGE = new THREE.Color(0x2f5aa8);

/**
 * How strongly a station is drawn, given how far outside the calibrated band it sits.
 *
 * An honesty control that also fixes a visual problem. The far-wake model has no
 * business in the near wake, and evaluated there it does not fail quietly — the Gaussian
 * widths collapse, the amplitude saturates, and it reports a ~60% velocity deficit at
 * 4 D that no real turbine produces. Drawn at full strength those stations were the
 * brightest thing in the scene, which is exactly backwards: the least trustworthy part
 * of the model was the most visually dominant.
 *
 * Full weight inside 7-12 D, falling to a faint 0.10 by four diameters outside it.
 */
function bandFade(xOverD) {
  if (withinCalibration(xOverD)) return 1;
  const outside = xOverD < CALIBRATED_XD.min
    ? CALIBRATED_XD.min - xOverD
    : xOverD - CALIBRATED_XD.max;
  return Math.max(0.10, 1 - outside / 4);
}

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uTable;   // row 0: sigmaY, sigmaZ, centreX, centreY | row 1: amp, fade
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform float uZMin;
  uniform float uZMax;
  uniform float uHubHeight;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uAbsorb;
  uniform float uReveal;
  uniform float uNearFade;

  varying vec3 vWorld;

  // Nearest-texel pair plus a manual lerp. Linear filtering of float textures needs
  // OES_texture_float_linear, which is not guaranteed; interpolating by hand keeps the
  // table smooth without depending on an extension.
  void fetchStation(float z, out vec2 sig, out vec2 centre, out vec2 ampFade) {
    float u = clamp((z - uZMin) / (uZMax - uZMin), 0.0, 1.0) * (${BINS}.0 - 1.0);
    float i0 = floor(u);
    float f = u - i0;
    float t0 = (i0 + 0.5) / ${BINS}.0;
    float t1 = (min(i0 + 1.0, ${BINS}.0 - 1.0) + 0.5) / ${BINS}.0;

    vec4 a0 = texture2D(uTable, vec2(t0, 0.25));
    vec4 a1 = texture2D(uTable, vec2(t1, 0.25));
    vec4 b0 = texture2D(uTable, vec2(t0, 0.75));
    vec4 b1 = texture2D(uTable, vec2(t1, 0.75));

    vec4 a = mix(a0, a1, f);
    vec4 b = mix(b0, b1, f);
    sig = a.xy;
    centre = a.zw;
    ampFade = b.xy;
  }

  float densityAt(vec3 p) {
    if (p.z < uZMin || p.z > uZMax) return 0.0;
    // No air below the ground. Depth testing is off (see the material), so without this
    // the ray keeps marching past the ground plane and paints wake over the terrain
    // from underneath.
    if (p.y < 0.0) return 0.0;
    vec2 sig, centre, ampFade;
    fetchStation(p.z, sig, centre, ampFade);
    if (sig.x <= 0.0 || sig.y <= 0.0) return 0.0;
    float dy = (p.x - centre.x) / sig.x;
    float dz = (p.y - centre.y) / sig.y;
    return ampFade.x * ampFade.y * exp(-0.5 * (dy * dy + dz * dz));
  }

  // Slab test. Gives the ray's entry and exit along the bounding box; tn < 0 when the
  // camera is already inside, which is the normal case for this walk.
  vec2 boxRange(vec3 ro, vec3 rd) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uBoxMin - ro) * inv;
    vec3 t1 = (uBoxMax - ro) * inv;
    vec3 lo = min(t0, t1);
    vec3 hi = max(t0, t1);
    return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    vec2 range = boxRange(ro, rd);
    float tn = max(range.x, 0.0);
    float tf = range.y;
    if (tf <= tn) discard;

    float stepLen = (tf - tn) / float(${STEPS});

    vec3 acc = vec3(0.0);
    float T = 1.0;

    for (int i = 0; i < ${STEPS}; i++) {
      float t = tn + (float(i) + 0.5) * stepLen;
      vec3 p = ro + rd * t;

      float d = densityAt(p);
      if (d > 0.0005) {
        // Fade out the volume immediately around the eye. Without it, standing inside
        // the wake fills the screen with the nearest few metres of fog and nothing
        // beyond it reads at all.
        float near = smoothstep(0.0, uNearFade, t);
        float a = 1.0 - exp(-d * uAbsorb * stepLen * near);
        vec3 c = mix(uEdge, uCore, clamp(d * 3.0, 0.0, 1.0));
        acc += T * a * c;
        T *= (1.0 - a);
        if (T < 0.01) break;
      }
    }

    float alpha = (1.0 - T) * uReveal;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(acc / max(1.0 - T, 1e-4), alpha);
  }
`;

export class WakeVolume {
  constructor(scene) {
    this.tiltDeg = 7.5;
    this.calibration = 'local';
    this.reveal = 0;

    this.zMin = WALK_XD.min * TURBINE.D;
    this.zMax = WALK_XD.max * TURBINE.D;

    // Lookup table. Row 0 is (sigmaY, sigmaZ, centreX, centreY); row 1 is (amp, fade).
    this.tableData = new Float32Array(BINS * 2 * 4);
    this.table = new THREE.DataTexture(this.tableData, BINS, 2, THREE.RGBAFormat, THREE.FloatType);
    this.table.minFilter = THREE.NearestFilter;
    this.table.magFilter = THREE.NearestFilter;
    this.table.wrapS = THREE.ClampToEdgeWrapping;
    this.table.wrapT = THREE.ClampToEdgeWrapping;
    this.table.needsUpdate = true;

    const boxMin = new THREE.Vector3(-HALF_WIDTH, 0, this.zMin);
    const boxMax = new THREE.Vector3(HALF_WIDTH, CEILING + 60, this.zMax);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTable: { value: this.table },
        uBoxMin: { value: boxMin },
        uBoxMax: { value: boxMax },
        uZMin: { value: this.zMin },
        uZMax: { value: this.zMax },
        uHubHeight: { value: TURBINE.hubHeight },
        uCore: { value: WAKE_COLOR_CORE },
        uEdge: { value: WAKE_COLOR_EDGE },
        uAbsorb: { value: ABSORB },
        uReveal: { value: 0 },
        // Clears the volume immediately around the eye. At 40 m, standing inside the
        // wake fogged the viewer in and nothing beyond arm's reach read; 90 m opens up
        // enough of the near field to see the wake's structure receding ahead.
        uNearFade: { value: 90 },
      },
      transparent: true,
      depthWrite: false,
      // depthTest OFF. The box's back faces sit BEHIND the ground plane, so with depth
      // testing on they are rejected wholesale and no wake is drawn anywhere the ground
      // is visible — including the air between the viewer and the ground, which is most
      // of the lower screen. The march is bounded by the y >= 0 check in densityAt()
      // instead, which is the correct place for it: there is no air underground.
      depthTest: false,
      // BackSide so the far faces are rasterized: the fragment is then guaranteed to be
      // on the far side of the volume from the eye, and the camera can be inside the box
      // without the geometry being culled away in front of it.
      side: THREE.BackSide,
    });

    const size = new THREE.Vector3().subVectors(boxMax, boxMin);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    geo.translate(
      (boxMin.x + boxMax.x) / 2,
      (boxMin.y + boxMax.y) / 2,
      (boxMin.z + boxMax.z) / 2,
    );

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Below the streaks (renderOrder 2) so the air draws inside the wake volume rather
    // than being painted over by it. Neither writes depth, so this ordering is the only
    // thing deciding which is on top.
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    this._rebuild();
  }

  /** Re-bake the station table from model.js. Called on tilt or calibration change. */
  _rebuild() {
    const d = this.tableData;
    for (let i = 0; i < BINS; i++) {
      const xd = WALK_XD.min + (WALK_XD.max - WALK_XD.min) * (i / (BINS - 1));
      const s = sigmas(this.tiltDeg, xd, this.calibration);

      // Row 0: widths and centre.
      d[i * 4 + 0] = s.y;
      d[i * 4 + 1] = s.z;
      d[i * 4 + 2] = -deflectionY(this.tiltDeg, xd);
      d[i * 4 + 3] = TURBINE.hubHeight + deflectionZ(this.tiltDeg, xd);

      // Row 1: amplitude and the out-of-band weight.
      const o = (BINS + i) * 4;
      d[o + 0] = peakDeficit(this.tiltDeg, xd, this.calibration);
      d[o + 1] = bandFade(xd);
      d[o + 2] = 0;
      d[o + 3] = 0;
    }
    this.table.needsUpdate = true;
  }

  setTilt(deg) { this.tiltDeg = deg; this._rebuild(); }
  setCalibration(id) { this.calibration = id; this._rebuild(); }

  /** Master visibility, 0..1. Ramped by main.js rather than snapped — no strobe. */
  setReveal(v) {
    this.reveal = v;
    this.material.uniforms.uReveal.value = v;
    this.mesh.visible = v > 0.001;
  }
}
