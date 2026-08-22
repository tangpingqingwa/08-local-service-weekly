export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPY = {
  city_unknown: {
    title: "Unknown city",
    detail: "That city slug is not in the catalog. We did not fall back to London.",
  },
  category_unknown: {
    title: "Unknown category",
    detail: "That category is not in the closed set.",
  },
} as const;

type ErrorCode = keyof typeof COPY;

type ErrorRouteProps = {
  params: Promise<{ code: string }>;
};

export async function GET(_request: Request, { params }: ErrorRouteProps) {
  const { code } = await params;
  const error: ErrorCode =
    code === "category_unknown" ? "category_unknown" : "city_unknown";
  const copy = COPY[error];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${error}</title></head><body><main class="error-page" data-error="${error}"><p class="error-status">404</p><h1>${error}</h1><p>${copy.title}. ${copy.detail}</p></main></body></html>`;
  return new Response(html, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
