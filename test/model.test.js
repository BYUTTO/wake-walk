// Tests for the wake model.
//
// Same pattern and same reason as filtration-walk/test/machine.test.js: the valuable
// half is not "is this geometry valid" but "does the prose still match the physics".
//
// This build has a second job the earlier walks did not. The entire pitch of the
// product is "grounded in a specific published paper", so these tests are also a
// TRANSCRIPTION CHECK: several of them reproduce values that are plotted in the
// paper's own figures, and go red if a coefficient is fat-fingered or if someone feeds
// the deflection surrogates degrees instead of radians. That last one is the dangerous
// failure — degrees produce a wake that still looks like a wake, just a wrong one.
//
// Figure references are to Cutler, Bay & Ning, Wind Energy Science 11, 37-49, 2026.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TURBINE, INFLOW, TILT_STOPS_DEG, CALIBRATED_XD, WALK_XD, TILT_LIMIT_DEG,
  CALIBRATIONS, CALIBRATION_IDS, INTEGRITY, VIEWPOINTS,
  deflectionY, deflectionZ, sigmas, deficit, windSpeed,
  wakeCentreHeight, withinCalibration,
} from '../src/wake/model.js';

const DEG = Math.PI / 180;

// --- Transcription checks against the paper's published figures --------------

test('deflection uses RADIANS, not degrees (Fig. 8, 12.5 deg at 12 D)', () => {
  // Fig. 8 (left) puts delta_z/D at roughly -0.35 for a 12.5 deg tilt at x/D = 12.
  // Feeding Eq. (4) degrees instead of radians moves this by a factor of ~57 and the
  // wake ends up kilometres underground, so this single assertion is the tripwire for
  // the most consequential unit error in the file.
  const dOverD = deflectionZ(12.5, 12.0) / TURBINE.D;
  assert.ok(dOverD > -0.36 && dOverD < -0.31,
    `delta_z/D should sit near -0.34 (Fig. 8), got ${dOverD.toFixed(4)}`);
});

test('lateral deflection at 12.5 deg / 12 D is near zero (Fig. 8, right)', () => {
  const dOverD = deflectionY(12.5, 12.0) / TURBINE.D;
  assert.ok(Math.abs(dOverD) < 0.03,
    `delta_y/D should be near 0 at 12.5 deg / 12 D, got ${dOverD.toFixed(4)}`);
});

test('k_y and k_z reproduce Fig. 9 at the extreme tilt stop', () => {
  const g = 12.5 * DEG;
  assert.ok(Math.abs(CALIBRATIONS.local.ky(g) - 0.0285) < 0.001, 'k_y off Fig. 9');
  assert.ok(Math.abs(CALIBRATIONS.local.kz(g) - 0.0238) < 0.001, 'k_z off Fig. 9');
});

test('sigma_z0 reproduces Fig. 10 across the tilt stops', () => {
  // Fig. 10 shows sigma_z0 falling from ~0.257 at 2.5 deg toward ~0.19 at 12.5 deg.
  const lo = CALIBRATIONS.local.sigmaZ0(2.5 * DEG);
  const hi = CALIBRATIONS.local.sigmaZ0(12.5 * DEG);
  assert.ok(Math.abs(lo - 0.257) < 0.005, `sigma_z0 at 2.5 deg: ${lo.toFixed(4)}`);
  assert.ok(Math.abs(hi - 0.192) < 0.005, `sigma_z0 at 12.5 deg: ${hi.toFixed(4)}`);
  assert.equal(CALIBRATIONS.local.sigmaY0(), 0.266, 'sigma_y0 is constant at 0.266 (Fig. 10)');
});

// --- The lesson: positive tilt flattens and widens the wake -----------------

test('THE LESSON — rising tilt compresses the wake vertically, both calibrations', () => {
  for (const id of CALIBRATION_IDS) {
    for (const xd of [7, 9, 12]) {
      let prev = Infinity;
      for (const tilt of TILT_STOPS_DEG) {
        const sz = sigmas(tilt, xd, id).z;
        assert.ok(sz < prev,
          `${id} @ ${xd}D: sigma_z should fall as tilt rises, but ${tilt} deg gave ${sz.toFixed(2)} m (prev ${prev.toFixed(2)})`);
        prev = sz;
      }
    }
  }
});

test('THE LESSON — rising tilt expands the wake horizontally, both calibrations', () => {
  for (const id of CALIBRATION_IDS) {
    for (const xd of [7, 9, 12]) {
      let prev = -Infinity;
      for (const tilt of TILT_STOPS_DEG) {
        const sy = sigmas(tilt, xd, id).y;
        assert.ok(sy > prev,
          `${id} @ ${xd}D: sigma_y should rise as tilt rises, but ${tilt} deg gave ${sy.toFixed(2)} m (prev ${prev.toFixed(2)})`);
        prev = sy;
      }
    }
  }
});

test('positive tilt deflects the wake DOWNWARD, more so with tilt and with distance', () => {
  for (const tilt of TILT_STOPS_DEG) {
    for (let xd = CALIBRATED_XD.min; xd <= CALIBRATED_XD.max; xd += 0.5) {
      assert.ok(deflectionZ(tilt, xd) < 0, `tilt ${tilt} @ ${xd}D deflected upward`);
    }
  }
  // Deeper tilt, lower wake — the ordering plotted in Fig. 8.
  let prev = Infinity;
  for (const tilt of TILT_STOPS_DEG) {
    const d = deflectionZ(tilt, 12.0);
    assert.ok(d < prev, `tilt ${tilt} did not deflect further down than the previous stop`);
    prev = d;
  }
  // Further downstream, lower wake.
  for (const tilt of TILT_STOPS_DEG) {
    assert.ok(deflectionZ(tilt, 12.0) < deflectionZ(tilt, 7.0),
      `tilt ${tilt}: wake should keep sinking between 7 D and 12 D`);
  }
});

test('the wake centre stays above ground everywhere in the walk', () => {
  for (const tilt of TILT_STOPS_DEG) {
    for (let xd = WALK_XD.min; xd <= WALK_XD.max; xd += 0.25) {
      const h = wakeCentreHeight(tilt, xd);
      assert.ok(h > 0, `wake centre went underground at tilt ${tilt}, ${xd}D: ${h.toFixed(1)} m`);
    }
  }
});

// --- Tilt stops: only states the paper actually contains --------------------

test('tilt stops are exactly the five angles the paper analyzed (Eq. 16)', () => {
  assert.deepEqual(TILT_STOPS_DEG, [2.5, 5.0, 7.5, 10.0, 12.5]);
});

test('every tilt stop is inside the model validity limit', () => {
  for (const t of TILT_STOPS_DEG) {
    assert.ok(t > 0 && t < TILT_LIMIT_DEG, `tilt stop ${t} is outside the ${TILT_LIMIT_DEG} deg limit`);
  }
});

test('every tilt stop is defined for BOTH calibrations — no NaN from the log fits', () => {
  // The locally-optimized sigma_z0 is 0.168 - 0.014*ln(gamma - 0.0419), undefined at or
  // below 2.4 deg. A zero-tilt stop would silently produce NaN and paint nothing.
  for (const id of CALIBRATION_IDS) {
    for (const t of TILT_STOPS_DEG) {
      const s = sigmas(t, 9.0, id);
      assert.ok(Number.isFinite(s.y) && s.y > 0, `${id} sigma_y not finite at ${t} deg`);
      assert.ok(Number.isFinite(s.z) && s.z > 0, `${id} sigma_z not finite at ${t} deg`);
    }
  }
});

// --- The deficit field ------------------------------------------------------

test('deficit is finite and in 0..1 everywhere a player can stand', () => {
  for (const id of CALIBRATION_IDS) {
    for (const tilt of TILT_STOPS_DEG) {
      for (let xd = WALK_XD.min; xd <= WALK_XD.max; xd += 0.5) {
        for (const lat of [-400, -126, 0, 126, 400]) {
          for (const h of [1.7, 45, 90, 150, 300]) {
            const d = deficit(xd * TURBINE.D, lat, h, tilt, id);
            assert.ok(Number.isFinite(d), `NaN deficit at ${id}/${tilt}deg/${xd}D/${lat}/${h}`);
            assert.ok(d >= 0 && d <= 1, `deficit out of range: ${d}`);
          }
        }
      }
    }
  }
});

test('the deficit peaks on the wake centreline and falls away from it', () => {
  const tilt = 7.5;
  const xd = 10;
  const x = xd * TURBINE.D;
  const centre = wakeCentreHeight(tilt, xd);
  const onAxis = deficit(x, -deflectionY(tilt, xd), centre, tilt);

  for (const dz of [40, 90, 160]) {
    assert.ok(deficit(x, -deflectionY(tilt, xd), centre + dz, tilt) < onAxis,
      `deficit did not fall ${dz} m above the wake centre`);
    assert.ok(deficit(x, -deflectionY(tilt, xd), centre - dz, tilt) < onAxis,
      `deficit did not fall ${dz} m below the wake centre`);
  }
  for (const dy of [80, 200, 420]) {
    assert.ok(deficit(x, -deflectionY(tilt, xd) + dy, centre, tilt) < onAxis,
      `deficit did not fall ${dy} m to the side of the wake centre`);
  }
});

test('the wake always slows the air, never speeds it up', () => {
  for (const tilt of TILT_STOPS_DEG) {
    for (let xd = WALK_XD.min; xd <= WALK_XD.max; xd += 1) {
      for (const h of [1.7, 60, 90, 140]) {
        const u = windSpeed(xd * TURBINE.D, 0, h, tilt);
        assert.ok(u <= INFLOW.U + 1e-9, `wind exceeded freestream: ${u}`);
        assert.ok(u >= 0, `negative wind speed: ${u}`);
      }
    }
  }
});

test('the wake recovers downstream — the far station is weaker than the near one', () => {
  for (const tilt of TILT_STOPS_DEG) {
    const near = deficit(7 * TURBINE.D, -deflectionY(tilt, 7), wakeCentreHeight(tilt, 7), tilt);
    const far = deficit(12 * TURBINE.D, -deflectionY(tilt, 12), wakeCentreHeight(tilt, 12), tilt);
    assert.ok(far < near, `tilt ${tilt}: wake did not weaken between 7 D and 12 D`);
  }
});

test('the wake is still clearly present at the far edge of the calibrated band', () => {
  // The 12 D payoff line depends on this: if the deficit there were negligible, the
  // walk would be claiming something it does not show.
  const tilt = 7.5;
  const d = deficit(12 * TURBINE.D, -deflectionY(tilt, 12), wakeCentreHeight(tilt, 12), tilt);
  assert.ok(d > 0.05, `wake centre deficit at 12 D is only ${(d * 100).toFixed(1)}% — too weak to be the payoff`);
});

// --- Domain of validity -----------------------------------------------------

test('the calibrated band sits strictly inside the walkable range', () => {
  assert.ok(WALK_XD.min < CALIBRATED_XD.min, 'walk must start upstream of the calibrated band');
  assert.ok(WALK_XD.max > CALIBRATED_XD.max, 'walk must extend past the calibrated band');
});

test('withinCalibration matches the paper band exactly (Eq. 17)', () => {
  assert.equal(CALIBRATED_XD.min, 7.0);
  assert.equal(CALIBRATED_XD.max, 12.0);
  assert.ok(!withinCalibration(6.99));
  assert.ok(withinCalibration(7.0));
  assert.ok(withinCalibration(9.5));
  assert.ok(withinCalibration(12.0));
  assert.ok(!withinCalibration(12.01));
});

// --- Turbine and inflow -----------------------------------------------------

test('the turbine is the NREL 5 MW as published', () => {
  assert.equal(TURBINE.D, 126.0);
  assert.equal(TURBINE.hubHeight, 90.0);
  assert.equal(TURBINE.CT, 0.8);
});

test('the rotor fits above the ground with clearance', () => {
  assert.ok(TURBINE.hubHeight - TURBINE.D / 2 > 0, 'blade tip would strike the ground');
});

test('inflow matches the calibration conditions', () => {
  assert.equal(INFLOW.U, 8.0);
  assert.equal(INFLOW.TI, 0.08);
});

test('every unpublished figure is flagged inferred', () => {
  assert.equal(TURBINE.rpmInferred, true, 'rotor speed is not in the paper and must be flagged');
  assert.equal(INFLOW.veerInferred, true, 'veer is fitted but unpublished and must be flagged');
});

// --- Copy cannot drift from data -------------------------------------------

test('the integrity line names the real inflow and the real calibrated band', () => {
  assert.ok(INTEGRITY.includes(INFLOW.U.toFixed(1)), 'integrity line lost the wind speed');
  assert.ok(INTEGRITY.includes(String(INFLOW.TI)), 'integrity line lost the turbulence intensity');
  assert.ok(INTEGRITY.includes(String(CALIBRATED_XD.min)), 'integrity line lost the near band edge');
  assert.ok(INTEGRITY.includes(String(CALIBRATED_XD.max)), 'integrity line lost the far band edge');
});

test('the integrity line refuses to call this a simulation', () => {
  assert.ok(/not a simulation/i.test(INTEGRITY));
});

// --- Calibrations and viewpoints -------------------------------------------

test('both published calibrations are present and described', () => {
  assert.deepEqual(CALIBRATION_IDS, ['local', 'optimized']);
  for (const id of CALIBRATION_IDS) {
    const c = CALIBRATIONS[id];
    assert.ok(c.label && c.note && c.short, `${id} missing display copy`);
  }
});

test('the two calibrations genuinely disagree — the K toggle has something to show', () => {
  const a = sigmas(12.5, 12, 'local');
  const b = sigmas(12.5, 12, 'optimized');
  const diff = Math.abs(a.z - b.z) / a.z;
  assert.ok(diff > 0.01, `calibrations differ by only ${(diff * 100).toFixed(2)}% — toggle is pointless`);
});

test('sigmas rejects an unknown calibration', () => {
  assert.throws(() => sigmas(7.5, 9, 'made_up'), /Unknown calibration/);
});

test('every viewpoint is inside the walk and above ground', () => {
  for (const [name, vp] of Object.entries(VIEWPOINTS)) {
    assert.ok(vp.xOverD >= WALK_XD.min && vp.xOverD <= WALK_XD.max, `${name} is outside the walk`);
    assert.ok(vp.height >= 1.7, `${name} is below eye height`);
    assert.ok(Number.isFinite(vp.facingDeg), `${name} has no facing`);
  }
});
