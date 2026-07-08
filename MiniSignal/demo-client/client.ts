import { PrivateKey, PublicKey } from "@signalapp/libsignal-client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";
import WebSocket from "ws";
import { ContactStore } from "./contact/contactStore";
import { CryptoManager } from "./crypto/crypto";
import { IdentityManager } from "./identity/identity";
import { TrustedIdentityStore } from "./identity/trustedIdentityStore";
import { MessageStore } from "./message/messageStore";
import { PreKeyManager } from "./prekey/prekey";
import { DHRatchetManager } from "./session/dhRatchet";
import {
  MiniSessionState,
  deriveDirectionalChains,
  nextMessageKey,
} from "./session/sessionState";
import { SessionStore } from "./session/sessionStore";
import { X3DHManager } from "./session/x3dh";
import { NotificationStore } from "./storage/notificationStore";

const userId = process.argv[2];
const deviceId = process.argv[3];

let targetId = process.argv[4];
let targetDeviceId = process.argv[5];

let pendingSendAllText: string | null = null;
let pendingSendAllTarget: string | null = null;

function isCurrentConversation(remoteUserId: string, remoteDeviceId: string) {
  return remoteUserId === targetId && remoteDeviceId === targetDeviceId;
}

function addNotification(input: {
  from: string;
  fromDeviceId: string;
  type: "x3dh-init" | "message" | "offline-message" | "session-reset";
  messageNumber?: number;
  note: string;
}) {
  const id = [
    input.type,
    input.from,
    input.fromDeviceId,
    input.messageNumber ?? "none",
    Date.now(),
  ].join(":");

  NotificationStore.add(userId, deviceId, {
    id,
    from: input.from,
    fromDeviceId: input.fromDeviceId,
    to: userId,
    toDeviceId: deviceId,
    type: input.type,
    messageNumber: input.messageNumber,
    timestamp: Date.now(),
    read: false,
    note: input.note,
  });

  notifications.push({
    from: input.from,
    fromDeviceId: input.fromDeviceId,
    messageNumber: input.messageNumber,
    note: input.note,
  });
}

if (!userId || !deviceId || !targetId || !targetDeviceId) {
  console.log("usage: npx ts-node client.ts alice desktop bob phone");
  process.exit(0);
}

const identity = new IdentityManager(userId, deviceId);
const preKeys = new PreKeyManager(identity.getPrivateKey(), userId, deviceId);
preKeys.ensureOneTimePreKeys(5);

let session: MiniSessionState | null = null;

const notifications: any[] = [];

const resetPendingPeers = new Set<string>();
const resetRequestedPeers = new Set<string>();
const sessionNeedsRebuild = new Set<string>();

function peerKey(peerUserId: string, peerDeviceId: string) {
  return `${peerUserId}:${peerDeviceId}`;
}

function showNotifications() {
  if (notifications.length === 0) {
    console.log("当前没有非当前会话提醒。");
    return;
  }

  console.log("非当前会话提醒：");

  notifications.forEach((item, index) => {
    console.log(
      `${index + 1}. 来自 ${item.from}/${item.fromDeviceId}，消息编号=${item.messageNumber}，说明=${item.note}`
    );
  });
}

function clearAllNotifications() {
  notifications.length = 0;
  console.log("所有非当前会话提醒已清空。");
}

function showSearchResult(keyword: string) {
  const searchKeyword = keyword.trim();

  if (!searchKeyword) {
    console.log("用法：/search <关键词>");
    return;
  }

  const messages = MessageStore.list(
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  const results = messages.filter((item: any) => {
    return String(item.text ?? "")
      .toLowerCase()
      .includes(searchKeyword.toLowerCase());
  });

  console.log("===== SEARCH RESULT =====");
  console.log(`关键词：${searchKeyword}`);
  console.log(`当前会话：${targetId}/${targetDeviceId}`);
  console.log("");

  if (results.length === 0) {
    console.log("没有找到匹配的消息。");
    console.log("=========================");
    return;
  }

  results.forEach((item: any, index: number) => {
    const time = new Date(item.timestamp).toLocaleString();
    const direction = item.direction ?? "unknown";

    console.log(
      `[${index + 1}] [${time}] [${direction}] ${item.from}/${item.fromDeviceId} -> ${item.to}/${item.toDeviceId}`
    );
    console.log(item.text);
    console.log("");
  });

  console.log(`共找到 ${results.length} 条结果。`);
  console.log("=========================");
}

function shortText(text: string, maxLength = 40) {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + "...";
}

function addPeer(
  peers: Map<string, { userId: string; deviceId: string }>,
  remoteUserId: string,
  remoteDeviceId: string
) {
  const key = peerKey(remoteUserId, remoteDeviceId);

  if (!peers.has(key)) {
    peers.set(key, {
      userId: remoteUserId,
      deviceId: remoteDeviceId,
    });
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function exportCurrentChat() {
  const messages = MessageStore.list(
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  const exportDir = path.join(__dirname, "storage", "exports");

  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");

  const fileName =
    `${safeFileName(userId)}_${safeFileName(deviceId)}__` +
    `${safeFileName(targetId)}_${safeFileName(targetDeviceId)}_` +
    `${timestamp}.json`;

  const outputPath = path.join(exportDir, fileName);

  const data = {
    exportedAt: new Date().toISOString(),
    local: {
      userId,
      deviceId,
    },
    remote: {
      userId: targetId,
      deviceId: targetDeviceId,
    },
    messageCount: messages.length,
    messages,
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");

  console.log("当前会话聊天记录已导出：");
  console.log(outputPath);
}

function showChats() {
  const peers = new Map<string, { userId: string; deviceId: string }>();

  addPeer(peers, targetId, targetDeviceId);

  for (const contact of ContactStore.list(userId, deviceId)) {
    addPeer(peers, contact.userId, contact.deviceId);
  }

  for (const item of NotificationStore.list(userId, deviceId)) {
    addPeer(peers, item.from, item.fromDeviceId);
  }

  if (peers.size === 0) {
    console.log("当前没有会话。");
    return;
  }

  const summaries = Array.from(peers.values()).map((peer) => {
    const messages = MessageStore.list(
      userId,
      deviceId,
      peer.userId,
      peer.deviceId
    );

    const unreadMessages = messages.filter((item: any) => {
      return (
        item.direction === "in" &&
        item.from === peer.userId &&
        item.fromDeviceId === peer.deviceId &&
        item.read !== true
      );
    });

    const unreadNotifications = NotificationStore.unread(userId, deviceId)
      .filter((item) => {
        return item.from === peer.userId && item.fromDeviceId === peer.deviceId;
      });

    const lastMessage =
      messages.length > 0
        ? messages.slice().sort((a: any, b: any) => {
            return Number(a.timestamp) - Number(b.timestamp);
          })[messages.length - 1]
        : null;

    const lastTimestamp = lastMessage
      ? Number(lastMessage.timestamp)
      : 0;

    return {
      peer,
      messages,
      unreadMessages,
      unreadNotifications,
      lastMessage,
      lastTimestamp,
    };
  });

  summaries.sort((a, b) => b.lastTimestamp - a.lastTimestamp);

  console.log("===== CHATS =====");

  for (const item of summaries) {
    const current =
      item.peer.userId === targetId && item.peer.deviceId === targetDeviceId;

    console.log(`${current ? "*" : "-"} ${item.peer.userId}/${item.peer.deviceId}`);
    console.log(`  未读消息: ${item.unreadMessages.length}`);
    console.log(`  未读提醒: ${item.unreadNotifications.length}`);

    if (item.lastMessage) {
      const time = new Date(item.lastMessage.timestamp).toLocaleString();
      console.log(
        `  最后一条: [${item.lastMessage.direction}] ${shortText(
          item.lastMessage.text
        )}`
      );
      console.log(`  时间: ${time}`);
    } else {
      console.log("  最后一条: 暂无消息");
    }

    console.log("");
  }

  console.log("=================");
}

function fingerprint(publicKeyBase64: string) {
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.from(publicKeyBase64, "base64"))
    .digest("hex")
    .toUpperCase();

  return hash.slice(0, 48).match(/.{1,4}/g)?.join(" ") ?? hash;
}

function getLocalIdentityPublicKeyBase64() {
  return Buffer.from(
    identity.getPrivateKey().getPublicKey().serialize()
  ).toString("base64");
}

function getTrustedIdentityPublicKeyBase64(
  peerUserId: string,
  peerDeviceId: string
) {
  const file = path.join(
    process.cwd(),
    "storage",
    `trusted_identities_${userId}_${deviceId}.json`
  );

  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    const trusted = JSON.parse(fs.readFileSync(file, "utf8"));

    const colonKey = `${peerUserId}:${peerDeviceId}`;
    const slashKey = `${peerUserId}/${peerDeviceId}`;
    const underlineKey = `${peerUserId}_${peerDeviceId}`;

    if (typeof trusted[colonKey] === "string") {
      return trusted[colonKey];
    }

    if (typeof trusted[slashKey] === "string") {
      return trusted[slashKey];
    }

    if (typeof trusted[underlineKey] === "string") {
      return trusted[underlineKey];
    }

    return null;
  } catch {
    return null;
  }
}

function clearNotificationsFrom(peerId: string, peerDeviceId: string) {
  for (let i = notifications.length - 1; i >= 0; i--) {
    const item = notifications[i];

    if (item.from === peerId && item.fromDeviceId === peerDeviceId) {
      notifications.splice(i, 1);
    }
  }
}

function loadCurrentSession() {
  session = SessionStore.load(
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  if (session) {
    console.log(`session restored for ${targetId}/${targetDeviceId}`);
  }
}

function switchCurrentTarget(remoteUserId: string, remoteDeviceId: string) {
  targetId = remoteUserId;
  targetDeviceId = remoteDeviceId;

  session = SessionStore.load(
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  if (session) {
    console.log(`session loaded for ${targetId}/${targetDeviceId}`);
  } else {
    console.log(`no session for ${targetId}/${targetDeviceId}`);
  }
}

function runWithTemporaryTarget(
  remoteUserId: string,
  remoteDeviceId: string,
  work: () => void
) {
  const oldTargetId = targetId;
  const oldTargetDeviceId = targetDeviceId;
  const oldSession = session;

  targetId = remoteUserId;
  targetDeviceId = remoteDeviceId;
  session = SessionStore.load(userId, deviceId, targetId, targetDeviceId);

  try {
    work();
  } finally {
    targetId = oldTargetId;
    targetDeviceId = oldTargetDeviceId;
    session = oldSession;
  }
}

loadCurrentSession();

let pendingMessage: string | null = null;
let resetInProgress = false;

function saveSession() {
  if (session) {
    SessionStore.save(session);
  }
}

function clearSessionWith(remoteUserId: string, remoteDeviceId: string) {
  SessionStore.delete(userId, deviceId, remoteUserId, remoteDeviceId);

  if (remoteUserId === targetId && remoteDeviceId === targetDeviceId) {
    session = null;
  }
}

function clearLocalSession() {
  clearSessionWith(targetId, targetDeviceId);
}

function sendSessionResetRequest(
  reason: string,
  remoteUserId: string,
  remoteDeviceId: string
) {
  if (resetInProgress) {
    return;
  }

  resetInProgress = true;

  ws.send(
    JSON.stringify({
      type: "session-reset-request",
      from: userId,
      fromDeviceId: deviceId,
      target: remoteUserId,
      targetDeviceId: remoteDeviceId,
      reason,
    })
  );
}

function uploadPreKeyBundle() {
  const bundle = preKeys.getBundle();

  ws.send(
    JSON.stringify({
      type: "uploadPreKeyBundle",
      userId,
      deviceId,
      bundle,
    })
  );

  console.log(
    `uploaded prekey bundle, oneTimePreKeys=${preKeys.getOneTimePreKeyCount()}`
  );
}

function ensureAndUploadPreKeys() {
  const before = preKeys.getOneTimePreKeyCount();

  if (before >= 2) {
    return;
  }

  preKeys.ensureOneTimePreKeys(5);

  const after = preKeys.getOneTimePreKeyCount();

  console.log(
    `oneTimePreKeys low: ${before}, refreshed to ${after}`
  );

  uploadPreKeyBundle();
}

function createSessionFromRootFor(
  remoteUserId: string,
  remoteDeviceId: string,
  rootKeyBase64: string,
  remoteRatchetPublicKey: string | null = null
) {
  const oldTargetId = targetId;
  const oldTargetDeviceId = targetDeviceId;
  const oldSession = session;

  targetId = remoteUserId;
  targetDeviceId = remoteDeviceId;

  createSessionFromRoot(rootKeyBase64, remoteRatchetPublicKey);

  const newSession = session;

  targetId = oldTargetId;
  targetDeviceId = oldTargetDeviceId;

  if (oldTargetId === remoteUserId && oldTargetDeviceId === remoteDeviceId) {
    session = newSession;
  } else {
    session = oldSession;
  }
}

function createSessionFromRoot(
  rootKeyBase64: string,
  remoteRatchetPublicKey: string | null = null
) {
  let rootKey = Buffer.from(rootKeyBase64, "base64");

  const chains = deriveDirectionalChains(
    rootKey,
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  const localRatchet = generateRatchetKeyPair();

  let sendChainKey = chains.sendChainKey;
  let recvChainKey = chains.recvChainKey;

  /**
   * 如果我是 responder，并且已经拿到了 initiator 的 ratchet 公钥，
   * 那我第一次回复时就可以使用 DH Ratchet 派生新的发送链。
   *
   * Alice 首次发给 Bob：仍然用 X3DH 后的初始发送链
   * Bob 首次回复 Alice：使用 DH(BobRatchetPrivate, AliceRatchetPublic) 派生发送链
   */
  if (remoteRatchetPublicKey) {
    const remotePublicKey = parsePublicKey(remoteRatchetPublicKey);

    if (!remotePublicKey) {
      throw new Error("Failed to parse remote ratchet public key");
    }

    const step = DHRatchetManager.ratchetStep(
      localRatchet.privateKey,
      remotePublicKey,
      rootKey
    );

    rootKey = Buffer.from(step.nextRootKey);
    sendChainKey = Buffer.from(step.chainKey);
  }

  session = {
    version: 3,
    localUserId: userId,
    localDeviceId: deviceId,
    remoteUserId: targetId,
    remoteDeviceId: targetDeviceId,

    rootKey: rootKey.toString("base64"),

    sendChainKey: sendChainKey.toString("base64"),
    recvChainKey: recvChainKey.toString("base64"),

    sendCounter: 0,
    recvCounter: 0,

    localRatchetPrivateKey: localRatchet.privateKeyBase64,
    localRatchetPublicKey: localRatchet.publicKeyBase64,

    remoteRatchetPublicKey,

    previousSendCounter: 0,
    processedMessageIds: {},

    skippedMessageKeys: {},
  };

  saveSession();
}

function buildMessageAAD(input: {
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  messageNumber: number;
  ratchetPublicKey: string | null;
  previousSendCounter: number;
}) {
  return Buffer.from(
    JSON.stringify({
      from: input.from,
      fromDeviceId: input.fromDeviceId,
      target: input.target,
      targetDeviceId: input.targetDeviceId,
      messageNumber: input.messageNumber,
      ratchetPublicKey: input.ratchetPublicKey ?? null,
      previousSendCounter: input.previousSendCounter,
    }),
    "utf8"
  );
}

function encryptForSend(plaintext: string) {
  if (!session) {
    throw new Error("session not established");
  }

  const chain = Buffer.from(session.sendChainKey, "base64");
  const { nextChainKey, messageKey } = nextMessageKey(chain);

  const messageNumber = session.sendCounter;
  const ratchetPublicKey = session.localRatchetPublicKey ?? null;
  const previousSendCounter = session.previousSendCounter ?? 0;

  const aad = buildMessageAAD({
    from: userId,
    fromDeviceId: deviceId,
    target: targetId,
    targetDeviceId,
    messageNumber,
    ratchetPublicKey,
    previousSendCounter,
  });

  const encrypted = CryptoManager.encrypt(
    plaintext,
    messageKey.toString("base64"),
    aad
  );

  session.sendCounter += 1;
  session.sendChainKey = nextChainKey.toString("base64");
  saveSession();

  return {
    encrypted,
    messageNumber,
    ratchetPublicKey,
    previousSendCounter,
  };
}

function messageId(
  from: string,
  fromDeviceId: string,
  ratchetPublicKey: string | null,
  messageNumber: number
) {
  return `${from}:${fromDeviceId}:${ratchetPublicKey ?? "initial"}:${messageNumber}`;
}

function ensureReplayProtectionState() {
  if (!session) {
    throw new Error("session not established");
  }

  if (!session.skippedMessageKeys) {
    session.skippedMessageKeys = {};
  }

  if (!session.processedMessageIds) {
    session.processedMessageIds = {};
  }
}

function assertNotReplayed(id: string) {
  if (!session) {
    throw new Error("session not established");
  }

  ensureReplayProtectionState();

  if (session.processedMessageIds[id]) {
    throw new Error(`replayed message rejected: ${id}`);
  }
}

function markMessageProcessed(id: string) {
  if (!session) {
    throw new Error("session not established");
  }

  ensureReplayProtectionState();

  session.processedMessageIds[id] = true;
  saveSession();
}

function skippedKeyId(ratchetPublicKey: string | null, messageNumber: number) {
  return `${ratchetPublicKey ?? "initial"}:${messageNumber}`;
}

function tryDecryptWithSkippedKey(
  from: string,
  fromDeviceId: string,
  messageNumber: number,
  payload: any,
  remoteRatchetPublicKey: string | null,
  previousSendCounter: number
) {
  if (!session) {
    throw new Error("session not established");
  }

  const keyId = skippedKeyId(remoteRatchetPublicKey, messageNumber);
  const savedMessageKey = session.skippedMessageKeys[keyId];

  if (!savedMessageKey) {
    return null;
  }

  const aad = buildMessageAAD({
    from,
    fromDeviceId,
    target: userId,
    targetDeviceId: deviceId,
    messageNumber,
    ratchetPublicKey: remoteRatchetPublicKey,
    previousSendCounter,
  });

  const plaintext = CryptoManager.decrypt(
    payload.encrypted,
    payload.iv,
    payload.tag,
    savedMessageKey,
    aad
  );

  delete session.skippedMessageKeys[keyId];
  saveSession();

  return plaintext;
}

function skipMessageKeysUntil(
  untilMessageNumber: number,
  remoteRatchetPublicKey: string | null
) {
  if (!session) {
    throw new Error("session not established");
  }

  const MAX_SKIP = 50;

  if (untilMessageNumber - session.recvCounter > MAX_SKIP) {
    throw new Error(
      `too many skipped messages: current=${session.recvCounter}, received=${untilMessageNumber}`
    );
  }

  while (session.recvCounter < untilMessageNumber) {
    const chain = Buffer.from(session.recvChainKey, "base64");
    const { nextChainKey, messageKey } = nextMessageKey(chain);

    const keyId = skippedKeyId(remoteRatchetPublicKey, session.recvCounter);

    session.skippedMessageKeys[keyId] = messageKey.toString("base64");
    session.recvChainKey = nextChainKey.toString("base64");
    session.recvCounter += 1;
  }

  saveSession();
}

function applyReceiveRatchetIfNeeded(remoteRatchetPublicKey: string | null) {
  if (!session) {
    throw new Error("session not established");
  }

  if (!remoteRatchetPublicKey) {
    return;
  }
  
  

  if (session.remoteRatchetPublicKey === remoteRatchetPublicKey) {
    return;
  }

  const localRatchetPrivateKey = parsePrivateKey(session.localRatchetPrivateKey);
  const remoteRatchetKey = parsePublicKey(remoteRatchetPublicKey);

  if (!remoteRatchetKey) {
    throw new Error("Failed to parse remote ratchet public key");
  }

  let rootKey = Buffer.from(session.rootKey, "base64");

  /**
   * 第一次 DH：
   * 用自己的旧 ratchet 私钥 + 对方新的 ratchet 公钥
   * 派生新的 rootKey 和 recvChainKey
   */
  const receiveStep = DHRatchetManager.ratchetStep(
    localRatchetPrivateKey,
    remoteRatchetKey,
    rootKey
  );

  rootKey = Buffer.from(receiveStep.nextRootKey);
  const newRecvChainKey = Buffer.from(receiveStep.chainKey);

  /**
   * 然后自己生成新的 ratchet key pair。
   * 第二次 DH：
   * 用自己的新 ratchet 私钥 + 对方新的 ratchet 公钥
   * 派生新的 rootKey 和 sendChainKey
   */
  const newLocalRatchet = generateRatchetKeyPair();

  const sendStep = DHRatchetManager.ratchetStep(
    newLocalRatchet.privateKey,
    remoteRatchetKey,
    rootKey
  );

  session.previousSendCounter = session.sendCounter;

  session.rootKey = Buffer.from(sendStep.nextRootKey).toString("base64");
  session.recvChainKey = newRecvChainKey.toString("base64");
  session.sendChainKey = Buffer.from(sendStep.chainKey).toString("base64");

  session.localRatchetPrivateKey = newLocalRatchet.privateKeyBase64;
  session.localRatchetPublicKey = newLocalRatchet.publicKeyBase64;

  session.remoteRatchetPublicKey = remoteRatchetPublicKey;

  session.sendCounter = 0;
  session.recvCounter = 0;

  saveSession();

  console.log("DH Ratchet step applied");
}

function decryptIncoming(
  from: string,
  fromDeviceId: string,
  messageNumber: number,
  payload: any,
  remoteRatchetPublicKey: string | null = null,
  previousSendCounter: number = 0
) {
  const oldSession = session;
  const wasCurrentConversation = isCurrentConversation(from, fromDeviceId);

  session = SessionStore.load(
    userId,
    deviceId,
    from,
    fromDeviceId
  );

  if (!session) {
    session = oldSession;
    throw new Error(`session not established for ${from}/${fromDeviceId}`);
  }

  try {
    if (!session.skippedMessageKeys) {
      session.skippedMessageKeys = {};
    }

    ensureReplayProtectionState();

    const id = messageId(
      from,
      fromDeviceId,
      remoteRatchetPublicKey,
      messageNumber
    );

    assertNotReplayed(id);

  /**
   * 1. 如果是已经跳过保存过的旧消息，直接用 skipped key 解密。
   */
  const skippedPlaintext = tryDecryptWithSkippedKey(
    from,
    fromDeviceId,
    messageNumber,
    payload,
    remoteRatchetPublicKey,
    previousSendCounter
  );

  if (skippedPlaintext !== null) {
    return skippedPlaintext;
  }

  /**
   * 2. 如果对方换了 ratchet 公钥，先执行 DH Ratchet。
   */
  applyReceiveRatchetIfNeeded(remoteRatchetPublicKey);

  /**
   * 3. 如果收到未来消息，保存中间跳过的 message keys。
   */
  if (messageNumber > session.recvCounter) {
    skipMessageKeysUntil(messageNumber, remoteRatchetPublicKey);
  }

  /**
   * 4. 如果收到过去消息，但 skipped keys 里没有，就认为重复或非法。
   */
  if (messageNumber < session.recvCounter) {
    throw new Error(
      `old or replayed message: current=${session.recvCounter}, got=${messageNumber}`
    );
  }

  /**
   * 5. 正常解密当前消息。
   */
  const chain = Buffer.from(session.recvChainKey, "base64");
  const { nextChainKey, messageKey } = nextMessageKey(chain);

  const aad = buildMessageAAD({
    from,
    fromDeviceId,
    target: userId,
    targetDeviceId: deviceId,
    messageNumber,
    ratchetPublicKey: remoteRatchetPublicKey,
    previousSendCounter,
  });

  const plaintext = CryptoManager.decrypt(
    payload.encrypted,
    payload.iv,
    payload.tag,
    messageKey.toString("base64"),
    aad
  );

  session.recvCounter += 1;
  session.recvChainKey = nextChainKey.toString("base64");

  markMessageProcessed(id);
  saveSession();

  return plaintext;
  } finally {
    if (!wasCurrentConversation) {
      session = oldSession;
    }
  }
}

function sendChat(line: string) {
  const key = peerKey(targetId, targetDeviceId);

  if (sessionNeedsRebuild.has(key)) {
    clearSessionWith(targetId, targetDeviceId);
  }

  if (!session) {
    pendingMessage = line;
    ws.send(
      JSON.stringify({
        type: "getPreKeyBundle",
        target: targetId,
        targetDeviceId,
      })
    );
    console.log("Creating X3DH session...");
    return;
  }

  const {
    encrypted,
    messageNumber,
    ratchetPublicKey,
    previousSendCounter,
  } = encryptForSend(line);

  ws.send(
  JSON.stringify({
    type: "message",
    from: userId,
    fromDeviceId: deviceId,
    target: targetId,
    targetDeviceId,
    ratchetPublicKey,
    previousSendCounter,
    messageNumber,
    payload: encrypted,
  })
);

  MessageStore.append(userId, deviceId, targetId, targetDeviceId, {
  direction: "out",
  from: userId,
  fromDeviceId: deviceId,
  to: targetId,
  toDeviceId: targetDeviceId,
  text: line,
  timestamp: Date.now(),
  messageNumber,
  status: "sent",
});
}

function shortKey(value: string | null | undefined) {
  if (!value) {
    return "null";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function parsePublicKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return PublicKey.deserialize(Buffer.from(value, "base64"));
}

function normalizeOneTimePreKey(bundle: any) {
  const publicKey =
    typeof bundle.oneTimePreKey === "string"
      ? bundle.oneTimePreKey
      : bundle.oneTimePreKey?.publicKey ?? null;

  const rawKeyId =
    bundle.oneTimePreKeyId !== undefined && bundle.oneTimePreKeyId !== null
      ? bundle.oneTimePreKeyId
      : bundle.oneTimePreKey?.keyId ?? null;

  const keyId = rawKeyId !== null ? Number(rawKeyId) : null;

  if (!publicKey || keyId === null || !Number.isFinite(keyId)) {
    return {
      publicKey: null,
      keyId: null,
    };
  }

  return {
    publicKey,
    keyId,
  };
}

function verifySignedPreKeySignature(input: {
  identityPublicKey: PublicKey;
  signedPreKey: string;
  signature: string;
}) {
  return input.identityPublicKey.verify(
    Buffer.from(input.signedPreKey, "utf8"),
    Buffer.from(input.signature, "base64")
  );
}

function buildX3DHSignatureData(input: {
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  ephemeralPublic: string;
  ratchetPublicKey: string | null;
}) {
  return Buffer.from(
    JSON.stringify({
      from: input.from,
      fromDeviceId: input.fromDeviceId,
      target: input.target,
      targetDeviceId: input.targetDeviceId,
      ephemeralPublic: input.ephemeralPublic,
      ratchetPublicKey: input.ratchetPublicKey ?? null,
    }),
    "utf8"
  );
}

function signX3DHInit(input: {
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  ephemeralPublic: string;
  ratchetPublicKey: string | null;
}) {
  const data = buildX3DHSignatureData(input);

  console.log("SIGN DATA:", data.toString("utf8"));

  const signature = identity.getPrivateKey().sign(data);

  return Buffer.from(signature).toString("base64");
}

function verifyX3DHInitSignature(input: {
  identityPublicKey: PublicKey;
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  ephemeralPublic: string;
  ratchetPublicKey: string | null;
  signature: string;
}) {
  const data = buildX3DHSignatureData({
    from: input.from,
    fromDeviceId: input.fromDeviceId,
    target: input.target,
    targetDeviceId: input.targetDeviceId,
    ephemeralPublic: input.ephemeralPublic,
    ratchetPublicKey: input.ratchetPublicKey,
  });

  console.log("VERIFY DATA:", data.toString("utf8"));

  const signature = Buffer.from(input.signature, "base64");

  return input.identityPublicKey.verify(data, signature);
}

function serializePrivateKey(key: PrivateKey) {
  return Buffer.from(key.serialize()).toString("base64");
}

function serializePublicKey(key: PublicKey) {
  return Buffer.from(key.serialize()).toString("base64");
}

function parsePrivateKey(base64: string) {
  return PrivateKey.deserialize(Buffer.from(base64, "base64"));
}

function generateRatchetKeyPair() {
  const privateKey = PrivateKey.generate();

  return {
    privateKey,
    privateKeyBase64: serializePrivateKey(privateKey),
    publicKeyBase64: serializePublicKey(privateKey.getPublicKey()),
  };
}

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log(`${userId}/${deviceId} connected`);

  ws.send(
    JSON.stringify({
      type: "login",
      userId,
      deviceId,
      publicKey: identity.getPublicKeyBase64(),
    })
  );

  uploadPreKeyBundle();
  ensureAndUploadPreKeys();

  if (session) {
    console.log("session restored");
  }
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "login-ok") {
    return;
  }

  if (msg.type === "uploadPreKeyBundle-ok") {
    return;
  }

  if (msg.type === "session-reset-request") {
    const key = peerKey(msg.from, msg.fromDeviceId);

    resetRequestedPeers.add(key);
    sessionNeedsRebuild.add(key);

    clearSessionWith(msg.from, msg.fromDeviceId);

    console.log();
    console.log(`Session reset requested by ${msg.from}/${msg.fromDeviceId}: ${msg.reason}`);
    console.log(`session with ${msg.from}/${msg.fromDeviceId} deleted, next message will rebuild X3DH session`);

    ws.send(
      JSON.stringify({
        type: "session-reset-ok",
        from: userId,
        fromDeviceId: deviceId,
        target: msg.from,
        targetDeviceId: msg.fromDeviceId,
      })
    );

    rl.prompt();
    return;
  }

  if (msg.type === "session-reset-ok") {
    const key = peerKey(msg.from, msg.fromDeviceId);

    resetPendingPeers.delete(key);
    sessionNeedsRebuild.add(key);

    clearSessionWith(msg.from, msg.fromDeviceId);

    console.log();
    console.log(`Session reset confirmed by ${msg.from}/${msg.fromDeviceId}`);
    console.log(`session with ${msg.from}/${msg.fromDeviceId} deleted, next message will rebuild X3DH session`);

    rl.prompt();
    return;
  }

  if (msg.type === "session-reset-status") {
    console.log(`session reset request: ${msg.status}`);
    rl.prompt();
    return;
  }

  if (msg.type === "message-status") {
    console.log(`message ${msg.messageNumber}: ${msg.status}`);
    rl.prompt();
    return;
  }

  if (msg.type === "receipt") {
    MessageStore.updateStatus(
      userId,
      deviceId,
      msg.from,
      msg.fromDeviceId,
      msg.messageNumber,
      msg.receiptType,
      msg.timestamp
    );

    console.log(
      `message ${msg.messageNumber} ${msg.receiptType} by ${msg.from}/${msg.fromDeviceId}`
    );

    rl.prompt();
    return;
  }

  if (msg.type === "device-list") {
    console.log(`Devices for ${msg.target}:`);

    if (!msg.devices || msg.devices.length === 0) {
      console.log("  no registered devices");
      pendingSendAllText = null;
      pendingSendAllTarget = null;
      rl.prompt();
      return;
    }

    for (const device of msg.devices) {
      const status = device.online ? "online" : "offline";
      const lastSeen = new Date(device.lastSeen).toLocaleString();
      console.log(
        `  - ${device.userId}/${device.deviceId} [${status}], lastSeen=${lastSeen}`
      );
    }

    if (pendingSendAllText && pendingSendAllTarget === msg.target) {
      const text = pendingSendAllText;
      pendingSendAllText = null;
      pendingSendAllTarget = null;

      for (const device of msg.devices) {
        if (device.userId === userId && device.deviceId === deviceId) {
          continue;
        }

        switchCurrentTarget(device.userId, device.deviceId);
        sendChat(text);
        console.log(`sendAll queued to ${device.userId}/${device.deviceId}`);
      }
    }

    rl.prompt();
    return;
  }

  if (msg.type === "error") {
    console.log("server error:", msg.error);
    rl.prompt();
    return;
  }

  if (msg.type === "preKeyBundle") {
    if (!msg.bundle) {
      console.log(`bundle not available: ${targetId}/${targetDeviceId}`);
      rl.prompt();
      return;
    }

    const remoteIdentity = parsePublicKey(msg.bundle.identityKey);

    if (!remoteIdentity) {
      console.error("PreKeyBundle rejected: failed to parse identity key");
      rl.prompt();
      return;
    }

    const trustResult = TrustedIdentityStore.checkAndTrust(
      userId,
      deviceId,
      targetId,
      targetDeviceId,
      msg.bundle.identityKey
    );

    if (!trustResult.ok) {
      console.error();
      console.error("安全警告：对方身份密钥发生变化！");
      console.error(
        `${targetId}/${targetDeviceId} 的 identityKey 和本地信任记录不一致。`
      );
      console.error("这可能是对方重装、换设备，也可能是中间人攻击。");
      console.error("当前会话建立已被拒绝。");
      console.error(`确认安全后请输入：/trust ${targetId} ${targetDeviceId}`);
      console.error();

      pendingMessage = null;
      rl.prompt();
      return;
    }

    if (trustResult.firstTrust) {
      console.log(`Trusted new identity for ${targetId}/${targetDeviceId}`);
    }

    if (!msg.bundle.signedPreKeySignature) {
      console.error("PreKeyBundle rejected: missing signedPreKeySignature");
      rl.prompt();
      return;
    }

    const signedPreKeyValid = verifySignedPreKeySignature({
      identityPublicKey: remoteIdentity,
      signedPreKey: msg.bundle.signedPreKey,
      signature: msg.bundle.signedPreKeySignature,
    });

    if (!signedPreKeyValid) {
      console.error("PreKeyBundle rejected: invalid signedPreKey signature");
      rl.prompt();
      return;
    }

    console.log("SignedPreKey signature verified");

    if (!msg.bundle.oneTimePreKey) {
      console.warn();
      console.warn(
        `警告：${targetId}/${targetDeviceId} 当前没有可用 oneTimePreKey，将使用 signedPreKey fallback 建立会话。`
      );
      console.warn("该模式仍可端到端加密，但缺少一次性 PreKey 带来的额外前向安全性。");
      console.warn();
    }

    const remoteSignedPreKey = parsePublicKey(msg.bundle.signedPreKey);

    if (!remoteSignedPreKey) {
      console.error("PreKeyBundle rejected: failed to parse signedPreKey");
      rl.prompt();
      return;
    }
      
    const normalizedOneTimePreKey = normalizeOneTimePreKey(msg.bundle);

    const remoteOneTimePreKey = normalizedOneTimePreKey.publicKey
      ? parsePublicKey(normalizedOneTimePreKey.publicKey)
      : null;

    const usedOneTimePreKeyId =
      remoteOneTimePreKey && normalizedOneTimePreKey.keyId !== null
        ? normalizedOneTimePreKey.keyId
        : null;

    const result = X3DHManager.initiator(
        identity.getPrivateKey(),
        remoteIdentity,
        remoteSignedPreKey,
        remoteOneTimePreKey
      );

    createSessionFromRoot(result.rootKey);

    console.log("X3DH initiator session established");

    sessionNeedsRebuild.delete(peerKey(targetId, targetDeviceId));
    resetPendingPeers.delete(peerKey(targetId, targetDeviceId));
    resetRequestedPeers.delete(peerKey(targetId, targetDeviceId));

    const x3dhInitPayload = {
      from: userId,
      fromDeviceId: deviceId,
      target: targetId,
      targetDeviceId,
      ephemeralPublic: result.ephemeralPublic,
      ratchetPublicKey: session?.localRatchetPublicKey ?? null,
    };

    const x3dhSignature = signX3DHInit(x3dhInitPayload);

    ws.send(
      JSON.stringify({
         type: "x3dh-init",
         ...x3dhInitPayload,
         identityKey: identity.getPublicKeyBase64(),
         signature: x3dhSignature,
         usedOneTimePreKey: usedOneTimePreKeyId !== null,
         usedOneTimePreKeyId,
         usedSignedPreKeyId: Number(msg.bundle.signedPreKeyId ?? 1),
      })
    );

    if (pendingMessage) {
      const text = pendingMessage;
      pendingMessage = null;
      sendChat(text);
    }

    rl.prompt();
    return;
  }

  if (msg.type === "x3dh-init") {
    const wasCurrentConversation = isCurrentConversation(
      msg.from,
      msg.fromDeviceId
    );

    if (!wasCurrentConversation) {
      addNotification({
        from: msg.from,
        fromDeviceId: msg.fromDeviceId,
        type: "x3dh-init",
        note: "非当前会话请求建立 X3DH，会话已在后台处理",
      });

      console.log(
        `[非当前会话提醒] ${msg.from}/${msg.fromDeviceId} 请求建立会话。当前会话仍然是 ${targetId}/${targetDeviceId}。`
      );
    } else {
      switchCurrentTarget(msg.from, msg.fromDeviceId);
    }

    runWithTemporaryTarget(msg.from, msg.fromDeviceId, () => {
      const remoteEphemeral = parsePublicKey(msg.ephemeralPublic);
      const remoteIdentity = parsePublicKey(msg.identityKey);

      if (!remoteEphemeral || !remoteIdentity) {
        console.error("X3DH init rejected: failed to parse public keys");
        return;
      }

      const trustResult = TrustedIdentityStore.checkAndTrust(
        userId,
        deviceId,
        msg.from,
        msg.fromDeviceId,
        msg.identityKey
      );

      if (!trustResult.ok) {
        console.error();
        console.error("SECURITY WARNING: remote identity key changed!");
        console.error(
          `${msg.from}/${msg.fromDeviceId} identityKey is different from trusted record.`
        );
        console.error("X3DH init rejected. Use /trust-reset if this change is expected.");
        return;
      }

      if (trustResult.firstTrust) {
        console.log(`Trusted new identity for ${msg.from}/${msg.fromDeviceId}`);
      }

      if (!msg.signature) {
        console.error("X3DH init rejected: missing signature");
        return;
      }

      const signatureValid = verifyX3DHInitSignature({
        identityPublicKey: remoteIdentity,
        from: msg.from,
        fromDeviceId: msg.fromDeviceId,
        target: msg.target,
        targetDeviceId: msg.targetDeviceId,
        ephemeralPublic: msg.ephemeralPublic,
        ratchetPublicKey: msg.ratchetPublicKey ?? null,
        signature: msg.signature,
      });

      if (!signatureValid) {
        console.error("X3DH init rejected: invalid signature");
        return;
      }

      console.log("X3DH init signature verified");

      const signedPreKeyId = Number(msg.usedSignedPreKeyId ?? 1);
      
      const usedOneTimePreKey =
        msg.usedOneTimePreKey === true &&
        msg.usedOneTimePreKeyId !== null &&
        msg.usedOneTimePreKeyId !== undefined &&
        msg.usedOneTimePreKeyId !== "";

      const usedOneTimePreKeyId = usedOneTimePreKey
        ? Number(msg.usedOneTimePreKeyId)
        : null;

      const signedPreKeyPrivate = preKeys.getSignedPreKeyPrivate(signedPreKeyId);

      if (!signedPreKeyPrivate) {
        console.error(
          `X3DH init rejected: missing signedPreKey private key ${signedPreKeyId}`
        );
        return;
      }

      const oneTimePreKeyPrivate = usedOneTimePreKey
        ? preKeys.getOneTimePreKeyPrivate(usedOneTimePreKeyId)
        : null;

      if (usedOneTimePreKey && !oneTimePreKeyPrivate) {
        console.error(
          `X3DH init rejected: missing oneTimePreKey private key ${usedOneTimePreKeyId}`
        );
        return;
      }

      if (!usedOneTimePreKey) {
        console.warn(
          `X3DH init from ${msg.from}/${msg.fromDeviceId} did not use oneTimePreKey, signedPreKey fallback mode.`
        );
      }

      console.log(
        `X3DH responder keys: signedPreKeyId=${signedPreKeyId}, oneTimePreKeyId=${usedOneTimePreKeyId}, usedOneTimePreKey=${usedOneTimePreKey}, hasOneTimePrivate=${!!oneTimePreKeyPrivate}`
      );

      const rootKey = X3DHManager.responder(
        identity.getPrivateKey(),
        signedPreKeyPrivate,
        oneTimePreKeyPrivate,
        remoteEphemeral,
        remoteIdentity
      );

      createSessionFromRootFor(
        msg.from,
        msg.fromDeviceId,
        rootKey,
        msg.ratchetPublicKey ?? null
      );

      if (usedOneTimePreKey) {
        preKeys.consumeOneTimePreKey(usedOneTimePreKeyId);
        ensureAndUploadPreKeys();
      }

      console.log("X3DH responder session established");
    });

    if (wasCurrentConversation) {
      session = SessionStore.load(
        userId,
        deviceId,
        targetId,
        targetDeviceId
      );
    }

    rl.prompt();
    return;
  }

  if (msg.type === "message") {
    if (!isCurrentConversation(msg.from, msg.fromDeviceId)) {
      try {
        const plaintext = decryptIncoming(
          msg.from,
          msg.fromDeviceId,
          msg.messageNumber,
          msg.payload,
          msg.ratchetPublicKey ?? null,
          Number(msg.previousSendCounter ?? 0)
        );

        MessageStore.append(userId, deviceId, msg.from, msg.fromDeviceId, {
          direction: "in",
          from: msg.from,
          fromDeviceId: msg.fromDeviceId,
          to: userId,
          toDeviceId: deviceId,
          text: plaintext,
          timestamp: Date.now(),
          messageNumber: msg.messageNumber,
          read: false,
        });

        ws.send(
          JSON.stringify({
            type: "receipt",
            receiptType: "delivered",
            from: userId,
            fromDeviceId: deviceId,
            to: msg.from,
            toDeviceId: msg.fromDeviceId,
            messageNumber: msg.messageNumber,
            timestamp: Date.now(),
          })
        );

        addNotification({
          from: msg.from,
          fromDeviceId: msg.fromDeviceId,
          type: "message",
          messageNumber: msg.messageNumber,
          note: "非当前会话收到一条新消息，已后台解密并保存到历史记录",
        });

        console.log();
        console.log(
          `[非当前会话提醒] ${msg.from}/${msg.fromDeviceId} 发来一条消息，已后台保存。当前会话仍然是 ${targetId}/${targetDeviceId}。`
        );
        console.log(
          `输入 /switch ${msg.from} ${msg.fromDeviceId} 后，再输入 /history 查看。`
        );
      } catch (err) {
        console.error("Failed to decrypt non-current message:", err);

        addNotification({
          from: msg.from,
          fromDeviceId: msg.fromDeviceId,
          type: "message",
          messageNumber: msg.messageNumber,
          note: "非当前会话消息后台解密失败，需要重建 session",
        });

        const reason = err instanceof Error ? err.message : "decrypt failed";
        clearSessionWith(msg.from, msg.fromDeviceId);
        sendSessionResetRequest(reason, msg.from, msg.fromDeviceId);
      }

      rl.prompt();
      return;
    }

    try {
      const plaintext = decryptIncoming(
      msg.from,
      msg.fromDeviceId,
      msg.messageNumber,
      msg.payload,
      msg.ratchetPublicKey ?? null,
      Number(msg.previousSendCounter ?? 0)
      );
      
      MessageStore.append(userId, deviceId, msg.from, msg.fromDeviceId, {
        direction: "in",
        from: msg.from,
        fromDeviceId: msg.fromDeviceId,
        to: userId,
        toDeviceId: deviceId,
        text: plaintext,
        timestamp: Date.now(),
        messageNumber: msg.messageNumber,
        read: false,
      });

      ws.send(
        JSON.stringify({
          type: "receipt",
          receiptType: "delivered",
          from: userId,
          fromDeviceId: deviceId,
          to: msg.from,
          toDeviceId: msg.fromDeviceId,
          messageNumber: msg.messageNumber,
          timestamp: Date.now(),
        })
      );
      
      console.log();
      console.log(`[${msg.from}/${msg.fromDeviceId}] ${plaintext}`);
    } catch (err) {
      console.error("Failed to decrypt message:", err);

      const reason = err instanceof Error ? err.message : "decrypt failed";

      if (reason === "session not established") {
        addNotification({
          from: msg.from,
          fromDeviceId: msg.fromDeviceId,
          type: "message",
          messageNumber: msg.messageNumber,
          note: "当前会话尚未建立 session，请让本端先发送一条消息或等待 X3DH 初始化",
        });

        console.log(
          `[提醒] ${msg.from}/${msg.fromDeviceId} 的消息未解密：本地 session 尚未建立。`
        );

        rl.prompt();
        return;
      }

      const key = peerKey(msg.from, msg.fromDeviceId);

      clearSessionWith(msg.from, msg.fromDeviceId);
      sessionNeedsRebuild.add(key);

      if (!resetPendingPeers.has(key)) {
        resetPendingPeers.add(key);
        sendSessionResetRequest(reason, msg.from, msg.fromDeviceId);

        console.log(
          `已向 ${msg.from}/${msg.fromDeviceId} 发送 session reset 请求，等待对方确认。`
        );
      } else {
        console.log(
          `${msg.from}/${msg.fromDeviceId} 的 session reset 已在等待中，不重复发送。`
        );
      }
    }

    rl.prompt();
    return;
  }

  if (msg.type === "pull-result") {
    for (const item of msg.messages ?? []) {
      if (!isCurrentConversation(item.from, item.fromDeviceId)) {
        addNotification({
          from: item.from,
          fromDeviceId: item.fromDeviceId,
          type: "offline-message",
          messageNumber: item.messageNumber,
          note: "非当前会话有一条离线消息，未自动解密",
        });

        console.log(
          `[非当前会话提醒] ${item.from}/${item.fromDeviceId} 有一条离线消息。当前会话仍然是 ${targetId}/${targetDeviceId}。`
        );

        continue;
      }

      try {
        const plaintext = decryptIncoming(
          item.from,
          item.fromDeviceId,
          item.messageNumber,
          item.payload,
          item.ratchetPublicKey ?? null,
          Number(item.previousSendCounter ?? 0)
        );

        MessageStore.append(userId, deviceId, item.from, item.fromDeviceId, {
          direction: "in",
          from: item.from,
          fromDeviceId: item.fromDeviceId,
          to: userId,
          toDeviceId: deviceId,
          text: plaintext,
          timestamp: Date.now(),
          messageNumber: item.messageNumber,
          read: false,
        });

        ws.send(
          JSON.stringify({
            type: "receipt",
            receiptType: "delivered",
            from: userId,
            fromDeviceId: deviceId,
            to: item.from,
            toDeviceId: item.fromDeviceId,
            messageNumber: item.messageNumber,
            timestamp: Date.now(),
          })
        );

        console.log(`[${item.from}/${item.fromDeviceId}] ${plaintext}`);
      } catch (err) {
        console.error("Failed to decrypt pulled message:", err);

        clearSessionWith(item.from, item.fromDeviceId);

        sendSessionResetRequest(
          err instanceof Error ? err.message : "decrypt failed",
          item.from,
          item.fromDeviceId
        );
      }
    }
    rl.prompt();
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.setPrompt("> ");
rl.prompt();

rl.on("line", (line) => {
  const text = line.trim();

  if (!text) {
    rl.prompt();
    return;
  }

  if (text === "/reset") {
    clearLocalSession();
    resetInProgress = false;
    console.log("local session deleted");
    rl.prompt();
    return;
  }

  if (text === "/session") {
    if (!session) {
      console.log("no active session");
      rl.prompt();
      return;
    }

    console.log("===== SESSION STATE =====");
    console.log(`local: ${session.localUserId}/${session.localDeviceId}`);
    console.log(`remote: ${session.remoteUserId}/${session.remoteDeviceId}`);
    console.log(`version: ${session.version}`);
    console.log(`sendCounter: ${session.sendCounter}`);
    console.log(`recvCounter: ${session.recvCounter}`);
    console.log(`previousSendCounter: ${session.previousSendCounter}`);

    console.log(`rootKey: ${shortKey(session.rootKey)}`);
    console.log(`sendChainKey: ${shortKey(session.sendChainKey)}`);
    console.log(`recvChainKey: ${shortKey(session.recvChainKey)}`);

    console.log(`localRatchetPublicKey: ${shortKey(session.localRatchetPublicKey)}`);
    console.log(`remoteRatchetPublicKey: ${shortKey(session.remoteRatchetPublicKey)}`);

    console.log(
      `skippedMessageKeys: ${
        session.skippedMessageKeys
          ? Object.keys(session.skippedMessageKeys).length
          : 0
      }`
    );

    console.log(
      `processedMessageIds: ${
        session.processedMessageIds
          ? Object.keys(session.processedMessageIds).length
          : 0
      }`
    );

    console.log("=========================");
    rl.prompt();
    return;
  }

  if (text.startsWith("/trust ")) {
    const parts = line.trim().split(" ");

    if (parts.length < 3) {
      console.log("用法：/trust <userId> <deviceId>");
      rl.prompt();
      return;
    }

    const trustUserId = parts[1];
    const trustDeviceId = parts[2];

    TrustedIdentityStore.forget(
      userId,
      deviceId,
      trustUserId,
      trustDeviceId
    );

    clearSessionWith(trustUserId, trustDeviceId);

    console.log(
      `已清除 ${trustUserId}/${trustDeviceId} 的旧身份信任和旧 session。`
    );
    console.log("下一次发送消息时会重新获取 PreKeyBundle 并建立新的 X3DH 会话。");

    rl.prompt();
    return;
  }

  if (text === "/verify") {
    const localKey = getLocalIdentityPublicKeyBase64();
    const peerKey = getTrustedIdentityPublicKeyBase64(targetId, targetDeviceId);

    console.log();
    console.log("当前会话安全验证码：");
    console.log();

    console.log(`本机 ${userId}/${deviceId}:`);
    console.log(fingerprint(localKey));
    console.log();

    console.log(`对方 ${targetId}/${targetDeviceId}:`);

    if (!peerKey) {
      console.log("尚未建立信任关系，请先发送或接收一条消息。");
      rl.prompt();
      return;
    }

    console.log(fingerprint(peerKey));
    console.log();

    console.log("请让对方也输入 /verify，对比双方显示的验证码是否一致。");

    rl.prompt();
    return;
  }

  if (text === "/trust-reset") {
    TrustedIdentityStore.forget(userId, deviceId, targetId, targetDeviceId);
    clearLocalSession();
    resetInProgress = false;

    console.log(`trusted identity for ${targetId}/${targetDeviceId} deleted`);
    console.log("local session deleted, next message will trust the new identity");
    rl.prompt();
    return;
  }

  if (text === "/rotate-spk") {
    const newKeyId = preKeys.rotateSignedPreKey();

    uploadPreKeyBundle();

    clearLocalSession();
    resetInProgress = false;

    console.log(`signedPreKey rotated to id=${newKeyId}`);
    console.log("uploaded new KeyBundle");
    console.log("local session deleted, next message will rebuild X3DH session");

    rl.prompt();
    return;
  }

  if (text === "/prekeys") {
    const count = preKeys.getOneTimePreKeyCount();

    console.log();
    console.log(`PreKey 状态：${userId}/${deviceId}`);
    console.log(`SignedPreKeyId: ${preKeys.getCurrentSignedPreKeyId()}`);
    console.log(`OneTimePreKeys: ${count}`);

    if (count === 0) {
      console.log("警告：oneTimePreKey 已耗尽，新的会话会退化为 signedPreKey fallback。");
    } else if (count < 2) {
      console.log("提示：oneTimePreKey 数量较低，建议执行 /refreshPreKeys。");
    }

    rl.prompt();
    return;
  }

  if (text === "/refreshPreKeys") {
    const before = preKeys.getOneTimePreKeyCount();

    preKeys.ensureOneTimePreKeys(5);
    uploadPreKeyBundle();

    console.log(
      `PreKey 已刷新：oneTimePreKeys ${before} -> ${preKeys.getOneTimePreKeyCount()}`
    );

    rl.prompt();
    return;
  }

  if (text === "/debugClearPreKeys") {
    preKeys.clearOneTimePreKeysForDebug();
    uploadPreKeyBundle();

    console.log("DEBUG: 已清空本机 oneTimePreKeys，并重新上传 PreKeyBundle。");
    console.log("注意：这是测试命令，只用于验证 signedPreKey fallback。");

    rl.prompt();
    return;
  }

  if (text === "/export") {
    exportCurrentChat();
    rl.prompt();
    return;
  }

  if (text.startsWith("/search ")) {
    const keyword = text.slice("/search ".length);
    showSearchResult(keyword);
    rl.prompt();
    return;
  }
  
  if (text === "/history") {
  const messages = MessageStore.list(userId, deviceId, targetId, targetDeviceId);

  if (messages.length === 0) {
    console.log("no message history");
    rl.prompt();
    return;
  }

  messages.forEach((item: any, index: number) => {
    const time = new Date(item.timestamp).toLocaleString();
    const status = item.direction === "out" ? item.status ?? "sent" : item.status ?? "received";

    console.log(
      `[${index + 1}] [${time}] #${item.messageNumber} ${item.from}/${item.fromDeviceId} -> ${item.to}/${item.toDeviceId}: ${item.text} [${status}]`
    );
  });

  const unreadIncoming = messages.filter((item: any) => {
    return (
      item.direction === "in" &&
      item.from === targetId &&
      item.fromDeviceId === targetDeviceId &&
      item.read !== true
    );
  });

  for (const item of unreadIncoming) {
    item.read = true;
    item.readAt = Date.now();

    ws.send(
      JSON.stringify({
        type: "receipt",
        receiptType: "read",
        from: userId,
        fromDeviceId: deviceId,
        to: item.from,
        toDeviceId: item.fromDeviceId,
        messageNumber: item.messageNumber,
        timestamp: Date.now(),
      })
    );
  }

  if (unreadIncoming.length > 0) {
    MessageStore.save(userId, deviceId, targetId, targetDeviceId, messages);
    console.log(`已自动标记 ${unreadIncoming.length} 条消息为已读。`);
  }

  NotificationStore.markReadFrom(userId, deviceId, targetId, targetDeviceId);

  rl.prompt();
  return;
  }

  if (text === "/read") {
    const messages = MessageStore.load(
      userId,
      deviceId,
      targetId,
      targetDeviceId
    );

    const unreadIncoming = messages.filter((item: any) => {
      return (
        item.direction === "in" &&
        item.from === targetId &&
        item.fromDeviceId === targetDeviceId &&
        item.read !== true
      );
    });

    if (unreadIncoming.length === 0) {
      console.log("当前会话没有未读消息。");
      rl.prompt();
      return;
    }

    for (const item of unreadIncoming) {
      item.read = true;
      item.readAt = Date.now();

      ws.send(
        JSON.stringify({
          type: "receipt",
          receiptType: "read",
          from: userId,
          fromDeviceId: deviceId,
          to: item.from,
          toDeviceId: item.fromDeviceId,
          messageNumber: item.messageNumber,
          timestamp: Date.now(),
        })
      );
    }

    MessageStore.save(userId, deviceId, targetId, targetDeviceId, messages);

    console.log(`已标记 ${unreadIncoming.length} 条消息为已读，并发送已读回执。`);
    rl.prompt();
    return;
  }

  if (text === "/clearHistory") {
    MessageStore.clear(userId, deviceId, targetId, targetDeviceId);

    console.log(`已清空当前会话历史：${targetId}/${targetDeviceId}`);
    rl.prompt();
    return;
  }

  if (text === "/clearHistoryAll") {
    MessageStore.clearAllForDevice(userId, deviceId);

    console.log(`已清空 ${userId}/${deviceId} 的所有聊天历史。`);
    rl.prompt();
    return;
  }

  if (text.startsWith("/deleteMessage ")) {
    const parts = text.trim().split(" ");
    const index = Number(parts[1]);

    if (Number.isNaN(index)) {
      console.log("用法：/deleteMessage <历史列表序号>");
      rl.prompt();
      return;
    }

    const deleted = MessageStore.deleteByIndex(
      userId,
      deviceId,
      targetId,
      targetDeviceId,
      index
    );

    if (!deleted) {
      console.log(`没有找到第 ${index} 条历史消息。`);
    } else {
      console.log(`已删除第 ${index} 条消息：${deleted.text}`);
    }

    rl.prompt();
    return;
  }

  if (text === "/chats") {
    showChats();
    rl.prompt();
    return;
  }

  if (text === "/notifications") {
    showNotifications();
    rl.prompt();
    return;
  }

  if (text === "/clearNotifications") {
    clearAllNotifications();
    rl.prompt();
    return;
  }

  if (text === "/read-notifications") {
    NotificationStore.markAllRead(userId, deviceId);
    console.log("all notifications marked as read");
    rl.prompt();
    return;
  }

  if (text === "/contacts") {
    const contacts = ContactStore.list(userId, deviceId);

    if (contacts.length === 0) {
      console.log("no contacts");
      rl.prompt();
      return;
    }

    console.log("===== CONTACTS =====");

    for (const contact of contacts) {
      const time = new Date(contact.addedAt).toLocaleString();

      console.log(
        `- ${contact.userId}/${contact.deviceId}, addedAt=${time}`
      );
    }

    console.log("====================");
    rl.prompt();
    return;
  }

  if (text.startsWith("/add-contact ")) {
    const parts = text.split(/\s+/);

    if (parts.length < 3) {
      console.log("usage: /add-contact <userId> <deviceId>");
      rl.prompt();
      return;
    }

    const remoteUserId = parts[1];
    const remoteDeviceId = parts[2];

    const added = ContactStore.add(
      userId,
      deviceId,
      remoteUserId,
      remoteDeviceId
    );

    if (added) {
      console.log(`contact added: ${remoteUserId}/${remoteDeviceId}`);
    } else {
      console.log(`contact already exists: ${remoteUserId}/${remoteDeviceId}`);
    }

    rl.prompt();
    return;
  }

  if (text.startsWith("/remove-contact ")) {
    const parts = text.split(/\s+/);

    if (parts.length < 3) {
      console.log("usage: /remove-contact <userId> <deviceId>");
      rl.prompt();
      return;
    }

    const remoteUserId = parts[1];
    const remoteDeviceId = parts[2];

    const removed = ContactStore.remove(
      userId,
      deviceId,
      remoteUserId,
      remoteDeviceId
    );

    if (removed) {
      console.log(`contact removed: ${remoteUserId}/${remoteDeviceId}`);
    } else {
      console.log(`contact not found: ${remoteUserId}/${remoteDeviceId}`);
    }

    rl.prompt();
    return;
  }

  if (text.startsWith("/devices")) {
    const parts = text.trim().split(" ");
    const queryUser = parts[1] ?? targetId;

    ws.send(
      JSON.stringify({
        type: "getDevices",
        target: queryUser,
      })
    );

    rl.prompt();
    return;
  }

  if (text.startsWith("/sendAll ")) {
    const parts = text.trim().split(" ");

    if (parts.length < 3) {
      console.log("用法：/sendAll <userId> <message>");
      rl.prompt();
      return;
    }

    const sendAllTarget = parts[1];
    const textToSend = parts.slice(2).join(" ");

    pendingSendAllTarget = sendAllTarget;
    pendingSendAllText = textToSend;

    ws.send(
      JSON.stringify({
        type: "getDevices",
        target: sendAllTarget,
      })
    );

    rl.prompt();
    return;
  }

  if (text.startsWith("/switch ")) {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
    console.log("usage: /switch  ");
    rl.prompt();
    return;
  }

  targetId = parts[1];
  targetDeviceId = parts[2];

  clearNotificationsFrom(targetId, targetDeviceId);
  NotificationStore.markReadFrom(userId, deviceId, targetId, targetDeviceId);

  resetInProgress = false;
  pendingMessage = null;

  loadCurrentSession();

  console.log(`current chat target switched to ${targetId}/${targetDeviceId}`);
  console.log("该会话的非当前会话提醒已标记为已读。");
  rl.prompt();
  return;
}

  if (text === "/target") {
    console.log(`current target: ${targetId}/${targetDeviceId}`);
    rl.prompt();
    return;
  }

  if (text === "/pull") {
    ws.send(JSON.stringify({ type: "pull", userId, deviceId }));
    return;
  }

  if (text === "/requestReset") {
    sendSessionResetRequest(
      "manual reset requested",
      targetId,
      targetDeviceId
    );

    clearSessionWith(targetId, targetDeviceId);
    sessionNeedsRebuild.add(peerKey(targetId, targetDeviceId));

    console.log(
      `已向 ${targetId}/${targetDeviceId} 发送 session reset 请求。`
    );
    console.log("本地 session 已删除，下一条消息会重新建立 X3DH。");

    rl.prompt();
    return;
  }

  sendChat(text);
  rl.prompt();
});
