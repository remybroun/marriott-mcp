// Marriott brand tier list.
//
// grade — tier on a full ladder, graded on a curve across the whole portfolio
//         (so Courtyard sits mid-table, not near the top: SS is Bulgari).
// rank  — strict total order, 1 = best. No two brands share a rank.
//
// Sources and per-brand reasoning: research/07-brand-grading.md
// Edit freely — nothing else depends on these values.

export const TIERS = [
  'SS', 'S+', 'S', 'S-',
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
  'F',
];

export const tierRank = (grade) => {
  const i = TIERS.indexOf(grade);
  return i === -1 ? TIERS.length : i;
};

// rank, code, name, grade, segment, variable, why
const TABLE = [
  [1, 'BG', 'Bvlgari Hotels & Resorts', 'SS', 'Luxury', false, 'Smallest, most exclusive, highest ADR in the group.'],
  [2, 'XR', 'St. Regis', 'SS', 'Luxury', false, 'Butler service everywhere; highest award ceiling (~220k pts/night).'],
  [3, 'RZ', 'The Ritz-Carlton', 'S+', 'Luxury', false, 'J.D. Power #1 in Luxury (785) two years running. Most consistent; lower ceiling than St. Regis.'],
  [4, 'EB', 'EDITION', 'S+', 'Luxury', false, 'Schrager design luxury. Luxury rates, no butler-tier service.'],
  [5, 'JW', 'JW Marriott', 'S', 'Luxury', false, 'Accessible luxury; most consistent of the core-luxury tier.'],
  [6, 'LC', 'The Luxury Collection', 'S', 'Luxury', true, 'J.D. Power 758 (4th in Luxury) but explicitly no consistent brand standard.'],
  [7, 'WH', 'W Hotels', 'S-', 'Luxury', true, 'Priced luxury, positioned as loud and bar-led. Most polarising brand here.'],
  [8, 'WI', 'Westin', 'S-', 'Premium', false, "Marriott's most consistent upper-premium brand. Wellness, Heavenly Bed."],
  [9, 'MC', 'Marriott Hotels', 'A+', 'Premium', false, 'Flagship full service. STR Upper Upscale; the reliable default.'],
  [10, 'AK', 'Autograph Collection', 'A+', 'Premium', true, 'Real character, enormous spread. Most variable brand in the portfolio.'],
  [11, 'MD', 'Le Méridien', 'A', 'Premium', false, 'STR Upper Upscale. European design, less consistent than Westin.'],
  [12, 'BR', 'Renaissance Hotels', 'A', 'Premium', false, 'Full service, neighbourhood-led. Dependable, rarely exceptional.'],
  [13, 'GE', 'Gaylord Hotels', 'A-', 'Premium', false, 'Vast convention resorts. Great for its purpose, poor for a quiet stay.'],
  [14, 'DS', 'Design Hotels', 'A-', 'Premium', true, 'Independent design-led. Character over consistency.'],
  [15, 'SI', 'Sheraton', 'A-', 'Premium', true, 'Mid-renovation. Renovated properties strong, un-renovated are the weakest "premium" stays.'],
  [16, 'TX', 'Tribute Portfolio', 'B+', 'Premium', true, 'Soft brand a notch below Autograph; lighter standards.'],
  [17, 'MG', 'MGM Collection with Marriott Bonvoy', 'B+', 'Collection', true, 'Bellagio and Aria down to Excalibur under one code. Widest internal spread here.'],
  [18, 'DE', 'Delta Hotels', 'B+', 'Premium', false, '"Relatively basic compared to other premium Marriott brands" — premium badge, select substance.'],
  [19, 'ER', 'Marriott Executive Apartments', 'B', 'Longer Stays', false, 'High-spec corporate housing. Worst earn rate in the programme (2.5x).'],
  [20, 'RI', 'Residence Inn', 'B', 'Longer Stays', false, 'The extended-stay benchmark: real suites, kitchens, breakfast.'],
  [21, 'AR', 'AC Hotels by Marriott', 'B', 'Select', false, 'Best-looking select brand, thinnest amenities. "Sparse but functional."'],
  [22, 'CY', 'Courtyard by Marriott', 'B-', 'Select', false, 'STR Upscale. The business default: never exciting, never bad.'],
  [23, 'CM', 'citizenM', 'B-', 'Select', false, 'Design-led and unusually consistent for the price. Deliberately tiny rooms.'],
  [24, 'MV', 'Marriott Vacation Club', 'B-', 'Vacation', false, 'Spacious villas; timeshare-adjacent sales culture.'],
  [25, 'EL', 'Element', 'C+', 'Longer Stays', false, 'Wellness extended stay. Above TownePlace, below Residence Inn. Earns 5x.'],
  [26, 'SH', 'SpringHill Suites', 'C+', 'Select', false, 'All-suite: larger rooms, desks, couches, free breakfast. A step above Fairfield.'],
  [27, 'AL', 'Aloft', 'C+', 'Select', false, 'Industrial-chic loft rooms, social lobbies. Ageing unevenly.'],
  [28, 'OX', 'Moxy Hotels', 'C', 'Select', false, 'TPG Best Affordable Hotel Brand 2023. Rooms "often surprisingly small".'],
  [29, 'FP', 'Four Points by Sheraton', 'C', 'Select', false, 'Comfortable rooms, modest rates, local beer. Unglamorous and honest.'],
  [30, 'BA', 'Apartments by Marriott Bonvoy', 'C', 'Longer Stays', false, 'Full apartments, no on-site hotel services. Earns 5x.'],
  [31, 'HV', 'Homes & Villas by Marriott Bonvoy', 'C-', 'Collection', true, 'Whole-home rentals. Quality entirely per-property. Earns 5x.'],
  [32, 'FI', 'Fairfield by Marriott', 'C-', 'Select', false, 'STR Upper Midscale. Comfortable basics, free breakfast, no ambition.'],
  [33, 'TS', 'TownePlace Suites', 'C-', 'Longer Stays', false, '"Usually a step below Residence Inn properties."'],
  [34, 'PR', 'Protea Hotels', 'D+', 'Select', true, "Africa's largest brand; broad conversion estate. Earns 5x."],
  [35, 'SO', 'Sonder by Marriott Bonvoy', 'D+', 'Collection', true, 'Often unstaffed, app-operated. Convenience over service.'],
  [36, 'SE', 'Series by Marriott', 'D', 'Collection', true, 'Regional midscale conversions keeping their own identity.'],
  [37, 'OC', 'Outdoor Collection by Marriott Bonvoy', 'D', 'Collection', true, 'Glamping and cabins. Too new and heterogeneous to grade tightly.'],
  [38, 'XE', 'City Express by Marriott', 'D-', 'Select', false, 'Latin American economy brand. Earns 5x.'],
  [39, 'XF', 'Four Points Flex by Sheraton', 'D-', 'Select', false, 'Budget conversion line. Carries the Sheraton name, nowhere near Sheraton.'],
  [40, 'SF', 'StudioRes', 'F', 'Longer Stays', false, '"Most basic extended-stay option." Earns 4x with NO elite night credits — the floor.'],
];

export const BRANDS = Object.fromEntries(
  TABLE.map(([rank, code, name, grade, segment, variable, why]) => [
    code,
    { name, grade, rank, segment, variable, why },
  ]),
);

/**
 * Look up a brand by facet code, falling back to an exact name match.
 *
 * Never returns `code` — the caller's facet code is authoritative. Matching is exact
 * normalised equality, never substring: "Four Points Flex by Sheraton" contains
 * "Sheraton" and would otherwise inherit Sheraton's grade despite being a budget brand.
 */
export function gradeFor(code, label = '') {
  if (code && BRANDS[code]) return { ...BRANDS[code], matchedBy: 'code' };
  const needle = String(label).toLowerCase().replace(/[^a-z]/g, '');
  if (needle) {
    for (const [c, b] of Object.entries(BRANDS)) {
      if (b.name.toLowerCase().replace(/[^a-z]/g, '') === needle) {
        return { ...b, matchedBy: 'name', aliasOf: c };
      }
    }
  }
  return { name: label || code, grade: null, rank: 999, segment: null, matchedBy: null };
}

/** ANSI colour per tier, for terminal output. */
export function tierColour(grade) {
  // Must honour the same no-colour rules as the rest of the renderer, or piped and
  // NO_COLOR output leaks raw escape codes in this one column.
  const on = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
  if (!grade || !on) return (s) => s;
  const wrap = (c) => (s) => `\x1b[${c}m${s}\x1b[0m`;
  if (grade.startsWith('SS')) return wrap('1;35'); // magenta
  if (grade.startsWith('S')) return wrap('1;33'); // yellow
  if (grade.startsWith('A')) return wrap('1;36'); // cyan
  if (grade.startsWith('B')) return wrap('0;32'); // green
  if (grade.startsWith('C')) return wrap('0;33'); // dark yellow
  if (grade.startsWith('D')) return wrap('0;31'); // red
  return wrap('1;31'); // F — bright red
}
