# MATH FOUNDATIONS: the formulas this engine actually runs on

The small set of maths a game engine keeps reaching for, written as things you can paste, with the place in
THIS codebase each one belongs. Not a tutorial, and not a summary of a video: every entry is a formula plus
the question it answers here.

Read alongside [`TILE-EFFECTS.md`](TILE-EFFECTS.md) §0, which lists seven primitives lifted out of the grass
source. Those are about VARIATION and TIMING. These are the arithmetic underneath them, and where the two
overlap this doc is the definition and that one is the application.

---

## 0. Sources

1. **"What Kind of Math Should Game Developers Know?"**, SimonDev, 19:39,
   `https://www.youtube.com/watch?v=eRVRioN4GwA`. Transcribed with `yt-dlp`, cited by timestamp throughout.
   His framing, and the reason this is worth writing down: *"a lot of the math that game developers use is a
   lot simpler than it looks"*.
2. Onward references he names at `[19:30]`: 3Blue1Brown, Freya Holmer, George Rodriguez.

---

## 1. Linear interpolation, the highest-value formula in the file

`[00:23]` to `[01:50]`. His words: *"the biggest bang for your buck technique"*.

```
lerp(a, b, t) = a + (b - a) * t
```

**The power is that `a` and `b` can be anything**: a number, a position, a scale, an opacity, a colour, a
whole palette. Fade, move, shrink, drain a health bar, all the same line.

### 1.1 Shaping the `t`, not the values

A straight lerp moves at a constant rate and reads mechanically `[01:01]`. The fix is to bend `t` before
using it, leaving `a` and `b` alone:

```
smoothstep(t) = t * t * (3 - 2 * t)        // ease in and out, the default worth reaching for
smootherstep(t) = t*t*t*(t*(t*6 - 15) + 10) // flatter ends, no second-derivative kink
```

Any function `[0,1] -> [0,1]` works, including deliberately exotic ones that overshoot and bounce `[01:18]`.

### 1.2 The colour-space fact, and it matters to us RIGHT NOW

`[01:22]` to `[01:48]`. Interpolating two colours in **RGB** drags the midpoint through a muddy region: he
demonstrates a gradient where *"you can see some sort of reddish Hues right in the middle because we're
interpolating RGB colors"*. Interpolating the SAME two endpoints in HSV changes the result, and in **Lab**
gives a gradient he calls *"more aesthetically pleasing"*.

**Where this lands here:** the tree colour work in [`TREES.md`](TREES.md). A biome tone blended with a season
tone is exactly a two-colour interpolation, and doing it naively in RGB is how you get the muddy, washed
greens. Blend in a perceptual space, then convert back.

```
// sRGB -> linear, the step almost everyone skips and the reason blends look dark
lin(c) = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
```

Even a blend in LINEAR RGB is a large improvement over blending gamma-encoded bytes, and it is four lines.
Lab is better again where the endpoints are far apart in hue.

### 1.3 What does NOT interpolate naively

`[01:50]` to `[02:05]`. Angles and rotations. Lerping a turret between two headings *"fails to take the
shortest path"*, because 350 degrees to 10 degrees is 20 degrees the short way and 340 the way the numbers
go. See §6.

```
shortestAngle(a, b) = ((b - a + PI) mod 2PI) - PI     // then lerp along THAT
```

---

## 2. Angles and the unit circle

`[02:07]` to `[02:44]`. Degrees are the human unit, radians the maths one: walking one unit of arc around a
circle of radius 1 subtends **one radian**, so a full turn is `2 * PI`.

The unit circle is the whole of the trigonometry below. A point on it at angle `theta` is exactly
`(cos theta, sin theta)`, the hypotenuse is 1, and every identity falls out of that picture `[03:02]`.

---

## 3. Trigonometry, which is mostly three ratios

`[02:49]` to `[04:20]`. *"trigonometry is the study of triangles and the relationship between the sides of
those triangles and the angles in between"*.

| | on the unit circle | range |
|---|---|---|
| `sin theta` | the VERTICAL distance | -1 to 1 |
| `cos theta` | the HORIZONTAL distance | -1 to 1 |
| `tan theta` | `sin/cos`, undefined at `+-PI/2` | unbounded |

`tan` blowing up at `PI/2` is not a glitch, it is the definition: the ratio's denominator is 0 `[04:00]`.

### 3.1 The three animation recipes, verbatim

`[04:23]` to `[04:50]`. These are the whole of what most tile animation needs:

```
pulse:  scale  = base * (1 + amp * sin(t * speed))       // throb
hover:  y      = base + amp * sin(t * speed)             // bob in place
orbit:  (x, y) = centre + radius * (cos(t), sin(t))      // circle or spiral
```

**Where this lands here:** [`TILE-EFFECTS.md`](TILE-EFFECTS.md) §1 calls these "setting" animations and has
the envelope for them with nothing varying over time yet. These three lines ARE that missing piece, and the
water surface already wants the first.

**Pair every one of them with a per-instance phase offset**, `TILE-EFFECTS.md` §0 primitive 5: a field of
props all running `sin(t)` with the same `t` pulses in lockstep and reads as a bug. Offset by something
stable and per-cell:

```
phase = hash(col, row) * 2PI     // then use sin(t * speed + phase)
```

---

## 4. Vectors, and the operations that are legal

`[04:55]` to `[06:16]`. The distinction worth keeping in code: a **position** is a point in space, a
**vector** is a direction with a magnitude. Same two numbers, different meanings.

| operation | result | used for |
|---|---|---|
| position + vector | position | moving something |
| vector +- vector | vector | accumulating forces, velocities |
| position - position | vector | "how far, and which way, is B from A" |
| vector * scalar | vector | scaling velocity by time |
| **position + position** | **nonsense** | nothing. It is not a meaningful operation `[06:13]` |

That last row is the one that catches people, and it is worth keeping the two apart in types for exactly
that reason.

### 4.1 Euler integration

`[06:18]` to `[07:03]`. The simplest way to move anything, and it is two lines:

```
position += velocity * dt
velocity += acceleration * dt
```

He is explicit that it is *"imperfect but super simple"* and points at Verlet integration for stability
`[07:01]`. For projectiles and unit movement at our scale, this is enough.

---

## 5. The dot product, the single most useful one

`[07:06]` to `[09:20]`. *"the dot product is freaking awesome"*.

```
dot(a, b) = a.x * b.x + a.y * b.y            // 2D
```

**For UNIT vectors, `dot(a, b) = cos(theta)`**, the cosine of the angle between them. So:

| `dot` | meaning |
|---|---|
| `1` | same direction |
| `0` | perpendicular |
| `-1` | opposite |

### 5.1 The two recipes it buys you

**In front or behind**, `[08:27]`: take the sign of `dot(forward, toTarget)`. Positive is in front.

**Inside a field of view**, `[09:00]`, and this is the part worth memorising. For a cone of total angle
`fov`, compare against the cosine of HALF of it:

```
visible = dot(forward, normalize(target - self)) >= cos(fov / 2)
// his worked example: fov 60 degrees -> cos(30) ~= 0.866
```

Note it needs no `acos` and no angle at all, just one multiply-add and a compare.

**Where this lands here:** the four-facings rule in [`RENDER-AND-CAMERA.md`](RENDER-AND-CAMERA.md) and
`TILE-DESIGN.md` §2.5, enemy vision cones in `COMBAT-AND-SYSTEMS-SPEC.md`, light falling on a slope, and
directional wind in `TILE-EFFECTS.md`.

---

## 6. Matrices, read as linear transformations

`[09:27]` to `[12:20]`. The unlock: *"start seeing matrices as linear Transformations"*. **A matrix's columns
are where the basis vectors land.** That is the whole intuition.

```
scale by (3, 2):      [ 3  0 ]     x-axis -> (3,0), y-axis -> (0,2)
                      [ 0  2 ]

rotate 90 degrees:    [ 0 -1 ]     x-axis -> (0,1), y-axis -> (-1,0)
                      [ 1  0 ]

rotate by theta:      [ cos -sin ]  because the new x-axis is (cos, sin)
                      [ sin  cos ]  and the new y-axis is that plus 90 degrees
```

The familiar rotation matrix is not a magic formula to memorise, it is just those two basis vectors written
as columns `[10:45]`.

A non-perpendicular pair of axes gives a **shear** `[11:10]`.

### 6.1 Homogeneous coordinates, and why translation needs a third row

`[11:31]` to `[12:20]`. Rotation and scale are linear, and no linear 2x2 can translate, because the origin
always maps to the origin. The trick is to add a dimension and write every point as `(x, y, 1)`:

```
[ cos -sin  tx ]
[ sin  cos  ty ]
[  0    0    1 ]
```

The translation tucks into the extra column, and *"this extra Dimension lets us use a single Matrix to handle
everything rotation scales and even translations all at once"*. The shear machinery is being deliberately
abused to do it.

---

## 7. Representing a rotation: three options, and when each is wrong

`[12:21]` to `[15:15]`.

| | size | gimbal lock | interpolates | verdict |
|---|---|---|---|---|
| **Matrix** | 9 values in 3D | no | **badly** `[12:39]` | fine to APPLY, bad to store or blend |
| **Euler** (yaw/pitch/roll) | 3 | **yes** `[13:34]` | badly | the one to show a USER, per `[14:31]` |
| **Quaternion** | 4 | no | **yes, slerp** | the one to store and blend |

**Gimbal lock**, explained plainly `[13:36]` to `[14:25]`: the three axes are applied in a fixed order, so
rotating the middle one by 90 degrees can align the outer and inner axes, and *"you've lost a degree of
freedom"*.

His practical rule, which is the one to adopt: **Euler angles for anything user-facing** because they are
compact and intuitive, and a lock-free representation *"deep in the darkest parts of the code"* `[14:31]`.

Quaternions are honestly labelled: *"they're just fraking hard to understand"*, and he notes he has needed to
know how they actually work precisely once, in an interview `[15:47]`. Using them does not require deriving
them.

### 7.1 Why they work at all, via complex numbers

`[16:00]` to `[18:10]`. Worth knowing because it makes the 2D case obvious. Multiplying by `i` rotates by 90
degrees in the real/imaginary plane:

```
i * (1 + 0i) = i          // (1,0) -> (0,1),  a quarter turn
i * i        = -1         // another quarter turn
```

So **multiplication is rotation**, and multiplying by `cos theta + i sin theta` rotates by `theta`. Expanding
that product gives exactly the same components as multiplying by the 2x2 rotation matrix `[17:55]`.
Quaternions are this extended with three imaginary parts.

**Where this lands here:** our world is 2D-with-levels and the camera has four fixed facings, so we need
almost none of §7. Rotation in this engine is a quarter-turn facing index, and quarter turns are the one case
where the matrix is exact, tiny and trivially composable. Recorded so nobody reaches for a quaternion library
to turn a tile 90 degrees.

---

## 8. What this teaches us to OFFER

The second half of the two-readings rule in [`FRAMEWORKS.md`](FRAMEWORKS.md).

- **Shaping functions are a served preset.** `smoothstep`, `linear`, `ease-in`, `bounce` are a named list,
  and a user picking "how it moves" is picking one. Same shape as the physics presets in `TILE-EFFECTS.md` §3,
  and it should reuse that mechanism rather than invent a second.
- **A blend space is an authoring choice.** Since RGB, linear-RGB and Lab give visibly different midpoints,
  the space a gradient blends in is a setting worth exposing wherever two colours meet: the depth ramp in
  `WATER.md`, a season transition, a biome boundary.
- **A field-of-view number is friendlier than a cosine.** Author degrees, store the cosine. The user should
  never see `0.866`.

---

## 9. Checklist

- [ ] Any blend of two colours states which space it happens in, and is not naive sRGB
- [ ] Any `lerp` that should ease names its shaping function instead of hand-rolling a curve
- [ ] Angles are interpolated the short way round, never by lerping the raw numbers
- [ ] Positions and vectors are not added together anywhere
- [ ] A view/facing/alignment test uses a dot product against a cosine, not an `acos` and a comparison
- [ ] Nothing stores a rotation as a matrix it intends to interpolate
- [ ] Every repeated animated instance carries a per-instance phase offset (`TILE-EFFECTS.md` §0.5)
