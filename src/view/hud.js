// The HUD.
//
// Two jobs, and the second one is the reason this file is longer than it looks like it
// should be.
//
// Job one is the readout: where you are, how fast the air is moving past you, what the
// rotor is doing. Job two is HONESTY PLUMBING. This product's entire claim is that it
// is a specific published model rather than a pretty animation, and that claim is only
// worth anything if the screen says, continuously and without being asked:
//
//   - which of the paper's two calibrations is currently drawn,
//   - whether you are inside the 7-12 D band that calibration was fit over,
//   - that the deficit number is MODEL output and not a measurement,
//   - what the movement speed multiplier currently is.
//
// The band warning is the important one. Quoting a model outside its fitted domain
// without saying so is the single most common way a demo like this tells a lie, and it
// is invisible to everyone in the room who is not the author.

import { CALIBRATIONS, CALIBRATED_XD, INFLOW, TURBINE } from '../wake/model.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      chip: $('state-chip'),
      chipLabel: $('state-label'),
      chipAction: $('state-action'),
      chipDetail: $('state-detail'),
      readout: $('readout'),
      dist: $('r-dist'),
      elev: $('r-elev'),
      speed: $('r-speed'),
      deficit: $('r-deficit'),
      tilt: $('r-tilt'),
      calib: $('r-calib'),
      band: $('band'),
      prompt: $('prompt'),
      hint: $('hint'),
    };
    this._promptTimer = null;
  }

  /** Reveal-state chip. The single most important control, so it is a real button. */
  setRevealState(on) {
    this.el.chip.dataset.state = on ? 'revealed' : 'hidden';
    this.el.chipLabel.textContent = on ? 'Wake visible' : 'Open air';
    this.el.chipAction.textContent = on ? 'hide' : 'reveal wake';
    this.el.chipDetail.textContent = on
      ? 'Modelled velocity deficit, drawn. The air itself is transparent.'
      : 'The wake is here either way. You just cannot see it.';
  }

  update({ xOverD, height, lateral, speed, deficit, tiltDeg, calibrationId, speedSetting }) {
    const metres = xOverD * TURBINE.D;
    this.el.dist.textContent = `${metres.toFixed(0)} m · ${xOverD.toFixed(2)} D`;
    this.el.elev.textContent = `${height.toFixed(0)} m${Math.abs(lateral) > 2 ? ` · ${lateral > 0 ? '+' : ''}${lateral.toFixed(0)} m lat` : ''}`;

    const pct = (1 - speed / INFLOW.U) * 100;
    this.el.speed.textContent = `${speed.toFixed(2)} m/s`;
    this.el.deficit.textContent = `−${(deficit * INFLOW.U).toFixed(2)} m/s (${pct.toFixed(1)}%)`;

    this.el.tilt.textContent = `${tiltDeg.toFixed(1)}°`;
    this.el.calib.textContent = CALIBRATIONS[calibrationId].short;

    const inBand = xOverD >= CALIBRATED_XD.min && xOverD <= CALIBRATED_XD.max;
    this.el.band.dataset.state = inBand ? 'in' : 'out';
    this.el.band.textContent = inBand
      ? `within calibration · ${CALIBRATED_XD.min}–${CALIBRATED_XD.max} D`
      : `EXTRAPOLATING · fit only over ${CALIBRATED_XD.min}–${CALIBRATED_XD.max} D`;

    this.el.hint.textContent =
      `${speedSetting.toFixed(0)} m/s${speedSetting > 10 ? ' (Shift)' : ''}  ·  `
      + `R/F change height  ·  T tilt  ·  K calibration  ·  Space reveal  ·  P free cursor`;
  }

  /** Transient centre-screen line. Used for band crossings and control changes. */
  say(text, ms = 3200) {
    this.el.prompt.textContent = text;
    this.el.prompt.classList.add('visible');
    clearTimeout(this._promptTimer);
    this._promptTimer = setTimeout(() => {
      this.el.prompt.classList.remove('visible');
    }, ms);
  }
}
