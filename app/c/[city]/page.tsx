import type { Metadata } from "next";
import {
  DEFAULT_CITY_SLUG,
  listCityLanes,
  listLastWeekChampions,
  resolveCity,
} from "../../../src/board";
import { CityHub } from "../../../src/ui/city-hub";
import { NotFoundCode } from "../../../src/ui/not-found-code";
import { currentWeekId } from "../../../src/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CityPageProps = {
  params: Promise<{ city: string }>;
};

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
  const { city: slug } = await params;
  const city = resolveCity(slug);
  if (!city.ok) return { robots: { index: false, follow: false } };
  const title = `${city.value.display} Local Services`;
  const description = `Browse paid local-service listings in ${city.value.display}. Rankings are transparent and based only on the bid.`;
  const canonical = city.value.slug === DEFAULT_CITY_SLUG ? "/" : `/c/${city.value.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      images: [{ url: "/brand-mark.png", width: 512, height: 512, alt: `${city.value.display} local services` }],
    },
    twitter: { card: "summary", title, description, images: ["/brand-mark.png"] },
  };
}

export default async function CityPage({ params }: CityPageProps) {
  const { city: slug } = await params;
  const city = resolveCity(slug);
  if (!city.ok) {
    return <NotFoundCode code="city_unknown" />;
  }

  return (
    <CityHub
      city={city.value}
      lanes={listCityLanes(city.value.slug)}
      lastWeek={listLastWeekChampions(city.value.slug)}
      weekId={currentWeekId()}
    />
  );
}
