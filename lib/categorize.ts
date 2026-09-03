/**
 * Role categories — the normalization layer above raw ATS departments.
 *
 * Every company names its teams differently ("Akoustis - Starlink",
 * "Avionics Electromechanical", "Barrel Production"). Job seekers think in
 * roles. This maps each job onto one of a fixed set of categories using
 * keyword rules: TITLE first (most reliable), then DEPARTMENT as a
 * fallback, else "Other".
 *
 * The worker stamps jobs.category on every run, so editing these rules
 * re-categorizes the whole database at the next sync — no backfill needed.
 * The worker summary reports "Other" counts per company; use that to add
 * rules.
 */

export const CATEGORIES = [
  'Software Engineering',
  'Data & AI',
  'Hardware & Electrical',
  'Mechanical & Aerospace',
  'Manufacturing & Operations',
  'Design',
  'Product & Program',
  'Sales & Business',
  'Marketing',
  'Customer Support',
  'People & Recruiting',
  'Finance & Legal',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Ordered rules: first match wins, so more specific categories come first.
 * Word boundaries everywhere — "ai" alone is deliberately NOT a signal
 * (see SpaceX's "AI Satellite Solar Production").
 */
const RULES: Array<[Category, RegExp]> = [
  ['Data & AI', /\b(machine learning|ml engineer|ml ops|mlops|data scien\w*|data engineer\w*|analytics engineer|data analy\w*|business intelligence|artificial intelligence|deep learning|computer vision|nlp|llm|ai engineer|ai research\w*|research scientist|applied scientist|perception engineer|autonomy engineer)\b/],
  ['Software Engineering', /\b(software|developer|dev ?ops|sre|site reliability|front[- ]?end|back[- ]?end|full[- ]?stack|web engineer|mobile engineer|ios|android|platform engineer|cloud engineer|infrastructure engineer|security engineer|application security|embedded|firmware|simulation engineer|qa engineer|quality assurance engineer|test automation|sdet|solutions architect|it engineer|systems administrator|network engineer|database administrator|dba)\b/],
  ['Hardware & Electrical', /\b(electrical|hardware|rf|radio frequency|antenna|pcb|fpga|asic|power electronics|avionics|electronics|circuit|signal integrity|emc|emi|photonics|optical engineer|electro[- ]?mechanical|test engineer)\b/],
  ['Mechanical & Aerospace', /\b(mechanical|aerospace|aeronautic\w*|propulsion|structures|structural|thermal|fluids?|gnc|guidance|navigation|flight|mission|spacecraft|satellite engineer|launch engineer|vehicle engineer|dynamics|materials engineer|stress engineer|design engineer|systems engineer|integration engineer|reliability engineer|manufacturing engineer)\b/],
  ['Manufacturing & Operations', /\b(technician|production|manufacturing|assembl\w*|machinist|welder|welding|fabricat\w*|operator|inspector|quality inspection|quality control|supply chain|logistics|warehouse|facilities|maintenance|procurement|buyer|planner|scheduler|inventory|shipping|receiving|ehs|safety|operations)\b/],
  ['Design', /\b(product designer|ux|ui designer|user experience|user interface|visual designer|brand designer|graphic designer|industrial designer|motion designer|design lead|creative director|art director|illustrator|designer)\b/],
  ['Product & Program', /\b(product manager|product owner|product lead|head of product|program manager|project manager|technical program|tpm|scrum|delivery manager|chief of staff)\b/],
  ['Sales & Business', /\b(sales|account executive|account manager|business development|partnerships?|revenue|solutions engineer|sales engineer|pre[- ]?sales|enterprise|go[- ]to[- ]market|gtm|strategy|corporate development|bizops|business operations|analyst)\b/],
  ['Marketing', /\b(marketing|content|seo|sem|growth|communications|public relations|pr manager|social media|brand manager|copywriter|community manager|events?|demand generation|lifecycle)\b/],
  ['Customer Support', /\b(customer support|customer success|customer experience|customer service|support engineer|technical support|help desk|success manager|implementation|onboarding specialist|trust and safety)\b/],
  ['People & Recruiting', /\b(recruit\w*|talent|human resources|hr|people operations|people partner|learning and development|l&d|compensation|benefits|workplace|office manager|executive assistant|administrative)\b/],
  ['Finance & Legal', /\b(finance|financial|accounting|accountant|controller|fp&a|treasury|tax|payroll|audit\w*|legal|counsel|paralegal|compliance|contracts? manager|regulatory|privacy|export control)\b/],
];

function match(text: string): Category | null {
  const t = text.toLowerCase();
  for (const [category, re] of RULES) {
    if (re.test(t)) return category;
  }
  return null;
}

/** Classify a job. Title is decisive; department only breaks ties to "Other". */
export function categorize(title: string, department?: string | null): Category {
  return match(title) ?? (department ? match(department) : null) ?? 'Other';
}

/** Stable display ordering for filter lists. */
export function categoryOrder(c: string): number {
  const i = (CATEGORIES as readonly string[]).indexOf(c);
  return i === -1 ? CATEGORIES.length : i;
}
