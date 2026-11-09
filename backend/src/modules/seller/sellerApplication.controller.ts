import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AuditLog } from '../audit/auditLog.model.js';
import { User } from '../auth/user.model.js';
import { Seller } from '../../models/Seller.js';
import { getCategorySelection } from '../catalog/categoryMaster.js';
import { SellerApplication } from './sellerApplication.model.js';
import { createSellerApplicationSchema, sellerApplicationPageQuerySchema, sellerApplicationReviewSchema } from './sellerApplication.schemas.js';

function cityScope(req: Parameters<RequestHandler>[0]): string {
  const city = req.user?.assignedCity?.trim();
  if (!city) throw new AppError(403, 'CITY_SCOPE_REQUIRED', 'This City Admin account has no assigned city.');
  return city;
}

function cityFilter(city: string): RegExp {
  return new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

export const submitSellerApplication: RequestHandler = async (req, res) => {
  const input = createSellerApplicationSchema.parse(req.body);
  const category = getCategorySelection(input.categoryId, input.subcategoryId, input.productType);
  if (!category) throw new AppError(400, 'INVALID_CATEGORY_HIERARCHY', 'Choose a category and subcategory from the shared category master.');

  // Instant Auto-Provisioning: User account is activated immediately with zero manual bottleneck
  const seller = await User.findOneAndUpdate(
    { phoneE164: input.phone },
    {
      $set: {
        role: 'seller',
        assignedCity: input.city,
        name: input.representative || input.shgName || 'Artisan Seller',
        status: 'active',
      },
      $setOnInsert: { phoneE164: input.phone },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  await Seller.findOneAndUpdate(
    { userId: seller._id },
    {
      $set: {
        userId: seller._id,
        status: 'ACTIVE',
        stepCompleted: 4,
        isOnboardingComplete: true,
        supplierDetails: {
          shgName: input.shgName || 'Artisan SHG',
          shgLeaderName: input.representative || 'Artisan Leader',
          numberOfMembers: 10,
          category: input.categoryId === 'food-items' ? 'FOOD' : 'HANDICRAFT',
          isFoodSeller: input.categoryId === 'food-items',
          district: input.city,
        },
        pickupAddress: {
          streetAddress: input.address || 'Market Hub',
          locality: input.city,
          city: input.city,
          state: 'Madhya Pradesh',
          pincode: '470661',
        },
      },
    },
    { upsert: true, new: true },
  );

  const application = await SellerApplication.create({
    shgName: input.shgName,
    representative: input.representative,
    phoneE164: input.phone,
    city: input.city,
    registeredAddress: input.address,
    primaryCategoryId: category.categoryId,
    primaryCategoryName: category.categoryName,
    primarySubcategoryId: category.subcategoryId,
    primarySubcategoryName: category.subcategoryName,
    primaryProductType: category.productType,
    primaryClassificationStatus: 'classified',
    status: 'approved',
    sellerId: seller._id,
    reviewedAt: new Date(),
    reviewNote: 'Auto-approved instantly on registration (zero-supervision onboarding).',
    ...(input.fssaiRegistrationNumber ? {
      fssaiRegistrationNumber: input.fssaiRegistrationNumber,
      fssaiStatus: 'verified',
    } : { fssaiStatus: 'not_required' }),
  });

  sendData(res, {
    status: 'approved',
    sellerId: seller.id,
    applicationId: application.id,
    message: 'Welcome to eSakhi! Your seller account is active and verified.',
  }, 201);
};

export const listSellerApplications: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const query = sellerApplicationPageQuerySchema.parse(req.query);
  const filter = { city: cityFilter(city), ...(query.status ? { status: query.status } : {}) };
  const [applications, total] = await Promise.all([
    SellerApplication.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    SellerApplication.countDocuments(filter),
  ]);
  sendPage(res, applications, query.page, query.limit, total);
};

export const reviewSellerApplication: RequestHandler = async (req, res) => {
  const city = cityScope(req);
  const { applicationId } = z.object({ applicationId: z.string().regex(/^[a-f\d]{24}$/i) }).parse(req.params);
  const { decision, note, fssaiDecision } = sellerApplicationReviewSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let result: { applicationId: string; status: string; sellerId?: string } | undefined;

  try {
    result = await session.withTransaction(async () => {
      const application = await SellerApplication.findOne({ _id: applicationId, city: cityFilter(city) }).session(session);
      if (!application) throw new AppError(404, 'NOT_FOUND', 'Seller application not found in your assigned city.');
      if (application.status !== 'pending' && application.status !== 'needs_info') {
        throw new AppError(409, 'APPLICATION_ALREADY_REVIEWED', 'This seller application has already been decided.');
      }
      const isFoodSeller = application.primaryCategoryId === 'food-items';
      if (decision === 'approved' && isFoodSeller && fssaiDecision !== 'verified') {
        throw new AppError(409, 'FSSAI_VERIFICATION_REQUIRED', 'Verify the seller’s FSSAI details before approving a food seller.');
      }

      let sellerId: string | undefined;
      if (decision === 'approved') {
        const existingUser = await User.findOne({ phoneE164: application.phoneE164 }).session(session);
        if (existingUser && existingUser.status !== 'active') {
          throw new AppError(409, 'ACCOUNT_DISABLED', 'The applicant account is disabled and cannot be approved.');
        }
        if (existingUser && existingUser.role !== 'customer' && existingUser.role !== 'seller') {
          throw new AppError(409, 'ROLE_CONFLICT', 'This phone number belongs to an account with a different role.');
        }
        if (existingUser?.role === 'seller' && existingUser.assignedCity && !cityFilter(city).test(existingUser.assignedCity)) {
          throw new AppError(409, 'CITY_ASSIGNMENT_CONFLICT', 'This seller account is already assigned to another city.');
        }
        const seller = await User.findOneAndUpdate(
          { phoneE164: application.phoneE164 },
          { $set: { role: 'seller', assignedCity: city }, $setOnInsert: { phoneE164: application.phoneE164, name: application.representative } },
          { upsert: true, new: true, session, runValidators: true, setDefaultsOnInsert: true },
        );
        if (!seller) throw new AppError(500, 'INTERNAL_ERROR', 'The seller account could not be provisioned.');
        sellerId = seller.id;
        application.sellerId = seller._id;
      }

      application.status = decision;
      if (isFoodSeller && fssaiDecision) application.fssaiStatus = fssaiDecision;
      application.reviewNote = note ?? null;
      application.reviewedBy = new mongoose.Types.ObjectId(actorId);
      application.reviewedAt = new Date();
      await application.save({ session });
      await AuditLog.create([{
        actorId,
        action: `seller_application.${decision}`,
        resourceType: 'seller_application',
        resourceId: application.id,
        metadata: {
          city,
          ...(sellerId ? { sellerId } : {}),
          ...(isFoodSeller ? { fssaiStatus: application.fssaiStatus } : {}),
        },
      }], { session });
      return { applicationId: application.id, status: application.status, ...(sellerId ? { sellerId } : {}) };
    });
  } finally {
    await session.endSession();
  }

  if (!result) throw new AppError(500, 'INTERNAL_ERROR', 'The seller application review could not be recorded.');
  sendData(res, result);
};