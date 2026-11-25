-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'HOST');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('ONLINE', 'PHONE', 'WALK_IN', 'WAITLIST');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('GUEST', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TableSessionSource" AS ENUM ('WALK_IN', 'RESERVATION', 'WAITLIST');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'SEATED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GuestMessageKind" AS ENUM ('BOOKING_CONFIRMED', 'REMINDER', 'LATE_ACCEPTED', 'LATE_DECLINED', 'CANCELLED', 'RELEASED', 'WAITLIST_JOINED', 'TABLE_READY', 'WAITLIST_EXPIRED');

-- CreateEnum
CREATE TYPE "GuestMessageStatus" AS ENUM ('QUEUED', 'SENT', 'MANUAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bookingOpensAt" TEXT NOT NULL DEFAULT '12:00',
    "bookingClosesAt" TEXT NOT NULL DEFAULT '23:00',
    "bookingSlotMins" INTEGER NOT NULL DEFAULT 30,
    "bookingLeadMins" INTEGER NOT NULL DEFAULT 60,
    "bookingMaxDaysAhead" INTEGER NOT NULL DEFAULT 30,
    "bookingMaxParty" INTEGER NOT NULL DEFAULT 20,
    "onlineTablesPct" INTEGER NOT NULL DEFAULT 80,
    "defaultDiningMins" INTEGER NOT NULL DEFAULT 90,
    "cleaningMins" INTEGER NOT NULL DEFAULT 10,
    "graceMins" INTEGER NOT NULL DEFAULT 15,
    "autoReleaseNoShows" BOOLEAN NOT NULL DEFAULT true,
    "reminderMinsBefore" INTEGER NOT NULL DEFAULT 120,
    "holdMinsBefore" INTEGER NOT NULL DEFAULT 30,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "waitlistAutoNotify" BOOLEAN NOT NULL DEFAULT true,
    "waitlistReplyMins" INTEGER NOT NULL DEFAULT 10,
    "cctvAutoVacate" BOOLEAN NOT NULL DEFAULT false,
    "edgeKeyHash" TEXT,
    "bookingWeekHours" JSONB,
    "bookingMaxCoversPerSlot" INTEGER NOT NULL DEFAULT 0,
    "floorFixtures" JSONB,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'HOST',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "minParty" INTEGER NOT NULL DEFAULT 1,
    "area" TEXT NOT NULL DEFAULT 'Main hall',
    "joinGroup" TEXT,
    "reservable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "cctvOccupied" BOOLEAN,
    "cctvPeople" INTEGER,
    "cctvConfidence" DOUBLE PRECISION,
    "cctvSince" TIMESTAMP(3),
    "cctvSeenAt" TIMESTAMP(3),
    "planX" INTEGER,
    "planY" INTEGER,
    "planW" INTEGER,
    "planH" INTEGER,
    "shape" TEXT NOT NULL DEFAULT 'SQUARE',

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 90,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "ReservationSource" NOT NULL DEFAULT 'ONLINE',
    "note" TEXT,
    "areaPreference" TEXT,
    "code" TEXT,
    "manageToken" TEXT,
    "guestConfirmedAt" TIMESTAMP(3),
    "lateUntil" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "CancelledBy",
    "releasedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "guestId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffNote" TEXT,
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationTable" (
    "reservationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "blockStart" TIMESTAMP(3) NOT NULL,
    "blockEnd" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReservationTable_pkey" PRIMARY KEY ("reservationId","tableId")
);

-- CreateTable
CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "source" "TableSessionSource" NOT NULL DEFAULT 'WALK_IN',
    "partySize" INTEGER,
    "reservationId" TEXT,
    "waitlistEntryId" TEXT,
    "seatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstOrderAt" TIMESTAMP(3),
    "billRequestedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "cleanedAt" TIMESTAMP(3),
    "leftVia" TEXT,
    "freeAtOverride" TIMESTAMP(3),
    "revenueCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "manageToken" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "partySize" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "source" TEXT NOT NULL DEFAULT 'REMOTE',
    "quotedMins" INTEGER,
    "note" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "respondBy" TIMESTAMP(3),
    "offeredTableIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "guestId" TEXT,
    "seatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestMessage" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "reservationId" TEXT,
    "waitlistEntryId" TEXT,
    "kind" "GuestMessageKind" NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "GuestMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT,
    "notes" TEXT,
    "birthday" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingClosure" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "onlineOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorRevision" (
    "restaurantId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorRevision_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key","windowEnd")
);

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE INDEX "StaffUser_restaurantId_idx" ON "StaffUser"("restaurantId");

-- CreateIndex
CREATE INDEX "Table_restaurantId_idx" ON "Table"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_manageToken_key" ON "Reservation"("manageToken");

-- CreateIndex
CREATE INDEX "Reservation_guestId_startAt_idx" ON "Reservation"("guestId", "startAt");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_startAt_idx" ON "Reservation"("restaurantId", "startAt");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_status_startAt_idx" ON "Reservation"("restaurantId", "status", "startAt");

-- CreateIndex
CREATE INDEX "Reservation_restaurantId_updatedAt_idx" ON "Reservation"("restaurantId", "updatedAt");

-- CreateIndex
CREATE INDEX "Reservation_tableId_idx" ON "Reservation"("tableId");

-- CreateIndex
CREATE INDEX "ReservationTable_tableId_blockStart_idx" ON "ReservationTable"("tableId", "blockStart");

-- CreateIndex
CREATE INDEX "ReservationTable_restaurantId_blockStart_idx" ON "ReservationTable"("restaurantId", "blockStart");

-- CreateIndex
CREATE INDEX "TableSession_restaurantId_seatedAt_idx" ON "TableSession"("restaurantId", "seatedAt");

-- CreateIndex
CREATE INDEX "TableSession_restaurantId_updatedAt_idx" ON "TableSession"("restaurantId", "updatedAt");

-- CreateIndex
CREATE INDEX "TableSession_tableId_seatedAt_idx" ON "TableSession"("tableId", "seatedAt");

-- CreateIndex
CREATE INDEX "TableSession_reservationId_idx" ON "TableSession"("reservationId");

-- CreateIndex
CREATE INDEX "TableSession_waitlistEntryId_idx" ON "TableSession"("waitlistEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_code_key" ON "WaitlistEntry"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_manageToken_key" ON "WaitlistEntry"("manageToken");

-- CreateIndex
CREATE INDEX "WaitlistEntry_restaurantId_status_createdAt_idx" ON "WaitlistEntry"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_restaurantId_updatedAt_idx" ON "WaitlistEntry"("restaurantId", "updatedAt");

-- CreateIndex
CREATE INDEX "GuestMessage_restaurantId_status_createdAt_idx" ON "GuestMessage"("restaurantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GuestMessage_reservationId_idx" ON "GuestMessage"("reservationId");

-- CreateIndex
CREATE INDEX "GuestMessage_waitlistEntryId_idx" ON "GuestMessage"("waitlistEntryId");

-- CreateIndex
CREATE INDEX "Guest_restaurantId_lastSeenAt_idx" ON "Guest"("restaurantId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Guest_restaurantId_name_idx" ON "Guest"("restaurantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_restaurantId_phone_key" ON "Guest"("restaurantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "BookingClosure_restaurantId_date_key" ON "BookingClosure"("restaurantId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_restaurantId_createdAt_idx" ON "AuditLog"("restaurantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestMessage" ADD CONSTRAINT "GuestMessage_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingClosure" ADD CONSTRAINT "BookingClosure_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Guarantees Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_range_chk"
  CHECK ("blockEnd" > "blockStart");

-- No double booking, enforced by Postgres itself: two active blocks on the
-- same table may not overlap. Concurrent confirms race here and exactly one
-- wins; the loser gets a constraint error the API turns into "just taken".
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_no_overlap"
  EXCLUDE USING gist ("tableId" WITH =, tsrange("blockStart", "blockEnd", '[)') WITH &&)
  WHERE ("active");

-- One party per table at a time: at most one session not yet cleaned.
CREATE UNIQUE INDEX "TableSession_one_open_per_table" ON "TableSession"("tableId")
  WHERE "cleanedAt" IS NULL;
