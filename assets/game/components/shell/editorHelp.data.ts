/**
 * THE (i) EXPLANATIONS — the copy behind every info button in the editor.
 *
 * Alexander, 2026-09-08:
 *
 *   > the actions while better organized aren't completely clear for end user, we need to improve labeling
 *   > and add (i) info and docs with example guides
 *   > for example, how does animation work? how do triggers work? [...] what does scatter place one means??
 *   > what does npc, auto, enemy means? whats player, npc, erase and collision???? what are rules, what's a
 *   > conector, how do they work? How did that fountain animate?
 *   > we want to make it was easy that even a 5y kid can build a game with the tool
 *
 * This is UI COPY, not game data — the same category as a button's label — so it lives with the components
 * that show it. Every entry answers a question a real person asked, in their words, and several describe a
 * WORKED EXAMPLE (`fountain`) rather than the abstraction, because "how did that fountain animate" is the
 * question people actually have.
 *
 * Carried over verbatim from the approved design at :8899, and a test asserts it stays that way. `body` is
 * trusted HTML authored HERE — never user input — and is rendered with dangerouslySetInnerHTML by design.
 */

/** One explanation: the question as a heading, and the answer as authored HTML. */
export interface HelpEntry {
  title: string
  body: string
}

/** Every explanation, keyed by the id an (i) button passes. */
export const EDITOR_HELP: Readonly<Record<string, HelpEntry>> = {
  anchor: {
    title: "Pinned, not placed",
    body:
      "A piece of the HUD is pinned to one of nine points — a corner, an edge, or the middle — and then nudged away from it.<br><br>That is why the offsets are small numbers. “16 up from the bottom-left” still means the bottom-left corner on a phone, on a laptop and on a 4K monitor. An absolute “y = 812” means the bottom on exactly one screen and the middle of the map on every other.",
  },
  anim: {
    title: "How animation works",
    body:
      "Exactly two kinds.<br><br><b>1 · Play a frame sequence.</b> Swap pictures like a flipbook. Each frame <i>is</i> a tile. You choose when it plays — idle, moving, attacking, interacting, or on a key — and a direction.<br><br><b>2 · Move, fade or recolour it.</b> Slide one number from A to B: height, opacity, x, y, zoom, width, rotation, colour, draw order. With start delay, loop, gap, <b>yoyo</b> (run it backwards to return) and an easing curve.",
  },
  bars: {
    title: "Conditional bars",
    body:
      "A bar can appear only when something is true — a specific event fires, a quest step is active, the hero is in a vehicle, an object is in use, or a given power is active. That lets a vehicle bar replace the normal one while driving, then swap back. As many bars as you need, and no paging.",
  },
  connector: {
    title: "What a doorway is",
    body:
      "A <b>set of cells</b> that takes the player somewhere. Mark the cells (a door can be several), pick where it leads, and choose <b>which cell they arrive on</b> so they do not land in a wall. It can go to another level, move them within this one, hand over an item, or reveal something — firing on walk, on E, or automatically.",
  },
  effects: {
    title: "Effects",
    body:
      "The pictures a power draws — a slash, a bolt, an arrow in flight. They are tiles like any other, so they have a size, a colour and frames, and you can look at them here. You do not usually place them by hand: a power places its own when it fires.",
  },
  footprint: {
    title: "How many cells it spans",
    body:
      "Counts whole <b>cells</b> in each of the four diagonal directions, 1 to 9. A castle wall spanning three cells is footprint 3. This is the tile’s size on the grid — not its size inside one square.",
  },
  fountain: {
    title: "Worked example — how the fountain animates",
    body:
      "You never animated it; it arrived that way. The fountain is a <b>5×5 object of 25 cells</b>. Three of them are water, and each carries a property tween called “grow”:<br><br>· height moves <b>1 → 4</b><br>· <b>yoyo</b> on, so it falls back<br>· <b>loops</b> with a 400 ms gap<br>· <b>sine</b> easing<br>· and the jets are deliberately <b>out of step</b> — durations 1000 / 1400 / 1800 ms, start delays 0 / 800 / 400 ms<br><br>That stagger is the whole trick. Because it is authored on the object’s cells in the backend, every fountain you stamp is animated the moment it lands.",
  },
  hudform: {
    title: "Two layouts, not one",
    body:
      "A game carries a <b>desktop</b> layout and a <b>mobile</b> layout, and the screen decides which one is live.<br><br>They are edited separately on purpose: a thumb needs a bigger action bar, the bag and journal want opposite corners rather than the centre, and an FPS readout is worth nothing on a phone. A squeezed desktop layout is not a mobile layout.",
  },
  motion: {
    title: "Stands still, or wanders?",
    body:
      "<b>Stands still</b> pins it to its cell. <b>Wanders nearby</b> gives it a patrol of 3–5 points within about two cells, walked in sequence with a movement animation. It will not wander off across the map.",
  },
  muzzle: {
    title: "Where the shot comes out",
    body:
      "Only weapons that fire use this. When the shot is loosed, it is born a fraction of the way from the character toward the target:<br><br>· <b>0</b> — on top of the character. The arrow appears inside the archer.<br>· <b>0.2</b> — about the end of a drawn bow or a barrel. This is what you usually want.<br>· <b>0.5</b> — halfway to the target. It looks like the shot teleported.<br><br>Melee weapons have no projectile, so they ignore it entirely.",
  },
  objprev: {
    title: "What an object will do",
    body:
      "An object is not one tile — it is a group of cells stamped at once. The preview shows both halves of that:<br><br>· the <b>picture</b> is its front, built from the very tiles it will place;<br>· the <b>footprint</b> is the ground it will claim, with the cells you can walk through marked. That is usually the doorway.<br><br>Everything it places lands in one action, and one undo takes it all back.",
  },
  placeAs: {
    title: "Whose side is this character on?",
    body:
      "Two answers, and no third. <b>Friendly</b> will not attack the hero. <b>Unfriendly</b> will. Every character has a sensible default — a villager arrives friendly, a goblin arrives unfriendly — and this overrides it, so a friendly wolf or a hostile shopkeeper is one click.",
  },
  quest: {
    title: "How a quest works",
    body:
      "A character asks for something and pays for it. Pick <b>who gives it</b>, a <b>title</b>, the <b>goal</b> (defeat N of a type, reach a cell, or find a character) and the <b>reward</b> (XP or an item). In play the hero presses <b>E</b> near the giver to accept, and again to hand it in.",
  },
  scatter: {
    title: "One at a time, or sprinkle several?",
    body:
      "<b>One at a time</b>: you click each spot, and a monster placed this way <b>stands still</b>. <b>Sprinkle 8</b>: dropped at random on walkable, non-water cells — and every one arrives with a <b>wandering patrol and a walk animation</b>. That difference is invisible today.",
  },
  stack: {
    title: "Tiles stack, like bricks",
    body:
      "Ground lies on the floor. Everything else <b>stacks on top</b> of what is already in the cell — a wall on grass is grass with a wall above it. One cell can hold a stack, and ▲▼ picks which tile in it you are editing. <b>Things stack on top</b> makes a cell behave as if already filled, which is how roads and walk-over floors work.",
  },
  swap: {
    title: "Swapping a tile",
    body:
      "It puts a different tile in <b>this exact slot</b> of the cell. Same cell, same level — the tiles above and below it do not move.<br><br>The slot takes on everything about the new tile: its picture, its colour, its height, its thickness and its settings. It is a replacement, not a coat of paint.<br><br>One exception: a standing block cannot <i>become</i> the ground slab. Pick a wall for the ground layer and it stacks on top instead — the button tells you when that is what will happen.",
  },
  thickness: {
    title: "How much of its own cell it fills",
    body:
      "A fraction of <b>one cell</b>, 0.05 to 1, per direction. A door is thin: it fills only a sliver of its cell so it reads as a plane rather than a block. Full thickness (1) fills the cell edge to edge.",
  },
  trigger: {
    title: "When … then …",
    body:
      "A rule watches <b>one</b> thing and does <b>one</b> action. It does not join two things — that is a doorway.<br><br><b>On a cell</b>: when the player walks onto it, or presses E on it.<br><b>On a character</b>: when it is defeated.<br><br>Then: go to another level · win · show a message · spawn monsters · give an item · lose.",
  },
  unitsize: {
    title: "How big — and why it matters",
    body:
      "Size 1× / 2× / 3× scales the figure <b>and its stats by the same ratio</b>, and the bigger figure covers more cells. So a 3× dragon is a genuine multi-cell boss, not just a bigger picture. The footprint comes from the art, floored at 1×2 cells.",
  },
}

/** The ids that actually have copy — a test uses this to prove no (i) button points at nothing. */
export const HELP_IDS = Object.keys(EDITOR_HELP)

/** One explanation, or undefined when the id has no copy. Callers must render nothing for undefined. */
export function helpFor(id: string): HelpEntry | undefined {
  return EDITOR_HELP[id]
}
