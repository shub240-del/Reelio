CREATE TABLE `ai_edit_proposals` (
	`id` varchar(36) NOT NULL,
	`requestId` varchar(64) NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`instructionHash` varchar(64) NOT NULL,
	`baseRevision` varchar(64) NOT NULL,
	`planJson` text NOT NULL,
	`provenanceJson` text NOT NULL,
	`provider` varchar(64) NOT NULL,
	`status` enum('pending','applied','rejected','cancelled','no_action') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_edit_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_edit_proposals_user_request_unique` UNIQUE(`userId`,`requestId`)
);
--> statement-breakpoint
ALTER TABLE `exports` MODIFY COLUMN `status` enum('processing','done','failed','cancelled') NOT NULL DEFAULT 'processing';--> statement-breakpoint
ALTER TABLE `exports` ADD `progress` int DEFAULT 0 NOT NULL;