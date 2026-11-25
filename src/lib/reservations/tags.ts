/** Tag vocabularies, safe to import in the browser. */

/** Tags staff can tap; free text is allowed too. */
export const GUEST_TAGS = [
  "VIP",
  "Regular",
  "Family",
  "Corporate",
  "Influencer",
  "Press",
  "Staff friend",
  "Difficult",
] as const;

/** Occasions and needs on one booking. */
export const BOOKING_TAGS = [
  "Birthday",
  "Anniversary",
  "Business",
  "Date night",
  "High chair",
  "Wheelchair",
  "Quiet table",
  "Window",
  "Outdoor",
  "Surprise",
] as const;
