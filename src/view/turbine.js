// The NREL 5 MW reference turbine.
//
// Dimensions that matter to the wake model (rotor diameter, hub height) come from
// model.js and are exact. Everything else here is shape-only: it exists so that the
// first thing you do in this walk is crane your neck at a 126 m rotor and get a scale
// reference you will spend the next 1700 m using.
//
// The blade is built from spanwise stations with a real chord distribution and twist
// rather than a scaled box, for the reason the gene-walk polish pass established:
// plain primitives read as a diagram, and a diagram is the thing this product exists to
// beat. It is still cheap — 13 stations, 4 points each.
//
// TILT. The rotor assembly rotates by +gamma about the world X axis. A rotation of
// +theta about +X carries +Z toward -Y, so the rotor axis ends up pointing downstream
// AND downward; thrust on the air gains a downward component and the wake sinks. That
// is the sign convention the deflection surrogate in model.js expects — deflectionZ()
// is negative for every positive tilt, asserted in the tests.

import * as THREE from 'three';
import { TURBINE } from '../wake/model.js';

const R = TURBINE.D / 2;

/** Normalized NREL-5MW-like chord and twist distribution, root to tip. */
const BLADE_STATIONS = [
  { r: 0.02, chord: 3.4, twist: 13.3 },
  { r: 0.06, chord: 3.9, twist: 13.3 },
  { r: 0.12, chord: 4.6, twist: 13.3 },
  { r: 0.20, chord: 4.6, twist: 11.5 },
  { r: 0.30, chord: 4.2, twist: 9.0 },
  { r: 0.40, chord: 3.7, twist: 6.5 },
  { r: 0.50, chord: 3.3, twist: 4.6 },
  { r: 0.60, chord: 2.9, twist: 3.1 },
  { r: 0.70, chord: 2.5, twist: 2.0 },
  { r: 0.80, chord: 2.1, twist: 1.2 },
  { r: 0.90, chord: 1.6, twist: 0.5 },
  { r: 0.97, chord: 0.9, twist: 0.1 },
  { r: 1.00, chord: 0.2, twist: 0.0 },
];

/** Four-point section, normalized on chord: LE, upper, TE, lower. */
const SECTION = [
  [0.00, 0.000],
  [0.30, 0.085],
  [1.00, 0.005],
  [0.30, -0.055],
];

function buildBlade() {
  const stations = BLADE_STATIONS.length;
  const verts = [];
  const idx = [];

  for (const st of BLADE_STATIONS) {
    const span = st.r * R;
    const tw = (st.twist * Math.PI) / 180;
    const cos = Math.cos(tw);
    const sin = Math.sin(tw);
    for (const [cx, cy] of SECTION) {
      // Section sits in the rotor plane: chordwise along Z, thickness along X, span
      // along Y. Pitch axis at 30% chord so twist rotates about something plausible.
      const c = (cx - 0.3) * st.chord;
      const t = cy * st.chord;
      verts.push(t * cos - c * sin, span, c * cos + t * sin);
    }
  }

  for (let s = 0; s < stations - 1; s++) {
    for (let k = 0; k < SECTION.length; k++) {
      const a = s * 4 + k;
      const b = s * 4 + ((k + 1) % 4);
      const c = (s + 1) * 4 + ((k + 1) % 4);
      const d = (s + 1) * 4 + k;
      idx.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export class Turbine {
  constructor(scene) {
    this.group = new THREE.Group();

    const shell = new THREE.MeshStandardMaterial({
      color: 0xe8ecef, roughness: 0.55, metalness: 0.05,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2b3238, roughness: 0.7, metalness: 0.2,
    });

    // Tower — tapered, 90 m to the hub.
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.95, 3.2, TURBINE.hubHeight, 28, 1, true),
      shell,
    );
    tower.position.y = TURBINE.hubHeight / 2;
    this.group.add(tower);

    // Everything from here up tilts together.
    this.rotorAssembly = new THREE.Group();
    this.rotorAssembly.position.y = TURBINE.hubHeight;

    const nacelle = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.0, 16), shell);
    nacelle.position.z = 2.5;
    this.rotorAssembly.add(nacelle);

    // Spinner points upwind, which is -Z.
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(2.1, 5.0, 24), shell);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -7.2;
    this.rotorAssembly.add(spinner);

    this.hub = new THREE.Group();
    this.hub.position.z = -5.6;
    const bladeGeo = buildBlade();
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(bladeGeo, shell);
      blade.rotation.z = (i * 2 * Math.PI) / 3;
      this.hub.add(blade);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 14), dark);
    this.hub.add(cap);
    this.rotorAssembly.add(this.hub);

    this.group.add(this.rotorAssembly);
    scene.add(this.group);

    this.tiltDeg = 7.5;
    this.setTilt(this.tiltDeg);
    this.omega = (TURBINE.rpm * 2 * Math.PI) / 60;
  }

  /**
   * Set rotor tilt. Ramped by main.js rather than snapped — the photosensitivity rule
   * across this whole line is smooth ramps and no strobe, and a rotor that jumps 5
   * degrees between frames also breaks the read on the wake reshaping around you.
   */
  setTilt(deg) {
    this.tiltDeg = deg;
    this.rotorAssembly.rotation.x = (deg * Math.PI) / 180;
  }

  update(dt) {
    // Rotation direction is cosmetic; rate is TURBINE.rpm, which is flagged inferred
    // because the paper does not publish it.
    this.hub.rotation.z -= this.omega * dt;
  }
}
