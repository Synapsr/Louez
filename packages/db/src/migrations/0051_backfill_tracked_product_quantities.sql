UPDATE `products` p
SET `quantity` = (
  SELECT COUNT(*)
  FROM `product_units` u
  WHERE u.`product_id` = p.`id`
    AND u.`lifecycle_status` = 'active'
)
WHERE p.`track_units` = 1;
