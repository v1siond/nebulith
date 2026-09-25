# Frameworks

The index. Before any work starts, find the row for what is being worked on, open the document it
names, and follow it. Say which one is being followed.

**If there is no document for it, that is not permission to improvise.** Research the fundamentals,
the best practices and real examples, WRITE the document, then work from it. A framework invented from
nothing is improvisation with a filename on it.

**A document's checklist is the gate, not a summary.** Before reporting any change it covers, walk it
item by item and state the evidence for each. Say plainly which items could not be verified.

## What exists

| Context | Document | What it settles |
|---|---|---|
| The whole system: laws, schema, phases | [SPEC.md](SPEC.md) | The 12 laws, every table and column, the 15 phases and their gates. This drives development; a change that contradicts it is a defect |
| Testing | [TESTING.md](TESTING.md) | The two layers, the browser scenario framework in Elixir, what to assert on a canvas, the mocked backend, the checklist |
| Tile art | [TILE-DESIGN.md](TILE-DESIGN.md) | Where a tile's picture comes from, why the art carries the tone and the setting only moves the hue, how a colour role resolves per season, the nine-piece autotile scheme, and the seeder ordering trap |
| Building an object | [OBJECT-CONSTRUCTION.md](OBJECT-CONSTRUCTION.md) | An object is CELLS, never a billboard tile; a cell is not stuck filling its tile, so shapes are built from sized and posed bars; its numbers are its own with no shared formula; and the reference comes before the modelling |
| How the code must read | [CODING-STANDARDS.md](CODING-STANDARDS.md) | SOLID with its sources, guard clauses as function clauses, dispatch maps, one owner per fact, what must never be in the tree, and the commands that must be clean |
| Clicking on the map | [EDITOR-INTERACTION-SPEC.md](EDITOR-INTERACTION-SPEC.md) | How a click is resolved against what was drawn, why a unit is selected whatever tool is armed, what `Alt` and `Shift` mean, which modes are deliberately exempt, and mouse-down versus mouse-up |
| Sign in, sessions, API tokens | [AUTH.md](AUTH.md) | Who can reach what, and how |
| Rendering and performance | [RENDERING.md](RENDERING.md) | What a frame costs, the techniques ranked, why depth sorting is not a sort, the honest ceiling of canvas 2D, and range transparency as rows rather than constants |
| Shipping it | [DEPLOY.md](DEPLOY.md) | How it gets to a server |

The spec absorbed the material that would otherwise sit in separate documents for the cell and block
model, generation, and object construction. Section 2 is the vocabulary, section 3 is the schema,
section 3.3 is generation, section 8 is the phase plan.

## What is missing

Named here so the gap is a decision rather than a discovery. Writing one of these is the first task of
the work that needs it, not a follow-up.

| Context | Missing document | Why it is needed |
|---|---|---|
| Water | `WATER.md` | Surface height, banks, flow direction, what stops you, and why the three tone bands read as three materials when they are meant to read as one |

## The rules that apply to all of them

* **Knowledge shared goes INTO the document, in the same turn it arrives**, with its source. A reference, a video or a correction that lives only in a reply is knowledge lost, and the next session relearns it wrongly. `yt-dlp` is installed, so a video link becomes a timestamped transcript.
* **Look it up. The internet is configured, use it.** `WebSearch` and `WebFetch` are available and were set up deliberately. Anything not understood gets searched and read BEFORE it gets written about. Writing from recall when a source is one call away is hallucinating with extra steps, and it has already put a wrong statement into this very file: the SOLID section carried "the page body did not come back through an automated fetch" as an excuse and fell back to memory, when a different source fetched cleanly on the first try. If one URL genuinely returns nothing, fetch another, and RECORD which one failed and that it failed, so the next session does not repeat the attempt or inherit the guess.
* **Documents go stale.** Read the document AND check it against the code. When they disagree, find out which is right and fix the other in the same turn.
* **For anything visual that applies to a FAMILY of things**, the evidence covers every member. Build the sheet that renders all of them at a size you can judge, and look at it. If no such tool exists, that tool is the first task.
