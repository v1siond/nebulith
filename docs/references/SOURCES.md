# Reference art, and where it came from

Isometric art we MODEL AGAINST. None of it ships. Every tile in this engine is authored here, baked through
`priv/tilegen/tiles.json` + `bake.mjs` and served from the database; these files exist so an object has
something real to be compared to, in the same projection, before it is built.

**Why they are here at all.** An object was built from a written description of a reference instead of the
reference itself, and it came out nothing like the thing it was named after. A text description is not a
reference. The rule that came out of it is step 1 of `../OBJECT-CONSTRUCTION.md`: find real isometric art of
the thing you are about to build, put it here, and get it approved before modelling anything.

| File | What it is for | Source | Licence |
|---|---|---|---|
| `gateway-arch-cc0.png` | The GATEWAY pattern: two solid piers, a real curved opening, a cap that oversails the piers | [opengameart.org/content/arch](https://opengameart.org/content/arch) | CC0 |
| `gatehouse-town-cc0.jpg` | **The TOWN entrance reference.** A stone gatehouse with real MASS, a true arched opening cut through it, crenellation either side, and a timber deck crossing to it. Also a second wood-deck reference | [opengameart.org/content/castle-gate-and-drawbridge](https://opengameart.org/content/castle-gate-and-drawbridge) | CC0 |
| `cave-mouth-cc0.png` | The DARK MOUTH: a rock mass with the darkest value in the picture as the way in | [opengameart.org/content/cave-entrance](https://opengameart.org/content/cave-entrance) | CC0 |
| `bridge-stone-cc0.png` | The stone bridge: a humped deck, a parapet on both sides, piers into the water | [opengameart.org/content/stone-bridge](https://opengameart.org/content/stone-bridge) | CC0 |
| `bridge-wood-cc0.png` | The wood bridge, plainest form | [opengameart.org/content/wooden-bridge](https://opengameart.org/content/wooden-bridge) | CC0 |
| `bridge-kit-ccby-jaqmarti.png` | **The most useful one.** A modular isometric bridge KIT: flat deck, ramp, decks on piers, decks with posts, in two wood tones. A bridge is a family of pieces, not one stretched tile | [opengameart.org/content/isometric-bridges](https://opengameart.org/content/isometric-bridges) by jaqmarti | CC-BY 4.0 |
| `bridge-arched-ccbysa.png` | An arched bridge rendered with ambient occlusion, for reading how the arch meets the bank | [opengameart.org/content/isometric-bridge](https://opengameart.org/content/isometric-bridge) | CC-BY-SA |

## Attribution

`bridge-kit-ccby-jaqmarti.png` is CC-BY 4.0 by **jaqmarti** and `bridge-arched-ccbysa.png` is CC-BY-SA. Both
are credited here because they are redistributed in this repository as reference material. The CC0 files carry
no attribution requirement; the links are kept anyway so the origin of every reference is traceable.

## Adding one

Search for the thing by name plus "isometric", take art in the same projection this engine draws (2:1 diamond),
prefer CC0, and record the row above before the file is used. A reference in a different projection teaches the
wrong proportions and is worse than none.
