/**
 * STEP-BY-STEP GUIDES — "how do I actually do this?"
 *
 * Alexander, 2026-09-09: *"and there's no general step by step guides on how to do stuff."*
 *
 * This is not the same thing as `editorHelp.data.ts`, and the two must not drift into each other.
 * `EDITOR_HELP` explains a CONCEPT where you meet it — what thickness means, how stacking works — reached
 * from an ⓘ next to the control. A GUIDE is a PROCEDURE: an ordered list of clicks that gets one whole job
 * done, read before you start rather than when you are already stuck.
 *
 * Every step names the control by the words actually printed on it. That is the discipline that makes a
 * guide worth having and the thing that rots first: a guide saying "click Generate" when the button says
 * "Build this world" is worse than no guide, because it makes the reader doubt they are in the right place.
 * `editorGuides.test.ts` asserts the control names quoted here still exist in the components that draw them.
 */

export interface GuideStep {
  /** The instruction, imperative, naming the real control. */
  do: string
  /** Why this step exists, when it is not obvious. Omitted when the step speaks for itself. */
  why?: string
}

export interface Guide {
  id: string
  /** The job, phrased the way someone would ask for it. */
  title: string
  /** One line on what you will have when you finish. */
  outcome: string
  steps: readonly GuideStep[]
}

export const EDITOR_GUIDES: readonly Guide[] = [
  {
    id: 'first-level',
    title: 'Make my first level',
    outcome: 'A whole level — ground, trees, buildings and people — built from a preset.',
    steps: [
      { do: 'In the left rail, under MAKE THE WORLD, click **New world**.' },
      { do: 'Pick a **Season**. It sets the palette every tile is drawn from.' },
      {
        do: 'Pick a **Kind of place** — Forest, Town, City, Cave or Temple.',
        why: 'The number in brackets is how many presets that kind offers.',
      },
      {
        do: 'Pick one of the presets in the list that appears — each one is a different layout of the same kind.',
        why: 'The heading names the kind you chose, so it reads "Which forest?" or "Which town?".',
      },
      {
        do: 'Set **Columns**, **Rows** and **Cell pixels** under HOW BIG.',
        why: 'These are exactly the numbers it will build. Nothing rounds them or overrides them.',
      },
      {
        do: 'Click **⚡ Build this world**.',
        why: 'Nothing above this button has touched the map yet. This is the step that replaces it.',
      },
      { do: 'Not quite right? Use **Rebuild one part** to re-roll just the buildings, or just the trees.' },
    ],
  },
  {
    id: 'place-object',
    title: 'Put a house (or a fountain) on the map',
    outcome: 'A ready-made building placed whole, every cell of it in one click.',
    steps: [
      { do: 'In the rail, under PUT THINGS IN IT, click **Objects**.' },
      {
        do: 'Point at any object in the list.',
        why: 'The preview panel shows it drawn exactly as it will look on the map, in the view you are in.',
      },
      { do: 'Click the one you want. It is now armed — the list highlights it.' },
      {
        do: 'Move over the map. A ghost footprint follows the cursor.',
        why: 'The footprint is how many cells it covers — a 5×5 fountain needs 5×5 clear cells.',
      },
      { do: 'Click to place it. Every cell it holds lands in that one action.' },
      { do: 'Wrong spot? **Ctrl+Z**.' },
    ],
  },
  {
    id: 'add-character',
    title: 'Add a character that wanders around',
    outcome: 'A villager or monster on the map, walking a patrol of its own.',
    steps: [
      { do: 'In the rail, click **Characters**.' },
      {
        do: 'Click the character you want.',
        why: 'Until you pick one, clicking the map selects rather than places — the library on its own arms nothing.',
      },
      { do: 'Click **Behaviour** at the bottom of the list.' },
      {
        do: 'Choose **Patrols nearby** instead of **Stands still**.',
        why: 'It walks a patrol of 3–5 points within about two cells, with a walking animation.',
      },
      {
        do: 'Choose whose side it is on, or leave it on Auto.',
        why: 'Auto reads it from the character itself — a villager becomes friendly, a monster hostile.',
      },
      { do: 'Click the map to drop it. Or use **Sprinkle** to scatter several onto walkable cells at once.' },
    ],
  },
  {
    id: 'make-a-rule',
    title: 'Make something happen when the player steps on a cell',
    outcome: 'A cell that wins the game, shows a message, or spawns monsters when walked on.',
    steps: [
      { do: 'Click the cell on the map. The right-hand panel appears, naming what you selected.' },
      { do: 'Click the **RULES** row.' },
      { do: 'In the panel that opens, add a rule.' },
      {
        do: 'Pick when it fires — walked onto, or **E** pressed on it.',
        why: 'A rule watches one thing and does one action. Joining two places together is a doorway instead.',
      },
      { do: 'Pick what happens: go to another level, win, show a message, spawn monsters, give an item, or lose.' },
      { do: 'Press **▶ Play** to walk onto it and check.' },
    ],
  },
  {
    id: 'change-art',
    title: 'Change how the whole game looks',
    outcome: 'Every tile redrawn in a different art style, with nothing else about the level changed.',
    steps: [
      { do: 'In the top bar, click **Art** — it is the first control, before the game name.' },
      {
        do: 'Pick a style by looking at the sample tiles rather than the name.',
        why: 'Every tile keeps its name, size, height and collision. Only the picture is swapped.',
      },
      { do: 'The map, the libraries and the previews all change together.' },
    ],
  },
  {
    id: 'play-it',
    title: 'Play what I built',
    outcome: 'The level running as a game, and a way back to editing.',
    steps: [
      { do: 'Click **▶ Play** in the top bar.' },
      { do: 'Move with the arrow keys or WASD. Press **E** to interact.' },
      { do: 'Press **I** for the inventory, **Q** for quests.' },
      { do: 'Click **Stop** to come back to the editor. Nothing you did while playing is saved to the map.' },
    ],
  },
]

/** One guide by id, or undefined. */
export function guideFor(id: string): Guide | undefined {
  return EDITOR_GUIDES.find(g => g.id === id)
}
