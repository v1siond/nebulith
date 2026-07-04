defmodule NebulithWeb.AdminHTML do
  @moduledoc """
  Templates for the admin data browser rendered by `NebulithWeb.AdminController`.
  """
  use NebulithWeb, :html

  embed_templates "admin_html/*"
end
