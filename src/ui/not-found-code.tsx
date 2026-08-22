export type BoardErrorCode = "city_unknown" | "category_unknown";

const COPY: Record<BoardErrorCode, { title: string; detail: string }> = {
  city_unknown: {
    title: "Unknown city",
    detail: "That city slug is not in the catalog. We did not fall back to London.",
  },
  category_unknown: {
    title: "Unknown category",
    detail: "That category is not in the closed set.",
  },
};

export function NotFoundCode({ code }: { code: BoardErrorCode }) {
  const copy = COPY[code];
  return (
    <main className="error-page" data-error={code}>
      <p className="error-status">404</p>
      <h1>{code}</h1>
      <p>{copy.title}. {copy.detail}</p>
    </main>
  );
}
