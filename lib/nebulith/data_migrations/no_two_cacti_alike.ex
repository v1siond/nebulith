defmodule Nebulith.DataMigration.NoTwoCactiAlike do
  @moduledoc """
  Seven cactus forms instead of three, so a desert stops repeating one silhouette.

  *"add some type of cactus randomizer, we can't have all of them looking the same"*.

  ## Where the variety comes from

  Not from jitter. From AGE and from asymmetry, which is what actually varies on real ones:

      cactus_saguaro_young   no arms yet, a short column
      cactus_saguaro_one     a single arm, on one side
      cactus_saguaro         two arms, the right one taller
      cactus_saguaro_old     taller still, with a third arm higher up the trunk
      cactus_barrel          one squat dome
      cactus_barrel_pair     a large one with a small one beside it
      cactus_prickly         two pads
      cactus_prickly_tall    three pads, stepping sideways as they climb

  A saguaro grows its first arm at around 70 years, so a stand of them is a stand of different ages. That
  gives four honestly different silhouettes without a single new tile, and the existing weighted mix is the
  randomiser: the generator already rolls a species per cell.

  The young form is weighted heaviest, because in a real stand the armless young outnumber the old giants.

  ## Why not per-instance jitter

  It was the obvious alternative and it is worse here. Jittering height or width per instance makes every
  cactus a slightly different size of the SAME shape, which reads as sloppy rather than varied, and it puts
  a rule in the generator that the catalog cannot see. Separate forms stay inspectable and editable, which
  `VISION.md` requires of anything generated.

  Idempotent: sets stated mixes by name.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_compositions()

    # THE MIXES ARE NOT WRITTEN FROM HERE ANY MORE. `GeneratorSource.seed/0` writes `generators.config`
    # WHOLE, so a desert mix set by this pass was a second owner and the next seed decided it. The seven
    # cactus forms are stated in the seeder; what is left here is composing them.
    Logger.info("[data_migrate] seven cactus forms composed")

    :ok
  end
end
