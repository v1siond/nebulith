defmodule Nebulith.LevelsTest do
  @moduledoc """
  THE LEVEL LAYER. and on why it has to be real rather than a naming convention:

  Four caves and a jungle are FIVE maps and ONE level. Everything below is that sentence.
  """
  use Nebulith.DataCase

  alias Nebulith.{Games, Levels}

  setup do
    {:ok, game} = Games.create_game(%{"name" => "Mario"})
    %{game: game}
  end

  describe "a game has many levels, in play order" do
    test "lists them by position, not by when they were made", %{game: game} do
      {:ok, _} = Levels.create_level(game.id, %{"name" => "1-2", "position" => 1})
      {:ok, _} = Levels.create_level(game.id, %{"name" => "1-1", "position" => 0})
      {:ok, _} = Levels.create_level(game.id, %{"name" => "1-3", "position" => 2})

      assert Enum.map(Levels.list_levels(game.id), & &1.name) == ["1-1", "1-2", "1-3"]
    end

    test "a new level lands at the END, not on top of the one already there", %{game: game} do
      # Defaulting position to 0 would collide with the existing level on the unique index. A new level is
      # the next one you are building.
      {:ok, first} = Levels.create_level(game.id, %{"name" => "1-1"})
      {:ok, second} = Levels.create_level(game.id, %{"name" => "1-2"})
      {:ok, third} = Levels.create_level(game.id, %{"name" => "1-3"})

      assert [first.position, second.position, third.position] == [0, 1, 2]
    end

    test "two games can each have their own 1-1", %{game: game} do
      {:ok, other} = Games.create_game(%{"name" => "Sonic"})
      assert {:ok, _} = Levels.create_level(game.id, %{"name" => "1-1", "position" => 0})
      assert {:ok, _} = Levels.create_level(other.id, %{"name" => "1-1", "position" => 0})
    end

    test "but ONE game cannot have two levels in the same slot", %{game: game} do
      {:ok, _} = Levels.create_level(game.id, %{"name" => "1-1", "position" => 0})
      assert {:error, changeset} = Levels.create_level(game.id, %{"name" => "clash", "position" => 0})
      assert "has already been taken" in errors_on(changeset).game_id
    end

    test "a level needs a name and a game, it cannot float loose", %{game: game} do
      assert {:error, changeset} = Levels.create_level(game.id, %{"description" => "nameless"})
      assert "can't be blank" in errors_on(changeset).name
    end
  end

  describe "a level has many templates, the jungle and its four caves" do
    test "holds the whole set, in order, as ONE level", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle"})
      maps = ["jungle", "cave-a", "cave-b", "cave-c", "cave-d"]
      level = Levels.set_templates(level, maps)

      # His exact example: five maps, one level.
      assert Levels.template_ids(level) == maps
    end

    test "accepts the frontend's camelCase templateIds on create", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a", "b"]})
      assert Levels.template_ids(level) == ["a", "b"]
    end

    test "REPLACES the set on update rather than merging into it", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a", "b", "c"]})
      {:ok, level} = Levels.update_level(level, %{"templateIds" => ["c", "a"]})

      assert Levels.template_ids(level) == ["c", "a"]
    end

    test "adding is idempotent, and adds to the END", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a"]})
      level = Levels.add_template(level, "b")
      level = Levels.add_template(level, "b")

      assert Levels.template_ids(level) == ["a", "b"]
    end

    test "removing keeps the rest in order", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a", "b", "c"]})
      level = Levels.remove_template(level, "b")

      assert Levels.template_ids(level) == ["a", "c"]
    end

    test "drops blanks and duplicates rather than storing them", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle"})
      level = Levels.set_templates(level, ["a", "", "b", "a", nil, "c"])

      assert Levels.template_ids(level) == ["a", "b", "c"]
    end
  end

  describe "reordering" do
    test "renumbers to exactly the list it is given", %{game: game} do
      for name <- ["1-1", "1-2", "1-3"], do: {:ok, _} = Levels.create_level(game.id, %{"name" => name})
      ids = Levels.list_levels(game.id) |> Enum.map(& &1.id)

      moved = Levels.reorder(game.id, [Enum.at(ids, 2), Enum.at(ids, 0), Enum.at(ids, 1)])

      assert Enum.map(moved, & &1.name) == ["1-3", "1-1", "1-2"]
      assert Enum.map(moved, & &1.position) == [0, 1, 2]
    end

    test "SWAPPING two levels does not trip the one-level-per-slot rule", %{game: game} do
      # The reason reorder moves everything out of the way first: renumbering in place means that for a
      # moment two levels both claim slot 0, and the unique index is right to refuse that.
      {:ok, a} = Levels.create_level(game.id, %{"name" => "1-1"})
      {:ok, b} = Levels.create_level(game.id, %{"name" => "1-2"})

      assert Enum.map(Levels.reorder(game.id, [b.id, a.id]), & &1.name) == ["1-2", "1-1"]
    end
  end

  describe "deleting" do
    test "deleting a level takes its template memberships with it (no orphans)", %{game: game} do
      {:ok, level} = Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a", "b"]})
      assert Repo.aggregate(Nebulith.Games.LevelTemplate, :count) == 2

      {:ok, _} = Levels.delete_level(level)

      assert Repo.aggregate(Nebulith.Games.LevelTemplate, :count) == 0
    end

    test "deleting a GAME takes its levels with it", %{game: game} do
      {:ok, _} = Levels.create_level(game.id, %{"name" => "1-1", "templateIds" => ["a"]})

      {:ok, _} = Games.delete_game(game)

      assert Levels.list_levels(game.id) == []
      assert Repo.aggregate(Nebulith.Games.LevelTemplate, :count) == 0
    end

    test "a missing level answers not_found rather than raising", %{game: _game} do
      assert {:error, :not_found} = Levels.get_level(Ecto.UUID.generate())
    end
  end
end
