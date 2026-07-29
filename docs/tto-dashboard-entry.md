# TTO Dashboard entries - Wake Walk

Paste-ready. ASCII only (no em-dashes or curly quotes) - they mojibake in the dashboard
form the same way they do in Outlook.

---

## Create New Project

```
Project Title: Wake Walk

Project Description: A first-person browser walkthrough of the invisible wake behind a
wind turbine, from the rotor plane out to 1764 metres downstream. Users reveal the wake,
tilt the rotor, and watch the wake compress vertically and spread horizontally around
them. The wake is a published BYU wake model evaluated at its own calibration
conditions, not an animation.

Licensing Status: Not Licensed

Project Link: https://wake-walk.vercel.app

Is Professor Assigned?: No
```

**Note on "Is Professor Assigned": No is correct today.** This is a Method C build - the
demo was built from published research first, and the disclosure conversation with
Dr. Andrew Ning (BYU Mechanical Engineering, FLOW Lab) has not happened yet. Flip this to
Yes only after that conversation.

---

## Move to Complete

```
Quick Notes: Wind energy training and wind-farm siting. The angle is that wake behaviour
is the least intuitive thing in wind energy and the thing layout money is decided on, and
every existing explanation of it is a flat diagram.

Marketing Summary: Wake Walk puts a viewer inside the wake of an NREL 5 MW wind turbine
and lets them walk it, from the rotor plane to twelve rotor diameters downstream. Air
moving at full speed streams past in long streaks; air inside the wake visibly crawls,
and the boundary between them is something you can stand on. A rotor-tilt control steps
through the five angles the underlying research analysed, and the wake flattens, widens
and sinks around the viewer in response. It is built directly on a 2026 Wind Energy
Science paper from BYU Mechanical Engineering, so every shape on screen is a published
model at its published conditions rather than an artist's impression, and the interface
says so continuously - including warning the viewer when they walk outside the range the
model was actually calibrated over. Target buyers are wind technician training providers,
wind-farm developers, and university energy programmes.

Access Notes or Login Credentials: https://wake-walk.vercel.app - no login required.
Desktop only (pointer lock does not exist on touch devices). Press Space to reveal the
wake, T to change rotor tilt, K to switch calibration, R/F to change height.

Media Links: https://wake-walk.vercel.app
```

---

## Source attribution (for any marketing copy)

> J. Cutler, C. Bay, and A. Ning, "Introduction to and comparison of deep learning and
> optimization approaches to analytical wake modeling of a tilted wind turbine",
> Wind Energy Science 11, 37-49, 2026. doi:10.5194/wes-11-37-2026 (CC BY 4.0)

Cutler and Ning: BYU Mechanical Engineering (FLOW Lab). Bay: NREL.

**Do not describe this as a simulator in any marketing copy.** It evaluates a published
analytical model; it does not solve a flow field. That distinction is the reason the
build is defensible in front of the paper's own authors.

## Open before this is marketable

No domain expert has reviewed it - the same gate as the rest of the walkthrough line.
Here the reviewer is obvious and the ask is natural: the demo is of Dr. Ning's own
research, which is exactly the opening for the disclosure conversation.
