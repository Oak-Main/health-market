/**
 * Marketplace routing by state.
 *
 * Roughly a third of Marketplace enrollment (7.4M of 23.1M plan selections in
 * PY2026) sits in State-Based Exchanges whose plan data is NOT in the federal
 * QHP Landscape files. Any national tool that pretends otherwise is silently
 * wrong for 21 jurisdictions.
 *
 * This module makes that boundary explicit: for SBE states we route the user
 * to the right exchange rather than quoting a federal number that does not
 * apply to them.
 *
 * COUNT CHECK: 28 FFM + 2 SBE-FP + 21 SBE = 51 entries (50 states + DC). The
 * test suite asserts this total, and it earns its keep: the first draft of this
 * list was transcribed from a secondary source that silently omitted Oklahoma,
 * and the arithmetic (27 + 2 + 21 = 50, one short) is what surfaced it. Do not
 * relax that assertion.
 *
 * @see https://www.cms.gov/marketplace/in-person-assisters/training-webinars/training/marketplaces-map
 */

export type MarketplaceType =
  /** Federally-facilitated: plans and rates are in the federal PUFs. */
  | "FFM"
  /** State-based on the federal platform: uses HealthCare.gov for enrollment. */
  | "SBE-FP"
  /** State-based exchange: own platform, own data, own deadlines. */
  | "SBE";

export interface StateMarketplace {
  readonly state: string;
  readonly name: string;
  readonly type: MarketplaceType;
  /** Consumer-facing exchange URL. */
  readonly url: string;
  /** Exchange brand name, where it differs from HealthCare.gov. */
  readonly exchangeName: string;
  /**
   * Whether the state layers its own premium assistance on top of the federal
   * premium tax credit. Where true, a federal-only calculation understates the
   * subsidy — sometimes to the point of showing $0 when real help exists.
   */
  readonly hasStateSubsidy: boolean;
  readonly note?: string;
}

const HC_GOV = "https://www.healthcare.gov";

function ffm(state: string, name: string): StateMarketplace {
  return {
    state,
    name,
    type: "FFM",
    url: HC_GOV,
    exchangeName: "HealthCare.gov",
    hasStateSubsidy: false,
  };
}

/** Base table for 2026. Use lookupMarketplace for a specific coverage year. */
export const STATE_MARKETPLACES: readonly StateMarketplace[] = [
  // --- Federally-facilitated (28) ---
  ffm("AL", "Alabama"),
  ffm("AK", "Alaska"),
  ffm("AZ", "Arizona"),
  ffm("DE", "Delaware"),
  ffm("FL", "Florida"),
  ffm("HI", "Hawaii"),
  ffm("IN", "Indiana"),
  ffm("IA", "Iowa"),
  ffm("KS", "Kansas"),
  ffm("LA", "Louisiana"),
  ffm("MI", "Michigan"),
  ffm("MS", "Mississippi"),
  ffm("MO", "Missouri"),
  ffm("MT", "Montana"),
  ffm("NE", "Nebraska"),
  ffm("NH", "New Hampshire"),
  ffm("NC", "North Carolina"),
  ffm("ND", "North Dakota"),
  ffm("OH", "Ohio"),
  ffm("OK", "Oklahoma"),
  ffm("SC", "South Carolina"),
  ffm("SD", "South Dakota"),
  ffm("TN", "Tennessee"),
  ffm("TX", "Texas"),
  ffm("UT", "Utah"),
  ffm("WV", "West Virginia"),
  ffm("WI", "Wisconsin"),
  ffm("WY", "Wyoming"),

  // --- State-based on the federal platform (2) ---
  {
    state: "AR",
    name: "Arkansas",
    type: "SBE-FP",
    url: HC_GOV,
    exchangeName: "Arkansas Health Insurance Marketplace",
    hasStateSubsidy: false,
  },
  {
    state: "OR",
    name: "Oregon",
    type: "SBE-FP",
    url: HC_GOV,
    exchangeName: "Oregon Health Insurance Marketplace",
    hasStateSubsidy: false,
    note:
      "Oregon used HealthCare.gov for the 2026 plan year. Use plan-year lookup for later enrollment.",
  },

  // --- State-based exchanges (21, including DC) ---
  {
    state: "CA",
    name: "California",
    type: "SBE",
    url: "https://www.coveredca.com",
    exchangeName: "Covered California",
    hasStateSubsidy: true,
  },
  {
    state: "CO",
    name: "Colorado",
    type: "SBE",
    url: "https://connectforhealthco.com",
    exchangeName: "Connect for Health Colorado",
    hasStateSubsidy: true,
  },
  {
    state: "CT",
    name: "Connecticut",
    type: "SBE",
    url: "https://www.accesshealthct.com",
    exchangeName: "Access Health CT",
    hasStateSubsidy: true,
  },
  {
    state: "DC",
    name: "District of Columbia",
    type: "SBE",
    url: "https://www.dchealthlink.com",
    exchangeName: "DC Health Link",
    hasStateSubsidy: false,
  },
  {
    state: "GA",
    name: "Georgia",
    type: "SBE",
    url: "https://georgiaaccess.gov",
    exchangeName: "Georgia Access",
    hasStateSubsidy: false,
    note: "Transitioned from the federal platform for plan year 2025.",
  },
  {
    state: "ID",
    name: "Idaho",
    type: "SBE",
    url: "https://www.yourhealthidaho.org",
    exchangeName: "Your Health Idaho",
    hasStateSubsidy: false,
    note: "Idaho opens open enrollment earlier than other states (mid-October).",
  },
  {
    state: "IL",
    name: "Illinois",
    type: "SBE",
    url: "https://getcovered.illinois.gov",
    exchangeName: "Get Covered Illinois",
    hasStateSubsidy: false,
    note: "Transitioned from SBE-FP to a full State-Based Exchange for plan year 2026.",
  },
  {
    state: "KY",
    name: "Kentucky",
    type: "SBE",
    url: "https://kynect.ky.gov",
    exchangeName: "kynect",
    hasStateSubsidy: false,
  },
  {
    state: "ME",
    name: "Maine",
    type: "SBE",
    url: "https://www.coverme.gov",
    exchangeName: "CoverME.gov",
    hasStateSubsidy: false,
  },
  {
    state: "MD",
    name: "Maryland",
    type: "SBE",
    url: "https://www.marylandhealthconnection.gov",
    exchangeName: "Maryland Health Connection",
    hasStateSubsidy: true,
  },
  {
    state: "MA",
    name: "Massachusetts",
    type: "SBE",
    url: "https://www.mahealthconnector.org",
    exchangeName: "Massachusetts Health Connector",
    hasStateSubsidy: true,
    note: "ConnectorCare provides state premium and cost-sharing assistance.",
  },
  {
    state: "MN",
    name: "Minnesota",
    type: "SBE",
    url: "https://www.mnsure.org",
    exchangeName: "MNsure",
    hasStateSubsidy: true,
    note: "Minnesota operates a Basic Health Program (MinnesotaCare).",
  },
  {
    state: "NV",
    name: "Nevada",
    type: "SBE",
    url: "https://www.nevadahealthlink.com",
    exchangeName: "Nevada Health Link",
    hasStateSubsidy: false,
  },
  {
    state: "NJ",
    name: "New Jersey",
    type: "SBE",
    url: "https://www.nj.gov/getcoverednj",
    exchangeName: "Get Covered New Jersey",
    hasStateSubsidy: true,
  },
  {
    state: "NM",
    name: "New Mexico",
    type: "SBE",
    url: "https://www.bewellnm.com",
    exchangeName: "beWellnm",
    hasStateSubsidy: true,
  },
  {
    state: "NY",
    name: "New York",
    type: "SBE",
    url: "https://nystateofhealth.ny.gov",
    exchangeName: "NY State of Health",
    hasStateSubsidy: true,
    note: "New York operates the Essential Plan for lower-income residents.",
  },
  {
    state: "PA",
    name: "Pennsylvania",
    type: "SBE",
    url: "https://pennie.com",
    exchangeName: "Pennie",
    hasStateSubsidy: true,
  },
  {
    state: "RI",
    name: "Rhode Island",
    type: "SBE",
    url: "https://healthsourceri.com",
    exchangeName: "HealthSource RI",
    hasStateSubsidy: false,
  },
  {
    state: "VT",
    name: "Vermont",
    type: "SBE",
    url: "https://portal.healthconnect.vermont.gov",
    exchangeName: "Vermont Health Connect",
    hasStateSubsidy: true,
  },
  {
    state: "VA",
    name: "Virginia",
    type: "SBE",
    url: "https://www.marketplace.virginia.gov",
    exchangeName: "Virginia's Insurance Marketplace",
    hasStateSubsidy: false,
    note: "Transitioned from the federal platform for plan year 2024.",
  },
  {
    state: "WA",
    name: "Washington",
    type: "SBE",
    url: "https://www.wahealthplanfinder.org",
    exchangeName: "Washington Healthplanfinder",
    hasStateSubsidy: true,
    note: "Cascade Care Savings provides state premium assistance.",
  },
];

const BY_STATE: ReadonlyMap<string, StateMarketplace> = new Map(
  STATE_MARKETPLACES.map((m) => [m.state, m]),
);

// CMS Plan Year 2027 Marketplace map and HealthCare.gov's Oregon transition notice.
const PY2027_CHANGES: Readonly<Record<string, Partial<StateMarketplace>>> = {
  OR: { type: "SBE", url: "https://explorehealthor.gov/", note: "Oregon operates its own enrollment platform for 2027 coverage." },
  OK: { type: "SBE-FP" },
};
export function lookupMarketplace(stateCode: string, planYear = 2026): StateMarketplace | undefined {
  const entry = BY_STATE.get(stateCode.toUpperCase());
  const change = entry && planYear === 2027 ? PY2027_CHANGES[entry.state] : undefined;
  return entry && change ? { ...entry, ...change } : entry;
}

/** States whose plan data lives in the federal QHP Landscape / Rate PUFs. */
export function usesFederalData(stateCode: string, planYear = 2026): boolean {
  const m = lookupMarketplace(stateCode, planYear);
  return m !== undefined && (m.type === "FFM" || m.type === "SBE-FP");
}

export function marketplaceCounts(planYear = 2026): Record<MarketplaceType, number> {
  return STATE_MARKETPLACES.reduce(
    (acc, entry) => {
      const type = lookupMarketplace(entry.state, planYear)!.type;
      acc[type] += 1;
      return acc;
    },
    { FFM: 0, "SBE-FP": 0, SBE: 0 } as Record<MarketplaceType, number>,
  );
}
