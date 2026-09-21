-- A reservation should survive its customer's account being deleted, once
-- the booking itself is no longer active (completed/cancelled). That means
-- customerId must become optional, and the reservation needs its own
-- snapshot of who it was for — otherwise deleting the customer would either
-- be blocked forever, or silently erase the record of who booked what.

-- Add the snapshot columns as nullable first, so existing rows don't fail
-- the insert; backfilled below, then locked to NOT NULL.
ALTER TABLE "Reservation" ADD COLUMN "customerName" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "customerEmail" TEXT;

-- Backfill from the current relation before it's possible for customerId
-- to be null.
UPDATE "Reservation" r
SET "customerName" = c."name", "customerEmail" = c."email"
FROM "Customer" c
WHERE r."customerId" = c."id";

ALTER TABLE "Reservation" ALTER COLUMN "customerName" SET NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "customerEmail" SET NOT NULL;

-- Swap the foreign key: customerId becomes optional, and deleting a
-- Customer now sets it to null on their reservations instead of being
-- blocked by the FK (the application layer still blocks deleting a
-- customer who has a *pending* or *confirmed* reservation — this only
-- covers what happens for their completed/cancelled history).
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_customerId_fkey";
ALTER TABLE "Reservation" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
