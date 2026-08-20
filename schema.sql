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
  -- When set, a 200 with the wrong words in it is still a failure — a
  -- database error page and a healthy page can share a status code.
  expect_body TEXT,
  -- How many probes in a row must fail before the monitor is called down.
  -- One network blip in a minute-long window is weather, not an outage.
  fail_threshold INTEGER NOT NULL DEFAULT 2,
  group_name TEXT,
  -- A grouped monitor is shown only through its group's one row — never by
  -- name, and never as a count. For the sites you host but do not own.
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
  -- Read by nothing; kept because when a probe starts failing the first
  -- question is always what it answered.
  status INTEGER,
  ms INTEGER
);
-- Every read of this table asks for a window of time and nothing else: the
-- last hour for the latency figure, the last day for the waveform, older
-- than two days for the sweep. Leading on `at` is what lets those seek
-- instead of scan, and carrying the other three columns is what keeps the
-- seek from going back to the table for them.
CREATE INDEX IF NOT EXISTS checks_by_time ON checks (at, ok, monitor_id, ms);

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
-- The page asks for the last ninety days; the primary key is monitor-first
-- and cannot answer that without reading every row of every year kept.
CREATE INDEX IF NOT EXISTS days_by_day ON days (day);

-- The last known state, so an alert fires on the change and not on every
-- minute of an outage.
CREATE TABLE IF NOT EXISTS state (
  monitor_id INTEGER PRIMARY KEY,
  ok INTEGER NOT NULL,
  since INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  -- What the last probe answered, so a page can say which kind of failure
  -- this is: a redirect where a 200 was promised reads nothing like a
  -- connection that was refused.
  last_status INTEGER,
  -- And why, when the code does not say it: 'timeout', 'unreachable' for a
  -- connection that never happened, 'body' for a promised status with the
  -- wrong words in it.
  last_reason TEXT
);

-- Every change of state, kept so the page can say not only how things are
-- but what happened lately. Pruned past half a year.
CREATE TABLE IF NOT EXISTS events (
  monitor_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  -- Whether the monitor was grouped when this was written. The page reads
  -- a window of each kind, and a window that has to join to find out which
  -- it is cannot stop at its limit.
  grouped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_by_time ON events (at);
CREATE INDEX IF NOT EXISTS events_by_kind ON events (grouped, at);

-- What the operator said, in their own words. A probe can say a thing is
-- down; only a person can say why, and when to expect it back.
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  body_md TEXT NOT NULL,
  resolved_at INTEGER,
  -- Which audience this speaks to; empty speaks to all of them.
  lang TEXT
);
