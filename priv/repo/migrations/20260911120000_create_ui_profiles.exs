defmodule Nebulith.Repo.Migrations.CreateUiProfiles do
  use Ecto.Migration

  @moduledoc """
  THE PLAYER-UI MODEL — the HUD, the keys and the bars, as data.

  The spec for this is `2026-09-06-ui-system-spec-and-plan.md` §2.3, and Alexander answered its open
  questions the same day. The answers are what this schema is shaped by:

  * **One profile per GAME, plus a seeded default** (his Q1) — *"these profiles would basically act as game
    settings, and we'd always offer an easy default set"*. `game_id` nil IS the default profile.
  * **Author and player, with author-controlled limits** (Q2) — *"authors have the ability to build the UI
    they want and also limit it's editability, players are allowed to do only as much as the game author
    allows"*. Hence `editable` on a binding and on an element, owned by the author.
  * **Unlimited bars, no paging, with CONDITIONAL swapping** (Q6) — *"allow user to create as much bars as
    they need, no pagination. But do support things like conditional swapping, I'd like to be able to
    activate bars when certain things happen"*. Hence `ui_bars.condition`, a jsonb rule rather than a
    boolean: the trigger kinds he listed (event, quest action, vehicle, object, ability) are open-ended.
  * **Bars are player-only** (Q7) — so there is no unit/enemy bar here; an enemy's attacks are its own.
  * **Desktop AND mobile layouts** (Q9) — *"I'd like to be able to make a desktop AND mobile layout, where
    depending on screensize, either activates"*. Hence `form` on an element row: one profile carries both.

  `ui_actions` is the seeded ACTION CATALOG and is read-only to the frontend: it names what CAN be bound
  (move_up, attack_primary, power_1…), which is engine capability rather than per-game taste.
  """

  def change do
    # WHAT CAN BE BOUND. Seeded from the engine's own capabilities; a game does not invent actions.
    create table(:ui_actions, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :category, :string, null: false
      add :label, :string, null: false
      # What the engine ships bound to it, shown as the "default" a player can reset to.
      add :default_chord, :string
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:ui_actions, [:key])

    # ONE COMPLETE UI CONFIGURATION. `game_id` nil = the seeded default every new game starts from.
    create table(:ui_profiles, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :name, :string, null: false
      add :game_id, references(:games, type: :binary_id, on_delete: :delete_all)
      # What a PLAYER may change in this profile, as the author allows: keys, layout, both or neither.
      add :player_may, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:ui_profiles, [:key])
    create index(:ui_profiles, [:game_id])

    # ONE INPUT → ONE ACTION. Several rows per action is how an alternate binding is expressed.
    create table(:ui_bindings, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :profile_id, references(:ui_profiles, type: :binary_id, on_delete: :delete_all), null: false
      add :action_key, :string, null: false
      # "KeyW" / "Space" / "mouse:right" — the input as the browser names it.
      add :input, :string, null: false
      add :editable, :boolean, null: false, default: true
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:ui_bindings, [:profile_id])
    create unique_index(:ui_bindings, [:profile_id, :action_key, :input])

    # ONE HUD ELEMENT, per FORM. A profile carries a Desktop row and a Mobile row for the same element.
    create table(:ui_elements, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :profile_id, references(:ui_profiles, type: :binary_id, on_delete: :delete_all), null: false
      add :element_key, :string, null: false
      add :form, :string, null: false
      # anchor + offset + size + scale + opacity + z + on — the placement model, whole.
      add :placement, :map, null: false, default: %{}
      add :editable, :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create index(:ui_elements, [:profile_id])
    create unique_index(:ui_elements, [:profile_id, :element_key, :form])

    # A BAR. Unlimited per profile, no paging, and it may carry a condition that decides when it shows.
    create table(:ui_bars, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :profile_id, references(:ui_profiles, type: :binary_id, on_delete: :delete_all), null: false
      add :name, :string
      add :position, :integer, null: false, default: 0
      add :rows, :integer, null: false, default: 1
      add :cols, :integer, null: false, default: 6
      # button size, gap, show keys / cooldown / empty slots, text + font
      add :settings, :map, null: false, default: %{}
      # WHEN this bar is up. Nil = always. Otherwise a rule: {"when": "ability", "id": …} and so on.
      add :condition, :map

      timestamps(type: :utc_datetime)
    end

    create index(:ui_bars, [:profile_id])

    # ONE BUTTON on a bar. Empty slots are rows too, so a bar's shape is explicit rather than inferred.
    create table(:ui_bar_slots, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :bar_id, references(:ui_bars, type: :binary_id, on_delete: :delete_all), null: false
      add :slot, :integer, null: false
      # What the button DOES: an ability key, an item slug, or an action key. Nil = a deliberate blank.
      add :ref_kind, :string
      add :ref_key, :string

      timestamps(type: :utc_datetime)
    end

    create index(:ui_bar_slots, [:bar_id])
    create unique_index(:ui_bar_slots, [:bar_id, :slot])
  end
end
