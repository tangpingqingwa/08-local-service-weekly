import {
  DEFAULT_CITY_SLUG,
  listCityLanes,
  resolveCity,
} from "../src/board";
import { CityHub } from "../src/ui/city-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  const city = resolveCity(DEFAULT_CITY_SLUG);
  if (!city.ok) {
    throw new Error("v1 default city London is missing from the catalog");
  }

  return <CityHub city={city.value} lanes={listCityLanes(city.value.slug)} />;
}
