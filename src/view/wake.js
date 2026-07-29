// The wake volume.
//
// Drawn as a stack of cross-stream quads perpendicular to the flow, one every ~20 m,
// each carrying a single 2-D Gaussian blob. Stack enough of them and the eye reads a
// continuous volume; walk into the stack and you are inside it.
//
// THE IMPORTANT DECISION HERE IS WHAT THE SHADER IS NOT ALLOWED TO KNOW. It would be
// natural to port Eq. (3) into GLSL and evaluate the wake per-fragment. That would
// create a second implementation of the physics — one that no test in test/model.test.js
// can reach, and that would drift from model.js the first time a coefficient changed.
// So the CPU calls model.js for sigma_y, sigma_z, the two deflections and the peak
// deficit at each station, and hands the GPU three numbers and a normalized offset.
// The shader draws a Gaussian blob. It does not know what a wind turbine is.
//
// Each quad is sized to +/-3.2 sigma rather than a fixed extent, which keeps the near
// stations small. Overdraw is the only real cost in this file and a fixed-size stack of
// 64 full-scene quads is what makes it expensive.

import * as THREE from 'three';
import {
  TURBINE, sigmas, deflectionY, deflectionZ, peakDeficit, withinCalibration,
} from '../wake/model.js';
import { WALK_XD } from '../wake/model.js';

const STATIONS = 64;
const EXTENT = 3.2; // quad half-size in standard deviations
// Per-quad opacity. Additive blending accumulates without a ceiling, and the worst case
// is looking straight down the wake AXIS from downstream: every one of the 64 quad
// centres lines up on the same view ray and the core saturates to flat white, losing
// the shape entirely. 0.26 keeps the axial view as a bright tunnel that still has
// structure while leaving the profile view legible.
const DENSITY = 0.26;

// Near-fade. Without this the walk is unusable from INSIDE the wake: you are looking
// through ~30 additive quads at once, they saturate, and a shaped volume renders as a
// flat blue wall filling the screen. Fading out the quads within NEAR_FADE metres of
// the eye leaves only the ones receding ahead of you, which is what makes the wake read
// as a TUBE you are standing in rather than fog. Standard volumetric trick, and the
// single change that made this file work.
// 110 m, not 260: the fade only has to kill the handful of quads close enough to fill
// the screen. At 260 it also erased the wake when viewed in PROFILE from outside, which
// is the one angle where its shape reads best.
const NEAR_FADE = 110;

/** Colour ramp for the deficit, echoing the blue colormap the paper's own figures use. */
const WAKE_COLOR_CORE = new THREE.Color(0x9ecbff);
const WAKE_COLOR_EDGE = new THREE.Color(0x2f5aa8);

const VERT = /* glsl */ `
  attribute vec2 aOffset;   // position within the blob, in standard deviations
  attribute float aAmp;     // peak deficit at this station, 0..1
  attribute float aFade;    // 1 inside the calibrated band, lower outside
  varying vec2 vOffset;
  varying float vAmp;
  varying float vFade;
  varying float vNear;
  uniform float uNearFade;
  void main() {
    vOffset = aOffset;
    vAmp = aAmp;
    vFade = aFade;
    vec4 world = modelMatrix * vec4(position, 1.0);
    // cameraPosition is a Three.js built-in uniform.
    vNear = smoothstep(0.0, uNearFade, distance(world.xyz, cameraPosition));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uDensity;
  uniform float uReveal;   // 0..1 master reveal, ramped so nothing pops
  varying vec2 vOffset;
  varying float vAmp;
  varying float vFade;
  varying float vNear;
  void main() {
    // The Gaussian. This is the ONLY physics the GPU does, and it is not the wake
    // model — sigma, the centre and the amplitude were all computed on the CPU.
    float g = exp(-0.5 * dot(vOffset, vOffset));
    float d = vAmp * g;
    if (d < 0.002) discard;
    vec3 col = mix(uEdge, uCore, clamp(d * 3.5, 0.0, 1.0));
    gl_FragColor = vec4(col, d * uDensity * vFade * uReveal * vNear);
  }
`;

export class WakeVolume {
  constructor(scene) {
    this.tiltDeg = 7.5;
    this.calibration = 'local';
    this.reveal = 0;

    const quads = STATIONS;
    const positions = new Float32Array(quads * 4 * 3);
    const offsets = new Float32Array(quads * 4 * 2);
    const amps = new Float32Array(quads * 4);
    const fades = new Float32Array(quads * 4);
    const indices = new Uint16Array(quads * 6);

    for (let i = 0; i < quads; i++) {
      const v = i * 4;
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
      // Corner offsets in sigma units; positions are filled by _rebuild().
      offsets.set([-EXTENT, -EXTENT, EXTENT, -EXTENT, EXTENT, EXTENT, -EXTENT, EXTENT], v * 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
    geo.setAttribute('aAmp', new THREE.BufferAttribute(amps, 1));
    geo.setAttribute('aFade', new THREE.BufferAttribute(fades, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCore: { value: WAKE_COLOR_CORE },
        uEdge: { value: WAKE_COLOR_EDGE },
        uDensity: { value: DENSITY },
        uReveal: { value: 0 },
        uNearFade: { value: NEAR_FADE },
      },
      transparent: true,
      depthWrite: false,
      // Additive is order-independent, which matters because the player walks THROUGH
      // this stack — any sorted alpha scheme would pop as they cross each quad plane.
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this._rebuild();
  }

  /** Recompute every station from model.js. Called on tilt or calibration change. */
  _rebuild() {
    const pos = this.geometry.getAttribute('position');
    const amp = this.geometry.getAttribute('aAmp');
    const fade = this.geometry.getAttribute('aFade');

    const span = WALK_XD.max - WALK_XD.min;
    for (let i = 0; i < STATIONS; i++) {
      // Start slightly downstream of the rotor plane: at x/D = 0 the far-wake model
      // has no meaning at all and a quad there would be a bright disc glued to the hub.
      const xd = WALK_XD.min + 0.35 + (span - 0.35) * (i / (STATIONS - 1));
      const s = sigmas(this.tiltDeg, xd, this.calibration);
      const centreLateral = -deflectionY(this.tiltDeg, xd);
      const centreHeight = TURBINE.hubHeight + deflectionZ(this.tiltDeg, xd);
      const a = peakDeficit(this.tiltDeg, xd, this.calibration);

      // Outside the band the model is extrapolating. It still draws — walking out of
      // validity is a thing this walk deliberately lets you do — but it dims, so the
      // HUD's "extrapolating" warning has a visual partner instead of being fine print.
      const f = withinCalibration(xd) ? 1.0 : 0.45;

      const z = xd * TURBINE.D;
      const hw = EXTENT * s.y;
      const hh = EXTENT * s.z;
      const v = i * 4;

      pos.setXYZ(v + 0, centreLateral - hw, centreHeight - hh, z);
      pos.setXYZ(v + 1, centreLateral + hw, centreHeight - hh, z);
      pos.setXYZ(v + 2, centreLateral + hw, centreHeight + hh, z);
      pos.setXYZ(v + 3, centreLateral - hw, centreHeight + hh, z);

      for (let k = 0; k < 4; k++) {
        amp.setX(v + k, a);
        fade.setX(v + k, f);
      }
    }

    pos.needsUpdate = true;
    amp.needsUpdate = true;
    fade.needsUpdate = true;
    this.geometry.computeBoundingSphere();
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
