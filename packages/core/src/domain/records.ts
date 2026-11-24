import { z } from 'zod';
import { date } from './dates';

const title = z.string().trim().min(1, 'Udfyld feltet.').max(240);
const text = z.string().max(20000).nullish();
const id = z.uuid();
const ref = id.nullish();
const day = date.nullish();
const amount = z.number().int().safe().nonnegative().nullish();
const currency = z.string().regex(/^[A-Z]{3}$/).optional();
const period = z.enum(['month', 'quarter', 'half_year', 'year']);
const status = z.enum(['registered', 'quote_requested', 'ordered', 'done', 'invoiced', 'closed', 'cancelled']);
const target = z.enum(['property', 'building_part', 'item', 'vehicle']);

export const fields = {
  property: { name: title, address: text, kind: z.enum(['house', 'apartment', 'summerhouse', 'other']), owned: z.union([z.literal(0), z.literal(1)]).optional(), notes: text },
  location: { property_id: id, parent_id: ref, name: title },
  item: { name: title, category: text, location_id: ref, brand: text, model: text, serial_number: text, purchase_date: day, purchase_price_minor: amount, currency, vendor_contact_id: ref, vendor_name: text, warranty_until: day, complaint_until: day, notes: text },
  item_part: { item_id: id, name: title, part_number: text, vendor: text, notes: text },
  building_part: { property_id: id, name: title, kind: text, installed_date: day, notes: text },
  vehicle: { name: title, registration: text, vin: text, make: text, model: text, model_year: z.number().int().min(1886).max(9999).nullish(), first_registration_date: day, fuel: z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'plugin_hybrid', 'other']).nullish(), notes: text },
  odometer_reading: { vehicle_id: id, reading_date: date, km: z.number().int().safe().nonnegative() },
  work_order: { title, description: text, kind: z.enum(['repair', 'service', 'damage', 'improvement', 'inspection']), status: status.optional(), target_type: target.nullish(), target_id: ref, contact_id: ref, reported_date: date, completed_date: day, cost_minor: amount, currency, odometer_km: amount, claim_id: ref },
  contact: { name: title, kind: z.enum(['craftsman', 'shop', 'insurer', 'doctor', 'dentist', 'workshop', 'bank', 'other']), phone: text, email: text, website: text, notes: text },
  account: { name: title, bank: text, last4: z.string().regex(/^\d{4}$/).nullish(), currency },
  category: { name: title, parent_id: ref, kind: z.enum(['expense', 'income', 'transfer']) },
  category_rule: { match_type: z.enum(['contains', 'starts_with', 'regex']), pattern: title, category_id: id, priority: z.number().int().safe().optional(), created_from: z.enum(['user', 'learned']).optional() },
  budget: { year: z.number().int().min(1900).max(9999), name: title },
  budget_line: { budget_id: id, category_id: id, month: z.number().int().min(1).max(12).nullish(), amount_minor: z.number().int().safe().nonnegative() },
  recurring_expense: { name: title, category_id: ref, amount_minor: z.number().int().safe().nonnegative(), currency, period, next_date: day, binding_until: day, contact_id: ref, policy_id: ref, notes: text },
  policy: { title, kind: z.enum(['home_contents', 'building', 'car', 'accident', 'health', 'life', 'travel', 'change_of_ownership', 'pet', 'other']), insurer_contact_id: ref, insurer_name: text, policy_number: text, premium_minor: amount, premium_period: period.nullish(), currency, start_date: day, renewal_date: day, deductible_minor: amount, coverage_sum_minor: amount, notes: text },
  claim: { policy_id: id, claim_number: text, incident_date: date, description: title, status: z.enum(['reported', 'in_progress', 'approved', 'rejected', 'paid', 'closed']).optional(), payout_minor: amount, currency },
  health_visit: { person_id: id, visit_date: date, kind: z.enum(['gp', 'dentist', 'specialist', 'hospital', 'physio', 'other']), contact_id: ref, reason: text, notes: text, referral: text },
  health_screening: { person_id: id, name: title, screening_date: day, result: text, next_due_date: day, notes: text },
  health_vaccination: { person_id: id, vaccine: title, dose: text, given_date: date, next_due_date: day, notes: text },
  health_medication: { person_id: id, name: title, strength: text, dosage: text, start_date: day, end_date: day, prescription_renewal_date: day, notes: text },
  health_allergy: { person_id: id, substance: title, reaction: text, severity: z.enum(['mild', 'moderate', 'severe']).nullish() },
  health_measurement: { person_id: id, type: title, value: z.number(), unit: title, measured_at: z.iso.datetime(), note: text },
} as const;

export const recordType = z.enum(Object.keys(fields) as [keyof typeof fields, ...(keyof typeof fields)[]]);
export type RecordType = z.infer<typeof recordType>;
export const createdTables = new Set(['property', 'item', 'building_part', 'vehicle', 'work_order', 'contact', 'policy', 'claim', 'health_visit']);
export const updatedTables = new Set(['item', 'work_order', 'task']);
export const archivedTables = new Set(['property', 'location', 'item', 'building_part', 'vehicle', 'contact', 'account', 'category', 'recurring_expense', 'policy']);
