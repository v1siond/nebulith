defmodule NebulithWeb.PixellabController do
  @moduledoc """
  The sprite generator's door to pixellab.ai.

  It exists so the API key stays on the server. The browser POSTs `{"action": ..., ...params}` and
  gets back the same shapes it always did: this replaced a Next.js API route when the engine moved,
  and the page calling it was not changed, so the contract here IS the contract.

  Every action normalises pixellab's response before returning it. That is not tidiness: the API
  answers `usage` as either a number or `%{"usd" => n}`, and images as either a bare base64 string or
  `%{"base64" => ...}`, so the page would have to handle both shapes on every call otherwise.
  """
  use NebulithWeb, :controller

  alias Nebulith.Pixellab
  alias Nebulith.Pixellab.Response

  def create(conn, params) do
    with :ok <- require_key(),
         {:ok, result} <- dispatch(params) do
      json(conn, result)
    else
      {:no_key} -> fail(conn, 500, "PIXELLAB_API_KEY not configured")
      {:unknown, action} -> fail(conn, 400, "Unknown action: #{action}")
      {:error, status, body} -> fail(conn, error_status(status), message_of(body))
    end
  end

  defp require_key do
    case Pixellab.api_key() do
      nil -> {:no_key}
      "" -> {:no_key}
      _key -> :ok
    end
  end

  defp dispatch(%{"action" => "generate"} = params) do
    with {:ok, body} <- Pixellab.generate(params) do
      {:ok, %{image: Response.data_url(body["image"]), usage: Response.usd(body["usage"])}}
    end
  end

  defp dispatch(%{"action" => "animate"} = params) do
    with {:ok, body} <- Pixellab.animate_with_text(params) do
      {:ok, %{images: Response.data_urls(body["images"]), usage: Response.usd(body["usage"])}}
    end
  end

  defp dispatch(%{"action" => "animate-skeleton"} = params) do
    with {:ok, body} <- Pixellab.animate_with_skeleton(params) do
      {:ok, %{images: Response.data_urls(body["images"]), usage: Response.usd(body["usage"])}}
    end
  end

  defp dispatch(%{"action" => "estimate-skeleton"} = params) do
    with {:ok, body} <- Pixellab.estimate_skeleton(params) do
      # The field has been named both ways across API revisions; take whichever came back.
      {:ok, %{skeleton: body["skeleton"] || body["keypoints"] || [], usage: Response.usd(body["usage"])}}
    end
  end

  defp dispatch(%{"action" => "balance"}) do
    with {:ok, body} <- Pixellab.balance() do
      {:ok, %{balance: Response.usd(body["balance"])}}
    end
  end

  defp dispatch(%{"action" => "animate-v3-start"} = params) do
    with {:ok, body} <- Pixellab.animate_v3_start(params) do
      {:ok, %{jobId: body["background_job_id"]}}
    end
  end

  defp dispatch(%{"action" => "animate-v3-status", "jobId" => job_id}) do
    with {:ok, body} <- Pixellab.job_status(job_id) do
      {:ok, Response.v3_status(body)}
    end
  end

  defp dispatch(%{"action" => action}), do: {:unknown, action}
  defp dispatch(_params), do: {:unknown, "(none given)"}

  # Their 4xx is about the caller's parameters, so it is passed through; anything else is ours to own.
  defp error_status(status) when status in 400..499, do: status
  defp error_status(_status), do: 500

  defp message_of(%{"message" => message}) when is_binary(message), do: message
  defp message_of(%{"detail" => detail}) when is_binary(detail), do: detail
  defp message_of(body) when is_binary(body), do: body
  defp message_of(body), do: inspect(body, limit: 200)

  defp fail(conn, status, message) do
    conn |> put_status(status) |> json(%{error: message})
  end
end
