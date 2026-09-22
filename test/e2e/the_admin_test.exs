defmodule Nebulith.E2E.TheAdminTest do
  @moduledoc """
  The database browser: every table, searchable, a row at a time, editable.

  It can write to any table in the database, so what it does has to be driven rather than assumed. An
  admin who is already signed in is admitted without being asked for anything else, which is the door
  a person comes through.

  Not tied to a phase. It covers the admin, which every phase leans on to look at its own rows.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e

  setup context do
    World.seed_catalog()
    template = World.scratch_map(%{name: "e2e admin", cols: 24, rows: 24})
    Elixir.Map.merge(a_signed_in_admin(context), %{template: template})
  end

  describe "the table list" do
    test "shows the tables, and is not squeezed into a column", %{session: session} do
      session = visit(session, "/admin")

      links = Browser.count(session, ~s|a[href^="/admin/"]|)
      assert links > 5, "the admin lists #{links} tables"

      width =
        Browser.js(
          session,
          "Math.round(document.querySelector('main').getBoundingClientRect().width)"
        )

      assert width > 1400,
             "the admin is #{width}px wide in a 1700px window, so a wide table has nowhere to go"
    end
  end

  describe "a table" do
    test "lists its rows, and a search says what it matched without leaving the table",
         %{session: session} do
      session = visit(session, "/admin/tiles")

      assert Browser.count(session, "tbody tr") > 0, "the tiles table lists no rows"

      session =
        session
        |> Browser.fill("input[type=search]", "water")
        |> click_button("Search")

      summary =
        Browser.wait_value(session, """
        (() => {
          const p = document.querySelector('main p')
          const t = p ? p.textContent.replace(/\\s+/g, ' ').trim() : ''
          return t.includes('water') ? t : null
        })()
        """)

      assert summary, "the search never reported what it matched"

      assert Browser.js(session, "document.querySelector('h1').textContent.trim()") == "tiles",
             "searching left the tiles table"
    end
  end

  describe "a row" do
    test "opens at its own id, shows every column, and can be edited and put back",
         %{session: session} do
      session = visit(session, "/admin/users")
      click(session, "a", "open")

      url =
        Browser.wait_value(session, """
        /\\/admin\\/users\\/[0-9a-f-]{36}$/.test(location.href) ? location.href : null
        """)

      assert url,
             "opening a user did not land on its own id: #{Browser.js(session, "location.href")}"

      assert Browser.count(session, "dl > div") > 3, "the row shows almost no columns"

      click(session, "a", "Edit")

      Browser.wait_until(
        session,
        &(Browser.count(&1, ~s|[name="row[display_name]"]|) == 1),
        "the edit form to open with a field for an editable column"
      )

      # THE KEY HAS NO FIELD. An editable primary key is a row you can rename into another row.
      assert Browser.count(session, ~s|[name="row[id]"]|) == 0, "the key column has a field"

      original =
        Browser.js(session, ~s|document.querySelector('[name="row[display_name]"]').value|)

      probe = "e2e-#{System.unique_integer([:positive])}"

      session
      |> Browser.fill(~s|[name="row[display_name]"]|, probe)
      |> click_button("Save")

      Browser.wait_until(
        session,
        &(Browser.js(&1, "location.href") == url),
        "the save to return to the row"
      )

      assert Browser.true?(
               session,
               "document.querySelector('main').innerText.includes('#{probe}')"
             ),
             "the new value is not on the row after saving"

      # PUT IT BACK. The sandbox rolls this away anyway, but a scenario that depends on that is a
      # scenario that stops working the moment somebody points it at a database that keeps things.
      session = visit(session, "#{url}/edit")

      session
      |> Browser.fill(~s|[name="row[display_name]"]|, original)
      |> click_button("Save")

      Browser.wait_until(
        session,
        &(not Browser.true?(&1, "document.querySelector('main').innerText.includes('#{probe}')")),
        "the original value to come back"
      )
    end
  end

  describe "a grid column" do
    test "is drawn as a grid, with each cell naming its own place", %{
      session: session,
      template: template
    } do
      session = visit(session, "/admin/Template/#{template.id}")

      cells =
        Browser.wait_value(session, """
        (() => {
          const n = document.querySelectorAll('table td[title^="col "]').length
          return n > 0 ? n : null
        })()
        """)

      assert cells && cells > 100,
             "a 24x24 map's ground drew #{inspect(cells)} cells, so it is being printed rather than drawn"

      # AND THE PAGE SAYS HOW THE GRIDS RELATE, which is the question it exists to answer: the height
      # data and the ground data are two values for the same cell, not two unrelated blobs.
      body = Browser.js(session, "document.querySelector('main').innerText")

      assert body =~ "one value per cell",
             "the page does not say that the grids are read per cell"

      assert body =~ "groundData" and body =~ "heightData",
             "and does not name the columns that share that grid"

      refute body =~ ~s|{"art":|, "a raw JSON blob is printed into the page"
    end
  end

  describe "a table name that is not a table" do
    test "is turned away, and the table it named is still there", %{session: session} do
      session = visit(session, "/admin/" <> URI.encode("users; drop table users"))

      assert Browser.js(session, "location.pathname") == "/admin",
             "a crafted table name was not turned away: #{Browser.js(session, "location.href")}"

      session = visit(session, "/admin/users")
      assert Browser.count(session, "tbody tr") > 0, "the users table is gone"
    end
  end
end
