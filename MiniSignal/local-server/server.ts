import WebSocket, { WebSocketServer } from "ws";
import { RelayQueue, CipherMessage } from "./relay";
import { UserRegistry } from "./users";

interface PreKeyBundle {
  identityKey: string;
  signedPreKey: string;
  oneTimePreKey: string;
}

const wss = new WebSocketServer({ port: 8080 });
const users = new UserRegistry();
const relay = new RelayQueue();

const bundles = new Map<string, PreKeyBundle>();

function deviceKey(userId: string, deviceId: string) {
  return `${userId}:${deviceId}`;
}

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
      send(ws, { type: "error", error: "invalid json" });
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

    if (message.type === "uploadPreKeyBundle") {
      const userId = String(message.userId);
      const deviceId = String(message.deviceId ?? "default");

      if (!message.bundle) {
        send(ws, { type: "error", error: "missing bundle" });
        return;
      }

      bundles.set(deviceKey(userId, deviceId), message.bundle);

      send(ws, {
        type: "uploadPreKeyBundle-ok",
        userId,
        deviceId,
      });

      console.log(`${userId} (${deviceId}) uploaded bundle`);
      return;
    }

    if (message.type === "getPreKeyBundle") {
      const target = String(message.target);
      const targetDeviceId = String(message.targetDeviceId ?? "default");
      const bundle = bundles.get(deviceKey(target, targetDeviceId));

      send(ws, {
        type: "preKeyBundle",
        target,
        targetDeviceId,
        bundle: bundle ?? null,
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
      };

      if (target && target.ws.readyState === WebSocket.OPEN) {
        send(target.ws, payload);
      } else {
        send(ws, { type: "error", error: "target offline for x3dh-init" });
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
      };

      const status = relay.deliverOrQueue(users, cipherMessage);

      send(ws, {
        type: "message-status",
        messageNumber: cipherMessage.messageNumber,
        status,
      });
      return;
    }

    if (message.type === "pull") {
      const userId = String(message.userId);
      const deviceId = String(message.deviceId ?? "default");
      const messages = relay.pull(userId, deviceId);
      send(ws, { type: "pull-result", messages });
      return;
    }

    send(ws, { type: "error", error: `unknown type: ${message.type}` });
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
