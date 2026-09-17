defmodule Nebulith.Catalog.UiSource do
  @moduledoc """
  The SEED for the player-UI model: the action catalog, and the DEFAULT profile.

  That default is this profile, the UI the product ships with
  today, moved rather than redesigned. Every chord and every placement was dumped out of the frontend
  (`shortcuts.ts`, `playerUi.data.ts`) and generated into this file, so the seed cannot have drifted from
  what shipped.

  A game with no profile of its own uses this one. A game that wants its own copies it.
  """
  import Ecto.Query, warn: false

  alias Nebulith.Repo
  alias Nebulith.Catalog.Ui.{Action, Binding, Bar, BarSlot, Element, Profile}

  @default_key "default"

  @doc "Every bindable action the engine understands, in menu order."
  def actions do
    [
      %{key: "move_up", category: "movement", label: "Move up", default_chord: "W / ↑", position: 0},
      %{key: "move_down", category: "movement", label: "Move down", default_chord: "S / ↓", position: 1},
      %{key: "move_left", category: "movement", label: "Move left", default_chord: "A / ←", position: 2},
      %{key: "move_right", category: "movement", label: "Move right", default_chord: "D / →", position: 3},
      %{key: "run", category: "movement", label: "Run", default_chord: "Shift", position: 4},
      %{key: "jump", category: "movement", label: "Jump", default_chord: "Space", position: 5},
      %{key: "attack_primary", category: "combat", label: "Attack primary", default_chord: "F", position: 6},
      %{key: "attack_special", category: "combat", label: "Attack special", default_chord: "G", position: 7},
      %{key: "power_1", category: "combat", label: "Power 1", default_chord: "1", position: 8},
      %{key: "power_2", category: "combat", label: "Power 2", default_chord: "2", position: 9},
      %{key: "power_3", category: "combat", label: "Power 3", default_chord: "3", position: 10},
      %{key: "power_4", category: "combat", label: "Power 4", default_chord: "4", position: 11},
      %{key: "interact", category: "world", label: "Interact", default_chord: "E / Enter", position: 12},
      %{key: "target_next", category: "world", label: "Target next", default_chord: "Tab", position: 13},
      %{key: "open_bag", category: "interface", label: "Open bag", default_chord: "I", position: 14},
      %{key: "open_journal", category: "interface", label: "Open journal", default_chord: "Q", position: 15},
      %{key: "select", category: "mouse", label: "Select", default_chord: "mouse_left", position: 16},
      %{key: "context", category: "mouse", label: "Context", default_chord: "mouse_right", position: 17},
      %{key: "camera_pan", category: "mouse", label: "Camera pan", default_chord: "mouse_middle", position: 18}
    ]
  end

  @doc "The default profile's HUD placements, per form."
  def elements do
    [
      %{element_key: "vitals", form: "Desktop", placement: %{
          "a" => "BL",
          "x" => 16,
          "y" => 16,
          "w" => 256,
          "h" => 64,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "action_bar", form: "Desktop", placement: %{
          "a" => "BC",
          "x" => 0,
          "y" => 16,
          "w" => 208,
          "h" => 46,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "quest_tracker", form: "Desktop", placement: %{
          "a" => "TC",
          "x" => 0,
          "y" => 80,
          "w" => 288,
          "h" => 84,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "fps", form: "Desktop", placement: %{
          "a" => "TR",
          "x" => 16,
          "y" => 16,
          "w" => 92,
          "h" => 24,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 30
        }},
      %{element_key: "exit", form: "Desktop", placement: %{
          "a" => "TL",
          "x" => 16,
          "y" => 16,
          "w" => 104,
          "h" => 30,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 30
        }},
      %{element_key: "select_hint", form: "Desktop", placement: %{
          "a" => "BC",
          "x" => 0,
          "y" => 74,
          "w" => 300,
          "h" => 28,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 20
        }},
      %{element_key: "trigger_msg", form: "Desktop", placement: %{
          "a" => "BC",
          "x" => 0,
          "y" => 108,
          "w" => 250,
          "h" => 34,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 40
        }},
      %{element_key: "win_lose", form: "Desktop", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 290,
          "h" => 110,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 50
        }},
      %{element_key: "bag_panel", form: "Desktop", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 320,
          "h" => 176,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 30
        }},
      %{element_key: "journal_panel", form: "Desktop", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 300,
          "h" => 168,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 30
        }},
      %{element_key: "debug_legend", form: "Desktop", placement: %{
          "a" => "BL",
          "x" => 16,
          "y" => 16,
          "w" => 176,
          "h" => 58,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 20
        }},
      %{element_key: "vitals", form: "Mobile", placement: %{
          "a" => "TL",
          "x" => 10,
          "y" => 10,
          "w" => 150,
          "h" => 40,
          "s" => 0.85,
          "o" => 1,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "action_bar", form: "Mobile", placement: %{
          "a" => "BC",
          "x" => 0,
          "y" => 14,
          "w" => 190,
          "h" => 52,
          "s" => 1.1,
          "o" => 1,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "quest_tracker", form: "Mobile", placement: %{
          "a" => "TC",
          "x" => 0,
          "y" => 58,
          "w" => 190,
          "h" => 60,
          "s" => 0.85,
          "o" => 0.9,
          "on" => true,
          "z" => 20
        }},
      %{element_key: "fps", form: "Mobile", placement: %{
          "a" => "TR",
          "x" => 8,
          "y" => 8,
          "w" => 78,
          "h" => 20,
          "s" => 0.8,
          "o" => 0.7,
          "on" => false,
          "z" => 30
        }},
      %{element_key: "exit", form: "Mobile", placement: %{
          "a" => "TR",
          "x" => 8,
          "y" => 34,
          "w" => 84,
          "h" => 28,
          "s" => 1,
          "o" => 1,
          "on" => true,
          "z" => 30
        }},
      %{element_key: "select_hint", form: "Mobile", placement: %{
          "a" => "BC",
          "x" => 0,
          "y" => 72,
          "w" => 200,
          "h" => 26,
          "s" => 0.9,
          "o" => 1,
          "on" => false,
          "z" => 20
        }},
      %{element_key: "trigger_msg", form: "Mobile", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 60,
          "w" => 200,
          "h" => 32,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 40
        }},
      %{element_key: "win_lose", form: "Mobile", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 220,
          "h" => 110,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 50
        }},
      %{element_key: "bag_panel", form: "Mobile", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 230,
          "h" => 170,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 30
        }},
      %{element_key: "journal_panel", form: "Mobile", placement: %{
          "a" => "MC",
          "x" => 0,
          "y" => 0,
          "w" => 230,
          "h" => 170,
          "s" => 1,
          "o" => 1,
          "on" => false,
          "z" => 30
        }},
      %{element_key: "debug_legend", form: "Mobile", placement: %{
          "a" => "BL",
          "x" => 10,
          "y" => 66,
          "w" => 150,
          "h" => 50,
          "s" => 0.8,
          "o" => 0.8,
          "on" => false,
          "z" => 20
        }}
    ]
  end

  @doc """
  What a PLAYER may change in the default profile.

  His Q2: So keys yes, layout no, until an author says otherwise.
  """
  def player_may, do: %{"keys" => true, "layout" => false, "settings" => true}

  @doc "Seed the catalog and the default profile. Idempotent: upserts by key."
  def seed do
    Enum.each(actions(), &upsert_action/1)
    profile = upsert_profile()
    seed_bindings(profile)
    seed_elements(profile)
    seed_bars(profile)

    %{actions: length(actions()), elements: length(elements()), profile: profile.key}
  end

  defp upsert_action(attrs) do
    case Repo.get_by(Action, key: attrs.key) do
      nil -> %Action{}
      found -> found
    end
    |> Action.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  defp upsert_profile do
    case Repo.get_by(Profile, key: @default_key) do
      nil -> %Profile{}
      found -> found
    end
    |> Profile.changeset(%{key: @default_key, name: "Default", player_may: player_may()})
    |> Repo.insert_or_update!()
  end

  # One binding per action, on the key the engine ships it with. An author adds alternates; the seed
  # states only what the product does today.
  defp seed_bindings(profile) do
    Repo.delete_all(from b in Binding, where: b.profile_id == ^profile.id)

    actions()
    |> Enum.with_index()
    |> Enum.each(fn {a, i} ->
      %Binding{}
      |> Binding.changeset(%{
        profile_id: profile.id,
        action_key: a.key,
        input: a.default_chord,
        position: i
      })
      |> Repo.insert!()
    end)
  end

  defp seed_elements(profile) do
    Repo.delete_all(from e in Element, where: e.profile_id == ^profile.id)

    Enum.each(elements(), fn e ->
      %Element{}
      |> Element.changeset(Map.put(e, :profile_id, profile.id))
      |> Repo.insert!()
    end)
  end

  # ONE bar to start, always up, holding the power slots the product already binds to 1-4. Unlimited bars
  # is the model (the Q6); one is what ships.
  defp seed_bars(profile) do
    Repo.delete_all(from b in Bar, where: b.profile_id == ^profile.id)

    bar =
      %Bar{}
      |> Bar.changeset(%{
        profile_id: profile.id,
        name: "Powers",
        position: 0,
        rows: 1,
        cols: 4,
        settings: %{"buttonPx" => 44, "gapPx" => 6, "showKeys" => true, "showCooldown" => true, "showEmpty" => true},
        condition: nil
      })
      |> Repo.insert!()

    for slot <- 0..3 do
      %BarSlot{}
      |> BarSlot.changeset(%{bar_id: bar.id, slot: slot, ref_kind: "action", ref_key: "power_#{slot + 1}"})
      |> Repo.insert!()
    end
  end

  @doc """
  The profile a game uses: its own if it has one, else the seeded default.

  No game asked for (`nil`) goes straight to the default rather than querying for `game_id == nil`, in SQL
  that comparison is never true, and Ecto refuses it outright for exactly that reason.
  """
  def profile_for(nil), do: default_profile()

  def profile_for(game_id) do
    Repo.one(from p in Profile, where: p.game_id == ^game_id) || default_profile()
  end

  defp default_profile, do: Repo.one(from p in Profile, where: p.key == ^@default_key)

  @doc """
  The profile a GAME may edit, creating it on first write.

  COPY-ON-WRITE, and it matters: the seeded default is shared by every game that has not customised its UI,
  so the first time one game moves a bar it must get its OWN profile rather than editing everyone's. The
  copy carries the default's bindings, elements and bars, so a game starts from exactly what it was already
  showing (his Q1:, you start from it, you do not lose it).
  """
  def editable_profile(nil), do: default_profile()

  def editable_profile(game_id) do
    case Repo.one(from p in Profile, where: p.game_id == ^game_id) do
      nil -> fork_default(game_id)
      found -> found
    end
  end

  defp fork_default(game_id) do
    source = default_profile() |> load()

    mine =
      %Profile{}
      |> Profile.changeset(%{
        key: "game-#{game_id}",
        name: "This game's UI",
        game_id: game_id,
        player_may: (source && source.player_may) || player_may()
      })
      |> Repo.insert!()

    if source do
      for b <- source.bindings do
        %Binding{}
        |> Binding.changeset(%{profile_id: mine.id, action_key: b.action_key, input: b.input, editable: b.editable, position: b.position})
        |> Repo.insert!()
      end

      for e <- source.elements do
        %Element{}
        |> Element.changeset(%{profile_id: mine.id, element_key: e.element_key, form: e.form, placement: e.placement, editable: e.editable})
        |> Repo.insert!()
      end

      for bar <- source.bars do
        copy =
          %Bar{}
          |> Bar.changeset(%{profile_id: mine.id, name: bar.name, position: bar.position, rows: bar.rows, cols: bar.cols, settings: bar.settings, condition: bar.condition})
          |> Repo.insert!()

        for slot <- bar.slots do
          %BarSlot{}
          |> BarSlot.changeset(%{bar_id: copy.id, slot: slot.slot, ref_kind: slot.ref_kind, ref_key: slot.ref_key})
          |> Repo.insert!()
        end
      end
    end

    mine
  end

  @doc """
  Replace a profile's BARS with the list given.

  Replace rather than patch because a bar list is ordered and a save can add, remove and reorder in one
  gesture; reconciling that per-row would be more moving parts than the thing is worth. Slots ride with
  their bar, since a slot has no meaning without one.
  """
  def put_bars(profile, bars) when is_list(bars) do
    Repo.delete_all(from b in Bar, where: b.profile_id == ^profile.id)

    for {bar, index} <- Enum.with_index(bars) do
      row =
        %Bar{}
        |> Bar.changeset(%{
          profile_id: profile.id,
          name: bar["name"],
          position: index,
          rows: bar["rows"] || 1,
          cols: bar["cols"] || 6,
          settings: bar["settings"] || %{},
          condition: bar["condition"]
        })
        |> Repo.insert!()

      for slot <- bar["slots"] || [] do
        %BarSlot{}
        |> BarSlot.changeset(%{bar_id: row.id, slot: slot["slot"], ref_kind: slot["refKind"], ref_key: slot["refKey"]})
        |> Repo.insert!()
      end
    end

    :ok
  end

  @doc "Replace a profile's element placements for the forms present in the list."
  def put_elements(profile, elements) when is_list(elements) do
    for e <- elements do
      attrs = %{
        profile_id: profile.id,
        element_key: e["elementKey"],
        form: e["form"],
        placement: e["placement"] || %{},
        editable: Map.get(e, "editable", true)
      }

      case Repo.one(from x in Element,
             where: x.profile_id == ^profile.id and x.element_key == ^attrs.element_key and x.form == ^attrs.form) do
        nil -> %Element{}
        found -> found
      end
      |> Element.changeset(attrs)
      |> Repo.insert_or_update!()
    end

    :ok
  end

  @doc "Every action in the catalog, in menu order."
  def list_actions, do: Repo.all(from a in Action, order_by: [asc: a.position, asc: a.key])

  @doc "A profile with its bindings, elements and bars loaded."
  def load(nil), do: nil
  def load(profile), do: Repo.preload(profile, [:bindings, :elements, bars: :slots])
end
