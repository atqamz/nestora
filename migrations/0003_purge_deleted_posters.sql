UPDATE items
SET data = json_remove(data, '$.cover', '$.tmdb', '$.tmdb_at'),
    rev = (SELECT rev + 1 FROM sync_state WHERE id = 1),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE deleted_at IS NOT NULL AND kind IN ('movie', 'series')
  AND (json_type(data, '$.cover') IS NOT NULL OR json_type(data, '$.tmdb') IS NOT NULL OR json_type(data, '$.tmdb_at') IS NOT NULL);

UPDATE sync_state SET rev = rev + 1 WHERE id = 1 AND EXISTS (SELECT 1 FROM items WHERE rev > (SELECT rev FROM sync_state WHERE id = 1));
