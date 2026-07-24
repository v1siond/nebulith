defmodule Nebulith.DataMigration.AsciiEmojiVocabularyParity do
  @moduledoc """
  Closes the ascii/emoji VOCABULARY gap on a LIVE DB: every tile LABEL present in one style is given a
  twin in the other, so a map painted or generated in one style never renders `?` in the other (Alexander:
  "full 1:1 vocabulary parity now"). Only the ART differs — each twin copies the SAME height/category/
  blocking as the row it mirrors (MAP-MODEL §4).

  `TileSource.seed_parity/0` is the one source of truth (also wired into a fresh `seed/0`), so this migration
  is a thin, surgical call: it INSERTS the gap labels (brand-new rows) and never rewrites the hand-tuned rows
  a full reseed would `replace_all`. Idempotent (upsert by [tileset_id, label]).

  Adds, per the parity pass:
    * 15 emoji-only GROUND labels (`desert`, `cobblestone`, …) → ascii ground tiles (ascii.json terrain);
    * 25 emoji-only flat-decor / standing-nature / structural labels (`rose`, `oak-tree`, `brick`, …) →
      ascii tiles reusing an existing glyph + baked mask, tinted by the emoji tile's colour;
    * 95 ascii-only labels (grounds, tree autotile pieces, the peak, the two flat-roof pieces) → emoji twins
      (a coloured square by hue, the 🟫/🍃 tree part-emoji, 🗻 for the peak).

  The genuinely-atomic emoji-only labels with NO ascii pattern (per-creature units, single-tile buildings,
  a few props/effects) are LEFT emoji-only and tracked as pending art direction in `Nebulith.TilesetParityTest`.
  """
  require Logger

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  def run do
    before = %{ascii: count("ascii"), emoji: count("emoji")}
    :ok = TileSource.seed_parity()
    now = %{ascii: count("ascii"), emoji: count("emoji")}

    Logger.info(
      "[data_migrate] ascii/emoji vocabulary parity " <>
        "(ascii #{before.ascii}->#{now.ascii}, emoji #{before.emoji}->#{now.emoji})"
    )

    :ok
  end

  defp count(key), do: length(Catalog.list_tiles_for(key))
end
