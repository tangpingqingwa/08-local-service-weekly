import { listCityLanes, resolveCity } from "../../../src/board";
import { CityHub } from "../../../src/ui/city-hub";
import { NotFoundCode } from "../../../src/ui/not-found-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CityPageProps = {
  params: Promise<{ city: string }>;
};

export default async function CityPage({ params }: CityPageProps) {
  const { city: slug } = await params;
  const city = resolveCity(slug);
  if (!city.ok) {
    return <NotFoundCode code="city_unknown" />;
  }

  return <CityHub city={city.value} lanes={listCityLanes(city.value.slug)} />;
}
