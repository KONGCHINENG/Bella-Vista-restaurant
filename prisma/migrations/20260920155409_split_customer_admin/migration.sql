-- Split the single "User" table (with a role column) into two separate
-- tables: "Customer" (can hold reservations) and "Admin" (never does).
-- Hand-written rather than auto-generated, because this needs to carry
-- existing rows across the split without losing data — in particular, an
-- account that is currently role='admin' but already has a reservation on
-- file (from before it was promoted) needs to end up in BOTH new tables,
-- so the reservation keeps a valid owner and admin access is preserved.

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- Migrate data: every user who is role='customer', OR who has at least one
-- reservation (regardless of current role), becomes a Customer — preserving
-- the original id so the Reservation foreign key still lines up below.
INSERT INTO "Customer" ("id", "name", "email", "passwordHash", "createdAt")
SELECT "id", "name", "email", "passwordHash", "createdAt"
FROM "User"
WHERE "role" = 'customer'
   OR EXISTS (SELECT 1 FROM "Reservation" r WHERE r."userId" = "User"."id");

-- Every user who is role='admin' becomes an Admin, keeping their existing
-- id, email, and password hash — so existing admin credentials keep working
-- unchanged against the new dedicated admin login.
INSERT INTO "Admin" ("id", "name", "email", "passwordHash", "createdAt")
SELECT "id", "name", "email", "passwordHash", "createdAt"
FROM "User"
WHERE "role" = 'admin';

-- Point Reservation at Customer instead of User
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_userId_fkey";
ALTER TABLE "Reservation" RENAME COLUMN "userId" TO "customerId";
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable
DROP TABLE "User";

-- Keep autoincrement sequences ahead of the ids we just inserted explicitly,
-- so the next signup/admin-create doesn't collide with a migrated row.
DO $$
DECLARE
  max_customer_id INTEGER;
  max_admin_id INTEGER;
BEGIN
  SELECT COALESCE(MAX("id"), 0) INTO max_customer_id FROM "Customer";
  SELECT COALESCE(MAX("id"), 0) INTO max_admin_id FROM "Admin";
  IF max_customer_id > 0 THEN
    PERFORM setval(pg_get_serial_sequence('"Customer"', 'id'), max_customer_id);
  END IF;
  IF max_admin_id > 0 THEN
    PERFORM setval(pg_get_serial_sequence('"Admin"', 'id'), max_admin_id);
  END IF;
END $$;
