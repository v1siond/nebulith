defmodule NebulithWeb.CVController do
  @moduledoc """
  Serves the combined CV/portfolio payload (`GET /api/cv?locale=en|es|it`) that the frontend's
  `getAllCVData` fetches — replacing the old Prisma reads. Read-only.
  """
  use NebulithWeb, :controller

  alias Nebulith.CV

  def index(conn, params) do
    locale = params["locale"] || "en"
    json(conn, CV.all_cv_data(locale))
  end
end
