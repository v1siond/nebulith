defmodule Nebulith.Pixellab do
  @moduledoc """
  Client for the pixellab.ai pixel-art API, used by the sprite generator.

  The API key lives here and only here. It used to sit in a Next.js API route in the CV site, which
  is why that route existed at all: the browser must never hold it. The engine moved, so this moved
  with it, and the browser contract is unchanged (POST an `action` plus its params).

  Two API versions are in play, deliberately: v1 is synchronous and v2 runs animation as a background
  job you poll. `animate_v3_start/1` returns a job id and `job_status/1` reads it.

  https://www.pixellab.ai/pixellab-api
  """
  require Logger

  @v1 "https://api.pixellab.ai/v1"
  @v2 "https://api.pixellab.ai/v2"

  # v3 animation has a pixel budget: width * height * frames must stay under this, or the API rejects
  # the job. Clamping here rather than letting it fail is what the Next route did.
  @v3_pixel_budget 524_288
  @v3_max_frames 16

  @doc "Configured key, or nil. Callers decide what a missing key means; the controller 500s."
  def api_key, do: Application.get_env(:nebulith, :pixellab_api_key)

  def generate(%{"description" => description} = params) do
    post(@v1, "/generate-image-pixflux", drop_nils(%{
      "description" => description,
      "image_size" => %{"width" => param(params, "width", 64), "height" => param(params, "height", 64)},
      "no_background" => no_background(params),
      "init_image" => base64_image(params["initImage"]),
      "seed" => params["seed"]
    }))
  end

  def animate_with_text(params) do
    post(@v1, "/animate-with-text", drop_nils(%{
      "description" => params["description"],
      "action" => param(params, "animationAction", "idle"),
      "image_size" => %{"width" => 64, "height" => 64},
      "reference_image" => base64_image(params["referenceImage"]),
      "direction" => param(params, "direction", "south-east"),
      "no_background" => no_background(params),
      "seed" => params["seed"]
    }))
  end

  def animate_with_skeleton(params) do
    size = params["size"]

    post(@v1, "/animate-with-skeleton", drop_nils(%{
      "image_size" => %{"width" => size, "height" => size},
      "reference_image" => base64_image(params["referenceImage"]),
      "skeleton_keypoints" => params["skeletonKeypoints"],
      "no_background" => no_background(params),
      "seed" => params["seed"]
    }))
  end

  def estimate_skeleton(params) do
    size = params["size"]

    post(@v1, "/estimate-skeleton", %{
      "image_size" => %{"width" => size, "height" => size},
      "image" => base64_image(params["image"])
    })
  end

  def animate_v3_start(params) do
    width = param(params, "width", 128)
    height = param(params, "height", 128)

    post(@v2, "/animate-with-text-v3", drop_nils(%{
      "first_frame" => base64_image(params["firstFrame"]),
      "action" => params["animationAction"],
      "frame_count" => v3_frame_count(params["frameCount"], width, height),
      "no_background" => no_background(params),
      "seed" => params["seed"]
    }))
  end

  def job_status(job_id), do: get(@v2, "/background-jobs/#{job_id}")

  def balance, do: get(@v1, "/balance")

  @doc "Frames a v3 job may have at this size, never above the API's own ceiling or its pixel budget."
  def v3_frame_count(requested, width, height) when width > 0 and height > 0 do
    affordable = min(@v3_max_frames, div(@v3_pixel_budget, width * height))
    min(requested || 8, affordable)
  end

  def v3_frame_count(requested, _width, _height), do: min(requested || 8, @v3_max_frames)

  defp post(base, path, body), do: request(:post, base <> path, json: body)
  defp get(base, path), do: request(:get, base <> path, [])

  defp request(method, url, opts) do
    key = api_key()

    Req.request([method: method, url: url, auth: {:bearer, key}, receive_timeout: 120_000] ++ opts)
    |> handle()
  end

  defp handle({:ok, %{status: status, body: body}}) when status in 200..299, do: {:ok, body}

  defp handle({:ok, %{status: status, body: body}}) do
    Logger.warning("pixellab returned #{status}: #{inspect(body, limit: 400)}")
    {:error, status, body}
  end

  defp handle({:error, reason}) do
    Logger.error("pixellab request failed: #{inspect(reason)}")
    {:error, 502, %{"message" => "could not reach pixellab"}}
  end

  # The API takes images as {"base64": "..."} rather than a bare string.
  defp base64_image(nil), do: nil
  defp base64_image(base64), do: %{"base64" => base64}

  # `no_background` is only ever sent as true; the API treats absent as false.
  defp no_background(%{"noBackground" => false}), do: nil
  defp no_background(_params), do: true

  defp param(params, key, default) do
    case Map.get(params, key) do
      nil -> default
      value -> value
    end
  end

  defp drop_nils(map), do: Map.reject(map, fn {_k, v} -> is_nil(v) end)
end
