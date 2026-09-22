defmodule Nebulith.Catalog.Autotile do
  @moduledoc """
  THE 9-PIECE SCHEME, said once.

  An autotile family is a base label and nine pieces: four corners, four edges and a centre, spelled
  `<base>_tl`, `<base>_t`, `<base>_c` and so on. Which piece a cell takes is decided entirely by which
  of its sides face outward.

  It was written twice, as two `cond` blocks in two modules, and one of them carried a comment saying
  the other used the same scheme. Two copies of one rule is one rule and one place for them to drift.
  """

  @doc """
  The piece suffix for a cell, from the sides that face out.

  A corner is two sides, an edge is one, and a cell with none is the centre. Written as clauses rather
  than as a chain of conditions because that is what it is: nine cases, each of which reads on its own
  line, with the corners first because a corner is also a top and also a left.
  """
  def suffix(top, bottom, left, right)
  def suffix(true, _bottom, true, _right), do: "tl"
  def suffix(true, _bottom, _left, true), do: "tr"
  def suffix(_top, true, true, _right), do: "bl"
  def suffix(_top, true, _left, true), do: "br"
  def suffix(true, _bottom, _left, _right), do: "t"
  def suffix(_top, true, _left, _right), do: "b"
  def suffix(_top, _bottom, true, _right), do: "l"
  def suffix(_top, _bottom, _left, true), do: "r"
  def suffix(_top, _bottom, _left, _right), do: "c"

  @doc "The piece label itself: the base and its suffix."
  def piece(base, top, bottom, left, right), do: "#{base}_#{suffix(top, bottom, left, right)}"
end
