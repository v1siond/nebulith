defmodule Nebulith.CV do
  @moduledoc """
  CV / portfolio read model. Serves the combined CV payload the frontend's `getAllCVData(locale)` used to
  build with Prisma — now read here from the shared DB via SCHEMALESS Ecto queries (read-only, no schema
  modules needed). i18n: each localisable field has `_es`/`_it` twins; `loc/3` picks the localised value,
  falling back to English.
  """
  import Ecto.Query
  alias Nebulith.Repo

  @doc "The whole CV payload for a locale — same shape the old `getAllCVData` returned."
  def all_cv_data(locale) do
    %{
      professionalSummary: professional_summary(locale),
      currentRoles: current_roles(locale),
      companies: companies(locale),
      featuredProjects: featured_projects(locale),
      techStack: tech_stack(locale),
      workExperience: work_experience(locale)
    }
  end

  # ── locale helpers ──────────────────────────────────────────────────────────
  defp loc(_row, _field, "en"), do: nil
  defp loc(row, field, locale), do: Map.get(row, :"#{field}_#{locale}")

  # localised string: `_locale` twin (if non-empty) else the English base
  defp lstr(row, field, "en"), do: Map.get(row, field)
  defp lstr(row, field, locale), do: blank_fallback(loc(row, field, locale), Map.get(row, field))

  # localised json array: `_locale` twin (if present) else the English base
  defp ljson(row, field, "en"), do: Map.get(row, field)
  defp ljson(row, field, locale), do: loc(row, field, locale) || Map.get(row, field)

  defp blank_fallback(nil, base), do: base
  defp blank_fallback("", base), do: base
  defp blank_fallback(val, _base), do: val

  # ── datasets ────────────────────────────────────────────────────────────────
  defp professional_summary(locale) do
    row =
      from(s in "ProfessionalSummary",
        limit: 1,
        select: %{
          headline: s.headline,
          tagline: s.tagline,
          bio: s.bio,
          highlights: s.highlights,
          headline_es: s.headline_es,
          headline_it: s.headline_it,
          tagline_es: s.tagline_es,
          tagline_it: s.tagline_it,
          bio_es: s.bio_es,
          bio_it: s.bio_it,
          highlights_es: s.highlights_es,
          highlights_it: s.highlights_it
        }
      )
      |> Repo.one()

    if row do
      %{
        headline: lstr(row, :headline, locale),
        tagline: lstr(row, :tagline, locale),
        bio: lstr(row, :bio, locale),
        highlights: ljson(row, :highlights, locale)
      }
    end
  end

  defp current_roles(locale) do
    from(r in "Role",
      where: r.current == true,
      order_by: [asc: r.order],
      select: %{
        id: r.id,
        slug: r.slug,
        title: r.title,
        company: r.company,
        type: r.type,
        description: r.description,
        title_es: r.title_es,
        title_it: r.title_it,
        description_es: r.description_es,
        description_it: r.description_it
      }
    )
    |> Repo.all()
    |> Enum.map(fn r ->
      %{
        id: r.id,
        slug: r.slug,
        title: lstr(r, :title, locale),
        company: r.company,
        type: r.type,
        description: lstr(r, :description, locale)
      }
    end)
  end

  defp companies(locale) do
    from(c in "Company",
      order_by: [asc: c.order],
      select: %{
        id: c.id,
        slug: c.slug,
        name: c.name,
        tagline: c.tagline,
        description: c.description,
        url: c.url,
        services: c.services,
        icon: c.icon,
        tagline_es: c.tagline_es,
        tagline_it: c.tagline_it,
        description_es: c.description_es,
        description_it: c.description_it,
        services_es: c.services_es,
        services_it: c.services_it
      }
    )
    |> Repo.all()
    |> Enum.map(fn c ->
      %{
        id: c.id,
        slug: c.slug,
        name: c.name,
        tagline: lstr(c, :tagline, locale),
        description: lstr(c, :description, locale),
        url: c.url,
        services: ljson(c, :services, locale),
        icon: c.icon
      }
    end)
  end

  defp featured_projects(locale) do
    from(p in "Project",
      where: p.featured == true and fragment("? = ANY(?)", "engineer", p.professions),
      order_by: [asc: p.order],
      select: %{
        id: p.id,
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        impact: p.impact,
        techStack: p.techStack,
        status: p.status,
        links: p.links,
        name_es: p.name_es,
        name_it: p.name_it,
        tagline_es: p.tagline_es,
        tagline_it: p.tagline_it,
        description_es: p.description_es,
        description_it: p.description_it,
        impact_es: p.impact_es,
        impact_it: p.impact_it
      }
    )
    |> Repo.all()
    |> Enum.map(fn p ->
      %{
        id: p.id,
        slug: p.slug,
        name: lstr(p, :name, locale),
        tagline: lstr(p, :tagline, locale),
        description: lstr(p, :description, locale),
        impact: if(p.impact, do: lstr(p, :impact, locale)),
        techStack: p.techStack,
        status: p.status,
        links: p.links
      }
    end)
  end

  defp tech_stack(locale) do
    cats =
      from(c in "TechCategory",
        order_by: [asc: c.order],
        select: %{id: c.id, name: c.name, icon: c.icon, name_es: c.name_es, name_it: c.name_it}
      )
      |> Repo.all()

    by_cat =
      from(t in "Technology",
        order_by: [asc: t.order],
        select: %{name: t.name, categoryId: t.categoryId}
      )
      |> Repo.all()
      |> Enum.group_by(& &1.categoryId, & &1.name)

    Enum.map(cats, fn c ->
      %{id: c.id, name: lstr(c, :name, locale), icon: c.icon, items: Map.get(by_cat, c.id, [])}
    end)
  end

  defp work_experience(locale) do
    from(e in "WorkExperience",
      order_by: [asc: e.order],
      select: %{
        id: e.id,
        title: e.title,
        company: e.company,
        description: e.description,
        startDate: e.startDate,
        endDate: e.endDate,
        current: e.current,
        highlights: e.highlights,
        skills: e.skills,
        title_es: e.title_es,
        title_it: e.title_it,
        description_es: e.description_es,
        description_it: e.description_it,
        highlights_es: e.highlights_es,
        highlights_it: e.highlights_it
      }
    )
    |> Repo.all()
    |> Enum.map(fn e ->
      %{
        id: e.id,
        title: lstr(e, :title, locale),
        company: e.company,
        description: lstr(e, :description, locale),
        startDate: e.startDate,
        endDate: e.endDate,
        current: e.current,
        highlights: if(e.highlights, do: ljson(e, :highlights, locale)),
        skills: e.skills
      }
    end)
  end
end
