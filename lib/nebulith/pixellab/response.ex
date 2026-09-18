defmodule Nebulith.Pixellab.Response do
  @moduledoc """
  Normalising what pixellab.ai answers.

  Its own module because it is data shaping, not request handling, and because it is the part of the
  port most likely to be wrong: the API returns the same field in more than one shape depending on
  the endpoint and the revision. `usage` is a number or `%{"usd" => n}`. An image is a base64 string
  or `%{"base64" => ...}`. A finished v3 job puts its frames under one of three keys.

  The page consuming this was not changed when the engine moved, so these shapes are a contract.
  """

  @doc "A money field, however it came back. Unknown shapes are 0, never nil, so the page can add it up."
  def usd(value) when is_number(value), do: value
  def usd(%{"usd" => value}) when is_number(value), do: value
  def usd(_value), do: 0

  @doc "A PNG data URL from whichever image shape came back. Unusable input is an empty string."
  def data_url(base64) when is_binary(base64), do: "data:image/png;base64," <> base64
  def data_url(%{"base64" => base64}) when is_binary(base64), do: data_url(base64)
  def data_url(_other), do: ""

  def data_urls(images) when is_list(images), do: Enum.map(images, &data_url/1)
  def data_urls(_other), do: []

  @doc """
  A v3 background job's state, as the page expects it.

  Completed without frames is reported as completed WITH debug keys rather than as a failure: it
  means the job finished and the frames sit under a key this does not know, and saying "failed"
  would send someone hunting the wrong problem.
  """
  def v3_status(%{"status" => "failed"} = body) do
    %{status: "failed", error: body["error"] || "Animation failed"}
  end

  def v3_status(%{"status" => "completed"} = body) do
    case v3_images(body) do
      nil -> %{status: "completed", debug: %{keys: Map.keys(body)}}
      images -> %{status: "completed", images: data_urls(images), usage: usd(body["usage"])}
    end
  end

  def v3_status(body), do: %{status: body["status"]}

  defp v3_images(body) do
    nested = body["last_response"] || body["lastResponse"] || body["result"] || %{}
    nested["images"] || body["images"]
  end
end
