defmodule Nebulith.AGameIsMadeInAStyleTest do
  @moduledoc """
  A GAME CARRIES THE ART STYLE IT IS MADE IN, and a person chooses it.

  `docs/SPEC.md` phase 1 REWIRE, quoting him: *"I like the versatility of having one art style per map, but
  I do want to be able to set the default at the game table level instead of hardcoding ascii."* The
  sentence after it is *"Creating a game asks for its name and its art style."*

  ## What was measured before

  `games.default_tileset_id` existed, a data migration backfilled it to the first style, and
  `MapController` served it behind a map's own `tileset_id`. Nothing in the application ever WROTE it: the
  games screen called `createGame({ name })` and no other call site named the field. So the game-level
  default the ticket asked for was a column a person could not reach, and the per-map override had nothing
  to override.

  ## And the translation that would have swallowed it

  The frontend spells the field `defaultTilesetId` and the column is `default_tileset_id`. `Games.normalize/1`
  translated ONE key by hand, `lastTemplateId`, so this one would have arrived unrecognised and been
  dropped by `cast` in silence, which is law 10: *"Anything that copies a record field by field must be
  generated from the schema, never typed out."* The map is asked of the schema now, so every field of the
  game carries across in both spellings. That is what the last test here pins.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Catalog
  alias Nebulith.Games

  import Nebulith.AccountsFixtures

  setup do
    {:ok, ascii} = Catalog.create_tileset(%{key: "ascii", name: "ASCII", position: 0})
    {:ok, emoji} = Catalog.create_tileset(%{key: "emoji", name: "Emoji", position: 1})
    %{user: user_fixture(), ascii: ascii, emoji: emoji}
  end

  test "a game keeps the style it was created in", %{user: user, emoji: emoji} do
    {:ok, game} =
      Games.create_game(user, %{"name" => "Made in emoji", "defaultTilesetId" => emoji.id})

    assert game.default_tileset_id == emoji.id,
           "the style was chosen at creation and the game did not keep it"

    assert Games.get_game(user, game.id).default_tileset_id == emoji.id,
           "the style did not survive being read back"
  end

  test "the style can be changed afterwards, which is the other half of what he asked for", %{
    user: user,
    ascii: ascii,
    emoji: emoji
  } do
    {:ok, game} =
      Games.create_game(user, %{"name" => "Started ascii", "defaultTilesetId" => ascii.id})

    {:ok, changed} = Games.update_game(user, game.id, %{"defaultTilesetId" => emoji.id})

    assert changed.default_tileset_id == emoji.id,
           "a game's style could not be changed after creation"
  end

  test "a game created without a style states none, rather than inventing one", %{user: user} do
    {:ok, game} = Games.create_game(user, %{"name" => "No style stated"})

    assert game.default_tileset_id == nil,
           "a game nobody chose a style for came back claiming one, which is a hardcoded default"
  end

  test "every field of a game crosses in both spellings, because the map is asked of the schema",
       %{
         user: user,
         emoji: emoji
       } do
    # Both halves of the same field, to prove the translation is not a list somebody has to remember to
    # extend. `default_tileset_id` is the field that would have been dropped by the old hand-written one.
    {:ok, camel} = Games.create_game(user, %{"name" => "Camel", "defaultTilesetId" => emoji.id})
    {:ok, snake} = Games.create_game(user, %{"name" => "Snake", "default_tileset_id" => emoji.id})

    assert camel.default_tileset_id == emoji.id
    assert snake.default_tileset_id == emoji.id

    # …and the same for the field that WAS in the old list, so this cannot pass by having swapped one
    # hand-written entry for another.
    {:ok, last} = Games.create_game(user, %{"name" => "Last", "lastTemplateId" => "a-template"})

    assert last.last_template_id == "a-template"
  end
end
