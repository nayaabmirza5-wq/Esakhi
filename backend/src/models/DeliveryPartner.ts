import mongoose, { Schema, Document } from "mongoose";

export interface IDeliveryPartner extends Document {
  userId: mongoose.Types.ObjectId;
  partnerId: string; // e.g., "DMH-DP-1001"
  operatingCity: string; // Fixed to "Damoh"
  status: "ACTIVE" | "SUSPENDED";
  isAvailable: boolean; // On-duty toggle
  personalDetails: {
    fullName: string;
    phone: string;
    emergencyPhone: string;
    dob: Date;
  };
  vehicleDetails: {
    vehicleType: "BIKE" | "EV" | "CYCLE";
    dlNumber?: string;
    rcNumber?: string;
    isVerified: boolean;
  };
  kycDetails: {
    panNumber: string;
    aadharNumber: string;
    isPanVerified: boolean;
    isAadharVerified: boolean;
  };
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    ifscCode: string;
    isVerified: boolean;
  };
}

const DeliveryPartnerSchema = new Schema<IDeliveryPartner>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    partnerId: { type: String, unique: true, required: true },
    operatingCity: { type: String, default: "Damoh", required: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
    isAvailable: { type: Boolean, default: true },
    personalDetails: {
      fullName: { type: String, required: true, trim: true },
      phone: { type: String, required: true, match: /^[6-9]\d{9}$/ },
      emergencyPhone: { type: String, required: true, match: /^[6-9]\d{9}$/ },
      dob: { type: Date, required: true }
    },
    vehicleDetails: {
      vehicleType: { type: String, enum: ["BIKE", "EV", "CYCLE"], required: true },
      dlNumber: { type: String, uppercase: true, trim: true },
      rcNumber: { type: String, uppercase: true, trim: true },
      isVerified: { type: Boolean, default: true }
    },
    kycDetails: {
      panNumber: { type: String, required: true, uppercase: true, match: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/ },
      aadharNumber: { type: String, required: true, match: /^\d{12}$/ },
      isPanVerified: { type: Boolean, default: true },
      isAadharVerified: { type: Boolean, default: true }
    },
    bankDetails: {
      accountHolderName: { type: String, required: true, trim: true },
      bankName: { type: String, required: true },
      branchName: { type: String, required: true },
      accountNumber: { type: String, required: true, trim: true },
      ifscCode: { type: String, required: true, uppercase: true, match: /^[A-Z]{4}0[A-Z0-9]{6}$/ },
      isVerified: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

export const DeliveryPartner =
  (mongoose.models.DeliveryPartner as mongoose.Model<IDeliveryPartner>) ||
  mongoose.model<IDeliveryPartner>("DeliveryPartner", DeliveryPartnerSchema);
