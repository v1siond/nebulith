defmodule NebulithWeb.PageController do
  use NebulithWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
