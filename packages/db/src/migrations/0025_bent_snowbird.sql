UPDATE `products` p
LEFT JOIN `stores` s ON s.`id` = p.`store_id`
SET p.`pricing_mode` = COALESCE(
	CASE
		WHEN JSON_UNQUOTE(JSON_EXTRACT(s.`settings`, '$.pricingMode')) IN ('hour', 'day', 'week')
			THEN JSON_UNQUOTE(JSON_EXTRACT(s.`settings`, '$.pricingMode'))
		ELSE NULL
	END,
	'day'
)
WHERE p.`pricing_mode` IS NULL;--> statement-breakpoint
UPDATE `stores`
SET `settings` = JSON_REMOVE(
	JSON_SET(
		COALESCE(`settings`, JSON_OBJECT()),
		'$.minRentalMinutes',
		CAST(
			COALESCE(
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.minRentalMinutes') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minRentalMinutes')) <> 'null'
						THEN JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minRentalMinutes'))
					ELSE NULL
				END,
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.minRentalHours') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minRentalHours')) <> 'null'
						THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minRentalHours')) AS SIGNED) * 60
					ELSE NULL
				END,
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.minDuration') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minDuration')) <> 'null'
						THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.minDuration')) AS SIGNED) *
							(CASE JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.pricingMode'))
								WHEN 'hour' THEN 60
								WHEN 'week' THEN 10080
								ELSE 1440
							END)
					ELSE NULL
				END,
				60
			) AS SIGNED
		),
		'$.maxRentalMinutes',
		CAST(
			COALESCE(
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.maxRentalMinutes') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxRentalMinutes')) <> 'null'
						THEN JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxRentalMinutes'))
					ELSE NULL
				END,
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.maxRentalHours') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxRentalHours')) <> 'null'
						THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxRentalHours')) AS SIGNED) * 60
					ELSE NULL
				END,
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.maxDuration') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxDuration')) <> 'null'
						THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.maxDuration')) AS SIGNED) *
							(CASE JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.pricingMode'))
								WHEN 'hour' THEN 60
								WHEN 'week' THEN 10080
								ELSE 1440
							END)
					ELSE NULL
				END
			) AS SIGNED
		),
		'$.advanceNoticeMinutes',
		CAST(
			COALESCE(
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.advanceNoticeMinutes') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.advanceNoticeMinutes')) <> 'null'
						THEN JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.advanceNoticeMinutes'))
					ELSE NULL
				END,
				CASE
					WHEN JSON_EXTRACT(`settings`, '$.advanceNotice') IS NOT NULL
						AND JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.advanceNotice')) <> 'null'
						THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.advanceNotice')) AS SIGNED) * 60
					ELSE NULL
				END,
				1440
			) AS SIGNED
		)
	),
	'$.pricingMode',
	'$.minRentalHours',
	'$.maxRentalHours',
	'$.advanceNotice',
	'$.minDuration',
	'$.maxDuration'
);--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `pricing_mode` enum('hour','day','week') NOT NULL;--> statement-breakpoint
ALTER TABLE `stores` MODIFY COLUMN `settings` json DEFAULT ('{"reservationMode":"payment","minRentalMinutes":60,"maxRentalMinutes":null,"advanceNoticeMinutes":1440}');
