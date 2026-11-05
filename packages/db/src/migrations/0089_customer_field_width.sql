ALTER TABLE `customer_field_definitions` ADD `width` enum('full','half') DEFAULT 'full' NOT NULL;--> statement-breakpoint
-- Existing fields keep today's two-column look: half a row each, a long text on its own row.
UPDATE `customer_field_definitions` SET `width` = 'half' WHERE `field_type` <> 'textarea';--> statement-breakpoint
-- Sections are gone: fold their order into the positions so every form keeps the order it
-- showed (sections in the order of their first field, then fields by position), 1..n per
-- store and scope.
UPDATE `customer_field_definitions` AS `definition`
INNER JOIN (
  SELECT `id`, ROW_NUMBER() OVER (
    PARTITION BY `store_id`, `scope`
    ORDER BY `section_rank`, `position`, `label`, `id`
  ) AS `layout_position`
  FROM (
    SELECT `id`, `store_id`, `scope`, `position`, `label`,
      MIN(`form_rank`) OVER (PARTITION BY `store_id`, `scope`, `section`) AS `section_rank`
    FROM (
      SELECT `id`, `store_id`, `scope`, `section`, `position`, `label`,
        ROW_NUMBER() OVER (
          PARTITION BY `store_id`, `scope`
          ORDER BY `position`, `label`, `id`
        ) AS `form_rank`
      FROM `customer_field_definitions`
    ) AS `ranked`
  ) AS `sectioned`
) AS `ordered` ON `ordered`.`id` = `definition`.`id`
SET `definition`.`position` = `ordered`.`layout_position`;
