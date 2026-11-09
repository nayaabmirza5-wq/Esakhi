import mongoose, { Schema, Document } from "mongoose";

export interface ISeller extends Document {
  userId: mongoose.Types.ObjectId;
  status: "ACTIVE" | "SUSPENDED";
  stepCompleted: number;
  isOnboardingComplete: boolean;

  // Step 1: Tax / Identity
  taxDetails: {
    hasGst: boolean;
    gstin?: string;
    hasEnrolmentId: boolean;
    enrolmentId?: string;
    panNumber: string;
    businessName: string;
    email: string;
  };

  // Step 2: Pickup Point
  pickupAddress: {
    streetAddress: string;
    locality: string;
    city: string;
    state: string;
    pincode: string;
    landmark?: string;
  };

  // Step 3: Bank Account
  bankDetails: {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountType: "SAVINGS" | "CURRENT";
  };

  // Step 4: SHG Profile & Food Regulation
  supplierDetails: {
    shgCode?: string;
    shgName: string;
    storeDisplayName?: string;
    shgLeaderName: string;
    numberOfMembers: number;
    category: "HANDICRAFT" | "TEXTILES" | "FOOD" | "HERBAL";
    areaType?: "RURAL_NRLM" | "URBAN_NULM";
    blockOrUlb?: string;
    villageOrWard?: string;
    isFoodSeller: boolean;
    minShelfLifeDays?: number;
    foodSubcategory?: string;
    fssaiNumber?: string;
    district: string;
  };
}

const SellerSchema = new Schema<ISeller>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
    stepCompleted: { type: Number, default: 4 },
    isOnboardingComplete: { type: Boolean, default: true },

    taxDetails: {
      hasGst: { type: Boolean, default: false },
      gstin: { type: String, uppercase: true, trim: true },
      hasEnrolmentId: { type: Boolean, default: false },
      enrolmentId: { type: String, uppercase: true, trim: true },
      panNumber: { type: String, uppercase: true, trim: true },
      businessName: { type: String, trim: true },
      email: { type: String, trim: true },
    },
    pickupAddress: {
      streetAddress: { type: String, required: true },
      locality: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      landmark: String,
    },
    bankDetails: {
      accountHolderName: { type: String, required: true },
      bankName: String,
      accountNumber: { type: String, required: true },
      ifscCode: { type: String, uppercase: true, trim: true, required: true },
      accountType: { type: String, enum: ["SAVINGS", "CURRENT"], default: "SAVINGS" },
    },
    supplierDetails: {
      shgCode: { type: String, trim: true, uppercase: true },
      shgName: { type: String, required: true },
      storeDisplayName: { type: String, trim: true },
      shgLeaderName: { type: String, required: true },
      numberOfMembers: { type: Number, default: 10 },
      category: { type: String, enum: ["HANDICRAFT", "TEXTILES", "FOOD", "HERBAL"], required: true },
      areaType: { type: String, enum: ["RURAL_NRLM", "URBAN_NULM"], default: "RURAL_NRLM" },
      blockOrUlb: { type: String, trim: true },
      villageOrWard: { type: String, trim: true },
      isFoodSeller: { type: Boolean, default: false },
      minShelfLifeDays: { type: Number, default: 30 },
      foodSubcategory: { type: String, trim: true },
      fssaiNumber: { type: String, trim: true },
      district: { type: String, required: true },
    },
  },
  { timestamps: true }
);

export const Seller = (mongoose.models.Seller as mongoose.Model<ISeller>) || mongoose.model<ISeller>("Seller", SellerSchema);
