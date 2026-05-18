import { PublicKey } from "@signalapp/libsignal-client";
import readline from "readline";
import WebSocket from "ws";
import { CryptoManager } from "./crypto/crypto";
import { IdentityManager } from "./identity/identity";
import { MessageStore } from "./message/messageStore";
import { PreKeyManager } from "./prekey/prekey";
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

function createSessionFromRoot(rootKeyBase64: string) {
  const rootKey = Buffer.from(rootKeyBase64, "base64");

  const chains = deriveDirectionalChains(
    rootKey,
    userId,
    deviceId,
    targetId,
    targetDeviceId
  );

  session = {
    version: 2,
    localUserId: userId,
    localDeviceId: deviceId,
    remoteUserId: targetId,
    remoteDeviceId: targetDeviceId,
    rootKey: rootKey.toString("base64"),
    sendChainKey: chains.sendChainKey.toString("base64"),
    recvChainKey: chains.recvChainKey.toString("base64"),
    sendCounter: 0,
    recvCounter: 0,
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

function decryptIncoming(messageNumber: number, payload: any) {
  if (!session) {
    throw new Error("session not established");
  }

  if (messageNumber !== session.recvCounter) {
    throw new Error(
      `message order mismatch: expected ${session.recvCounter}, got ${messageNumber}`
    );
  }

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
    const remoteOneTimePreKey = parsePublicKey(msg.bundle.oneTimePreKey);

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
      preKeys.getOneTimePreKeyPrivate(),
      remoteEphemeral,
      remoteIdentity
    );

    createSessionFromRoot(rootKey);

    console.log("X3DH responder session established");
    rl.prompt();
    return;
  }

  if (msg.type === "message") {
    try {
      const plaintext = decryptIncoming(msg.messageNumber, msg.payload);
      
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
        const plaintext = decryptIncoming(item.messageNumber, item.payload);
        
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
