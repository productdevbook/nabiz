-- What is watched. Rows are seeded by the operator, not committed to any
-- repository: a monitor's URL is often somebody's hostname, and a public
-- status page does not have to be a public customer list — see `grouped`.
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  expect_status INTEGER NOT NULL DEFAULT 200,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  group_name TEXT,
  -- Grouped monitors are shown only as their group's tally ("6/6 up"),
  -- never by name. For the sites you host but do not own.
  grouped INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

-- One row per probe. Kept short — two days for the latency figure — because
-- the page's history reads from the daily rollup, not from here.
CREATE TABLE IF NOT EXISTS checks (
  monitor_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS checks_by_monitor ON checks (monitor_id, at);

-- One row per monitor per UTC day, updated in place on every probe. Ninety
-- of these per monitor draw the bars.
CREATE TABLE IF NOT EXISTS days (
  monitor_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  ms_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day)
);

-- The last known state, so an alert fires on the change and not on every
-- minute of an outage.
CREATE TABLE IF NOT EXISTS state (
  monitor_id INTEGER PRIMARY KEY,
  ok INTEGER NOT NULL,
  since INTEGER NOT NULL
);
