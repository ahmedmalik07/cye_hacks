import { customAlphabet } from "nanoid";

/**
 * Guest identity without accounts: a phone number for WhatsApp, a short code
 * to read out at the door, and an unguessable token in the manage link.
 */

/**
 * Normalise a phone number to E.164. Pakistani numbers are what guests type
 * most, in every shape: 0300 1234567, 300-1234567, 92300…, 0092300…, +92 300….
 * Anything else must arrive with its own + country code.
 * Returns null when it can't be a reachable mobile number.
 */
export function normalisePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let national: string | null = null;
  if (raw.startsWith("+")) {
    if (digits.startsWith("92")) national = digits.slice(2);
    else return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  } else if (digits.startsWith("0092")) national = digits.slice(4);
  else if (digits.startsWith("92") && digits.length === 12) national = digits.slice(2);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  // Pakistani mobiles: 3XX XXXXXXX (10 digits after the country code).
  if (!/^3\d{9}$/.test(national)) return null;
  return `+92${national}`;
}

/** "+92 300 ••• 4567": enough for staff to recognise, not to copy. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return "•••";
  const country = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : "";
  return `${country}${d.slice(-10, -7)} ••• ${d.slice(-4)}`;
}

/** No 0/O, 1/I: a guest reading the code to a busy host gets it right. */
const codeChars = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 5);
const tokenChars = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  32,
);

export function newBookingCode(prefix = "MZ") {
  return `${prefix}-${codeChars()}`;
}

export function newManageToken() {
  return tokenChars();
}

/** A wa.me link that opens WhatsApp with the message ready to send. */
export function whatsappLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
