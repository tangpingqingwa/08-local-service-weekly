import {
  lastWeekNumberOne,
  listLane,
  resolveCategory,
  resolveCity,
} from "../../../../src/board";
import { ClassifiedEdition } from "../../../../src/ui/edition";
import { LaneBoard } from "../../../../src/ui/lane-board";
import { NotFoundCode } from "../../../../src/ui/not-found-code";
import { OutbidForm } from "../../../../src/ui/outbid-form";
import { currentWeekId } from "../../../../src/week";

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

  const weekId = currentWeekId();
  const listings = listLane(city.value.slug, category.value.slug);
  const lastWeek = lastWeekNumberOne(city.value.slug, category.value.slug);
  return (
    <ClassifiedEdition
      city={city.value}
      weekId={weekId}
      claim={
        <OutbidForm
          city={city.value.slug}
          category={category.value.slug}
          lockCity
          lockCategory
        />
      }
    >
      <div className="classified-columns classified-single" data-classified-columns="">
        <LaneBoard
          city={city.value}
          category={category.value}
          listings={listings}
          lastWeek={lastWeek}
          weekId={weekId}
        />
      </div>
    </ClassifiedEdition>
  );
}
