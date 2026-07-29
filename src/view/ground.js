// Ground, horizon, and the downstream distance markers.
//
// The ground is not decoration here, it is the instrument. The whole 12 D payoff — "the
// wake is STILL HERE, 1512 m out" — only lands if you can feel how far you have walked,
// and in an empty field with no reference a player has no idea whether they moved 40 m
// or 400. So: a grid ruled at one rotor diameter, and a numbered post at every diameter
// carrying both units, because "9 D" and "1134 m" teach different halves of the same
// fact.
//
// The 7 D and 12 D posts are called out differently from the rest. Those are the edges
// of the band the paper calibrated (Eq. 17), and walking across them is the moment the
// HUD switches between quoting a model and admitting it is extrapolating.

import * as THREE from 'three';
import { TURBINE, CALIBRATED_XD } from '../wake/model.js';
import { MARKERS, HALF_WIDTH, WALK_LENGTH } from './scene-frame.js';

const ACCENT = '#6f8cff';
const MUTED = 'rgba(190, 205, 225, 0.72)';

/**
 * Two-line marker label.
 *
 * SIZING IS THE WHOLE STORY HERE. The first version scaled sprites off the canvas
 * WIDTH, so a long caption like "12 D 1512 m CALIBRATION ENDS" came out roughly 300
 * METRES wide and swallowed three neighbouring markers. Sprites are sized off a fixed
 * world HEIGHT now, with width following the aspect ratio, so a label is always about
 * as tall as a person is at the same distance no matter what it says. The long captions
 * are gone too — the calibration band is stated in the HUD, which is where a viewer is
 * already reading state, and the posts only have to say where they are.
 */
function labelSprite(lines, { accent = false, worldHeight = 11 } = {}) {
  const FONT = 44;
  const LINE = 56;
  const pad = 18;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `600 ${FONT}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width))) + pad * 2;
  const h = LINE * lines.length + pad;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  c.font = `600 ${FONT}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  c.fillStyle = accent ? ACCENT : MUTED;
  lines.forEach((l, i) => c.fillText(l, w / 2, pad / 2 + LINE * (i + 0.5)));

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    // depthTest ON so a marker 1400 m away is correctly hidden behind nearer geometry
    // instead of floating on top of the whole scene.
    depthTest: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((w / h) * worldHeight, worldHeight, 1);
  return sprite;
}

export function buildGround(scene) {
  const group = new THREE.Group();

  // Ground plane. Deliberately dark and low-contrast: the streaks and the wake are the
  // bright things in this scene and a bright field would fight both.
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_WIDTH * 4, WALK_LENGTH * 1.4),
    new THREE.MeshStandardMaterial({ color: 0x10161d, roughness: 0.95, metalness: 0 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, 0, WALK_LENGTH / 2);
  group.add(plane);

  // Grid ruled at one rotor diameter, with a finer division inside it.
  const major = new THREE.GridHelper(WALK_LENGTH * 1.2, Math.round((WALK_LENGTH * 1.2) / TURBINE.D), 0x35507f, 0x1e2836);
  major.position.set(0, 0.05, WALK_LENGTH / 2);
  major.material.transparent = true;
  major.material.opacity = 0.5;
  group.add(major);

  const postGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x5f7594, roughness: 0.6, emissive: 0x14203a, emissiveIntensity: 0.6,
  });
  const majorMat = new THREE.MeshStandardMaterial({
    color: 0x6f8cff, roughness: 0.4, emissive: 0x3552c4, emissiveIntensity: 1.4,
  });

  for (const m of MARKERS) {
    const h = m.major ? 26 : 12;
    const post = new THREE.Mesh(postGeo, m.major ? majorMat : postMat);
    post.scale.y = h;
    post.position.set(-HALF_WIDTH * 0.62, h / 2, m.z);
    group.add(post);

    // Mirror on the far side so the ruler reads from either side of the wake.
    const mirror = post.clone();
    mirror.position.x = HALF_WIDTH * 0.62;
    group.add(mirror);

    const lines = m.major
      ? [`${m.xOverD} D`, `${m.metres} m`, m.xOverD === CALIBRATED_XD.min ? 'BAND START' : 'BAND END']
      : [`${m.xOverD} D`, `${m.metres} m`];
    const sprite = labelSprite(lines, { accent: m.major, worldHeight: m.major ? 15 : 10 });
    sprite.position.set(-HALF_WIDTH * 0.62, h + 10, m.z);
    group.add(sprite);

    const mirrorLabel = labelSprite(lines, { accent: m.major, worldHeight: m.major ? 15 : 10 });
    mirrorLabel.position.set(HALF_WIDTH * 0.62, h + 10, m.z);
    group.add(mirrorLabel);
  }

  scene.add(group);
  return group;
}
