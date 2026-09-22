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
| Sign in, sessions, API tokens | [AUTH.md](AUTH.md) | Who can reach what, and how |
| Shipping it | [DEPLOY.md](DEPLOY.md) | How it gets to a server |

The spec absorbed the material that would otherwise sit in separate documents for the cell and block
model, generation, and object construction. Section 2 is the vocabulary, section 3 is the schema,
section 3.3 is generation, section 8 is the phase plan.

## What is missing

Named here so the gap is a decision rather than a discovery. Writing one of these is the first task of
the work that needs it, not a follow-up.

| Context | Missing document | Why it is needed |
|---|---|---|
| Tile art | `TILE-DESIGN.md` | How a tile is drawn, at what luminance, how a colour setting moves the hue and never the tone, how the pieces of an autotile family relate. Tiles keep being authored from memory and the family keeps coming out inconsistent |
| Objects and compositions | `OBJECT-CONSTRUCTION.md` | An object is a user-built asset made of tiles. Every value on it is its own. There is no formula, and inventing one flattened twenty-one authored tree silhouettes into a single shape |
| Water | `WATER.md` | Surface height, banks, flow direction, what stops you, and why the three tone bands read as three materials when they are meant to read as one |
| Rendering and performance | `RENDERING.md` | What the draw does per frame, what the budget is, and which measurements mean anything. Performance is a stated constraint and it is currently argued about from guesses |

## The rules that apply to all of them

* **Knowledge shared goes INTO the document, in the same turn it arrives**, with its source. A reference, a video or a correction that lives only in a reply is knowledge lost, and the next session relearns it wrongly. `yt-dlp` is installed, so a video link becomes a timestamped transcript.
* **Documents go stale.** Read the document AND check it against the code. When they disagree, find out which is right and fix the other in the same turn.
* **For anything visual that applies to a FAMILY of things**, the evidence covers every member. Build the sheet that renders all of them at a size you can judge, and look at it. If no such tool exists, that tool is the first task.
