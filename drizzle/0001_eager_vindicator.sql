ALTER TABLE `markers` MODIFY COLUMN `color` varchar(32) NOT NULL DEFAULT '#7c5cff';--> statement-breakpoint
ALTER TABLE `clips` ADD `videoFx` varchar(64);--> statement-breakpoint
ALTER TABLE `clips` ADD `transition` varchar(64);