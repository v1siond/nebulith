defmodule Nebulith.E2E.Browser do
  @moduledoc """
  Talking to the page, and waiting for it.

  ## Read the VALUE, not the session

  `PhoenixTest.Playwright.evaluate/2` returns the CONN so it can be piped, which means reading its
  result as the answer silently hands back a struct instead of what the JavaScript returned. A check
  written that way is quietly false forever and a count quietly zero, and nothing about it looks wrong.
  `js/2` here is the one that hands back the value, so a test cannot make that mistake by accident.

  ## Wait on the condition, never on a clock

  A generated world is not ready after a fixed number of milliseconds, it is ready when it is ready. A
  sleep long enough to be safe on a fast machine is a minute wasted on every run, and still too short on
  a slow one. Every wait here polls a condition and says, in words, what it was waiting for when it
  gives up, because "timeout" on its own tells you nothing about which step stalled.
  """

  import ExUnit.Assertions, only: [flunk: 1]

  @poll_ms 250
  @default_wait_ms 60_000

  @doc """
  Runs an expression in the page and returns what it evaluated to.

  Objects come back with STRING keys, arrays as lists, numbers as numbers. An expression that throws,
  or a page that has gone away, gives `nil` rather than raising: a test asserts on the value it wanted,
  and a nil that fails an assertion reads better than a transport error that hides it.
  """
  def js(session, expression) do
    case PlaywrightEx.Frame.evaluate(session.frame_id, expression: expression, timeout: 10_000) do
      {:ok, value} -> value
      _ -> nil
    end
  end

  @doc "True only when the expression evaluates to boolean true. A truthy string or number is not true."
  def true?(session, expression), do: js(session, expression) == true

  @doc "How many nodes match a CSS selector. Zero when the page cannot be asked."
  def count(session, selector) do
    case js(session, "document.querySelectorAll('#{selector}').length") do
      n when is_integer(n) -> n
      _ -> 0
    end
  end

  @doc """
  Polls `check` until it returns a truthy value, then gives back the session so it can be piped.

  `what` is the thing being waited for, in the words a person would use, and it is what the failure
  says out loud.
  """
  def wait_until(session, check, what, opts \\ []) do
    deadline = System.monotonic_time(:millisecond) + Keyword.get(opts, :timeout, @default_wait_ms)
    poll(session, check, what, deadline, Keyword.get(opts, :every, @poll_ms))
  end

  @doc "Polls until a JavaScript expression is true. The same wait, for the common case."
  def wait_for_js(session, expression, what, opts \\ []),
    do: wait_until(session, &true?(&1, expression), what, opts)

  defp poll(session, check, what, deadline, every) do
    cond do
      check.(session) -> session
      System.monotonic_time(:millisecond) >= deadline -> never_happened(session, what)
      true -> sleep_then_poll(session, check, what, deadline, every)
    end
  end

  defp sleep_then_poll(session, check, what, deadline, every) do
    Process.sleep(every)
    poll(session, check, what, deadline, every)
  end

  # The URL and the page's own error, because "waited for the canvas" is a much shorter story than
  # "waited for the canvas, and the page was sitting on /login the whole time".
  defp never_happened(session, what) do
    flunk("""
    waited for #{what} and it never happened.
      url:   #{js(session, "window.location.href")}
      title: #{js(session, "document.title")}
    """)
  end
end
