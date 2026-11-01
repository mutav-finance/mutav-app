/** Where the journeys find each app, and where each persona's session is saved. */
export const AGENCY_URL = process.env.E2E_AGENCY_URL ?? "http://localhost:3000";
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3003";

export const AGENCY_STATE = "e2e/.auth/agency.json";
export const STAFF_STATE = "e2e/.auth/staff.json";
