import WebSocket, { WebSocketServer } from "ws";
import {
  consumeOneTimePreKey,
  countOneTimePreKeys,
  getPreKeyBundle,
  saveOrMergePreKeyBundle,
} from "./db";
import { CipherMessage, RelayQueue } from "./relay";
import { UserRegistry } from "./users";

const wss = new WebSocketServer({ port: 8080 });

const users = new UserRegistry();
const relay = new RelayQueue();

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

console.log("MiniSignal Server Running: ws://localhost:8080");

wss.on("connection", (ws) => {
  console.log("client connected");

  ws.on("message", (data) => {
    let message: any;

    try {
      message = JSON.parse(data.toString());
    } catch {
      send(ws, {
        type: "error",
        error: "invalid json",
      });
      return;
    }

    console.log("RECV:", message.type, message.from ?? message.userId ?? "");

    if (message.type === "login") {
      const userId = String(message.userId);
      const deviceId = String(message.deviceId ?? "default");

      users.login(userId, deviceId, ws, message.publicKey);

      send(ws, {
        type: "login-ok",
        userId,
        deviceId,
      });

      const offline = relay.pull(userId, deviceId);

      for (const item of offline) {
        send(ws, item);
      }

      console.log(`${userId} (${deviceId}) online, offline=${offline.length}`);
      return;
    }

    if (message.type === "list-devices") {
      const target = String(message.target ?? message.userId);
      const devices = users.getRegisteredDevices(target);

      send(ws, {
        type: "device-list",
        target,
        devices: devices.map((item) => ({
          userId: item.userId,
          deviceId: item.deviceId,
          publicKey: item.publicKey ?? null,
          lastSeen: item.lastSeen,
          online: users.getDevice(item.userId, item.deviceId) ? true : false,
        })),
      });

      return;
    }

    if (message.type === "getDevices") {
      const targetUserId = String(message.target);
      const devices = users.getRegisteredDevices(targetUserId);

      send(ws, {
        type: "device-list",
        target: targetUserId,
        devices: devices.map((item) => ({
          userId: item.userId,
          deviceId: item.deviceId,
          publicKey: item.publicKey ?? null,
          online: users.getDevice(item.userId, item.deviceId) ? true : false,
          lastSeen: item.lastSeen,
        })),
      });

      return;
    }

    if (message.type === "uploadPreKeyBundle") {
      const userId = String(message.userId);
      const deviceId = String(message.deviceId ?? "default");

      if (!message.bundle) {
        send(ws, {
          type: "error",
          error: "missing bundle",
        });
        return;
      }

      saveOrMergePreKeyBundle(userId, deviceId, message.bundle);

      const remaining = countOneTimePreKeys(userId, deviceId);

      send(ws, {
        type: "uploadPreKeyBundle-ok",
        userId,
        deviceId,
      });

      console.log(
        `${userId} (${deviceId}) uploaded bundle, oneTimePreKeys=${remaining}`
      );

      return;
    }

    if (message.type === "getPreKeyBundle") {
      const target = String(message.target);
      const targetDeviceId = String(message.targetDeviceId ?? "default");

      const bundle = getPreKeyBundle(target, targetDeviceId);

      if (!bundle) {
        send(ws, {
          type: "preKeyBundle",
          target,
          targetDeviceId,
          bundle: null,
        });
        return;
      }

      const selectedOneTimePreKey = consumeOneTimePreKey(
        target,
        targetDeviceId
      );

      const responseBundle = {
        identityKey: bundle.identityKey,
        signedPreKeyId: bundle.signedPreKeyId,
        signedPreKey: bundle.signedPreKey,
        signedPreKeySignature: bundle.signedPreKeySignature,
        oneTimePreKeyId: selectedOneTimePreKey
          ? selectedOneTimePreKey.keyId
          : null,
        oneTimePreKey: selectedOneTimePreKey
          ? selectedOneTimePreKey.publicKey
          : null,
        hasOneTimePreKey: !!selectedOneTimePreKey,
      };

      if (selectedOneTimePreKey) {
        console.log(
          `${target} (${targetDeviceId}) oneTimePreKey consumed: ${selectedOneTimePreKey.keyId}`
        );
      } else {
        console.log(`${target} (${targetDeviceId}) has no oneTimePreKey left`);
      }

      send(ws, {
        type: "preKeyBundle",
        target,
        targetDeviceId,
        bundle: responseBundle,
      });

      return;
    }

    if (message.type === "x3dh-init") {
      const target = users.getDevice(
        String(message.target),
        String(message.targetDeviceId ?? "default")
      );

      const payload = {
        type: "x3dh-init",
        from: String(message.from),
        fromDeviceId: String(message.fromDeviceId ?? "default"),
        target: String(message.target),
        targetDeviceId: String(message.targetDeviceId ?? "default"),
        ephemeralPublic: message.ephemeralPublic,
        identityKey: message.identityKey,
        ratchetPublicKey: message.ratchetPublicKey ?? null,
        signature: message.signature,
        usedOneTimePreKey: Boolean(message.usedOneTimePreKey),
        usedOneTimePreKeyId:
          message.usedOneTimePreKeyId !== null &&
          message.usedOneTimePreKeyId !== undefined
            ? Number(message.usedOneTimePreKeyId)
            : null,
        usedSignedPreKeyId: Number(message.usedSignedPreKeyId ?? 1),
      };

      if (target && target.ws.readyState === WebSocket.OPEN) {
        send(target.ws, payload);
      } else {
        send(ws, {
          type: "error",
          error: "target offline for x3dh-init",
        });
      }

      return;
    }

    if (message.type === "session-reset-request") {
      const target = users.getDevice(
        String(message.target),
        String(message.targetDeviceId ?? "default")
      );

      const payload = {
        type: "session-reset-request",
        from: String(message.from),
        fromDeviceId: String(message.fromDeviceId ?? "default"),
        target: String(message.target),
        targetDeviceId: String(message.targetDeviceId ?? "default"),
        reason: String(message.reason ?? "decrypt failed"),
        timestamp: Date.now(),
      };

      if (target && target.ws.readyState === WebSocket.OPEN) {
        send(target.ws, payload);

        send(ws, {
          type: "session-reset-status",
          status: "delivered",
        });
      } else {
        send(ws, {
          type: "session-reset-status",
          status: "target-offline",
        });
      }

      return;
    }

    if (message.type === "session-reset-ok") {
      const target = users.getDevice(
        String(message.target),
        String(message.targetDeviceId ?? "default")
      );

      const payload = {
        type: "session-reset-ok",
        from: String(message.from),
        fromDeviceId: String(message.fromDeviceId ?? "default"),
        target: String(message.target),
        targetDeviceId: String(message.targetDeviceId ?? "default"),
        timestamp: Date.now(),
      };

      if (target && target.ws.readyState === WebSocket.OPEN) {
        send(target.ws, payload);
      }

      return;
    }

    if (message.type === "message") {
      const cipherMessage: CipherMessage = {
        type: "message",
        from: String(message.from),
        fromDeviceId: String(message.fromDeviceId ?? "default"),
        target: String(message.target),
        targetDeviceId: String(message.targetDeviceId ?? "default"),
        messageNumber: Number(message.messageNumber),
        payload: message.payload,
        timestamp: Date.now(),
        ratchetPublicKey: message.ratchetPublicKey ?? null,
        previousSendCounter: Number(message.previousSendCounter ?? 0),
      };

      const status = relay.deliverOrQueue(users, cipherMessage);

      send(ws, {
        type: "message-status",
        messageNumber: cipherMessage.messageNumber,
        status,
      });

      return;
    }

    if (message.type === "receipt") {
      const target = users.getDevice(
        String(message.to),
        String(message.toDeviceId ?? "default")
      );

      const payload = {
        type: "receipt",
        receiptType: String(message.receiptType),
        from: String(message.from),
        fromDeviceId: String(message.fromDeviceId ?? "default"),
        to: String(message.to),
        toDeviceId: String(message.toDeviceId ?? "default"),
        messageNumber: Number(message.messageNumber),
        timestamp: Number(message.timestamp ?? Date.now()),
      };

      if (target && target.ws.readyState === WebSocket.OPEN) {
        send(target.ws, payload);
      }

      return;
    }

    if (message.type === "pull") {
      const userId = String(message.userId);
      const deviceId = String(message.deviceId ?? "default");

      const messages = relay.pull(userId, deviceId);

      send(ws, {
        type: "pull-result",
        messages,
      });

      return;
    }

    send(ws, {
      type: "error",
      error: `unknown type: ${message.type}`,
    });
  });

  ws.on("close", () => {
    const removed = users.removeSocket(ws);

    if (removed) {
      console.log(`client disconnected: ${removed.userId} (${removed.deviceId})`);
    } else {
      console.log("client disconnected");
    }
  });
});