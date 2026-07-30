// The air itself. This file is the payoff.
//
// The wake volume in wake.js draws the SHAPE of the deficit. But a shape is what a
// diagram can already give you — the thing a diagram structurally cannot transmit is
// that the wake is SLOWER AIR, and that you can stand on its edge with fast air on one
// side of your body and slow air on the other. So: streaks.
//
// Each streak is a parcel of air, advected downstream at exactly the speed model.js says
// the air is moving at that point. Its drawn length is the distance that parcel covers
// in TRAIL_SECONDS — which makes the picture a long-exposure photograph rather than a
// stylization. Nothing about the length is exaggerated: a streak in the wake core is
// literally shorter because that air literally went less far. Brightness is layered on
// top and IS a visualisation choice; the entry card says so.
//
// WHY RIBBONS AND NOT LineSegments. The obvious implementation is THREE.LineSegments,
// and it renders nothing you can see. WebGL clamps line width to one physical pixel on
// essentially every desktop driver, and a 1 px line in a scene whose subject is 1764 m
// long disappears — at native resolution the field read as an empty sky. Each streak is
// therefore a camera-facing quad whose width is held at roughly a constant number of
// SCREEN pixels, clamped in world units at both ends so near streaks do not become
// planks and far ones do not vanish again.
//
// PERFORMANCE. windSpeed() allocates (sigmas() returns an object) and is far too heavy
// to call 14000 times a frame. The station parameters are baked into flat arrays once
// per tilt/calibration change, from model.js, and the per-particle inner loop is two
// exponentials against interpolated table entries. Same discipline as wake.js: the
// physics has exactly one implementation and this is a cache of it, not a copy.

import * as THREE from 'three';
import {
  TURBINE, INFLOW, WALK_XD, sigmas, deflectionY, deflectionZ, peakDeficit,
} from '../wake/model.js';
import { CEILING } from './scene-frame.js';

// Density is a two-sided constraint and both sides bite. Too sparse (the first attempt,
// 6000 in a box eight times this volume) and the air reads as empty space with specks.
// Too dense (14000 here) and looking ACROSS the flow puts ~20 layers of streak between
// you and the wake, they additively saturate, and the screen is a white wall through
// which no structure is visible at all. 8000 with a low per-streak opacity and a near
// fade is where the fluid reads as a fluid AND you can see through it.
const COUNT = 6000;
const BINS = 128;
const TRAIL_SECONDS = 1.2; // a streak is the distance this parcel covers in 1.2 s

// The moving box of air the streaks live in, centred on the player in all three axes.
//
// SIZED FOR DENSITY, NOT COVERAGE. The first version used a 600 x 340 x 600 m box and
// the field was invisible even once the ribbons worked — 6000 streaks in 1.2e8 cubic
// metres is one parcel every 27 m, which reads as empty sky with a few specks in it.
// Air has to look like a fluid.
//
// +/-170 m laterally is also the right number for the payoff specifically: sigma_y in
// the middle of the calibrated band is about 70 m, so the box straddles the wake edge
// and you can see fast air and slow air in the same glance. That side-by-side is the
// entire point of the streaks and it does not happen if the box only samples the core.
const BOX = { lateral: 170, depth: 170, vertical: 150 };

// Ribbon width control, in screen pixels and world-metre clamps.
const TARGET_PX = 2.4;
const MIN_WIDTH = 0.05;
const MAX_WIDTH = 2.4;

const FAST_COLOR = new THREE.Color(0xe6eefb); // freestream: bright, near-white
const SLOW_COLOR = new THREE.Color(0x2f4d86); // wake core: dim, blue

const VERT = /* glsl */ `
  attribute vec3 aEnd;
  attribute float aT;      // 0 at the head, 1 at the tail
  attribute float aSide;   // -1 / +1 across the ribbon
  attribute float aBright; // local speed as a fraction of freestream
  uniform float uWidthScale;
  uniform float uMinWidth;
  uniform float uMaxWidth;
  uniform float uNearFade;
  varying float vBright;
  varying float vT;
  varying float vNear;
  void main() {
    vec3 p = mix(position, aEnd, aT);
    vec3 seg = aEnd - position;
    float len = length(seg);
    vec3 d = len > 1e-4 ? seg / len : vec3(0.0, 0.0, 1.0);
    vec3 toCam = cameraPosition - p;
    float dist = max(length(toCam), 1e-4);
    vec3 side = cross(d, toCam / dist);
    float sl = length(side);
    // DEGENERATE CASE, AND IT IS THE COMMON ONE. Every streak points downstream, so
    // whenever the player looks along the flow — which is the default facing and most
    // of the walk — the streak is end-on to the eye and this cross product collapses.
    // The first version zeroed the width there and the entire field went invisible
    // exactly when a viewer was most likely to be looking for it. Falling back to a
    // stable perpendicular keeps an end-on streak as a small mark rather than nothing,
    // and streaks anywhere off the screen centre still read at full length.
    side = sl > 1e-3 ? side / sl : normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-3, 0.0, 0.0));
    float w = clamp(dist * uWidthScale, uMinWidth, uMaxWidth);
    vBright = aBright;
    vT = aT;
    // Same near fade as the wake volume, and for the same reason: streaks a few metres
    // from the eye are wide, bright and directly between the viewer and everything
    // worth looking at.
    vNear = smoothstep(0.0, uNearFade, dist);
    // Fade streaks seen END-ON. sl is sin(angle between the streak and the line of
    // sight), so it goes to zero when a parcel is travelling directly away from the
    // eye. Left at full opacity those streaks converge on the vanishing point and the
    // whole field reads as a hyperspace starfield — which is both ugly and completely
    // the wrong feel for 8 m/s of wind. They are dimmed rather than cut because air
    // moving away from you is still air.
    vNear *= 0.25 + 0.75 * clamp(sl, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aSide * w, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uFast;
  uniform vec3 uSlow;
  uniform float uOpacity;
  varying float vBright;
  varying float vT;
  varying float vNear;
  void main() {
    // STRETCH THE RANGE THAT ACTUALLY OCCURS. vBright is speed as a fraction of
    // freestream, and across this whole walk it only ever spans about 0.75 to 1.0 —
    // the deepest modelled deficit in the calibrated band is roughly 25%. Mapping that
    // sliver across the full colour ramp directly leaves every streak looking the same
    // and the wake invisible in a field of 8000 of them. Remapping [0.72, 1.0] onto
    // [0, 1] is what makes the wake read as a distinct region.
    //
    // This is a VISUALISATION choice and the only one in this file — the streak's
    // LENGTH stays strictly proportional to real speed, and the entry card says
    // brightness is layered on top.
    float t = clamp((vBright - 0.72) / 0.28, 0.0, 1.0);
    vec3 col = mix(uSlow, uFast, t * t);
    // Alpha follows only partly. Fading wake streaks out completely would read as "no
    // air in the wake", which is precisely the wrong lesson — the air is there, it is
    // just slower.
    float a = 0.45 + 0.55 * t;
    // Head bright, tail faded — gives the streak a direction to read.
    gl_FragColor = vec4(col, (1.0 - vT) * uOpacity * vNear * a);
  }
`;

export class FlowField {
  constructor(scene) {
    this.tiltDeg = 7.5;
    this.calibration = 'local';
    this.visible = true;

    // Particle state, in world coordinates.
    this.px = new Float32Array(COUNT);
    this.py = new Float32Array(COUNT);
    this.pz = new Float32Array(COUNT);

    // Station lookup, rebuilt whenever the wake changes.
    this.tbl = {
      sigmaY: new Float32Array(BINS),
      sigmaZ: new Float32Array(BINS),
      centreX: new Float32Array(BINS),
      centreY: new Float32Array(BINS),
      amp: new Float32Array(BINS),
    };
    this.zMin = WALK_XD.min * TURBINE.D;
    this.zMax = WALK_XD.max * TURBINE.D;
    this._bakeTable();

    const head = new Float32Array(COUNT * 4 * 3);
    const tail = new Float32Array(COUNT * 4 * 3);
    const tAttr = new Float32Array(COUNT * 4);
    const side = new Float32Array(COUNT * 4);
    const bright = new Float32Array(COUNT * 4);
    const index = new Uint32Array(COUNT * 6);

    for (let i = 0; i < COUNT; i++) {
      const v = i * 4;
      // v+0 head/-1, v+1 head/+1, v+2 tail/+1, v+3 tail/-1
      tAttr[v] = 0; tAttr[v + 1] = 0; tAttr[v + 2] = 1; tAttr[v + 3] = 1;
      side[v] = -1; side[v + 1] = 1; side[v + 2] = 1; side[v + 3] = -1;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(head, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(tail, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uFast: { value: FAST_COLOR },
        uSlow: { value: SLOW_COLOR },
        uOpacity: { value: 0.15 },
        uWidthScale: { value: 0.0008 },
        uMinWidth: { value: MIN_WIDTH },
        uMaxWidth: { value: MAX_WIDTH },
        uNearFade: { value: 45 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // Above the wake volume (renderOrder 1) so the air reads as being inside the wake
    // rather than hidden behind it.
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this._seeded = false;
    this._lastCam = new THREE.Vector3();
  }

  /**
   * Hold the ribbon at TARGET_PX screen pixels. Half-width in world units at distance
   * d is d * tan(fov/2) * TARGET_PX / (viewportHeightPx / 2). Call on resize and
   * whenever the camera's fov changes.
   */
  resize(camera, heightPx) {
    const halfFov = (camera.fov * Math.PI) / 360;
    this.material.uniforms.uWidthScale.value = (Math.tan(halfFov) * TARGET_PX) / (heightPx / 2);
  }

  /** Bake per-station wake parameters from model.js into flat arrays. */
  _bakeTable() {
    for (let i = 0; i < BINS; i++) {
      const xd = WALK_XD.min + (WALK_XD.max - WALK_XD.min) * (i / (BINS - 1));
      const s = sigmas(this.tiltDeg, xd, this.calibration);
      this.tbl.sigmaY[i] = s.y;
      this.tbl.sigmaZ[i] = s.z;
      this.tbl.centreX[i] = -deflectionY(this.tiltDeg, xd);
      this.tbl.centreY[i] = TURBINE.hubHeight + deflectionZ(this.tiltDeg, xd);
      // Upstream of about 1 D the far-wake amplitude saturates at 1 and would stop
      // every streak dead at the rotor plane. Ramp it in instead: the near wake is
      // outside this model's remit and pretending otherwise would be the lie.
      this.tbl.amp[i] = peakDeficit(this.tiltDeg, xd, this.calibration)
        * Math.min(1, Math.max(0, (xd - 0.4) / 1.6));
    }
  }

  /** Interpolated deficit at a world point. The hot path — no allocation. */
  _deficitAt(x, y, z) {
    const t = ((z - this.zMin) / (this.zMax - this.zMin)) * (BINS - 1);
    if (t <= 0 || t >= BINS - 1) return 0;
    const i = t | 0;
    const f = t - i;
    const sy = this.tbl.sigmaY[i] + (this.tbl.sigmaY[i + 1] - this.tbl.sigmaY[i]) * f;
    const sz = this.tbl.sigmaZ[i] + (this.tbl.sigmaZ[i + 1] - this.tbl.sigmaZ[i]) * f;
    const cx = this.tbl.centreX[i] + (this.tbl.centreX[i + 1] - this.tbl.centreX[i]) * f;
    const cy = this.tbl.centreY[i] + (this.tbl.centreY[i + 1] - this.tbl.centreY[i]) * f;
    const a = this.tbl.amp[i] + (this.tbl.amp[i + 1] - this.tbl.amp[i]) * f;
    if (sy <= 0 || sz <= 0) return 0;
    const u = (x - cx) / sy;
    const v = (y - cy) / sz;
    return a * Math.exp(-0.5 * (u * u + v * v));
  }

  /** Vertical band of the box, clamped so it never sinks below ground. */
  _yRange(cam) {
    const lo = Math.max(0.5, cam.y - BOX.vertical);
    const hi = Math.min(CEILING + 40, Math.max(lo + 40, cam.y + BOX.vertical));
    return { lo, span: hi - lo };
  }

  _seed(cam) {
    const { lo, span } = this._yRange(cam);
    for (let i = 0; i < COUNT; i++) {
      this.px[i] = cam.x + (Math.random() * 2 - 1) * BOX.lateral;
      this.py[i] = lo + Math.random() * span;
      this.pz[i] = cam.z + (Math.random() * 2 - 1) * BOX.depth;
    }
    this._seeded = true;
  }

  update(dt, cam) {
    if (!this.visible) return;

    // A viewpoint jump (?at=, or the named viewpoints) can move the camera 1500 m
    // between two frames. The per-particle wrap below then fires for every particle at
    // once and stacks the entire field onto a single plane at the edge of the box — it
    // renders as one bright slab hanging in space and no air anywhere else. Any move
    // bigger than the box itself is a teleport, not travel, so reseed instead.
    if (!this._seeded || this._lastCam.distanceTo(cam) > BOX.depth) this._seed(cam);
    this._lastCam.copy(cam);

    const headAttr = this.geometry.getAttribute('position');
    const tailAttr = this.geometry.getAttribute('aEnd');
    const brightAttr = this.geometry.getAttribute('aBright');
    const ha = headAttr.array;
    const ta = tailAttr.array;
    const ba = brightAttr.array;
    const step = Math.min(dt, 0.05); // clamp so a stalled tab does not teleport the air
    const { lo: yLo, span: ySpan } = this._yRange(cam);

    for (let i = 0; i < COUNT; i++) {
      let x = this.px[i];
      let y = this.py[i];
      let z = this.pz[i];

      const d = this._deficitAt(x, y, z);
      const speed = INFLOW.U * (1 - d);

      z += speed * step;

      // Recycle through the moving box. Re-randomising the cross-stream position on
      // wrap keeps the field from settling into visible lanes.
      if (z > cam.z + BOX.depth) {
        z = cam.z - BOX.depth;
        x = cam.x + (Math.random() * 2 - 1) * BOX.lateral;
        y = yLo + Math.random() * ySpan;
      } else if (z < cam.z - BOX.depth) {
        z = cam.z + BOX.depth;
        x = cam.x + (Math.random() * 2 - 1) * BOX.lateral;
        y = yLo + Math.random() * ySpan;
      }
      // Keep the box centred on the player as they strafe and climb.
      if (x > cam.x + BOX.lateral) x -= BOX.lateral * 2;
      else if (x < cam.x - BOX.lateral) x += BOX.lateral * 2;
      if (y > yLo + ySpan) y = yLo + (y - yLo - ySpan);
      else if (y < yLo) y = yLo + ySpan - (yLo - y);

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;

      // The streak: head at the parcel, tail one TRAIL_SECONDS of travel behind it.
      // Length is speed * time and nothing else, so the picture is a long exposure.
      const tailZ = z - speed * TRAIL_SECONDS;
      const frac = 1 - d;
      const v = i * 4;
      for (let k = 0; k < 4; k++) {
        const o = (v + k) * 3;
        ha[o] = x; ha[o + 1] = y; ha[o + 2] = z;
        ta[o] = x; ta[o + 1] = y; ta[o + 2] = tailZ;
        ba[v + k] = frac;
      }
    }

    headAttr.needsUpdate = true;
    tailAttr.needsUpdate = true;
    brightAttr.needsUpdate = true;
  }

  setTilt(deg) { this.tiltDeg = deg; this._bakeTable(); }
  setCalibration(id) { this.calibration = id; this._bakeTable(); }
  setVisible(v) { this.visible = v; this.mesh.visible = v; }

  /** Wind speed at a point, for the HUD. Uses the same table as the streaks. */
  speedAt(x, y, z) { return INFLOW.U * (1 - this._deficitAt(x, y, z)); }
  deficitAt(x, y, z) { return this._deficitAt(x, y, z); }
}
