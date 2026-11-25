import type { GuestMessageKind } from "@prisma/client";
import { prisma } from "../db";
import { enqueue } from "../jobs";
import { log } from "../log";

/**
 * WhatsApp to guests.
 *
 * Two ways out, chosen by configuration, never by the restaurant's budget:
 *
 * 1. WhatsApp Cloud API (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID), one
 *    business number sending a pre-approved utility template
 *    (WHATSAPP_TEMPLATE, one {{1}} body parameter) on the restaurant's behalf.
 * 2. Nothing configured: the message waits on the floor board with a
 *    "Send on WhatsApp" button that opens the host's own WhatsApp with the
 *    text ready. Free, no Meta account, works on day one, which is how most
 *    small Pakistani restaurants already talk to guests.
 *
 * Every message carries the guest's manage link, so confirming, running late
 * and cancelling work the same either way, with no reply parsing.
 */

export function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function manageUrl(slug: string, token: string) {
  return `${appOrigin()}/r/${slug}/booking/${token}`;
}

export function waitlistUrl(slug: string, token: string) {
  return `${appOrigin()}/r/${slug}/waitlist/${token}`;
}

export function whatsappApiConfigured() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function formatWhen(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-PK", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export function formatTime(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-PK", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    at,
  );
}

type BookingCtx = {
  restaurant: string;
  name: string;
  code: string;
  partySize: number;
  when: string;
  tables?: string;
  link: string;
  graceMins?: number;
};

type WaitCtx = { restaurant: string; name: string; link: string; until?: string; tables?: string };

/** Short, plain, and the same shape every time: who, when, what to do. */
export function composeBooking(kind: GuestMessageKind, c: BookingCtx): string {
  const first = c.name.split(" ")[0];
  switch (kind) {
    case "BOOKING_CONFIRMED":
      return `Assalam o Alaikum ${first}! Your table at ${c.restaurant} is confirmed: ${c.partySize} guests, ${c.when}${c.tables ? ` (${c.tables})` : ""}. Booking ${c.code}. Confirm, change or cancel: ${c.link}`;
    case "REMINDER":
      return `Reminder from ${c.restaurant}: your table for ${c.partySize} is at ${c.when}. We hold it ${c.graceMins ?? 15} minutes past your time. Tap to confirm you're coming, tell us you're late, or cancel: ${c.link}`;
    case "LATE_ACCEPTED":
      return `No problem ${first}, ${c.restaurant} will hold your table until ${c.when}. ${c.link}`;
    case "LATE_DECLINED":
      return `Sorry ${first}, ${c.restaurant} can't hold your table that late tonight. It is still yours at the original time; we hold it ${c.graceMins ?? 15} minutes. ${c.link}`;
    case "CANCELLED":
      return `Your booking ${c.code} at ${c.restaurant} for ${c.when} is cancelled. Book again any time: ${c.link}`;
    case "RELEASED":
      return `We missed you, ${first}. Your table at ${c.restaurant} for ${c.when} was released after the ${c.graceMins ?? 15}-minute grace period. If you're nearby, join the waiting list: ${c.link}`;
    default:
      return `${c.restaurant}: update on booking ${c.code}. ${c.link}`;
  }
}

export function composeWaitlist(kind: GuestMessageKind, c: WaitCtx): string {
  const first = c.name.split(" ")[0];
  switch (kind) {
    case "WAITLIST_JOINED":
      return `${first}, you're on the waiting list at ${c.restaurant}. Watch your place live: ${c.link}`;
    case "TABLE_READY":
      return `${first}, your table at ${c.restaurant} is ready${c.tables ? ` (${c.tables})` : ""}! Please come to the host by ${c.until}, then it goes to the next family. ${c.link}`;
    case "WAITLIST_EXPIRED":
      return `${first}, we couldn't hold your table at ${c.restaurant} any longer. Rejoin the list if you still want one: ${c.link}`;
    default:
      return `${c.restaurant}: waiting list update. ${c.link}`;
  }
}

export async function queueGuestMessage(input: {
  restaurantId: string;
  reservationId?: string;
  waitlistEntryId?: string;
  kind: GuestMessageKind;
  phone: string | null | undefined;
  body: string;
}) {
  if (!input.phone) return null;
  const message = await prisma.guestMessage.create({
    data: {
      restaurantId: input.restaurantId,
      reservationId: input.reservationId,
      waitlistEntryId: input.waitlistEntryId,
      kind: input.kind,
      toPhone: input.phone,
      body: input.body,
    },
  });
  await enqueue("guest-message", { messageId: message.id }, { dedupeKey: `gm:${message.id}` });
  return message;
}

/** Job handler. Idempotent: a message already settled is left alone. */
export async function deliverGuestMessage(messageId: string) {
  const message = await prisma.guestMessage.findUnique({ where: { id: messageId } });
  if (!message || message.status !== "QUEUED") return;

  if (!whatsappApiConfigured()) {
    await prisma.guestMessage.update({ where: { id: message.id }, data: { status: "MANUAL" } });
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.toPhone.replace(/\D/g, ""),
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE || "mezbaan_guest_update",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [
            {
              type: "body",
              // Template parameters may not contain newlines or long runs of spaces.
              parameters: [
                { type: "text", text: message.body.replace(/\s+/g, " ").slice(0, 1000) },
              ],
            },
          ],
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    log.warn("whatsapp send failed", { messageId, status: res.status, detail });
    // 4xx is a bad number or template: retrying changes nothing, hand it to staff.
    if (res.status >= 400 && res.status < 500) {
      await prisma.guestMessage.update({
        where: { id: message.id },
        data: { status: "MANUAL", error: `WhatsApp API ${res.status}` },
      });
      return;
    }
    throw new Error(`whatsapp ${res.status}`);
  }
  await prisma.guestMessage.update({
    where: { id: message.id },
    data: { status: "SENT", sentAt: new Date(), error: null },
  });
}
