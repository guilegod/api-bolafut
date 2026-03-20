import { prisma } from "../../lib/prisma.js";

export async function createFeedPost({
  userId,
  matchId = null,
  type = "POST",
  text,
  imageUrl = null,
  meta = null,
}) {
  if (!userId || !text) return null;

  return prisma.feedPost.create({
    data: {
      userId,
      matchId,
      type,
      text,
      imageUrl,
      meta,
    },
  });
}