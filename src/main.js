// Wiring. Scene, loop, controls, and the two ramps.
//
// Two things ramp rather than snap, both for reasons the earlier walks paid for:
//
//   REVEAL (Space). The wake fades in over ~0.9 s. A hard cut on a full-screen additive
//   volume is a flash, and the photosensitivity restraint across this line is absolute:
//   no strobe, smooth ramps, prefers-reduced-motion freezes what is left.
//
//   TILT (T). The rotor and the whole wake ease to the next stop over ~1.5 s, the same
//   ignition-ramp constant the jet and rocket walks used. This one is not only comfort:
//   the entire payoff of the control is watching the wake compress vertically and
//   spread horizontally AROUND you, and a jump cut between two shapes shows you two
//   pictures instead of one transformation.
//
// Tilt is interpolated for DISPLAY between stops, but the stops themselves are the five
// angles the paper analyzed and the HUD only ever settles on one of them. Mid-ramp the
// walk is briefly showing an interpolated state, which is why the ramp is short and why
// the readout shows the target angle.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import {
  TILT_STOPS_DEG, CALIBRATION_IDS, CALIBRATIONS, CALIBRATED_XD, VIEWPOINTS, INFLOW,
  INTEGRITY,
} from './wake/model.js';
import { SPAWN, CEILING, WALK_LENGTH, toWorldZ } from './view/scene-frame.js';
import { FirstPersonController } from './view/controller.js';
import { WakeVolume } from './view/wake.js';
import { FlowField } from './view/flow.js';
import { Turbine } from './view/turbine.js';
import { buildGround } from './view/ground.js';
import { Hud } from './view/hud.js';
import { startSession, record, flush } from './telemetry.js';

const REVEAL_SECONDS = 0.9;
const TILT_RAMP_SECONDS = 1.5;

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const card = overlay.querySelector('.card');
const enterBtn = document.getElementById('enter');

// The honesty line is GENERATED from the constants in model.js and injected here, never
// typed into the markup. deep-time-walk shipped a false scale claim for a full deploy
// because a number describing a constant was hand-written in the title card; the fix is
// structural — there is no place in index.html where that sentence could rot.
document.getElementById('integrity').textContent = INTEGRITY;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b12);
// Fog set well past the far marker so 14 D is still visible from the rotor plane —
// the walk's closing beat is turning around at 13 D and seeing the turbine as a speck,
// which needs the whole length to stay in view.
scene.fog = new THREE.Fog(0x070b12, WALK_LENGTH * 0.45, WALK_LENGTH * 2.1);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, WALK_LENGTH * 3);

// The turbine is the only solid object in the scene and it has to read as a machine
// from every angle the walk allows, including from downstream looking back. A single
// key light left it silhouetted against its own wake from half the viewpoints, so:
// strong sky ambient, a key from upstream, and a fill from the opposite side.
scene.add(new THREE.HemisphereLight(0x9fc0ff, 0x121a26, 1.7));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.9);
sun.position.set(520, 780, -520);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9db8e8, 0.75);
fill.position.set(-480, 340, 620);
scene.add(fill);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Strength kept low on purpose. The wake is additive and already accumulates; a strong
// bloom on top turned the axial view into a featureless white disc.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.8, 0.8);
composer.addPass(bloom);

const turbine = new Turbine(scene);
const wake = new WakeVolume(scene);
// A custom ShaderMaterial does not pick up scene.fog on its own.
wake.useFog(scene.fog);
const flow = new FlowField(scene);
buildGround(scene);

const controller = new FirstPersonController(camera, canvas);
const hud = new Hud();

// --- State ------------------------------------------------------------------

let tiltIndex = TILT_STOPS_DEG.indexOf(7.5);
let tiltShown = TILT_STOPS_DEG[tiltIndex];
let tiltTarget = tiltShown;
let calibrationIndex = 0;

let revealTarget = 0;
let revealNow = 0;
let started = false;
let photoMode = false;

wake.setTilt(tiltShown);
flow.setTilt(tiltShown);
turbine.setTilt(tiltShown);

// Deep-link: ?at=core etc.
const at = new URLSearchParams(location.search).get('at');
if (at && VIEWPOINTS[at]) controller.placeAt(VIEWPOINTS[at]);

// --- Controls ---------------------------------------------------------------

function setReveal(on) {
  revealTarget = on ? 1 : 0;
  hud.setRevealState(on);
  record(on ? 'reveal_on' : 'reveal_off', { pos: camera.position });
  hud.say(on
    ? 'The wake was always here. Now you can see it.'
    : 'Still there. Just invisible again.');
}

function stepTilt(dir) {
  const next = Math.min(TILT_STOPS_DEG.length - 1, Math.max(0, tiltIndex + dir));
  if (next === tiltIndex) return;
  tiltIndex = next;
  tiltTarget = TILT_STOPS_DEG[tiltIndex];
  record('tilt', { target: String(tiltTarget), pos: camera.position });
  hud.say(`Rotor tilt ${tiltTarget.toFixed(1)}° — one of the five angles the paper analyzed`);
}

function cycleCalibration() {
  calibrationIndex = (calibrationIndex + 1) % CALIBRATION_IDS.length;
  const id = CALIBRATION_IDS[calibrationIndex];
  wake.setCalibration(id);
  flow.setCalibration(id);
  record('calibration', { target: id, pos: camera.position });
  hud.say(`${CALIBRATIONS[id].label} — ${CALIBRATIONS[id].note}`, 5200);
}

function togglePhotoMode() {
  // Carried from the whole line: P frees the cursor for screenshots WITHOUT returning
  // to the entry overlay. Escape was explicitly rejected — it minimised the browser and
  // re-showed the explainer.
  photoMode = !photoMode;
  if (photoMode) document.exitPointerLock?.();
  else controller.requestLock();
}

controller.onKey = (e) => {
  if (!started) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); setReveal(revealTarget < 0.5); break;
    case 'KeyT': stepTilt(e.shiftKey ? -1 : 1); break;
    case 'KeyG': stepTilt(-1); break;
    case 'KeyK': cycleCalibration(); break;
    case 'KeyP': togglePhotoMode(); break;
    default: break;
  }
};

controller.onLockChange = (locked, hadLock) => {
  controller.enabled = locked;
  if (locked) {
    overlay.classList.add('hidden');
    photoMode = false;
  } else if (hadLock && !photoMode) {
    // A genuine Escape: show the pause card, not the first-run explainer.
    card.classList.add('paused');
    overlay.classList.remove('hidden');
  }
};

controller.onBandChange = (inBand, xd) => {
  if (inBand) {
    hud.say(`${CALIBRATED_XD.min} D — inside the band this model was fit over`);
    record('band_enter', { pos: camera.position });
  } else if (xd > CALIBRATED_XD.max) {
    hud.say('Past 12 D — the model is extrapolating from here');
    record('band_exit', { pos: camera.position });
  }
};

controller.onReachedFar = () => {
  record('reached_far', { pos: camera.position });
  hud.say('1512 m downstream. The wake is still here. Turn around.', 6000);
};

document.getElementById('state-chip').addEventListener('click', (e) => {
  e.stopPropagation();
  setReveal(revealTarget < 0.5);
  if (!photoMode) controller.requestLock();
});

enterBtn.addEventListener('click', () => {
  started = true;
  card.classList.remove('paused');
  controller.requestLock();
  if (!controller._sessionStarted) {
    controller._sessionStarted = true;
    startSession();
    record('enter', { pos: camera.position });
  }
});

function syncViewport() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  // The streak ribbons hold a constant SCREEN width, so they have to be told how tall
  // the viewport is in device pixels — otherwise they are correct at one window size
  // and either invisible or plank-wide at every other.
  flow.resize(camera, renderer.getDrawingBufferSize(new THREE.Vector2()).y);
}
addEventListener('resize', syncViewport);
syncViewport();

addEventListener('pagehide', flush);

// --- Loop -------------------------------------------------------------------

hud.setRevealState(false);

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  controller.update(dt);
  turbine.update(dt);

  // Reveal ramp.
  if (revealNow !== revealTarget) {
    const rate = reduceMotion ? 1 : dt / REVEAL_SECONDS;
    revealNow += Math.sign(revealTarget - revealNow) * Math.min(rate, Math.abs(revealTarget - revealNow));
    wake.setReveal(revealNow);
  }

  // Tilt ramp. Rebuilding the wake geometry every frame during a ramp is 64 quads of
  // attribute writes — cheap, and it is what makes the reshaping continuous rather
  // than a cut between two shapes.
  if (Math.abs(tiltShown - tiltTarget) > 1e-4) {
    const rate = reduceMotion ? 1 : dt / TILT_RAMP_SECONDS;
    const span = TILT_STOPS_DEG[TILT_STOPS_DEG.length - 1] - TILT_STOPS_DEG[0];
    const stepSize = Math.max(Math.abs(rate * span), 1e-4);
    const delta = tiltTarget - tiltShown;
    tiltShown += Math.sign(delta) * Math.min(stepSize, Math.abs(delta));
    turbine.setTilt(tiltShown);
    wake.setTilt(tiltShown);
    flow.setTilt(tiltShown);
  }

  flow.update(dt, camera.position);

  const p = camera.position;
  hud.update({
    xOverD: controller.xOverD,
    height: p.y,
    lateral: p.x,
    speed: flow.speedAt(p.x, p.y, p.z),
    deficit: flow.deficitAt(p.x, p.y, p.z),
    tiltDeg: tiltTarget,
    calibrationId: CALIBRATION_IDS[calibrationIndex],
    speedSetting: controller.speedSetting,
  });

  composer.render();
}

frame();

// Local-mode inspection handle, mirroring the rest of the line.
globalThis.__wake = {
  get position() { return camera.position.clone(); },
  get xOverD() { return controller.xOverD; },
  get tilt() { return tiltTarget; },
  get calibration() { return CALIBRATION_IDS[calibrationIndex]; },
  speedAt: (x, y, z) => flow.speedAt(x, y, z),
  freestream: INFLOW.U,
  // Accepts a named viewpoint or a raw {xOverD, y, height, facingDeg, pitch} literal.
  // The literal form is for reproducing a specific reported view during QA — a bug
  // screenshot carries its own coordinates in the HUD, so they can be typed straight
  // back in rather than walked to by hand.
  goto: (target) => {
    const vp = typeof target === 'string' ? VIEWPOINTS[target] : target;
    if (vp) controller.placeAt(vp);
  },
  viewpoints: Object.keys(VIEWPOINTS),
};
