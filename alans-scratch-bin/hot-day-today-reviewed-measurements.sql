-- This file is the reproducible, non-sensitive measurement source for the HTML report.
--
-- The numbers below were measured from the two experiment logs named in the report.
-- They are written as SQL `VALUES` rows so an analyst can load them into nearly any
-- database or notebook without reopening the raw logs, which contain sensitive context.

-- Headline comparison metrics.
SELECT
  17.435 AS request_size_multiple,
  8.983 AS tool_payload_multiple,
  61.88 AS instruction_text_multiple,
  2 AS claude_p_upstream_attempts,
  1 AS runner_upstream_attempts;

-- Request composition rows used by the grouped bar chart.
-- `share` is a fraction: 0.8126 means 81.26 percent of that client's request.
WITH request_composition(client, component, bytes, share) AS (
  VALUES
    ('Bridge runner', 'Messages', 43, 0.0042),
    ('Bridge runner', 'System', 1743, 0.1721),
    ('Bridge runner', 'Tools', 8232, 0.8126),
    ('Bridge runner', 'Envelope / other', 112, 0.0111),
    ('Claude -p', 'Messages', 89384, 0.5061),
    ('Claude -p', 'System', 12906, 0.0731),
    ('Claude -p', 'Tools', 73950, 0.4187),
    ('Claude -p', 'Envelope / other', 381, 0.0022)
)
SELECT client, component, bytes, share
FROM request_composition;

-- Exact request-anatomy measurements used by the report table.
WITH request_anatomy(
  client,
  body_bytes,
  instruction_text_chars,
  tool_count,
  tool_json_bytes,
  incoming_cache_markers,
  streaming,
  thinking
) AS (
  VALUES
    ('Bridge runner', 10130, 1629, 16, 8232, 2, 'No', 'Not declared'),
    ('Claude -p', 176621, 100808, 25, 73950, 3, 'Yes', 'Adaptive')
)
SELECT *
FROM request_anatomy;

-- Bridge-side event timing. These durations end when response headers arrived.
-- They are not total model completion times.
WITH response_header_timeline(
  client,
  request_captured,
  first_status,
  retry_start,
  final_200_headers,
  capture_to_200_headers_ms,
  attempts
) AS (
  VALUES
    ('Bridge runner', '10:14:52.901', '200', NULL, '10:14:57.633', 4732, 1),
    ('Claude -p', '10:11:33.073', '401', '10:11:34.160', '10:11:39.474', 6401, 2)
)
SELECT *
FROM response_header_timeline;
