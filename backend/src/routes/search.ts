import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { AuthRequest } from '../types.js';
import { logError } from '../utils/logger.js';

const router = Router();

const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  type: z.enum(['messages', 'dms', 'all']).optional().default('all'),
  channelId: z.coerce.number().int().positive().optional(),
});

// GET /search - Search messages and DMs
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid search parameters' });
      return;
    }
    const { q: query, type, channelId } = parsed.data;
    const userId = req.user!.userId;

    const searchMessages = type !== 'dms';
    const searchDMs = type !== 'messages';

    // Get channels user is a member of
    const userChannels = await prisma.channelMember.findMany({
      where: { userId },
      select: { channelId: true },
    });
    const channelIds = userChannels.map((c) => c.channelId);

    // Search channel messages
    let messages: any[] = [];
    if (searchMessages && channelIds.length > 0) {
      const messageWhere: any = {
        channelId: channelId ? { equals: channelId } : { in: channelIds },
        deletedAt: null,
        content: {
          contains: query,
          mode: 'insensitive',
        },
      };

      // If channelId specified, verify user is a member
      if (channelId && !channelIds.includes(channelId)) {
        // User not a member of this channel, skip message search
      } else {
        messages = await prisma.message.findMany({
          where: messageWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            channel: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        });
      }
    }

    // Search DMs (only if no channelId filter)
    let dms: any[] = [];
    if (searchDMs && !channelId) {
      dms = await prisma.directMessage.findMany({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
          ],
          deletedAt: null,
          content: {
            contains: query,
            mode: 'insensitive',
          },
        },
        include: {
          fromUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          toUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });
    }

    // Combine and format results
    const formattedMessages = messages.map((m) => ({
      id: m.id,
      type: 'message' as const,
      content: m.content,
      createdAt: m.createdAt,
      user: m.user,
      channel: m.channel,
      threadId: m.threadId,
    }));

    const formattedDMs = dms.map((dm) => ({
      id: dm.id,
      type: 'dm' as const,
      content: dm.content,
      createdAt: dm.createdAt,
      user: dm.fromUser,
      otherUser: dm.fromUserId === userId ? dm.toUser : dm.fromUser,
      participant: dm.fromUserId === userId ? dm.toUser : dm.fromUser,
    }));

    // Merge and sort by date
    const results = [...formattedMessages, ...formattedDMs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    res.json({
      results,
      query,
      counts: {
        messages: formattedMessages.length,
        dms: formattedDMs.length,
        total: results.length,
      },
    });
  } catch (error) {
    logError('Search error', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

export default router;
