-- CreateTable
CREATE TABLE `AppUsers` (
    `id` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `email` VARCHAR(256) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'Viewer',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastLoginAt` DATETIME(3) NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `avatarPath` VARCHAR(500) NULL,
    `jobTitle` VARCHAR(100) NULL,
    `phoneNumber` VARCHAR(50) NULL,
    `department` VARCHAR(100) NULL,
    `preferences` LONGTEXT NULL,

    UNIQUE INDEX `AppUsers_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Projects` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `clientName` VARCHAR(200) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `projectManagerId` VARCHAR(191) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Draft',
    `priority` VARCHAR(50) NOT NULL DEFAULT 'Medium',
    `allowManagerCustomFields` BOOLEAN NOT NULL DEFAULT false,
    `createdByAdminId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `aiOutput` TEXT NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `deletedByUserId` VARCHAR(191) NULL,
    `tags` VARCHAR(500) NULL,
    `budget` DECIMAL(65, 30) NULL,

    INDEX `Projects_status_idx`(`status`),
    INDEX `Projects_projectManagerId_idx`(`projectManagerId`),
    INDEX `Projects_isDeleted_idx`(`isDeleted`),
    INDEX `Projects_priority_idx`(`priority`),
    INDEX `Projects_createdAt_idx`(`createdAt`),
    INDEX `Projects_isDeleted_status_idx`(`isDeleted`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectFields` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `fieldType` VARCHAR(50) NOT NULL DEFAULT 'Text',
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `defaultValue` VARCHAR(500) NULL,
    `orderIndex` INTEGER NOT NULL DEFAULT 0,
    `fieldCategory` VARCHAR(50) NOT NULL DEFAULT 'Dynamic',
    `options` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectFieldValues` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `projectFieldId` VARCHAR(191) NOT NULL,
    `value` TEXT NULL,

    UNIQUE INDEX `ProjectFieldValues_projectId_projectFieldId_key`(`projectId`, `projectFieldId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectValidations` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `validatedByUserId` VARCHAR(191) NOT NULL,
    `validatedByRole` VARCHAR(50) NOT NULL,
    `phase` VARCHAR(50) NOT NULL,
    `isApproved` BOOLEAN NOT NULL,
    `comment` TEXT NULL,
    `validatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectValidations_projectId_phase_idx`(`projectId`, `phase`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectActivities` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(100) NOT NULL,
    `detail` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectActivities_projectId_idx`(`projectId`),
    INDEX `ProjectActivities_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectTemplates` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `createdByAdminId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectTemplateFields` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `category` VARCHAR(50) NOT NULL DEFAULT 'Custom',
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `options` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectComments` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL,
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,
    `parentCommentId` VARCHAR(191) NULL,
    `mentions` VARCHAR(500) NULL,

    INDEX `ProjectComments_projectId_idx`(`projectId`),
    INDEX `ProjectComments_userId_idx`(`userId`),
    INDEX `ProjectComments_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectAttachments` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `uploadedByUserId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `fileExtension` VARCHAR(20) NOT NULL,
    `contentType` VARCHAR(100) NOT NULL,
    `fileSize` BIGINT NOT NULL,
    `storagePath` VARCHAR(500) NOT NULL,
    `description` VARCHAR(500) NULL,
    `category` VARCHAR(50) NOT NULL DEFAULT 'Document',
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isDeleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `ProjectAttachments_projectId_idx`(`projectId`),
    INDEX `ProjectAttachments_uploadedByUserId_idx`(`uploadedByUserId`),
    INDEX `ProjectAttachments_uploadedAt_idx`(`uploadedAt`),
    INDEX `ProjectAttachments_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MeetingTranscripts` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `originalFileName` VARCHAR(500) NULL,
    `durationSeconds` INTEGER NOT NULL DEFAULT 0,
    `detectedLanguages` VARCHAR(50) NOT NULL DEFAULT '',
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MeetingTranscripts_projectId_idx`(`projectId`),
    INDEX `MeetingTranscripts_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TranscriptSegments` (
    `id` VARCHAR(191) NOT NULL,
    `transcriptId` VARCHAR(191) NOT NULL,
    `speaker` VARCHAR(100) NOT NULL DEFAULT 'Unknown',
    `text` LONGTEXT NOT NULL DEFAULT '',
    `startTime` DOUBLE NOT NULL,
    `endTime` DOUBLE NOT NULL,
    `language` VARCHAR(10) NOT NULL DEFAULT '',
    `confidence` DOUBLE NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notifications_userId_isRead_idx`(`userId`, `isRead`),
    INDEX `Notifications_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Projects` ADD CONSTRAINT `Projects_projectManagerId_fkey` FOREIGN KEY (`projectManagerId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `Projects` ADD CONSTRAINT `Projects_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `Projects` ADD CONSTRAINT `Projects_deletedByUserId_fkey` FOREIGN KEY (`deletedByUserId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectFields` ADD CONSTRAINT `ProjectFields_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectFieldValues` ADD CONSTRAINT `ProjectFieldValues_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectFieldValues` ADD CONSTRAINT `ProjectFieldValues_projectFieldId_fkey` FOREIGN KEY (`projectFieldId`) REFERENCES `ProjectFields`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectValidations` ADD CONSTRAINT `ProjectValidations_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectValidations` ADD CONSTRAINT `ProjectValidations_validatedByUserId_fkey` FOREIGN KEY (`validatedByUserId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectActivities` ADD CONSTRAINT `ProjectActivities_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectActivities` ADD CONSTRAINT `ProjectActivities_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectTemplates` ADD CONSTRAINT `ProjectTemplates_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectTemplateFields` ADD CONSTRAINT `ProjectTemplateFields_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ProjectTemplates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectComments` ADD CONSTRAINT `ProjectComments_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectComments` ADD CONSTRAINT `ProjectComments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectComments` ADD CONSTRAINT `ProjectComments_parentCommentId_fkey` FOREIGN KEY (`parentCommentId`) REFERENCES `ProjectComments`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `ProjectAttachments` ADD CONSTRAINT `ProjectAttachments_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectAttachments` ADD CONSTRAINT `ProjectAttachments_uploadedByUserId_fkey` FOREIGN KEY (`uploadedByUserId`) REFERENCES `AppUsers`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `MeetingTranscripts` ADD CONSTRAINT `MeetingTranscripts_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TranscriptSegments` ADD CONSTRAINT `TranscriptSegments_transcriptId_fkey` FOREIGN KEY (`transcriptId`) REFERENCES `MeetingTranscripts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notifications` ADD CONSTRAINT `Notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `AppUsers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notifications` ADD CONSTRAINT `Notifications_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
