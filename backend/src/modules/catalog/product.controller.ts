import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AuditLog } from '../audit/auditLog.model.js';
import { sendData, sendPage } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { Product } from './product.model.js';
import { Order } from '../orders/order.model.js';
import { bestSellerQuerySchema, idParamsSchema, productCreateSchema, productListQuerySchema, productUpdateSchema, slugParamsSchema } from './product.schemas.js';

export const listProducts: RequestHandler = async (req, res) => {
  const query = productListQuerySchema.parse(req.query);
  const filter = {
    isActive: true,
    isArchived: false,
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? { $text: { $search: query.q } } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .select('sellerId name slug description category pricePaise imageUrls variants stock')
      .sort(query.q ? { score: { $meta: 'textScore' as const } } : { createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, products, query.page, query.limit, total);
};

export const listBestSellingProducts: RequestHandler = async (req, res) => {
  const { limit } = bestSellerQuerySchema.parse(req.query);
  const bestSellers = await Order.aggregate([
    { $match: { paymentStatus: 'confirmed', fulfilmentStatus: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', unitsPurchased: { $sum: '$items.quantity' } } },
    { $sort: { unitsPurchased: -1, _id: 1 } },
    {
      $lookup: {
        from: Product.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    { $match: { 'product.isActive': true, 'product.isArchived': false } },
    {
      $project: {
        _id: '$product._id',
        sellerId: '$product.sellerId',
        name: '$product.name',
        slug: '$product.slug',
        description: '$product.description',
        category: '$product.category',
        pricePaise: '$product.pricePaise',
        imageUrls: '$product.imageUrls',
        variants: '$product.variants',
        stock: '$product.stock',
      },
    },
    { $limit: limit },
  ]);
  const remaining = limit - bestSellers.length;
  const recentProducts = remaining > 0
    ? await Product.find({
      isActive: true,
      isArchived: false,
      ...(bestSellers.length ? { _id: { $nin: bestSellers.map((product) => product._id) } } : {}),
    })
      .select('sellerId name slug description category pricePaise imageUrls variants stock')
      .sort({ createdAt: -1, _id: -1 })
      .limit(remaining)
      .lean()
    : [];
  sendData(res, [...bestSellers, ...recentProducts]);
};

export const getProductBySlug: RequestHandler = async (req, res) => {
  const { slug } = slugParamsSchema.parse(req.params);
  const product = await Product.findOne({ slug, isActive: true, isArchived: false })
    .select('sellerId name slug description category pricePaise imageUrls variants stock')
    .lean();
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  sendData(res, product);
};

export const listAllProductsForAdmin: RequestHandler = async (req, res) => {
  const query = productListQuerySchema.extend({
    active: zBooleanQuery.active.optional(),
    archived: zBooleanQuery.archived.optional(),
    sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  }).parse(req.query);
  const filter = {
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? { $text: { $search: query.q } } : {}),
    ...(query.active === undefined ? {} : { isActive: query.active }),
    ...(query.archived === undefined ? {} : { isArchived: query.archived }),
    ...(query.sellerId ? { sellerId: new mongoose.Types.ObjectId(query.sellerId) } : {}),
  };
  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(query.q ? { score: { $meta: 'textScore' as const } } : { createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  sendPage(res, products, query.page, query.limit, total);
};

export const getAdminProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const product = await Product.findById(id).lean();
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
  sendData(res, product);
};

const zBooleanQuery = {
  active: z.enum(['true', 'false']).transform((value) => value === 'true'),
  archived: z.enum(['true', 'false']).transform((value) => value === 'true'),
};

export const createProduct: RequestHandler = async (req, res) => {
  const input = productCreateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product;
  try {
    product = await session.withTransaction(async () => {
      const { sellerId, ...productFields } = input;
      const createInput = sellerId
        ? { ...productFields, sellerId: new mongoose.Types.ObjectId(sellerId) }
        : productFields;
      const [created] = await Product.create([createInput], { session });
      if (!created) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be created.');
      await AuditLog.create([{
        actorId,
        action: 'product.created',
        resourceType: 'product',
        resourceId: String(created.id),
        metadata: { category: created.category },
      }], { session });
      return created;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be created.');
  sendData(res, product, 201);
};

export const updateProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const input = productUpdateSchema.parse(req.body);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product;
  try {
    product = await session.withTransaction(async () => {
      const updated = await Product.findOneAndUpdate(
        { _id: id, isArchived: false },
        { $set: input },
        { new: true, runValidators: true, session },
      );
      if (!updated) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      await AuditLog.create([{
        actorId,
        action: 'product.updated',
        resourceType: 'product',
        resourceId: String(updated.id),
        metadata: { changedFields: Object.keys(input) },
      }], { session });
      return updated;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be updated.');
  sendData(res, product);
};

export const archiveProduct: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const actorId = authenticatedUserId(req);
  const session = await mongoose.startSession();
  let product;
  try {
    product = await session.withTransaction(async () => {
      const archived = await Product.findOneAndUpdate(
        { _id: id, isArchived: false },
        { $set: { isArchived: true, isActive: false } },
        { new: true, session },
      );
      if (!archived) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      await AuditLog.create([{
        actorId,
        action: 'product.archived',
        resourceType: 'product',
        resourceId: String(archived.id),
      }], { session });
      return archived;
    });
  } finally {
    await session.endSession();
  }
  if (!product) throw new AppError(500, 'INTERNAL_ERROR', 'The product could not be archived.');
  sendData(res, { id: product.id, isArchived: true });
};

export const categoriesController: RequestHandler = (_req, res) => {
  sendData(res, ['Bangles', 'Jewellery', 'Dupattas', 'Others']);
};
