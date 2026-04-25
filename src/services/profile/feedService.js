import { prisma } from "../../lib/prisma.js";

function buildPostInclude(currentUserId) {
  return {
    user: {
      select: {
        id: true,
        name: true,
        imageUrl: true,
        profile: {
          select: {
            username: true,
            avatarUrl: true,
          },
        },
      },
    },
    match: {
      select: {
        id: true,
        title: true,
        date: true,
        status: true,
      },
    },
    likes: {
      select: {
        userId: true,
      },
    },
    comments: {
      orderBy: {
        createdAt: "asc",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            imageUrl: true,
            profile: {
              select: {
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    },
    _count: {
      select: {
        likes: true,
        comments: true,
      },
    },
  };
}

function formatPost(post, currentUserId) {
  if (!post) return null;

  return {
    ...post,
    likesCount: post._count?.likes ?? 0,
    commentsCount: post._count?.comments ?? 0,
    likedByMe: Boolean(
      currentUserId && post.likes?.some((like) => like.userId === currentUserId)
    ),
  };
}

export async function createFeedPost({
  userId,
  matchId = null,
  type = "POST",
  text,
  imageUrl = null,
  meta = null,
}) {
  const cleanText = String(text || "").trim();

  if (!userId || !cleanText) return null;

  return prisma.feedPost.create({
    data: {
      userId,
      matchId,
      type,
      text: cleanText,
      imageUrl,
      meta,
    },
  });
}

export async function createUserPost({ userId, text, imageUrl = null }) {
  const post = await createFeedPost({
    userId,
    type: "POST",
    text,
    imageUrl,
  });

  if (!post) return null;

  const fullPost = await prisma.feedPost.findUnique({
    where: { id: post.id },
    include: buildPostInclude(userId),
  });

  return formatPost(fullPost, userId);
}

export async function getUserFeedPosts({ profileUserId, currentUserId }) {
  const posts = await prisma.feedPost.findMany({
    where: {
      userId: profileUserId,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: buildPostInclude(currentUserId),
  });

  return posts.map((post) => formatPost(post, currentUserId));
}

export async function getHomeFeed({ userId }) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    select: {
      userAId: true,
      userBId: true,
    },
  });

  const friendIds = friendships.map((friendship) =>
    friendship.userAId === userId ? friendship.userBId : friendship.userAId
  );

  const allowedUserIds = [userId, ...friendIds];

  const posts = await prisma.feedPost.findMany({
    where: {
      userId: {
        in: allowedUserIds,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    include: buildPostInclude(userId),
    take: 50,
  });

  return posts.map((post) => formatPost(post, userId));
}

export async function toggleFeedLike({ postId, userId }) {
  const existing = await prisma.feedLike.findUnique({
    where: {
      postId_userId: {
        postId,
        userId,
      },
    },
  });

  if (existing) {
    await prisma.feedLike.delete({
      where: {
        postId_userId: {
          postId,
          userId,
        },
      },
    });
  } else {
    await prisma.feedLike.create({
      data: {
        postId,
        userId,
      },
    });
  }

  const post = await prisma.feedPost.findUnique({
    where: {
      id: postId,
    },
    include: buildPostInclude(userId),
  });

  return formatPost(post, userId);
}

export async function createFeedComment({ postId, userId, text }) {
  const cleanText = String(text || "").trim();

  if (!postId || !userId || !cleanText) return null;

  await prisma.feedComment.create({
    data: {
      postId,
      userId,
      text: cleanText,
    },
  });

  const post = await prisma.feedPost.findUnique({
    where: {
      id: postId,
    },
    include: buildPostInclude(userId),
  });

  return formatPost(post, userId);
}

export async function deleteFeedPost({ postId, userId }) {
  const post = await prisma.feedPost.findUnique({
    where: {
      id: postId,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!post) {
    return {
      ok: false,
      status: 404,
      message: "Post não encontrado.",
    };
  }

  if (post.userId !== userId) {
    return {
      ok: false,
      status: 403,
      message: "Você não pode excluir esse post.",
    };
  }

  await prisma.feedPost.delete({
    where: {
      id: postId,
    },
  });

  return {
    ok: true,
  };
}