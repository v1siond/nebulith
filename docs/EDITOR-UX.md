# EDITOR UX: choosing what goes on a map

How a person decides what a generated map contains, and how they see what a choice does before they commit to it. This is the framework for the generate panel and the add-something flow.

Read [`EDITOR-INTERACTION-SPEC.md`](EDITOR-INTERACTION-SPEC.md) for the editing model (what a click does to a cell). This doc is about the step before that: picking what to build.

---

## 0. Where it came from

His words, 2026-09-16, on the generate panel:

> *"we need to improve the UI of sub selections. this is not clear and I want to have dynamic pathways limits based of size of the grid."*

> *"instead of 'river' and we select a river, it should be something like 'add element' or something and clicking shows what elements can be added categorized, like water -> river, lake, beach, bridges -> stone, dirt, wood."*

> *"we see the preview of the element like we do on objects and I want to see the preview of the element after adding it to the map too."*

And the principle he set for the entrances, which generalises to every element:

> *"I don't want to automatically put entrances designs on pathways, what we have right now is functional, what I want is the ability to do so, like rivers. we might have a section with rivers or without it, we might have a section with specific entrances/exits, or we might use what we have now which is the default. it's just a way to make things better, not to overhaul or replace entirely the system."*

---

## 1. The model

**A map is a set of ELEMENTS a person chose to add, over a default that already works.**

That last clause is the important one and it is the rule that protects the whole system: adding an element is always OPTIONAL, and not adding one leaves the map exactly as it is today. An element never replaces the default behaviour, it offers a better version of it. A map with no river is a map. A map with no authored entrance still opens where it opened.

An element has four parts:

| Part | What it is | Example |
|---|---|---|
| **Category** | The group it is browsed under | Water, Crossings, Ways in and out |
| **Element** | The thing itself | River, Lake, Beach |
| **Settings** | What varies within it | The river's course, its look, how deep it cuts |
| **Preview** | A picture of what it does | A small generated map carrying only that element |

Today's data is flat: seven sibling options on a generator (`exits`, `pathways`, `region`, `river`, `depth`, `bridge`, `water`), with `requires` as the only relationship between them. That flatness is what he is calling unclear: `depth` and `bridge` and `water` are all settings OF the river, and they read as peers of it.

---

## 2. The three rules

### 2.1 Grouping is served, not inferred

A category is a field on the option, the same way a tile's category is a field on the tile and the composition palette groups by the served category with no frontend heuristic. The frontend renders whatever groups the backend names, so adding an element is a data change.

This is the rule the composition palette already follows, quoted from its own docstring: *"grouped by the composition's backend `category` ... reads the served category, no frontend heuristic."* The generate panel should not invent a second way of doing the same thing.

### 2.2 A choice shows what it does, before and after

He named the reference himself: the object palette, where each entry draws a real `PreviewThumb` of the composition at 66px, rendered by the map's own renderer rather than an illustration.

For an element, the equivalent is a small `stage` preview generated with that element's choice applied and nothing else changed. The machinery exists: `PreviewSubject` already has a `stage` kind that takes `options`, and its docstring already states the rule this has to follow:

> *"a preview that is not fed the same inputs is a picture of a different map, which is worse than no picture."*

So an element preview is built from the SAME options the build will use, differing only in the one choice being previewed.

"After adding it to the map" is the second half: once chosen, the element stays visible as a chip or a row with its thumbnail, so the panel shows what the map contains rather than what a set of dropdowns say.

### 2.3 Limits scale with the map

*"dynamic pathways limits based of size of the grid"*. Four pathways across a 40x40 is a different map from four across a 100x100, and offering the same list for both is offering a choice that does not work.

The limit belongs to the DATA, not to a frontend formula: a generator already serves its `grid` bounds (`cols: {min, max}`, `rows: {min, max}`), so it can serve the rule that turns a size into a ceiling. The frontend reads the rule and narrows the list; it does not invent the arithmetic. Same rule as everywhere else: the backend decides values, the frontend renders them.

A choice that the current size rules out is removed from the list rather than shown and rejected, and the panel says why the list is shorter.

---

## 3. What exists to build on

| Piece | State |
|---|---|
| `PreviewThumb` + `PreviewSubject` (`tile`, `composition`, `stage`) | Built. `stage` already accepts full options. |
| Whole-map peek on every option change (`onPeek`) | Built. Changing an option re-peeks the whole map. |
| Composition palette grouped by served category, with per-item previews | Built. This is the pattern to copy. |
| Option `requires`, one option gating another | Built, and is the only structure the flat list has. |
| A `group` or `category` on a generator option | **Missing.** |
| A per-choice preview | **Missing.** Only the whole map is previewed. |
| Any size-derived limit | **Missing.** Every generator offers 1 to 4 whatever the map's size. |
| Lake and beach as elements | **Missing.** `river` serves COURSES (through, divides, around), not kinds of body. The water tiles now carry river, lake and beach edges, so the art is ready and the generator is not. |

---

## 4. Build order

1. **Group the options.** A `group` on each served option, and the panel renders headed sections instead of a flat list. Cheapest change, and it is most of what "this is not clear" is about.
2. **Size-aware limits.** Serve the rule, narrow the list, say why.
3. **Per-choice previews.** A thumbnail beside each choice, built from the same options as the build.
4. **The chosen elements, shown.** What the map contains, as rows with thumbnails, rather than only as dropdown values.
5. **Elements the generator does not have yet**, lake and beach as real bodies, and authored entrances as an optional element over the default opening.

1 through 4 are presentation over data that mostly exists. 5 is generator work.

---

## 5. Checklist

- [ ] Every group and every limit comes from served data, no frontend heuristic
- [ ] Adding an element is optional and the default still builds a working map
- [ ] A preview is fed the same options as the build it previews
- [ ] A choice the size rules out is not offered, and the panel says why
- [ ] The panel shows what the map CONTAINS, not just what the controls are set to
- [ ] Judged at :3000
