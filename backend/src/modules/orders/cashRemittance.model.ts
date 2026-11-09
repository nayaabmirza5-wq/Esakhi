import { Schema, model } from 'mongoose';

const cashRemittanceSchema = new Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    riderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    riderName: { type: String, required: true },
    riderPhone: { type: String, required: true },
    city: { type: String, required: true, index: true },
    amountPaise: { type: Number, required: true, min: 0 },
    orderIds: [{ type: Schema.Types.ObjectId, ref: 'Order' }],
    orderReferences: [{ type: String }],
    settledByAdminId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    settledByAdminName: { type: String, required: true },
    handshakePinUsed: { type: String, required: true },
    method: { type: String, enum: ['physical_hub_cash', 'digital_upi'], default: 'physical_hub_cash' },
    notes: { type: String, trim: true, maxlength: 500 },
    settledAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true },
);

export const CashRemittance = model('CashRemittance', cashRemittanceSchema);
