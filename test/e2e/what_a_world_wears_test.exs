defmodule Nebulith.E2E.WhatAWorldWearsTest do
  @moduledoc """
  A SPRING WOOD FLOWERS IN ITS TREES AND NOWHERE ELSE.

  Reported from a generated woodland: bushes and tall grass came out pink. Spring's canopy was three
  greens and a blossom in one served array, that array is what a per-cell variant picks from, and the
  undergrowth picks from it just as the crown does. One bush in four wore the blossom.

  `Nebulith.OnlyACanopyBlossomsTest` gates the DATA: every canopy row says where its leaves end, and
  nothing a shrub can reach is a shade the palette calls blossom. This is the other half, and it is
  the half that matches what he saw: a real browser signs in, builds a real spring woodland through
  the panel, and then every plant standing on that map is asked what colour it came out.

  ## Why spring, and why a woodland

  Spring is the only season that states a blossom, so it is the only one where this can go wrong.

  Woodland is `leafSeasonality: 1.0`, fully deciduous, which is what makes the check EXACT rather than
  approximate. `foliageColor` bends a shade's hue toward the biome by that number, so at 1.0 the hue
  that reaches the cell is the served shade's own hue plus the region's small shift (at most six
  degrees, and spring's blossom sits 138 degrees from its nearest leaf). Every placed colour therefore
  names the served shade it came from, with no ambiguity to argue about. In a jungle, at 0.05, every
  shade collapses onto the biome hue and the question could not be answered from a colour at all.

  ## It asks the served data what a blossom is

  The list of blossoms is not written down here. It is read from the same rows the engine reads:
  `leaf_center.settings.colors.spring` is the array and `settings.leafShades.spring` says how many of
  its entries are leaf. A test carrying its own copy of the palette passes the day the palette changes
  and the app does not.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8

  alias Nebulith.E2E.GeneratePanel

  # 60x60, because the rule is about how OFTEN a plant picks the blossom. A third of the shades on a
  # handful of bushes can come out green by luck; on a wood's worth of undergrowth it cannot.
  @size %{cols: 60, rows: 60}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a spring woodland flowers in its trees and nowhere else", %{session: session} do
    # THE SEASON COMES AFTER THE PRESET, which is the order the panel allows. The Season control lives in
    # the preview window, and the preview window is mounted by picking a preset, so asking for a season
    # first finds no control at all.
    session =
      session
      |> GeneratePanel.choose_category("wilderness")
      |> GeneratePanel.choose_preset("Woodland")
      |> GeneratePanel.choose_season("spring")
      |> GeneratePanel.build()

    report = worn_colours(session)

    assert report["assets"] > 500,
           "refusing to judge an empty wood: the map holds #{report["assets"]} tiles, so it never built"

    assert length(report["shades"]) > report["leafCount"],
           "spring serves #{length(report["shades"])} canopy shades and calls all #{report["leafCount"]} " <>
             "of them leaf, so there is no blossom on this map and this proves nothing"

    # AND SOMETHING WAS ACTUALLY JUDGED. Every line below is about plants wearing a canopy shade, and
    # every one of them passes trivially on a wood where nothing grew.
    assert report["judged"] > 100,
           "only #{report["judged"]} of #{report["assets"]} tiles came out wearing a spring canopy " <>
             "shade at all, which is too few to say anything about how often one picks the blossom"

    # THE THING HE SAW. Anything that is not a tree's canopy, wearing the blossom.
    assert report["wrongCount"] == 0,
           "#{report["wrongCount"]} tiles that are not a tree canopy came out wearing spring's " <>
             "blossom: #{Enum.join(report["wrong"], ", ")}"

    # AND THE HALF THAT MUST SURVIVE. Taking the blossom off the undergrowth by deleting it from the
    # palette would satisfy the line above and lose spring, which is not what was asked for.
    assert report["floweredCount"] > 0,
           "no tree on a spring woodland came out in blossom, so spring was removed rather than " <>
             "confined to the canopy"
  end

  # EVERY PLACED LEAF, ASKED WHICH SERVED SHADE IT IS.
  #
  # Nearest hue, because the region shifts a leaf by a few degrees on its way to the cell, and spring's
  # blossom sits 138 degrees from its nearest green, so nearest is exact for anything that came out of
  # that array.
  #
  # ONLY for things that came out of that array, which is the part worth stating. "Nearest of these
  # four" is a meaningless question to ask of a colour with another source: the first draft asked it of
  # every placed tile and filed 1,343 tan `meadow` floors at `#cfa37b` as blossom, because 66 degrees
  # from the pink happened to beat 72 from the nearest green. So the population is the tiles the rule is
  # about, foliage and canopy, and a colour further than a region's own shift from every shade is left
  # alone as something this has no business judging.
  #
  # A tile whose label resolves to no served row is reported as such rather than counted as a defect,
  # because that would be this join being wrong, not the world being wrong.
  defp worn_colours(session) do
    Browser.js(session, """
    (async () => {
      const body = await (await fetch('/api/tilesets')).json()
      const style = (body.data || []).find(t => t.key === 'ascii') || {}
      const tiles = style.tiles || {}
      const leaf = tiles['leaf_center'] || tiles['leaf_top'] || {}
      const shades = ((leaf.settings || {}).colors || {})['spring'] || []
      const counts = (leaf.settings || {}).leafShades || {}
      const leafCount = typeof counts['spring'] === 'number' ? counts['spring'] : shades.length

      const hueOf = (hex) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
        if (!m) return null
        const n = parseInt(m[1], 16)
        const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
        if (d === 0) return null
        let h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
        return ((h * 60) % 360 + 360) % 360
      }

      const apart = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

      // A region moves a leaf by at most six degrees on its way to the cell. Twice that is room for the
      // rounding through hsv and back, and still a fifth of the gap to the next shade.
      const REGION_SHIFT = 12

      const hues = shades.map(hueOf)
      const nearest = (h) => {
        let best = -1, bestApart = Infinity
        hues.forEach((sh, i) => {
          if (sh === null) return
          const d = apart(h, sh)
          if (d < bestApart) { bestApart = d; best = i }
        })
        return bestApart <= REGION_SHIFT ? best : -1
      }

      const assets = window.__nebulithGrid?.assets ?? []
      const wrong = [], flowered = []
      let judged = 0

      for (const a of assets) {
        const key = a.tileKey || a.label || ''
        const tile = tiles[key]
        if (!tile) continue
        // THE POPULATION THE RULE IS ABOUT: what grows. Everything else on the map has its colour from
        // somewhere that is not this array, so asking which of these shades it is nearest to is asking a
        // question with no answer.
        const role = tile.color_role
        const foliage = (tile.settings || {}).foliage === true
        if (!foliage && role !== 'canopy') continue
        const h = hueOf(a.color)
        if (h === null) continue
        const shade = nearest(h)
        if (shade < 0) continue
        judged++
        if (shade < leafCount) continue
        const where = `${key} [${role === undefined ? 'no such tile' : role}] at ${a.col},${a.row} ${a.color}`
        if (role === 'canopy') { flowered.push(where); continue }
        wrong.push(where)
      }

      return {
        assets: assets.length,
        judged,
        shades,
        leafCount,
        wrong: [...new Set(wrong)].slice(0, 10),
        wrongCount: wrong.length,
        floweredCount: flowered.length,
      }
    })()
    """)
  end
end
