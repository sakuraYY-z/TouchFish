import WebSocket from "ws";
import {
  CipherMessage,
  enqueueOfflineMessage,
  pullOfflineMessages,
} from "./db";
import { UserRegistry } from "./users";

export { CipherMessage };

export class RelayQueue {
  enqueue(message: CipherMessage) {
    enqueueOfflineMessage(message);
  }

  pull(userId: string, deviceId: string) {
    return pullOfflineMessages(userId, deviceId);
  }

  deliverOrQueue(registry: UserRegistry, message: CipherMessage) {
    const target = registry.getDevice(message.target, message.targetDeviceId);

    if (target && target.ws.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify(message));
      return "delivered";
    }

    this.enqueue(message);
    return "queued";
  }
}