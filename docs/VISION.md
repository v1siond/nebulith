# VISION: what this engine is for, and who it is for

The product decision behind every design decision. Read this before arguing about a feature, because most
arguments about features are really arguments about who the user is.

His words, 2026-09-16, given as context rather than as a task, which is exactly why it belongs written down.

---

## 1. The positioning, in one line

> *"basically I want to mix blender and godot/unity, but without being as poweful as each individually"*

Not a competitor to any of them. A deliberate middle.

---

## 2. Who the user is

> *"my engine is for users that don't necessarilly want to go all the way out to develop complex things with
> blender individually to import on another engine, they don't get all features, but in exchange, they can do
> most of what they'll need and they're frree to move to blender and other engines whenever they want"*

> *"mine is mainly as a playground for games, you might make an idea with my engine, then expand it on a more
> robust engine later, but mine will help you get to mvp and funding faster with crazy quality"*

So the user is someone with an IDEA and limited time, who wants to see it running and looking good before
committing to a full pipeline. The engine's job is to get them to a convincing MVP fast.

**The exit is a feature, not a failure.** "They are free to move to Blender and other engines whenever they
want" means nothing here should trap the work: formats should be exportable and the model should map onto
what a bigger engine expects. An engine that is easy to leave is one people are willing to enter.

---

## 3. Where AI belongs, and where it does not

> *"I know that there's AI that can create a game with prompts and what not, but at least i'm the type of
> person that prefers to have some level of control in each layer, there's more people like me in the world
> (I hope lol), so I want to use AI to deal with assets generation and other things like that, and help users
> focusing on developing their idea without worrying that much about the tile design part of it"*

The line is drawn at CONTROL:

| AI does | The person does |
|---|---|
| Asset generation, tile art, the parts that are labour | The idea, the design, the decisions in each layer |

This is a stance against prompt-to-game. The pitch is not "describe a game and get one", it is "keep your
hands on every layer, and stop doing the tedious part".

**What that implies for us:** every generated thing has to remain editable and inspectable afterwards. A tile
the AI drew is still a tile with settings a person can open and change. This is the same rule the catalog
already follows, and now it has a reason attached.

---

## 4. Simplify what other engines make confusing

> *"simplifying other things that tend to be confusing in engines UI, like physics, textures, animations,
> etc."*

Named explicitly: **physics, textures, animations**. Those are the three that
[`TILE-EFFECTS.md`](TILE-EFFECTS.md) is about, and this is why that framework exists in the shape it does: a
physics preset is a named piece of maths a person PICKS by its result, not a formula they write.

The general rule falls out of it: **when an engine normally exposes a control surface, we expose a CHOICE
backed by served data.** Not fewer capabilities, fewer decisions to make before seeing something.

---

## 5. The commercial shape

> *"I'm thinking on promotion the engine with a few games, platformers, short rpgs, short rts, short zelda
> rogue like games, short metroidvania, basically I'll do a dozens of games and I want to launch all of them
> in steam and as mobile apps with my engine and I want to public my engine as a product for anyone that
> wants it, all process will be recorded in youtube."*

Three things at once, and they constrain each other:

1. **A dozen small games**, across genres, shipped to Steam and mobile. These are the proof and the
   marketing. See [`STEAM-LAUNCH.md`](../../../insurance_apps/.claude-workspace/game-engine/STEAM-LAUNCH.md)
   in the workspace.
2. **The engine sold as a product** to anyone who wants it.
3. **The whole process recorded on YouTube.**

**What (1) demands of us that is easy to miss:** a dozen games across platformer, RPG, RTS, roguelike and
metroidvania means the engine cannot be a top-down isometric tool with a hard-coded genre. The genre spread
is a requirement, not an aspiration.

**What (3) demands:** the work has to be explicable on camera. A system that cannot be explained in a few
minutes is a system that will not survive the recording, which is a real design constraint and a good one.

---

## 6. How to use this document

When a design question comes up, ask it in this order:

1. Does this help someone get to a convincing MVP faster?
2. Does it keep the person in control of that layer, or take control away?
3. Is it a CHOICE backed by served data, or a control surface they have to understand first?
4. Does it still let them leave for Blender or Godot later?
5. Can it be explained on camera in a few minutes?

A feature that fails 2 or 3 is usually the right capability with the wrong interface.
