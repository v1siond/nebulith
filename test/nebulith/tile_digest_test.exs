defmodule Nebulith.TileDigestTest do
  @moduledoc """
  A digest of the whole seeded tile catalog, so a refactor can be proved to change nothing.

  It joins through to the tileset's KEY rather than carrying `tileset_id`. The id is a serial, so it moves
  every time the table is rebuilt: the first version of this hashed it, which made the digest differ on every
  run of the same code and made the whole comparison worthless. A digest is only an oracle when the thing it
  covers is the DATA and nothing about how the row was stored.
  """
  use Nebulith.DataCase, async: false
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  @tag :dump
  test "digest" do
    TileSource.seed()

    %{rows: rows} =
      Repo.query!("""
      SELECT ts.key, t.label, i.image_path, t.height, t.category, t.title, t.color_role, t.settings
      FROM tiles t
      JOIN tilesets ts ON ts.id = t.tileset_id
      LEFT JOIN tile_images i ON i.tile_id = t.id AND i.tileset_id = t.tileset_id
      ORDER BY ts.key, t.label
      """)

    IO.puts(
      "TILE DIGEST #{Base.encode16(:erlang.md5(:erlang.term_to_binary(rows)))} over #{length(rows)} rows"
    )

    assert rows != []
  end
end
