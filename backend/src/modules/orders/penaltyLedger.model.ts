import { Schema, model } from 'mongoose';
import type { InferSchemaType } from 'mongoose';

export const PENALTY_PARTY_TYPES = ['seller', 'delivery_partner'] as const;
export type PenaltyPartyType = (typeof PENALTY_PARTY_TYPES)[number];

export const PENALTY_SETTLEMENT_STATUSES = [
  'SELLER_PENALTY_PENDING',
  'DELIVERY_PARTNER_PENALTY_PENDING',
  'SETTLED',
  'WAIVED',
] as const;
export type PenaltySettlementStatus = (typeof PENALTY_SETTLEMENT_STATUSES)[number];

const penaltyLedgerSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    orderReference: { type: String, required: true, trim: true },
    city: { type: String, trim: true, maxlength: 100, default: 'Damoh', index: true },
    partyType: { type: String, enum: PENALTY_PARTY_TYPES, required: true, index: true },
    partyId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    partyName: { type: String, required: true, trim: true, maxlength: 180 },
    penaltyAmountPaise: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 600 },
    faultType: {
      type: String,
      enum: ['seller_fault', 'delivery_partner_fault'],
      required: true,
    },
    cityAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    settlementStatus: {
      type: String,
      enum: PENALTY_SETTLEMENT_STATUSES,
      required: true,
      default: 'SELLER_PENALTY_PENDING',
      index: true,
    },
    settledAt: { type: Date },
  },
  { timestamps: true },
);

penaltyLedgerSchema.index({ partyType: 1, partyId: 1, settlementStatus: 1, createdAt: -1 });

export const PenaltyLedger = model('PenaltyLedger', penaltyLedgerSchema);
export type PenaltyLedgerRecord = InferSchemaType<typeof penaltyLedgerSchema>;
