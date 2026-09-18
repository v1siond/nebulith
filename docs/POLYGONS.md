# POLYGONS: drawing a 3D shape from points, with one formula

Written 2026-09-18, from a source he shared as *"perfect context for the eventual poligons logic"*. This is
the framework for the polygon/vector work, ahead of the ticket, so the ticket starts from a written model
rather than from a link that scrolled away.

Nothing here is built yet. It is the maths, its proof, and what it would mean for this engine.

---

## 0. Source

**"One Formula That Demystifies 3D Graphics"**, Tsoding, 20:15, <https://www.youtube.com/watch?v=qjWkNZ0SXfo>.
Transcript pulled with `yt-dlp --skip-download --write-auto-sub`, timestamps cited as `[mm:ss]`.

The speaker writes almost nothing down: he types the code and draws the proof on screen. So every formula
below is RECONSTRUCTED from what he does and says, not copied from a slide, and each one carries the
timestamp it was derived from.

---

## 1. The formula

> *"Imagine that you have a 3D point in an imaginary 3D space behind your screen. And to project that 3D point
> onto your screen, what you have to do, you have to take its X divided by Z and its Y / Z."* `[00:07]`

```
x' = x / z
y' = y / z
```

That is the whole of perspective projection. No matrices, no library.

### Why it works `[17:51]-[19:17]`

He draws it rather than states it, so here it is written out:

- your eye is at the origin, `z = 0`
- the screen is the plane `z = 1`
- a point `P = (x, y, z)` casts a ray to the eye, and `P' = (x', y')` is where that ray crosses the screen

That makes two SIMILAR triangles (same angles): the big one from the eye to `P`, and the small one from the
eye to `P'`. Similar triangles have equal ratios, so

```
  1     x'                     x
 --- = ----      ⇒     x' =  -----      and the same for y
  z     x                      z
```

*"We got the magical formula"* `[19:14]`.

### The two things that break it

1. **`z` must never be 0.** *"Z equals Z means that the object, the point is exactly in your eye. So there's
   nowhere to project"* `[07:30]`. A point at the eye has no projection; it is a division by zero.
2. **It assumes its own coordinate system**: origin at the CENTRE of the screen, `y` UP, and the visible range
   running `-1` to `+1` on both axes `[03:20]-[03:46]`. A canvas has none of that.

---

## 2. Getting it onto a canvas

A canvas puts `0,0` at the TOP LEFT, `y` goes DOWN, and the range is `0..width` / `0..height` `[03:48]`. So
the projected point needs mapping `[04:31]-[05:03]`, and he derives it one step at a time:

```
x + 1          →  range becomes 0..2
(x + 1) / 2    →  range becomes 0..1
(x + 1) / 2 * W→  range becomes 0..W
```

and `y` the same, then FLIPPED, because positive `y` is up in the model and down on the canvas `[06:09]`:

```
sx =      (x + 1) / 2  * W
sy = (1 - (y + 1) / 2) * H
```

One more detail worth keeping: a point drawn as a square of side `s` is drawn at `sx - s/2, sy - s/2`, so the
mark is CENTRED on the point rather than hanging off it `[05:53]`.

---

## 3. A shape is points plus how they join

His words: *"we've got a very simple 3D engine in here and it's capable of rendering arbitrarily complex
model. You just need to find appropriate vertices and appropriate faces"* `[19:25]`, demonstrated with a model
of 326 vertices and 626 faces on the same code that drew the cube `[19:38]`.

### The cube

Two squares, one behind the other. The pair differ only in `z`:

```js
const vs = [
  { x:  0.25, y:  0.25, z:  0.25 },   // back face
  { x: -0.25, y:  0.25, z:  0.25 },
  { x: -0.25, y: -0.25, z:  0.25 },
  { x:  0.25, y: -0.25, z:  0.25 },

  { x:  0.25, y:  0.25, z: -0.25 },   // front face, the SAME square offset along z
  { x: -0.25, y:  0.25, z: -0.25 },
  { x: -0.25, y: -0.25, z: -0.25 },
  { x:  0.25, y: -0.25, z: -0.25 },
]
```

*(He shared this list with both planes written at `z: 0.25`. They have to differ or the two squares are the
same square: the offset is the whole point, and he says so himself, "the first set of complex number render
the same result but have an ofset".)*

### The faces

```js
const fs = [
  [0, 1, 2, 3],   // the back square
  [4, 5, 6, 7],   // the front square
  [0, 4],         // and the four struts joining them
  [1, 5],
  [2, 6],
  [3, 7],
]
```

A face is **a list of vertex indices to join in a loop**. Drawing one walks `i` from `0` to `f.length - 1` and
draws a line from `f[i]` to `f[(i + 1) % f.length]` `[16:02]-[16:31]`. The modulo is what closes the loop, and
it is also why a two-index face is simply an EDGE: `[0, 4]` draws `0→4` and then `4→0` over the top of it.

The order inside a face matters. He gets it wrong on camera and the cube comes out crossed: *"they're not
actually connected in the right order"* `[17:01]`. The list is a path around the polygon, not a set.

---

## 4. Rotation

To spin the cube he rotates around the Y axis, which means rotating in the XZ plane `[11:47]`. He takes the
standard 2D vector rotation and substitutes `z` for `y` `[13:12]`:

```js
const c = Math.cos(angle)
const s = Math.sin(angle)

x' = x * c - z * s
z' = x * s + z * c
y' = y                  // unchanged: it is the axis being turned about
```

His own advice on it: *"it's one of these formulas that you kind of have to memorize and don't try to
understand ... shut up and calculate"* `[12:04]`.

The frame loop is a rotation of `2π * dt` per second, with `dt = 1 / fps` `[13:38]`, and the ORDER is: rotate
the model point, project it to the display, map the display point to the screen, draw `[10:44]`.

---

## 5. What this would mean here

Not built, and not a proposal to replace anything. What it settles for the polygon ticket:

- **A shape is data, not art.** A list of `{x, y, z}` and a list of index loops. That is the same shape as a
  composition's cell list, which is already how an object is authored here (`OBJECT-CONSTRUCTION.md`), so a
  polygon object would be a third authoring form beside the glyph grid and the baked image, not a new engine.
- **The renderer needs nothing exotic.** A 2D context and two divisions. There is no argument from "we would
  need WebGL" available: he makes the point explicitly, *"we're not using OpenGL, WebGL, WebGPU"* `[20:02]`.
- **It is a different projection from ours.** This engine draws ISOMETRIC, which is a parallel projection: no
  divide by `z`, parallel lines stay parallel, and distance does not shrink anything. This formula is a
  PERSPECTIVE projection and the two cannot be mixed in one view. So a polygon shape here would be authored
  in 3D and rendered through the iso projection the map already uses, and this formula is the reference for
  the authoring model (vertices + faces), not for the camera.
- **What it buys**: a tile or an object that is not limited to what a 2-tile composition can say. Detail comes
  from adding points, not from baking another image per style.

### Open, for the ticket

- which projection an authored polygon draws through (the iso camera, or a perspective preview in the editor)
- how a polygon shape carries COLOUR: per face, per vertex, or as one fill
- where the vertex list is served from, given that all tile and object data is backend-owned
- how a polygon object takes part in collision and in the stacking law (`MAP-MODEL.md` §6)
