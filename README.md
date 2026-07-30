# Wake Walk

A first-person walk **inside the wake of a tilted wind turbine** — from the rotor plane
out to 14 rotor diameters (1764 m) downstream. Ninth in the BYU TTO walkthrough line,
after [containment](https://containment-walk.vercel.app),
[tokamak](https://tokamak-walk.vercel.app), [deep time](https://deep-time-walk.vercel.app),
filtration, accelerator, jet engine, rocket engine and gene.

Three.js from a CDN importmap. Plain static files. No build step, no bundler, no
dependencies.

```bash
npm run serve   # http://localhost:5183
npm test        # 28 assertions against the source paper
```

## What it is

Behind every wind turbine is a wake: a vast, shaped volume of slowed air that is still
coherent a kilometre and a half downstream, and that decides where the next turbine in a
wind farm can stand. It is completely invisible, and every explanation of it is a flat
grey cone in a textbook.

This is that cone at 1:1, with you inside it.

- **Space** reveals the wake. It was always there — the toggle is your ability to
  perceive it, not the wake's existence. (New device for the line: the earlier walks
  toggled a *machine state*; this one toggles *perception*.)
- **T** steps rotor tilt through the five angles the source paper analyzed. The wake
  compresses vertically, spreads horizontally, and sinks toward the ground around you.
- **K** switches between the paper's two published calibrations, which is the paper's
  actual contribution made into something you can see with your body.
- **R/F** change height. The wake centreline runs from 90 m down to about 48 m; standing
  on the ground only samples its underside.

## The source

Everything the wake does comes from one paper:

> J. Cutler, C. Bay, and A. Ning, "Introduction to and comparison of deep learning and
> optimization approaches to analytical wake modeling of a tilted wind turbine",
> *Wind Energy Science* **11**, 37–49, 2026.
> [doi:10.5194/wes-11-37-2026](https://doi.org/10.5194/wes-11-37-2026) · CC BY 4.0

Cutler and Ning are BYU Mechanical Engineering (FLOW Lab); Bay is at NREL.

`src/wake/model.js` is a transcription of that paper's modified Bastankhah Gaussian
model — Eqs. (1)–(3) for the wake, the deflection surrogates (4)–(5) with the
coefficients from (6)–(7), and both calibrations from Figs. 9, 10, 12 and 14. Conditions
are the paper's: NREL 5 MW reference turbine, 126.0 m rotor, 90.0 m hub, 8.0 m/s,
turbulence intensity 0.08, C_T 0.8.

**This is not a simulator.** There is no CFD, no solver, no time-stepped flow field. It
evaluates a published analytical model at the one condition that model was calibrated
at, and draws the answer.

## Honesty plumbing

The product's whole claim is "a specific published model, not a pretty animation", so
the screen says so continuously:

- The deficit readout is labelled **model output, not measurement**.
- The band strip turns **amber and reads EXTRAPOLATING** outside x/D = 7–12, which is the
  only range the paper fit. You can walk out of validity; the HUD will not let you do it
  quietly. The wake volume dims out there too.
- Tilt snaps to 2.5 / 5 / 7.5 / 10 / 12.5° — the paper's own angles (Eq. 16). No
  interpolated state the paper does not contain is ever a resting state.
- Rotor speed and veer are **not** in the paper; both are flagged `inferred` in the
  source and a test asserts the flags survive.
- The entry card's honesty sentence is **generated from the constants**, never typed.
  (deep-time-walk shipped a false scale claim for a full deploy because a number
  describing a constant was hand-written in the title card.)

## The one unpublished assumption

The potential-core length `x_0` in Eqs. (1)–(2) is not printed in the paper, so it is
taken as zero. That makes the far wake slightly wider and its centre deficit slightly
weaker than the SOWFA figures. It is the reason the deficit readout says "model" and
never "measured", and it is the first thing a domain reader should push on.

## Architecture

```
src/wake/model.js     the paper, in code. Everything else renders what this returns.
src/view/scene-frame.js  the ONLY place the paper's frame meets the world frame
src/view/wake.js      the deficit volume — raymarched against a baked station table
src/view/flow.js      the streaks. The payoff.
src/view/turbine.js   NREL 5 MW geometry, blades from a real chord/twist distribution
src/view/ground.js    grid, posts, distance markers
src/view/controller.js  first-person controller, 3-D box clamp
test/model.test.js    28 assertions, several reproducing the paper's own figures
```

**The GPU is never taught the wake model.** wake.js and flow.js both call `model.js` on
the CPU for sigma, deflection and peak deficit, then hand the shader a normalized offset
and an amplitude. A GLSL copy of Eq. (3) would be a second implementation of the physics
that no test could reach and that would drift the first time a coefficient changed.

## Things that cost real time

- **γ is in radians** in the deflection surrogates. The paper states it in prose only.
  Degrees produce a wake that still looks like a wake and is wrong by a factor of ~57.
  There is a dedicated test that reproduces Fig. 8 to catch it.
- **`THREE.LineSegments` renders nothing you can see** at this scale — WebGL clamps line
  width to one physical pixel on essentially every desktop driver. The streaks are
  camera-facing ribbons held at a constant *screen* width.
- **Looking along the flow collapses the streaks.** Every parcel travels downstream, so
  `cross(dir, toCamera)` degenerates whenever you face downstream — which is most of the
  walk. Zeroing the width there made the entire field invisible exactly when a viewer
  was looking for it.
- **A viewpoint jump stacks the whole streak field onto one plane.** `?at=` can move the
  camera 1500 m between frames; every particle then wraps at once. Any move larger than
  the box is treated as a teleport and reseeds.
- **Streak density is a two-sided constraint.** Too sparse reads as empty sky with
  specks; too dense additively saturates into a white wall you cannot see the wake
  through.
- **Billboard stacks cannot render this volume, and it took two tries to admit it.**
  v1 was 64 cross-stream quads with additive blending: additive has no ceiling, so any
  view down the wake axis put every quad centre on one ray, summed past 1, and clipped
  to a blinding white disc. Lowering the density only moved where the blowout started.
  v2 switched to back-to-front alpha, which fixed the blowout (layers converge on
  `1-(1-a)^n`) but exposed the real flaw — a cross-stream quad seen from the SIDE is
  edge-on and projects to nothing, so the wake nearly vanished in profile, the one angle
  where its shape reads best. Additive had been hiding that by summing 64 slivers.
  v3 raymarches with analytic transmittance: correct from every angle, no ordering, and
  saturation is bounded by construction rather than by tuning.
- **Absorption has a narrow usable window.** Too low and every ray integrates 1.7 km of
  wake, washing the Gaussian contrast into flat haze. Too high and every ray saturates
  within a few steps — and since the wake is a long tube the viewer stands beside,
  almost every ray hits it, so the whole screen becomes one sheet of wake colour.
- **A named viewpoint outside the movement clamp looks fine in automation and breaks for
  real users.** The controller only clamps while enabled, and it is not enabled without
  pointer lock, so a screenshot shows the intended framing while a real player gets
  yanked back to the wall on their first keypress. There is now a test for it.

## Status

Shipped as a demo; **not yet reviewed by a domain expert.** Same open gate as the rest of
the line. Here that gate matters more than usual — the point of this build is to have
something worth putting in front of the paper's own authors.

Desktop only. Pointer lock does not exist on touch.
