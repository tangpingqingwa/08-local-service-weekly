import { NextResponse, type NextRequest } from "next/server";
import { resolveCategory } from "./src/categories";
import { resolveCity } from "./src/cities";

export function middleware(request: NextRequest) {
  const parts = request.nextUrl.pathname.split("/").filter(Boolean);
  if (parts[0] !== "c" || !parts[1]) {
    return NextResponse.next();
  }

  if (!resolveCity(parts[1]).ok) {
    return NextResponse.rewrite(new URL("/e/city_unknown", request.url));
  }

  if (parts[2] && !resolveCategory(parts[2]).ok) {
    return NextResponse.rewrite(new URL("/e/category_unknown", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/c/:path*"],
};
