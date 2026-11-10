import mongoose, { Schema, model } from 'mongoose';

export interface SupportTicketRecord {
  ticketReference: string;
  city: string;
  cityAdminId: mongoose.Types.ObjectId;
  cityAdminName: string;
  cityAdminPhone: string;
  category: 'seller_dispute' | 'delivery_dispute' | 'customer_claim' | 'payout_query' | 'policy_help' | 'other';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'under_review' | 'action_taken' | 'resolved' | 'closed';
  relatedOrderReference?: string | undefined;
  relatedParty?: {
    partyType: 'seller' | 'delivery_partner' | 'customer';
    name?: string | undefined;
    phoneE164?: string | undefined;
  } | undefined;
  subject: string;
  description: string;
  superAdminResolution?: {
    resolvedBy?: mongoose.Types.ObjectId | undefined;
    resolvedByName?: string | undefined;
    resolvedAt?: Date | undefined;
    decisionNote?: string | undefined;
    actionTaken?: string | undefined;
  } | undefined;
  timeline: Array<{
    senderRole: 'city_admin' | 'super_admin';
    senderName: string;
    message: string;
    timestamp: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<SupportTicketRecord>(
  {
    ticketReference: { type: String, required: true, unique: true, index: true },
    city: { type: String, required: true, trim: true, index: true },
    cityAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cityAdminName: { type: String, required: true, trim: true },
    cityAdminPhone: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: ['seller_dispute', 'delivery_dispute', 'customer_claim', 'payout_query', 'policy_help', 'other'],
      default: 'seller_dispute',
      index: true,
    },
    priority: {
      type: String,
      required: true,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['open', 'under_review', 'action_taken', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    relatedOrderReference: { type: String, trim: true, uppercase: true },
    relatedParty: {
      partyType: { type: String, enum: ['seller', 'delivery_partner', 'customer'] },
      name: { type: String, trim: true },
      phoneE164: { type: String, trim: true },
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    superAdminResolution: {
      resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      resolvedByName: { type: String, trim: true },
      resolvedAt: { type: Date },
      decisionNote: { type: String, trim: true },
      actionTaken: { type: String, trim: true },
    },
    timeline: [
      {
        senderRole: { type: String, required: true, enum: ['city_admin', 'super_admin'] },
        senderName: { type: String, required: true },
        message: { type: String, required: true, trim: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export const SupportTicket = model<SupportTicketRecord>('SupportTicket', supportTicketSchema);
