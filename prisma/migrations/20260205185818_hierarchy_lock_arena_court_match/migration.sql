/*
  Warnings:

  - You are about to drop the column `matchAddress` on the `Match` table. All the data in the column will be lost.
  - Made the column `arenaId` on table `Court` required. This step will fail if there are existing NULL values in that column.
  - Made the column `courtId` on table `Match` required. This step will fail if there are existing NULL values in that column.

*/

/* =========================================================
   PATCH ORPHANS BEFORE MAKING FKs REQUIRED
   - Court.arenaId: fill nulls
   - Match.courtId: delete nulls (no manual mode)
   ========================================================= */

-- 1) Se existir Match sem courtId, removemos (SEM modo manual)
DELETE FROM "MatchPlayerStat" s
USING "Match" m
WHERE s."matchId" = m."id" AND m."courtId" IS NULL;

DELETE FROM "MatchMessage" mm
USING "Match" m
WHERE mm."matchId" = m."id" AND m."courtId" IS NULL;

DELETE FROM "MatchPresence" mp
USING "Match" m
WHERE mp."matchId" = m."id" AND m."courtId" IS NULL;

DELETE FROM "Match"
WHERE "courtId" IS NULL;


-- 2) Courts sem arenaId: primeiro tenta achar uma Arena do mesmo dono (ownerId == arenaOwnerId)
UPDATE "Court" c
SET "arenaId" = a."id"
FROM "Arena" a
WHERE c."arenaId" IS NULL
  AND c."arenaOwnerId" IS NOT NULL
  AND a."ownerId" = c."arenaOwnerId";


-- 3) Se ainda sobrar Court sem arenaId (caso raro), cria uma Arena LEGADO para o dono e liga nela
-- (cria 1 arena por dono que ainda tem court órfã)
WITH owners AS (
  SELECT DISTINCT c."arenaOwnerId" AS owner_id
  FROM "Court" c
  WHERE c."arenaId" IS NULL AND c."arenaOwnerId" IS NOT NULL
),
created AS (
  INSERT INTO "Arena" ("id","name","slug","ownerId","createdAt","updatedAt")
  SELECT
    gen_random_uuid()::text,
    ('Arena Legado ' || u."name"),
    ('arena-legado-' || substr(md5(gen_random_uuid()::text), 1, 10)),
    o.owner_id,
    now(),
    now()
  FROM owners o
  JOIN "User" u ON u."id" = o.owner_id
  RETURNING "id","ownerId"
)
UPDATE "Court" c
SET "arenaId" = created."id"
FROM created
WHERE c."arenaId" IS NULL
  AND c."arenaOwnerId" = created."ownerId";


-- 4) Segurança: se ainda existir Court sem arenaId (arenaOwnerId null também), melhor excluir (não tem como recuperar)
-- Se preferir, você pode pausar aqui e investigar ao invés de apagar.
DELETE FROM "Court"
WHERE "arenaId" IS NULL;

-- DropForeignKey
ALTER TABLE "Court" DROP CONSTRAINT "Court_arenaId_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_courtId_fkey";

-- AlterTable
ALTER TABLE "Court" ALTER COLUMN "arenaId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Match" DROP COLUMN "matchAddress",
ALTER COLUMN "courtId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Court" ADD CONSTRAINT "Court_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;
