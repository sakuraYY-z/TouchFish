import { PrivateKey, PublicKey } from "@signalapp/libsignal-client";
import readline from "readline";
import WebSocket from "ws";
import { CryptoManager } from "./crypto/crypto";
import { IdentityManager } from "./identity/identity";
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

const userId = process.argv[2];
const deviceId = process.argv[3];
const targetId = process.argv[4];
const targetDeviceId = process.argv[5];

if (!userId || !deviceId || !targetId || !targetDeviceId) {
  console.log("usage: npx ts-node client.ts alice desktop bob phone");
  process.exit(0);
}

const identity = new IdentityManager(userId, deviceId);
const preKeys = new PreKeyManager(identity.getPrivateKey());

let session: MiniSessionState | null = SessionStore.load(
  userId,
  deviceId,
  targetId,
  targetDeviceId
);

let pendingMessage: string | null = null;

function saveSession() {
  if (session) {
    SessionStore.save(session);
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

function encryptForSend(plaintext: string) {
  if (!session) {
    throw new Error("session not established");
  }

  const chain = Buffer.from(session.sendChainKey, "base64");
  const { nextChainKey, messageKey } = nextMessageKey(chain);

  const encrypted = CryptoManager.encrypt(
    plaintext,
    messageKey.toString("base64")
  );

  const messageNumber = session.sendCounter;

  session.sendCounter += 1;
  session.sendChainKey = nextChainKey.toString("base64");
  saveSession();

  return { encrypted, messageNumber };
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
  messageNumber: number,
  payload: any,
  remoteRatchetPublicKey: string | null
) {
  if (!session) {
    throw new Error("session not established");
  }

  const keyId = skippedKeyId(remoteRatchetPublicKey, messageNumber);
  const savedMessageKey = session.skippedMessageKeys[keyId];

  if (!savedMessageKey) {
    return null;
  }

  const plaintext = CryptoManager.decrypt(
    payload.encrypted,
    payload.iv,
    payload.tag,
    savedMessageKey
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
  remoteRatchetPublicKey: string | null = null
) {
  if (!session) {
    throw new Error("session not established");
  }

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
    messageNumber,
    payload,
    remoteRatchetPublicKey
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

  const plaintext = CryptoManager.decrypt(
    payload.encrypted,
    payload.iv,
    payload.tag,
    messageKey.toString("base64")
  );

  session.recvCounter += 1;
  session.recvChainKey = nextChainKey.toString("base64");

  markMessageProcessed(id);
  saveSession();

  return plaintext;
}

function sendChat(line: string) {
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

  const { encrypted, messageNumber } = encryptForSend(line);

  ws.send(
  JSON.stringify({
    type: "message",
    from: userId,
    fromDeviceId: deviceId,
    target: targetId,
    targetDeviceId,
    ratchetPublicKey: session?.localRatchetPublicKey ?? null,
    previousSendCounter: session?.previousSendCounter ?? 0,
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
});
}

function parsePublicKey(base64: string) {
  return PublicKey.deserialize(Buffer.from(base64, "base64"));
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

  ws.send(
    JSON.stringify({
      type: "uploadPreKeyBundle",
      userId,
      deviceId,
      bundle: preKeys.getBundle(),
    })
  );

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

  if (msg.type === "message-status") {
    console.log(`message ${msg.messageNumber}: ${msg.status}`);
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
    const remoteSignedPreKey = parsePublicKey(msg.bundle.signedPreKey);
      
      const remoteOneTimePreKey = msg.bundle.oneTimePreKey
        ? parsePublicKey(msg.bundle.oneTimePreKey)
        : null;

      const result = X3DHManager.initiator(
        identity.getPrivateKey(),
        remoteIdentity,
        remoteSignedPreKey,
        remoteOneTimePreKey
      );

    createSessionFromRoot(result.rootKey);

    console.log("X3DH initiator session established");

    ws.send(
      JSON.stringify({
         type: "x3dh-init",
         from: userId,
         fromDeviceId: deviceId,
         target: targetId,
         targetDeviceId,
         ephemeralPublic: result.ephemeralPublic,
         identityKey: identity.getPublicKeyBase64(),
         ratchetPublicKey: session?.localRatchetPublicKey ?? null,
         usedOneTimePreKey: msg.bundle.oneTimePreKey ? true : false,
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
    const remoteEphemeral = parsePublicKey(msg.ephemeralPublic);
    const remoteIdentity = parsePublicKey(msg.identityKey);

    const rootKey = X3DHManager.responder(
      identity.getPrivateKey(),
      preKeys.getSignedPreKeyPrivate(),
      msg.usedOneTimePreKey ? preKeys.getOneTimePreKeyPrivate() : null,
      remoteEphemeral,
      remoteIdentity
    );

    createSessionFromRoot(rootKey, msg.ratchetPublicKey ?? null);

    console.log("X3DH responder session established");
    rl.prompt();
    return;
  }

  if (msg.type === "message") {
    try {
      const plaintext = decryptIncoming(
      msg.from,
      msg.fromDeviceId,
      msg.messageNumber,
      msg.payload,
      msg.ratchetPublicKey ?? null
      );
      
      MessageStore.append(targetId, targetDeviceId, userId, deviceId, {
        direction: "in",
        from: userId,
        fromDeviceId: deviceId,
        to: targetId,
        toDeviceId: targetDeviceId,
        text: plaintext,
        timestamp: Date.now(),
        messageNumber: msg.messageNumber,
      });
      console.log();
      console.log(`[${msg.from}/${msg.fromDeviceId}] ${plaintext}`);
    } catch (err) {
      console.error("Failed to decrypt message:", err);
      console.error("Tip: delete demo-client/storage/session_*.json on both clients and retry.");
    }

    rl.prompt();
    return;
  }

  if (msg.type === "pull-result") {
    for (const item of msg.messages ?? []) {
      try {
        const plaintext = decryptIncoming(
        item.from,
        item.fromDeviceId,
        item.messageNumber,
        item.payload,
        item.ratchetPublicKey ?? null
      );
        
        MessageStore.append(targetId, targetDeviceId, userId, deviceId, {
          direction: "in",
          from: userId,
          fromDeviceId: deviceId,
          to: targetId,
          toDeviceId: targetDeviceId,
          text: plaintext,
          timestamp: Date.now(),
          messageNumber: item.messageNumber,
        });
        console.log(`[${item.from}/${item.fromDeviceId}] ${plaintext}`);
      } catch (err) {
        console.error("Failed to decrypt pulled message:", err);
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
    SessionStore.delete(userId, deviceId, targetId, targetDeviceId);
    session = null;
    console.log("local session deleted");
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

  for (const item of messages) {
    const time = new Date(item.timestamp).toLocaleString();
    const arrow = item.direction === "out" ? "->" : "<-";

    console.log(
      `[${time}] ${item.from}/${item.fromDeviceId} ${arrow} ${item.to}/${item.toDeviceId}: ${item.text}`
    );
  }

  rl.prompt();
  return;
  }
  if (text === "/pull") {
    ws.send(JSON.stringify({ type: "pull", userId, deviceId }));
    return;
  }

  sendChat(text);
  rl.prompt();
});
