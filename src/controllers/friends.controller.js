// src/controllers/friends.controller.js
import {prisma} from "../lib/prisma.js";

// garante que a amizade sempre é salva como (menorId, maiorId)
function normalizePair(a, b) {
  const A = String(a);
  const B = String(b);
  return A < B
    ? { userAId: A, userBId: B }
    : { userAId: B, userBId: A };
}

async function ensureUserExists(userId) {
  const u = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { id: true },
  });
  return !!u;
}

// GET /friends
export async function listFriends(req, res) {
  try {
    const me = req.user?.id; // ✅ seu authRequired seta req.user = { id, role, email }
    if (!me) return res.status(401).json({ error: "Unauthorized" });

    const [asA, asB] = await Promise.all([
      prisma.friendship.findMany({
        where: { userAId: me },
        include: { userB: { select: { id: true, name: true, imageUrl: true, role: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.friendship.findMany({
        where: { userBId: me },
        include: { userA: { select: { id: true, name: true, imageUrl: true, role: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const friends = [
      ...asA.map((r) => ({
        id: r.userB.id,
        name: r.userB.name,
        avatar: r.userB.imageUrl || null,
        role: r.userB.role,
      })),
      ...asB.map((r) => ({
        id: r.userA.id,
        name: r.userA.name,
        avatar: r.userA.imageUrl || null,
        role: r.userA.role,
      })),
    ];

    return res.json(friends);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao listar amigos" });
  }
}

// GET /friends/incoming
export async function listIncomingRequests(req, res) {
  try {
    const me = req.user?.id;
    if (!me) return res.status(401).json({ error: "Unauthorized" });

    const incoming = await prisma.friendRequest.findMany({
      where: { toId: me, status: "pending" },
      include: { from: { select: { id: true, name: true, imageUrl: true, role: true } } },
      orderBy: { createdAt: "desc" },
    });

    const result = incoming.map((r) => ({
      id: r.id,
      fromUserId: r.fromId,
      fromUser: {
        id: r.from.id,
        name: r.from.name,
        avatar: r.from.imageUrl || null,
        role: r.from.role,
      },
      createdAt: r.createdAt,
    }));

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao listar pedidos recebidos" });
  }
}

// GET /friends/outgoing
export async function listOutgoingRequests(req, res) {
  try {
    const me = req.user?.id;
    if (!me) return res.status(401).json({ error: "Unauthorized" });

    const outgoing = await prisma.friendRequest.findMany({
      where: { fromId: me, status: "pending" },
      include: { to: { select: { id: true, name: true, imageUrl: true, role: true } } },
      orderBy: { createdAt: "desc" },
    });

    const result = outgoing.map((r) => ({
      id: r.id,
      toUserId: r.toId,
      toUser: {
        id: r.to.id,
        name: r.to.name,
        avatar: r.to.imageUrl || null,
        role: r.to.role,
      },
      createdAt: r.createdAt,
    }));

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao listar pedidos enviados" });
  }
}

// POST /friends/request/:toUserId
export async function sendFriendRequest(req, res) {
  try {
    const me = req.user?.id;
    const toUserId = req.params.toUserId;

    if (!me) return res.status(401).json({ error: "Unauthorized" });
    if (!toUserId) return res.status(400).json({ error: "toUserId obrigatório" });
    if (String(me) === String(toUserId)) return res.status(400).json({ error: "Você não pode se adicionar." });

    const exists = await ensureUserExists(toUserId);
    if (!exists) return res.status(404).json({ error: "Usuário não encontrado." });

    const pair = normalizePair(me, toUserId);

    // ✅ findUnique com compound key certo
    const alreadyFriend = await prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
    });
    if (alreadyFriend) return res.status(409).json({ error: "Vocês já são amigos." });

    const pendingAny = await prisma.friendRequest.findFirst({
      where: {
        status: "pending",
        OR: [
          { fromId: me, toId: toUserId },
          { fromId: toUserId, toId: me },
        ],
      },
      select: { id: true },
    });
    if (pendingAny) return res.status(409).json({ error: "Já existe um pedido pendente." });

    const created = await prisma.friendRequest.create({
      data: { fromId: me, toId: toUserId, status: "pending" },
      select: { id: true, fromId: true, toId: true, createdAt: true },
    });

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao enviar pedido" });
  }
}

// POST /friends/accept/:fromUserId
export async function acceptFriendRequest(req, res) {
  try {
    const me = req.user?.id;
    const fromUserId = req.params.fromUserId;

    if (!me) return res.status(401).json({ error: "Unauthorized" });
    if (!fromUserId) return res.status(400).json({ error: "fromUserId obrigatório" });
    if (String(me) === String(fromUserId)) return res.status(400).json({ error: "Inválido." });

    const fr = await prisma.friendRequest.findFirst({
      where: { fromId: fromUserId, toId: me, status: "pending" },
      select: { id: true },
    });
    if (!fr) return res.status(404).json({ error: "Pedido não encontrado." });

    const pair = normalizePair(me, fromUserId);

    const friendship = await prisma.$transaction(async (tx) => {
      await tx.friendRequest.update({
        where: { id: fr.id },
        data: { status: "accepted" },
      });

      const createdFriendship = await tx.friendship.upsert({
        where: { userAId_userBId: pair },
        create: { ...pair },
        update: {},
      });

      // cancela qualquer pendência duplicada
      await tx.friendRequest.updateMany({
        where: {
          status: "pending",
          OR: [
            { fromId: me, toId: fromUserId },
            { fromId: fromUserId, toId: me },
          ],
        },
        data: { status: "canceled" },
      });

      return createdFriendship;
    });

    return res.json({ ok: true, friendship });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao aceitar pedido" });
  }
}

// POST /friends/decline/:fromUserId
export async function declineFriendRequest(req, res) {
  try {
    const me = req.user?.id;
    const fromUserId = req.params.fromUserId;

    if (!me) return res.status(401).json({ error: "Unauthorized" });
    if (!fromUserId) return res.status(400).json({ error: "fromUserId obrigatório" });

    const fr = await prisma.friendRequest.findFirst({
      where: { fromId: fromUserId, toId: me, status: "pending" },
      select: { id: true },
    });
    if (!fr) return res.status(404).json({ error: "Pedido não encontrado." });

    await prisma.friendRequest.update({
      where: { id: fr.id },
      data: { status: "declined" },
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Erro ao recusar pedido" });
  }
}
