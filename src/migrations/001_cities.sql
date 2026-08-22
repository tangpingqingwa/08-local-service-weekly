CREATE TABLE cities (
  slug TEXT PRIMARY KEY NOT NULL,
  display TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1))
);

INSERT INTO cities (slug, display, public) VALUES ('london', 'London', 1);
