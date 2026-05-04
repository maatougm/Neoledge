-- Sprint 2: RACI matrix + Handover engine
-- Apply with: C:/xampp/mysql/bin/mysql.exe -u root -h 127.0.0.1 -P 3306 NeoLeadgeDeployment < prisma/migration-sprint2-raci.sql

-- ─── Team stub (Sprint 1 minimal subset) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `Teams` (
  `code`        VARCHAR(50)  NOT NULL,
  `label`       VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `Teams` (`code`, `label`) VALUES
  ('Cloud',       'Cloud & Infrastructure'),
  ('PS',          'Professional Services'),
  ('Integration', 'Integration & Dev'),
  ('Delivery',    'Delivery & PMO');

-- ─── ActivityRaci ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ActivityRacis` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `phase`               VARCHAR(100) NOT NULL,
  `activityCode`        VARCHAR(100) NOT NULL,
  `activityLabel`       VARCHAR(500) NOT NULL,
  `responsibleTeamCode` VARCHAR(500) NOT NULL,
  `approverTeamCode`    VARCHAR(500) NOT NULL,
  `consultedTeams`      VARCHAR(500) NOT NULL DEFAULT '',
  `informedTeams`       VARCHAR(500) NOT NULL DEFAULT '',
  `order`               INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ActivityRacis_activityCode_key` (`activityCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Handovers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `Handovers` (
  `id`               VARCHAR(36)  NOT NULL,
  `projectId`        VARCHAR(36)  NOT NULL,
  `fromTeamCode`     VARCHAR(50)  NOT NULL,
  `toTeamCode`       VARCHAR(50)  NOT NULL,
  `phase`            VARCHAR(100) NOT NULL,
  `status`           VARCHAR(50)  NOT NULL DEFAULT 'Draft',
  `acceptedAt`       DATETIME(3)  NULL,
  `acceptedByUserId` VARCHAR(36)  NULL,
  `rejectionReason`  TEXT         NULL,
  `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `Handovers_projectId_idx` (`projectId`),
  KEY `Handovers_status_idx` (`status`),
  CONSTRAINT `Handovers_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `Projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── HandoverCriteria ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `HandoverCriteria` (
  `id`           VARCHAR(36)  NOT NULL,
  `handoverId`   VARCHAR(36)  NOT NULL,
  `code`         VARCHAR(100) NOT NULL,
  `label`        VARCHAR(500) NOT NULL,
  `isDone`       TINYINT(1)   NOT NULL DEFAULT 0,
  `doneAt`       DATETIME(3)  NULL,
  `doneByUserId` VARCHAR(36)  NULL,
  `evidenceUrl`  VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  KEY `HandoverCriteria_handoverId_idx` (`handoverId`),
  CONSTRAINT `HandoverCriteria_handoverId_fk` FOREIGN KEY (`handoverId`) REFERENCES `Handovers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RACI seed data (34 activities across 8 phases) ──────────────────────────
INSERT IGNORE INTO `ActivityRacis`
  (`phase`, `activityCode`, `activityLabel`, `responsibleTeamCode`, `approverTeamCode`, `consultedTeams`, `informedTeams`, `order`)
VALUES
  -- Phase 1: Kickoff
  ('Kickoff', 'K1', 'Reunion de lancement projet',    'Delivery',         'Delivery',         'Client',                   'Cloud,PS,Integration', 10),
  ('Kickoff', 'K2', 'Definition du planning macro',   'Delivery',         'Delivery',         'Cloud,PS,Integration',     'Client',               20),
  ('Kickoff', 'K3', 'Validation interlocuteurs',      'Delivery',         'Client',           '',                         'Cloud,PS,Integration', 30),

  -- Phase 2: CadrageTechnique
  ('CadrageTechnique', 'CT1', 'Animation atelier technique',         'Delivery,Cloud', 'Delivery',  '',        'Client',  10),
  ('CadrageTechnique', 'CT2', 'Collecte prerequis',                  'Cloud',          'Cloud',     '',        '',        20),
  ('CadrageTechnique', 'CT3', 'Redaction fiche synthese technique',  'Cloud',          'Cloud',     '',        '',        30),
  ('CadrageTechnique', 'CT4', 'Validation prerequis client',         'Client',         'Delivery',  '',        '',        40),

  -- Phase 3: Environnement
  ('Environnement', 'ENV1', 'Creation environnement prod et prepro', 'Cloud', 'Cloud',    '',       '',        10),
  ('Environnement', 'ENV2', 'Configuration authentification OIDC',   'Cloud', 'Cloud',    '',       '',        20),
  ('Environnement', 'ENV3', 'Configuration SFTP SMTP Mailfeeders',   'Cloud', 'Cloud',    '',       '',        30),
  ('Environnement', 'ENV4', 'Livraison compte admin CdP',            'Cloud', 'Delivery', '',       '',        40),
  ('Environnement', 'ENV5', 'Activation Elise automate',             'Cloud', 'Delivery', '',       '',        50),
  ('Environnement', 'ENV6', 'Activation Neoform',                    'Cloud', 'Delivery', '',       '',        60),
  ('Environnement', 'ENV7', 'Activation IA',                         'Cloud', 'Delivery', '',       '',        70),

  -- Phase 4: Parametrage
  ('Parametrage', 'PAR1', 'Parametrage circuits workflows',   'PS',    'PS',    '', '', 10),
  ('Parametrage', 'PAR2', 'Creation utilisateurs droits',     'PS',    'PS',    '', '', 20),
  ('Parametrage', 'PAR3', 'Statistiques standard deployees',  'Cloud', 'Cloud', '', '', 30),

  -- Phase 5: Integration
  ('Integration', 'INT1', 'Developpements specifiques interfaces', 'Integration', 'Integration', '', '', 10),
  ('Integration', 'INT2', 'Tests unitaires + doc technique',       'Integration', 'Integration', '', '', 20),

  -- Phase 6: Recette
  ('Recette', 'REC1', 'Redaction et animation cahier de recette',       'Delivery',    'Delivery',             '', '',        10),
  ('Recette', 'REC2', 'Correction anomalies Cloud',                     'Cloud',       'Cloud',                '', '',        20),
  ('Recette', 'REC3', 'Correction anomalies fonctionnelles PS',         'PS',          'PS',                   '', '',        30),
  ('Recette', 'REC4', 'Correction anomalies techniques Integration',    'Integration', 'Integration',          '', '',        40),
  ('Recette', 'REC5', 'PV de recette signe',                            'Client',      'Delivery',             '', '',        50),

  -- Phase 7: MEP
  ('MEP', 'MEP1', 'Go NoGo MEP',                  'Delivery', 'Delivery,Client', '', '',        10),
  ('MEP', 'MEP2', 'Snapshot prepro + passage prod','Cloud',    'Cloud',           '', '',        20),
  ('MEP', 'MEP3', 'PV de MEP signe',              'Cloud',    'Delivery',         '', '',        30),

  -- Phase 8: Cloture
  ('Cloture', 'CLO1', 'PV cloture + passation MCO',     'Delivery', 'Delivery', '', '', 10),
  ('Cloture', 'CLO2', 'Signature PV cloture client',    'Client',   'Delivery', '', '', 20);
