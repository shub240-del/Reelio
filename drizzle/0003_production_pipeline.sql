CREATE TABLE `media_analyses` (
	`id` varchar(36) NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`assetId` int NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('transcription','scene') NOT NULL,
	`status` enum('queued','processing','done','failed','cancelled') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`attempt` int NOT NULL DEFAULT 0,
	`provider` varchar(64) NOT NULL,
	`resultJson` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `media_analyses_id` PRIMARY KEY(`id`),
	CONSTRAINT `media_analyses_user_request_unique` UNIQUE(`userId`,`requestId`)
);
--> statement-breakpoint
ALTER TABLE `exports` MODIFY COLUMN `status` enum('queued','processing','done','failed','cancelled') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `clips` ADD `zIndex` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `volume` double DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `trackVolume` double DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `positionX` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `positionY` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `scale` double DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `cropLeft` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `cropTop` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `cropRight` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clips` ADD `cropBottom` double DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exports` ADD `requestId` varchar(64);--> statement-breakpoint
UPDATE `exports` SET `requestId` = CONCAT('legacy-', `id`) WHERE `requestId` IS NULL;--> statement-breakpoint
ALTER TABLE `exports` MODIFY COLUMN `requestId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `exports` ADD `includeCaptions` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `exports` ADD `attempt` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `exports` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `exports` ADD CONSTRAINT `exports_user_request_unique` UNIQUE(`userId`,`requestId`);--> statement-breakpoint
ALTER TABLE `media_analyses` ADD CONSTRAINT `media_analyses_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_analyses` ADD CONSTRAINT `media_analyses_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media_analyses` ADD CONSTRAINT `media_analyses_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `media_analyses_asset_kind_idx` ON `media_analyses` (`assetId`,`kind`);--> statement-breakpoint
CREATE INDEX `media_analyses_status_idx` ON `media_analyses` (`status`,`createdAt`);--> statement-breakpoint
ALTER TABLE `ai_edit_proposals` ADD CONSTRAINT `ai_edit_proposals_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_edit_proposals` ADD CONSTRAINT `ai_edit_proposals_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `captions` ADD CONSTRAINT `captions_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `captions` ADD CONSTRAINT `captions_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clips` ADD CONSTRAINT `clips_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clips` ADD CONSTRAINT `clips_assetId_assets_id_fk` FOREIGN KEY (`assetId`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exports` ADD CONSTRAINT `exports_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exports` ADD CONSTRAINT `exports_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `markers` ADD CONSTRAINT `markers_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_edit_proposals_project_status_idx` ON `ai_edit_proposals` (`projectId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `assets_project_idx` ON `assets` (`projectId`);--> statement-breakpoint
CREATE INDEX `assets_user_idx` ON `assets` (`userId`);--> statement-breakpoint
CREATE INDEX `captions_project_time_idx` ON `captions` (`projectId`,`startTime`);--> statement-breakpoint
CREATE INDEX `captions_asset_idx` ON `captions` (`assetId`);--> statement-breakpoint
CREATE INDEX `clips_project_timeline_idx` ON `clips` (`projectId`,`timelineStart`,`trackId`);--> statement-breakpoint
CREATE INDEX `clips_asset_idx` ON `clips` (`assetId`);--> statement-breakpoint
CREATE INDEX `exports_project_created_idx` ON `exports` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `exports_status_idx` ON `exports` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`userId`);
