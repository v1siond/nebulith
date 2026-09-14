# THE DESIGN: an exit that looks like a way somewhere else

The thing to model against, and the thing to compare the render to afterwards. Written before any code, per his
rule: *"always use something to model against and validate visually against it, then report completion when
you're confident they're the same or really similar"*.

## What he asked for

> "we need a better visual indicator that 'going through this pathway goes to somewhere else', like a whuite or
> dark light right in the exit cells"

> "[Image #62] -> somethign like this, a forest entrance, a cave entrance, a town/city entrance, a park
> entrance, that type of thing"

> "remember we need to add all new objects to the list, so these exits would be new objects we can just put in
> a map whenever we want, notice how any time we add a new functionality it just becomes a new object we can
> just place and play with"

## What Image #62 actually shows

An isometric diorama on a square base. Reading it as structure rather than as art:

1. **Two uprights flanking an opening.** A gnarled bare tree on the left, a full round-crowned tree on the
   right. They are different from each other, which is what stops it reading as a gate you built.
2. **A span over the top.** A mossy rock arch bridging the two, leaning left to right.
3. **A DARK MOUTH under the span.** The darkest value in the whole picture, and the thing your eye goes to.
   This is the "goes somewhere else" signal, and it is dark, not bright.
4. **Ground cover crowding the feet.** Moss, small stones, one mushroom. It makes the structure look grown
   rather than placed.
5. **The opening is BELOW the arch's highest point**, so the arch reads as a way IN rather than a wall.

The four-part rule that comes out of it, and every entrance below is built from it:

    UPRIGHT   SPAN   UPRIGHT
       │       ═══      │
       │      DARK      │
       │      MOUTH     │
      ▓▓▓     ▓▓▓▓     ▓▓▓      ← ground cover at the feet

## The four entrances

Each is 3 cells wide, which is exactly the gate width (`WOODLAND.pathWidth` is 3), so an entrance covers its
gate and nothing else. The middle cell is the mouth and stays WALKABLE: it is the way out.

Pieces are real catalogue tiles, listed by label. Nothing new is drawn.

### forest_entrance

    dead-tree        arch of boulder        oak-tree
        │             ════════════             │
        │              [ mouth ]               │
     mushroom          path_dirt            red-mushroom

- uprights: `dead-tree` left (bare, gnarled, matches the reference's left), `oak-tree` right (round crown)
- span: `boulder` raised over the mouth, tinted to the zone's rock
- mouth: the gate floor, with a DARK light pool on it
- feet: `mushroom` and `red-mushroom`, one each side

### cave_entrance

    cliff_face        arch of cliff         cliff_face
        │             ════════════             │
        │              [ mouth ]               │
      boulder          cave_floor            boulder

- uprights: `cliff_face` both sides, so it reads as rock rather than as wood
- span: `cliff` over the mouth
- mouth: `cave_floor`, darkest of the four
- feet: `boulder` each side

### town_entrance

    pillar             torii-gate            pillar
       │               ═════════               │
       │               [ mouth ]               │
     lamp              path_stone             lamp

- uprights: `pillar` both sides, dressed stone, clearly BUILT rather than grown
- span: `torii-gate`, the one real arch in the catalogue
- mouth: `path_stone`
- feet: `lamp` each side, which also lights the way at night through the existing light setting

### park_entrance

    pillar             torii-gate            pillar
       │               ═════════               │
       │               [ mouth ]               │
    bouquet              path                flower

- the town entrance, lighter: same built uprights and span, blooms at the feet instead of lamps
- mouth: `path`, the softer surface

## The dark mouth

Every entrance's middle cell carries a `light` setting with a DARK colour and a small radius. The lamp already
proves the setting works; this uses it for the opposite effect. That is the *"whuite or dark light right in the
exit cells"* he asked for, and it is why your eye lands on the opening.

## How they are placed

The `entrances` layer stamps one at each gate, after `gates` has cut the border. Which one follows the map you
are IN, because a gate does not yet know where it LEADS: a forest map gets `forest_entrance`, a cave gets
`cave_entrance`, a town or city gets `town_entrance`. When the world map lands (ticket 53) and a gate knows its
destination, the choice moves to that and this becomes the fallback.

`park_entrance` is placed by hand, which is the point of the next part.

## They are OBJECTS

All four carry a `category`, so they appear in the objects palette and can be dropped on any map, anywhere, like
every other composition. That is the workflow he described: a new piece of functionality becomes a thing you can
place and play with.

## How this gets validated

Render each of the four at :3000, put the shot beside this document and beside Image #62, and report whether the
four-part rule reads: two uprights, a span, a dark mouth, cover at the feet. His eyes are the gate on whether it
is close enough.

---

# THE COMPARISON, 2026-09-14

Built, wired, data-driven and tested. **The render does NOT match this design yet.** Reported rather than
claimed, per his rule: report completion only when confident they are the same or close.

Shot: `shots/entrance-forest.png`, a woodland's south gate.

What is right:
- one entrance lands at every gate, turned to the side its gate is on
- the pieces stamped are the ones the design names (dead-tree, oak-tree, boulder), 6 cells
- which entrance is served by the backend, not chosen in the engine

What is WRONG, and each needs another pass:

1. **The mouth reads as a solid black CUBE, not a dark opening.** The dark colour was put on the floor tile of
   the middle cell, and a floor draws as a slab, so it came out as a black box standing in the gate rather than
   a hole you walk into. The darkness has to come from something else: a shadowed face, an unlit recess, or a
   dedicated piece, not from painting a floor tile near-black.
2. **The span floats.** `boulder` at level 1 over the mouth is drawn as a full cube hanging in the air with
   nothing reading as support. The reference's arch springs FROM the uprights; this one does not touch them.
3. **The uprights do not read as a frame.** At the gate they sit among the treeline, so the eye cannot separate
   "these two mark the way out" from "these are more trees". The reference gets its read from the two uprights
   being distinct against open ground behind them.

The four-part rule is sound. The execution of parts 2 and 3 needs the span to bridge the uprights rather than
hover over the middle, which likely means a wider piece or a z-width span, and part 1 needs a different way to
express dark.
