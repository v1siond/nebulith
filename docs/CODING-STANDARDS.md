# Coding standards

The bar every change in this repository is held to. Not advice: a gate. Before reporting any change,
walk this file and state the evidence, the same way a framework's checklist is walked.

`docs/FRAMEWORKS.md` indexes the frameworks that say HOW to build a particular thing. This one says
how the code itself must read, whatever it is building.

## 1. SOLID

### Sources

Three, all fetched and read, not recalled.

1. [SOLID Principle in Programming: Understand With Real Life
   Examples](https://www.geeksforgeeks.org/system-design/solid-principle-in-programming-understand-with-real-life-examples/),
   GeeksforGeeks. Shared 2026-09-22. Carries a real-life analogy and a worked violation-and-fix per
   principle, in C++, Java, Python and JavaScript.
2. [SOLID](https://en.wikipedia.org/wiki/SOLID), Wikipedia. The canonical one-line statements with
   their objectmentor.com citations. Robert C. Martin set these out in his 2000 paper *Design
   Principles and Design Patterns*; Michael Feathers coined the acronym around 2004.
3. [S.O.L.I.D: The First Five Principles of Object Oriented
   Design](https://www.digitalocean.com/community/conceptual-articles/s-o-l-i-d-the-first-five-principles-of-object-oriented-design),
   DigitalOcean. Shared earlier. **Still unfetchable**: the URL returns the SPA shell, navigation and
   footer only, with no article body, confirmed again on 2026-09-22. Recorded so the link is not lost.
   Nothing below rests on it.

### The canonical statements, verbatim

| | Principle | Stated as |
|---|---|---|
| **S** | Single responsibility | "There should never be more than one reason for a class to change." |
| **O** | Open/closed | "Software entities should be open for extension, but closed for modification." |
| **L** | Liskov substitution | "Functions that use pointers or references to base classes must be able to use pointers or references of derived classes without knowing it." |
| **I** | Interface segregation | "Clients should not be forced to depend upon interface methods that they do not use." |
| **D** | Dependency inversion | "One should depend upon abstractions, not concretes." |

### The analogies, from GeeksforGeeks

Kept because they are the fastest way to recognise a violation before it is written.

* **SRP, the baker.** A baker who only bakes stays good at baking. A baker who also runs inventory,
  ordering, customer service and cleaning is five jobs in one apron. The article splits it into
  `BreadBaker`, `InventoryManager`, `SupplyOrder`, `CustomerService`, `BakeryCleaner`.
* **OCP, the payment processor.** Adding PayPal means a new `PayPalPaymentProcessor` beside
  `CreditCardPaymentProcessor`, both behind the same abstract `PaymentProcessor`. The original class
  is never opened.
* **LSP, the square that is not a rectangle.** `Square` deriving from `Rectangle` breaks the caller's
  assumption that width and height move independently. Setting one silently sets the other.
* **ISP, the vegetarian menu.** A vegetarian is not handed one menu containing meat, drinks and
  sweets. Separate `IVegetarianMenu`, `INonVegetarianMenu`, `IDrinkMenu`.
* **DIP, version control.** The team depends on an abstract `IVersionControl`, not on Git's internals,
  so the implementation can be swapped without touching team logic.

Why it is worth the trouble, in the article's own framing: maintainability (one clear place to change),
scalability (add without modifying), flexibility (swap a component without disturbing the system).

### What each one means in THIS codebase

Applied pragmatically, and applied to FUNCTIONS and MODULES here, because this codebase is Elixir and
TypeScript rather than a class hierarchy.

| | Principle | What it means here |
|---|---|---|
| **S** | Single responsibility | A module has ONE reason to change. `Autotile` decides which of nine pieces a cell takes and nothing else. When a module starts needing "and" to describe it, split it |
| **O** | Open/closed | Open for extension, closed for modification. A new art style is a new set of baked images, not a branch in the renderer. A new entity tool answers `placesAUnit/1` rather than being added to a list at the call site |
| **L** | Liskov substitution | Anything standing in for a type must honour its contract. Every tile resolves by LABEL through one path: a floor, a wall and a unit are all tiles, and a caller must not need to know which |
| **I** | Interface segregation | Narrow interfaces. A function takes the data it uses, not a god-struct it reads two fields from |
| **D** | Dependency inversion | Depend on abstractions, inject dependencies. The render sheet is handed a `paint` callback rather than importing the renderer, which is what lets it live outside `iso.ts` |

**Composition over inheritance**, always. An object in this engine IS composition: a tree is cells, a
building is cells. There is no inheritance to reach for.

## 2. Control flow

**Guard clauses, no `else`.** In ~99.9% of cases. Elixir has no early return, so the guard form is
SEPARATE FUNCTION CLAUSES with `when` guards, not a `cond` inside one body.

```elixir
# no
def suffix(top, bottom, left, right) do
  cond do
    top and left -> "tl"
    top and right -> "tr"
    true -> "c"
  end
end

# yes
def suffix(true, _bottom, true, _right), do: "tl"
def suffix(true, _bottom, _left, true), do: "tr"
def suffix(_top, _bottom, _left, _right), do: "c"
```

**Dispatch maps and tables over chains.** A long `if / else if` or `case` over names is a table
written as control flow. Make it a table.

**No deep nesting.** Flat, linear, single purpose. Extract a loop body into a named helper.

## 3. Size and naming

Small focused units: a file or function that has grown large is doing too much. Each unit has a clear
purpose, a well-defined interface, and is understandable without reading its internals.

Names reveal intent. No obscure abbreviations. Code reads like prose.

## 4. What must not be in the tree

* **No dead code.** No commented-out code, no unused exports, no speculative generality. Delete it.
* **No duplication of a FACT.** One owner per fact. `GeneratorSource.seed/0` writes `generators.config`
  whole, so a data migration that `jsonb_set`s into the same column is a second owner and the next seed
  discards its work. Retire the second owner, never extend it.
* **DRY, but duplication beats the wrong abstraction.** Do not couple two things only to deduplicate.

## 5. Errors and state

Explicit errors: no silent catches, fail loud in dev, degrade gracefully in prod. A step that is
allowed to not happen is not a step.

Immutability by default. No shared mutable state, no module-level mutable globals.

**Backend data is never derived at render time.** The generator PICKS and writes values as state; the
render READS. A hardcoded fallback for loaded data, or a value invented in the frontend, is a defect.

## 6. Comments

Comment the WHY, never the what. The why includes the measurement that justified the choice and the
defect the code is shaped to prevent.

**Never quote a prompt, and never name the user, in code or comments.** Keep the technical reason,
drop the attribution. This was 666 lines across 247 files when it was last caught.

**Never use an em dash or an en dash**, in code, comments, docs, commit messages or replies. A full
stop, a comma, a colon or parentheses instead. Hyphens inside compound words are spelling and are fine.

## 7. Tests

Two layers, always both, per `docs/TESTING.md`:

1. **Backend unit tests** in `mix test`, positive and negative paths, real modules.
2. **A browser scenario** in `test/e2e`, driving the real page with Playwright IN ELIXIR, performing
   the actions a person performs, asserting on the data the app actually holds and on the row after a
   save. **With the mocked backend where the scenario is about what the app does with served data**:
   `StubApi.stub/2` wraps `window.fetch` through an init script, so the response follows the exact
   schema and the scenario controls it.

**Jest is banned for anything that touches a page.**

**A new gate must be run against the code BEFORE the fix and must fail there**, and that failure is
shown. A gate that cannot fail is decoration.

For anything visual applying to a FAMILY, the evidence covers EVERY member:
`test/e2e/the_render_sheet_test.exs` renders one portrait per member into `docs/renders/`.

## 8. The commands that must be clean

```
mix format --check-formatted
mix compile --warnings-as-errors
mix credo
mix test
bin/e2e
npx tsc --noEmit        # in assets/
```

## 9. The verdict

For anything visual, a green suite is not "done". The user's own look at the running app is the only
verdict, and it is asked for rather than assumed.
