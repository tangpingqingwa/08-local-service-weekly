import {
  DEFAULT_CITY_SLUG,
  listCityLanes,
  listLastWeekChampions,
  resolveCity,
} from "../src/board";
import { CityHub } from "../src/ui/city-hub";
import { currentWeekId } from "../src/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  const city = resolveCity(DEFAULT_CITY_SLUG);
  if (!city.ok) {
    throw new Error("Default city is unavailable");
  }

  const weekId = currentWeekId();
  return (
    <CityHub
      city={city.value}
      lanes={listCityLanes(city.value.slug)}
      lastWeek={listLastWeekChampions(city.value.slug)}
      weekId={weekId}
    />
  );
}
