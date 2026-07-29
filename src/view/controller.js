// First-person controller with pointer lock.
//
// The comfort decisions are carried verbatim from filtration-walk (which took them from
// tokamak-walk, which took them from containment-walk, which took them from Clockwork):
// no head bob, no FOV kick, no camera roll, damping so movement reads as weight rather
// than input lag, pitch clamped short of vertical. Settled; not relitigated per build.
//
// TWO REAL DIFFERENCES from the filtration channel clamp:
//
// 1. THE BOX HAS A MEANINGFUL Y. A treatment gallery is 4 m tall and you may as well be
//    pinned to the floor. This wake is a Gaussian volume ~300 m tall whose centreline
//    sinks from 90 m toward 48 m as it travels; standing on the ground samples only its
//    underside. So the clamp is a full 3-D box and R/F move you through it vertically.
//    That is not a flying camera for its own sake — the payoff of the tilt control is
//    the wake compressing AROUND you, and you have to be able to get inside it.
//
// 2. THE SCALE IS ABSURD. The walk is 1764 m end to end. At the filtration walk's
//    4.2 m/s that is seven minutes in a straight line. Shift is therefore a large
//    multiplier rather than a jog, and the HUD prints the resulting speed in m/s at all
//    times, because "scale compromises are always stated on screen" is the line's rule
//    and a silent 12x would be the walk lying about how far you have gone.

import * as THREE from 'three';
import { BOUNDS, SPAWN, toWorldZ, toXOverD } from './scene-frame.js';

const WALK_SPEED = 6.0; // m/s — a brisk walk, honest at conversational scale
export const RUN_MULT = 12.0; // 72 m/s; crosses the full 1764 m in ~25 s
const DAMPING = 9;
const VERTICAL_MULT = 0.85; // rising is slightly slower than walking, so it reads as effort

export class FirstPersonController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;
    this.locked = false;

    this.yaw = 0;
    this.pitch = SPAWN.pitch ?? 0;
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.sensitivity = 0.0022;

    this.timeInMotion = 0;

    // Downstream progress, in rotor diameters. `furthestXD` is the deepest into the
    // wake the player has reached, so pacing back upstream does not un-count it.
    // `enteredBand` / `leftBand` are the two pedagogy signals: crossing into the
    // calibrated 7-12 D band and walking back out of it past 12 D.
    this.furthestXD = toXOverD(SPAWN.z);
    this.inBand = false;
    this.reachedFar = false;

    this.placeAt(SPAWN);

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onLockChange = this._onLockChange.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() { this.dom.requestPointerLock?.(); }

  /**
   * Place the camera at a viewpoint. Headings are relative to the flow for the same
   * reason as filtration-walk: every meaningful direction out here is "downstream" or
   * "back at the turbine", and an x/z facing vector drifts while "face downstream"
   * does not.
   */
  placeAt(vp) {
    const z = vp.z ?? (vp.xOverD !== undefined ? toWorldZ(vp.xOverD) : SPAWN.z);
    const x = vp.x ?? vp.y ?? 0;
    const y = vp.height ?? BOUNDS.eyeHeight;
    this.camera.position.set(x, y, z);
    // yaw 0 looks down -Z (back upstream at the rotor). facingDeg 0 means downstream
    // (+Z), so the base heading is PI plus the requested offset.
    this.yaw = Math.PI + ((vp.facingDeg ?? 0) * Math.PI) / 180;
    this.pitch = vp.pitch ?? 0;
    this._applyRotation();
    this.furthestXD = Math.max(this.furthestXD, toXOverD(z));
  }

  _onLockChange() {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.dom;
    if (!this.locked) this.keys.clear();
    // Only report a RELEASE if we actually held the lock — a browser that denies
    // pointer lock fires this with locked=false, and treating that as Escape traps
    // the player in a pause overlay they can never dismiss.
    this.onLockChange?.(this.locked, was === true);
  }

  _onMouseMove(e) {
    if (!this.locked || !this.enabled) return;
    this.yaw -= e.movementX * this.sensitivity;
    this.pitch -= e.movementY * this.sensitivity;
    // Symmetric and generous: the rotor is 90 m overhead at the start and the wake
    // centreline is above you for the whole walk, so looking up is the common case.
    this.pitch = Math.max(-1.25, Math.min(1.32, this.pitch));
    this._applyRotation();
  }

  _applyRotation() {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  _onKeyDown(e) {
    this.keys.add(e.code);
    this.onKey?.(e);
  }

  _onKeyUp(e) { this.keys.delete(e.code); }

  update(dt) {
    if (!this.enabled) return;

    const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
                  - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
                 - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const climb = (this.keys.has('KeyR') ? 1 : 0) - (this.keys.has('KeyF') ? 1 : 0);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const speed = WALK_SPEED * (running ? RUN_MULT : 1);
    const dir = new THREE.Vector3();
    if (forward || strafe) {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      dir.addScaledVector(fwd, forward).addScaledVector(right, strafe).normalize();
    }

    const target = dir.multiplyScalar(speed);
    target.y = climb * speed * VERTICAL_MULT;
    this.velocity.lerp(target, Math.min(1, DAMPING * dt));

    const p = this.camera.position;
    p.addScaledVector(this.velocity, dt);

    // Box clamp in all three axes. Push back to the wall along whichever axis was
    // exceeded so sliding along a boundary keeps sliding rather than sticking.
    if (p.x < BOUNDS.minX) { p.x = BOUNDS.minX; this.velocity.x = 0; }
    else if (p.x > BOUNDS.maxX) { p.x = BOUNDS.maxX; this.velocity.x = 0; }
    if (p.z < BOUNDS.minZ) { p.z = BOUNDS.minZ; this.velocity.z = 0; }
    else if (p.z > BOUNDS.maxZ) { p.z = BOUNDS.maxZ; this.velocity.z = 0; }
    if (p.y < BOUNDS.minY) { p.y = BOUNDS.minY; this.velocity.y = 0; }
    else if (p.y > BOUNDS.maxY) { p.y = BOUNDS.maxY; this.velocity.y = 0; }

    this._trackProgress(p);
    if (this.speed > 0.5) this.timeInMotion += dt;
  }

  /** Track furthest downstream and the two band crossings. */
  _trackProgress(p) {
    const xd = toXOverD(p.z);
    if (xd > this.furthestXD) this.furthestXD = xd;

    const nowInBand = xd >= 7.0 && xd <= 12.0;
    if (nowInBand !== this.inBand) {
      this.inBand = nowInBand;
      this.onBandChange?.(nowInBand, xd);
    }

    if (!this.reachedFar && xd >= 12.0) {
      this.reachedFar = true;
      this.onReachedFar?.();
    }
  }

  /** Ground speed, m/s. Excludes climb so the HUD reads as travel, not elevator. */
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  /** Current speed setting in m/s, for the on-screen scale statement. */
  get speedSetting() {
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return WALK_SPEED * (running ? RUN_MULT : 1);
  }

  get z() { return this.camera.position.z; }
  get xOverD() { return toXOverD(this.camera.position.z); }
  get height() { return this.camera.position.y; }
  get lateral() { return this.camera.position.x; }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
