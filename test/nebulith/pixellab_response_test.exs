defmodule Nebulith.PixellabResponseTest do
  use ExUnit.Case, async: true

  alias Nebulith.Pixellab
  alias Nebulith.Pixellab.Response

  @moduledoc """
  The sprite generator's browser page was NOT changed when this moved out of a Next.js API route, so
  the shapes below are a contract with it, not an implementation detail.
  """

  describe "usd, because pixellab answers money two ways" do
    test "a bare number" do
      assert Response.usd(0.012) == 0.012
    end

    test "wrapped in a map" do
      assert Response.usd(%{"usd" => 0.05}) == 0.05
    end

    test "anything else is zero, never nil, so the page can total it" do
      assert Response.usd(nil) == 0
      assert Response.usd(%{"credits" => 3}) == 0
      assert Response.usd("free") == 0
    end
  end

  describe "data_url, because pixellab answers an image two ways" do
    test "a bare base64 string" do
      assert Response.data_url("QUJD") == "data:image/png;base64,QUJD"
    end

    test "wrapped in a map" do
      assert Response.data_url(%{"base64" => "QUJD"}) == "data:image/png;base64,QUJD"
    end

    test "unusable input is an empty string, not a broken data url" do
      assert Response.data_url(nil) == ""
      assert Response.data_url(%{"url" => "http://x"}) == ""
    end

    test "a list maps, and a non-list is empty rather than a crash" do
      assert Response.data_urls(["QQ", %{"base64" => "Ug"}]) ==
               ["data:image/png;base64,QQ", "data:image/png;base64,Ug"]

      assert Response.data_urls(nil) == []
    end
  end

  describe "v3_status, the background animation job" do
    test "failed carries the reason through" do
      assert Response.v3_status(%{"status" => "failed", "error" => "budget"}) ==
               %{status: "failed", error: "budget"}
    end

    test "failed with no reason still says something" do
      assert %{status: "failed", error: "Animation failed"} =
               Response.v3_status(%{"status" => "failed"})
    end

    test "completed finds the frames under last_response" do
      body = %{
        "status" => "completed",
        "last_response" => %{"images" => ["QQ"]},
        "usage" => %{"usd" => 0.1}
      }

      assert %{status: "completed", images: ["data:image/png;base64,QQ"], usage: 0.1} =
               Response.v3_status(body)
    end

    test "completed finds them under result, and under images, the other two shapes seen" do
      assert %{images: ["data:image/png;base64,QQ"]} =
               Response.v3_status(%{"status" => "completed", "result" => %{"images" => ["QQ"]}})

      assert %{images: ["data:image/png;base64,QQ"]} =
               Response.v3_status(%{"status" => "completed", "images" => ["QQ"]})
    end

    test "completed with NO frames anywhere reports completed plus the keys, not a failure" do
      result = Response.v3_status(%{"status" => "completed", "surprise" => 1})
      assert result.status == "completed"
      assert "surprise" in result.debug.keys
      refute Map.has_key?(result, :images)
    end

    test "still running just reports the status" do
      assert Response.v3_status(%{"status" => "processing"}) == %{status: "processing"}
    end
  end

  describe "v3 frame count, which the API rejects if the pixel budget is blown" do
    test "a small sprite gets the frames it asked for" do
      assert Pixellab.v3_frame_count(8, 64, 64) == 8
    end

    test "never more than the API ceiling, however few pixels" do
      assert Pixellab.v3_frame_count(999, 16, 16) == 16
    end

    test "a big sprite is clamped to what the budget affords" do
      # 256*256 = 65536 per frame, and the budget is 524288, so eight frames exactly.
      assert Pixellab.v3_frame_count(16, 256, 256) == 8
      assert Pixellab.v3_frame_count(16, 512, 512) == 2
    end

    test "defaults to eight when nothing was asked for" do
      assert Pixellab.v3_frame_count(nil, 64, 64) == 8
    end
  end
end
