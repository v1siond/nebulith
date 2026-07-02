defmodule NebulithWeb.PageHTML do
  @moduledoc """
  This module contains pages rendered by PageController.

  See the `page_html` directory for all templates available.
  """
  use NebulithWeb, :html

  embed_templates "page_html/*"
end
