import type { Metadata } from "next";
import {
  lastWeekNumberOne,
  listLane,
  resolveCategory,
  resolveCity,
} from "../../../../src/board";
import { ColumnIndex } from "../../../../src/ui/column-index";
import { ClassifiedEdition } from "../../../../src/ui/edition";
import { LaneBoard } from "../../../../src/ui/lane-board";
import { NotFoundCode } from "../../../../src/ui/not-found-code";
import { OutbidForm } from "../../../../src/ui/outbid-form";
import { currentWeekId } from "../../../../src/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LanePageProps = {
  params: Promise<{ city: string; category: string }>;
  searchParams?: Promise<{ error?: string | string[] }>;
};

export async function generateMetadata({ params }: Pick<LanePageProps, "params">): Promise<Metadata> {
  const { city: citySlug, category: categorySlug } = await params;
  const city = resolveCity(citySlug);
  const category = resolveCategory(categorySlug);
  if (!city.ok || !category.ok) return { robots: { index: false, follow: false } };
  const title = `${category.value.display} in ${city.value.display}`;
  const description = `Compare paid ${category.value.display.toLowerCase()} listings in ${city.value.display}. Rank is the bid on a rolling seven-day board.`;
  const canonical = `/c/${city.value.slug}/${category.value.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [{ url: "/brand-mark.png", width: 512, height: 512, alt: `${category.value.display} in ${city.value.display}` }],
    },
    twitter: { card: "summary", title, description, images: ["/brand-mark.png"] },
  };
}

export default async function LanePage({ params, searchParams }: LanePageProps) {
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
  const query = searchParams ? await searchParams : undefined;
  const formError = Array.isArray(query?.error) ? query.error[0] : query?.error;
  const occupied = listings.length > 0;
  const claim = !occupied ? (
    <OutbidForm
      city={city.value.slug}
      category={category.value.slug}
      lockCity
      lockCategory
      emptyPaper
      hero
    />
  ) : undefined;
  return (
    <ClassifiedEdition
      city={city.value}
      weekId={weekId}
      emptyPaper={!occupied}
      claim={claim}
    >
      <div className="classified-columns classified-single" data-classified-columns="">
        <LaneBoard
          city={city.value}
          category={category.value}
          listings={listings}
          lastWeek={lastWeek}
          weekId={weekId}
          showForm={occupied}
          formError={formError}
        />
      </div>
      {occupied ? <ColumnIndex city={city.value} /> : null}
    </ClassifiedEdition>
  );
}
