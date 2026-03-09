-- Adds AENA verification fields to the Aerobox cache table.
-- Run once.

ALTER TABLE `shuttle_flights`
  ADD COLUMN `aenaVerificado` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `aenaVerificadoAt` datetime NULL,
  ADD COLUMN `aenaHoraProgramada` time NULL,
  ADD COLUMN `aenaFechaEstimada` date NULL,
  ADD COLUMN `aenaHoraEstimada` time NULL,
  ADD COLUMN `aenaEstado` varchar(50) NULL,
  ADD KEY `idx_aena_verificadoAt` (`aenaVerificadoAt`);
