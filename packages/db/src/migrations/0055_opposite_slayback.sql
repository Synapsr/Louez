-- Merge reconciliation: the `users` profile columns this migration would add are
-- already applied by 0050_add_user_profile_fields and 0051_abnormal_wind_dancer,
-- which sit earlier in the journal. This entry only realigns the snapshot chain
-- after merging two migration streams. It must contain a real statement (a
-- comment-only file fails with ER_EMPTY_QUERY on every migrator path).
SELECT 1;