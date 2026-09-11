/**
 * Copy parked for an About page.
 *
 * This was "The idea" on the homepage — the section that opened "Come as
 * guests. Leave lighter." It came off on 11 September 2026 to shorten the
 * homepage, not because anything in it was wrong; it is some of the best
 * writing on the site and it belongs on an About page when there is one.
 *
 * Nothing imports this yet. That is deliberate: it is a holding place, not
 * dead code to delete. When /about is built, import ABOUT and render it.
 */

export const ABOUT = {
  eyebrow: 'The idea',
  heading: ['Come as guests.', 'Leave lighter.'],
  lede: 'Raj Kuthir is a small invitation to do Shantiniketan differently: with a morning that does not need an itinerary, a garden that belongs to your group, and a house that lets everyone find their own corner.',
  points: [
    'A private home in nature for the pace of real life.',
    'Warm Bengali hospitality, led by a thoughtful local team.',
  ],
} as const;
