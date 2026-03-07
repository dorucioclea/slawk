import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkChannelMembership } from '../middleware/authorize.js';
import { AuthRequest } from '../types.js';
import { parseIntParam } from '../utils/params.js';
import { logError } from '../utils/logger.js';

const router = Router();

const scheduleMessageSchema = z.object({
  content: z.string()
    .min(1)
    .max(4000)
    .refine(val => val.trim().length > 0, { message: 'Message content cannot be empty or whitespace only' })
    .refine(val => !val.includes('\u0000'), { message: 'Content cannot contain null bytes' }),
  channelId: z.number().int().positive(),
  scheduledAt: z.string().datetime(),
});

// POST /messages/schedule — create a scheduled message
router.post('/schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { content, channelId, scheduledAt } = scheduleMessageSchema.parse(req.body);

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      res.status(400).json({ error: 'scheduledAt must be in the future' });
      return;
    }

    // Enforce maximum scheduling horizon (30 days)
    const maxFuture = new Date();
    maxFuture.setDate(maxFuture.getDate() + 30);
    if (scheduledDate > maxFuture) {
      res.status(400).json({ error: 'Cannot schedule more than 30 days in advance' });
      return;
    }

    // Check channel membership
    const isMember = await checkChannelMembership(userId, channelId);
    if (!isMember) {
      res.status(403).json({ error: 'You must be a member of the channel' });
      return;
    }

    // Enforce per-user cap on unsent scheduled messages
    const pendingCount = await prisma.scheduledMessage.count({
      where: { userId, sent: false },
    });
    if (pendingCount >= 25) {
      res.status(400).json({ error: 'Maximum of 25 pending scheduled messages allowed' });
      return;
    }

    const scheduled = await prisma.scheduledMessage.create({
      data: {
        content,
        channelId,
        userId,
        scheduledAt: scheduledDate,
      },
      include: {
        channel: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(scheduled);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    logError('Schedule message error', error);
    res.status(500).json({ error: 'Failed to schedule message' });
  }
});

// GET /messages/scheduled — list user's scheduled (unsent) messages
router.get('/scheduled', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const messages = await prisma.scheduledMessage.findMany({
      where: { userId, sent: false },
      include: {
        channel: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json(messages);
  } catch (error) {
    logError('Get scheduled messages error', error);
    res.status(500).json({ error: 'Failed to get scheduled messages' });
  }
});

// DELETE /messages/scheduled/:id — cancel a scheduled message
router.delete('/scheduled/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const id = parseIntParam(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid message ID' });
      return;
    }

    const scheduled = await prisma.scheduledMessage.findUnique({
      where: { id },
    });

    if (!scheduled) {
      res.status(404).json({ error: 'Scheduled message not found' });
      return;
    }

    if (scheduled.userId !== userId) {
      res.status(403).json({ error: 'Not authorized to cancel this message' });
      return;
    }

    if (scheduled.sent) {
      res.status(400).json({ error: 'Message has already been sent' });
      return;
    }

    await prisma.scheduledMessage.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    logError('Cancel scheduled message error', error);
    res.status(500).json({ error: 'Failed to cancel scheduled message' });
  }
});

export default router;
