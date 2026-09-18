defmodule NebulithWeb.EngineHTML do
  @moduledoc """
  The engine's shell. One template: a mount node and nothing else, because the application draws
  everything inside it.
  """
  use NebulithWeb, :html

  embed_templates "engine_html/*"
end
