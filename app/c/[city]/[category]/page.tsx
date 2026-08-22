import { listLane, resolveCategory, resolveCity } from "../../../../src/board";
import { LaneBoard } from "../../../../src/ui/lane-board";
import { NotFoundCode } from "../../../../src/ui/not-found-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LanePageProps = {
  params: Promise<{ city: string; category: string }>;
};

export default async function LanePage({ params }: LanePageProps) {
  const { city: citySlug, category: categorySlug } = await params;
  const city = resolveCity(citySlug);
  if (!city.ok) {
    return <NotFoundCode code="city_unknown" />;
  }
  const category = resolveCategory(categorySlug);
  if (!category.ok) {
    return <NotFoundCode code="category_unknown" />;
  }

  const listings = listLane(city.value.slug, category.value.slug);
  return (
    <main className="board" data-board="" data-city={city.value.slug}>
      <header className="board-header">
        <p className="eyebrow">Local Service Weekly</p>
        <h1>
          <a href={`/c/${city.value.slug}`}>{city.value.display}</a>
        </h1>
        <p>Rank is the bid. Empty lane is empty.</p>
      </header>
      <LaneBoard
        city={city.value}
        category={category.value}
        listings={listings}
        showForm
      />
    </main>
  );
}
