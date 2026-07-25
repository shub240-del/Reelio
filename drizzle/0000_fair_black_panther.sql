CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(512) NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` varchar(512) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`sizeBytes` bigint NOT NULL,
	`duration` double NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`fps` double NOT NULL,
	`hasAudio` boolean NOT NULL DEFAULT false,
	`thumbnailKey` varchar(512),
	`thumbnailUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `captions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`assetId` int NOT NULL,
	`text` text NOT NULL,
	`startTime` double NOT NULL,
	`endTime` double NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `captions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`assetId` int NOT NULL,
	`trackId` int NOT NULL DEFAULT 0,
	`trackType` enum('video','audio') NOT NULL DEFAULT 'video',
	`sourceStart` double NOT NULL,
	`duration` double NOT NULL,
	`timelineStart` double NOT NULL,
	`sortIndex` int NOT NULL DEFAULT 0,
	`locked` boolean NOT NULL DEFAULT false,
	`visible` boolean NOT NULL DEFAULT true,
	`muted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clips_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`url` varchar(512) NOT NULL,
	`resolution` varchar(32) NOT NULL,
	`format` varchar(16) NOT NULL DEFAULT 'mp4',
	`duration` double NOT NULL,
	`status` enum('processing','done','failed') NOT NULL DEFAULT 'processing',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `exports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `markers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`time` double NOT NULL,
	`label` varchar(256),
	`color` varchar(32) NOT NULL DEFAULT '#f97316',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `markers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`status` enum('draft','editing','exporting','done') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
