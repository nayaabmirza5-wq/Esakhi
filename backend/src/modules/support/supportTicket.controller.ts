import type { RequestHandler } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { SupportTicket } from './supportTicket.model.js';
import { User } from '../auth/user.model.js';
import { authenticatedUserId } from '../../utils/authenticatedUser.js';
import { sendData } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';
import { AuditLog } from '../audit/auditLog.model.js';

function generateTicketReference(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `TKT-${dateStr}-${rand}`;
}

const createTicketSchema = z.object({
  category: z.enum(['seller_dispute', 'delivery_dispute', 'customer_claim', 'payout_query', 'policy_help', 'other']),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(5).max(3000),
  relatedOrderReference: z.string().trim().max(50).optional(),
  relatedParty: z.object({
    partyType: z.enum(['seller', 'delivery_partner', 'customer']),
    name: z.string().trim().max(120).optional(),
    phoneE164: z.string().trim().max(20).optional(),
  }).optional(),
}).strict();

const resolveTicketSchema = z.object({
  status: z.enum(['under_review', 'action_taken', 'resolved', 'closed']),
  decisionNote: z.string().trim().min(3).max(2000),
  actionTaken: z.string().trim().max(500).optional(),
  replyMessage: z.string().trim().max(1000).optional(),
}).strict();

export const listCityAdminSupportTickets: RequestHandler = async (req, res) => {
  const userId = authenticatedUserId(req);
  const cityAdmin = await User.findById(userId).select('assignedCity name').lean();
  const city = cityAdmin?.assignedCity || 'Damoh';
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const tickets = await SupportTicket.find({
    $or: [
      { cityAdminId: userObjectId as any },
      { city: new RegExp(`^${city}$`, 'i') },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  sendData(res, tickets);
};

export const createCityAdminSupportTicket: RequestHandler = async (req, res) => {
  const userId = authenticatedUserId(req);
  const input = createTicketSchema.parse(req.body);
  const cityAdmin = await User.findById(userId).select('name phoneE164 assignedCity').lean();
  if (!cityAdmin) throw new AppError(404, 'USER_NOT_FOUND', 'City Admin profile not found.');

  const city = cityAdmin.assignedCity || 'Damoh';
  const ticketReference = generateTicketReference();

  const ticketDoc: Record<string, unknown> = {
    ticketReference,
    city,
    cityAdminId: cityAdmin._id,
    cityAdminName: cityAdmin.name || 'City Admin',
    cityAdminPhone: cityAdmin.phoneE164,
    category: input.category,
    priority: input.priority,
    status: 'open',
    subject: input.subject,
    description: input.description,
    timeline: [
      {
        senderRole: 'city_admin',
        senderName: cityAdmin.name || 'City Admin',
        message: input.description,
        timestamp: new Date(),
      },
    ],
  };

  if (input.relatedOrderReference) {
    ticketDoc.relatedOrderReference = input.relatedOrderReference;
  }
  if (input.relatedParty) {
    ticketDoc.relatedParty = input.relatedParty;
  }

  const [ticket] = await SupportTicket.create([ticketDoc]);
  if (!ticket) throw new AppError(500, 'INTERNAL_ERROR', 'Could not create support ticket.');

  await AuditLog.create([{
    actorId: userId,
    action: 'support_ticket.created',
    resourceType: 'support_ticket',
    resourceId: String(ticket._id),
    metadata: { ticketReference, city, category: input.category, priority: input.priority },
  }]);

  sendData(res, ticket.toObject(), 201);
};

export const listSuperAdminSupportTickets: RequestHandler = async (req, res) => {
  const { city, status, category, priority } = req.query;
  const filter: Record<string, unknown> = {};

  if (city && typeof city === 'string' && city !== 'all') {
    filter.city = new RegExp(`^${city.trim()}$`, 'i');
  }
  if (status && typeof status === 'string' && status !== 'all') {
    filter.status = status;
  }
  if (category && typeof category === 'string' && category !== 'all') {
    filter.category = category;
  }
  if (priority && typeof priority === 'string' && priority !== 'all') {
    filter.priority = priority;
  }

  const tickets = await SupportTicket.find(filter)
    .sort({ priority: 1, createdAt: -1 })
    .limit(150)
    .lean();

  sendData(res, tickets);
};

export const resolveSuperAdminSupportTicket: RequestHandler = async (req, res) => {
  const superAdminId = authenticatedUserId(req);
  const { ticketId } = req.params;
  const input = resolveTicketSchema.parse(req.body);

  const superAdmin = await User.findById(superAdminId).select('name').lean();
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');

  ticket.status = input.status;
  ticket.superAdminResolution = {
    resolvedBy: superAdmin?._id as any,
    resolvedByName: superAdmin?.name || 'Super Admin',
    resolvedAt: new Date(),
    decisionNote: input.decisionNote,
    actionTaken: input.actionTaken || 'Review & Resolution Recorded',
  };

  ticket.timeline.push({
    senderRole: 'super_admin',
    senderName: superAdmin?.name || 'Super Admin',
    message: input.replyMessage || input.decisionNote,
    timestamp: new Date(),
  });

  await ticket.save();

  await AuditLog.create([{
    actorId: superAdminId,
    action: 'support_ticket.resolved',
    resourceType: 'support_ticket',
    resourceId: String(ticket._id),
    metadata: { ticketReference: ticket.ticketReference, status: input.status, decisionNote: input.decisionNote },
  }]);

  sendData(res, ticket.toObject());
};
