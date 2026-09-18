defmodule Nebulith.DataMigration.ASettingIsStatedNotGuessed do
  @moduledoc """
  State every render setting on every tile, so the engine never has to invent one.

  *"I don't ever wanna have xx ?? y. JUST FUCKING SET THE SETTING DIRECTLY... the default shouldn't
  happen at the engine level, it should happen at the setting level."*

  ## What was wrong

  A census of the engine found **116 reads** shaped `something.setting ?? <literal>`. Each one is the
  engine deciding what the data failed to say, and every one of them is a place two readers can
  disagree. Two already had:

    * `display`   the renderer resolved instance then TILE, the panel read the instance and `??`-ed
                  'all-faces'. A rock served as 'single' drew one face and reported "All".
    * `actAsTile` the engine treats absent as FALSE (`assetSetting(...) === true`), the panel `??`-ed
                  TRUE. For 632 of 636 tiles those are opposite answers.

  The defaults could not simply be deleted, because the data did not carry them: `display` was stated
  on 26 of 636 tiles, `transparent` on 26, `actAsTile` on 4, `shape` on 0.

  ## What this writes

  Each tile that does not state one gets it, **at the value the engine invents today**, so the first
  render after this migration is pixel-identical. The point is not to change any picture. The point is
  that the value becomes DATA: visible in the panel, editable, and the same number the engine reads.

      display      all-faces   paint the art on every visible face
      transparent  false       draw the block shell
      actAsTile    false       a tile does NOT stand in for a tile already in the cell
      shape        square      a cube

  `actAsTile` is seeded FALSE on purpose, matching the engine. The panel claimed true; the panel was
  wrong, and after this it says what the engine does.

  A tile that already states a setting keeps it. This only fills silence.
  """
  require Logger

  alias Nebulith.Repo

  @defaults %{
    "display" => "all-faces",
    "transparent" => false,
    "actAsTile" => false,
    "shape" => "square"
  }

  def run do
    filled = Enum.map(@defaults, fn {setting, value} -> {setting, state(setting, value)} end)
    said = Enum.map_join(filled, ", ", fn {s, n} -> "#{s} on #{n}" end)
    Logger.info("[data_migrate] a setting is stated, not guessed: #{said}")
    :ok
  end

  # `jsonb_exists` rather than the `?` operator, which collides with Postgrex's own placeholder syntax.
  # The setting name is interpolated because it comes from @defaults above, never from input.
  defp state(setting, value) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
           SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{#{setting}}', $1::text::jsonb, true)
         WHERE NOT jsonb_exists(COALESCE(settings, '{}'::jsonb), $2)
        """,
        [Jason.encode!(value), setting]
      )

    rows
  end
end
