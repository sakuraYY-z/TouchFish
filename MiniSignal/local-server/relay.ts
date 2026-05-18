import WebSocket from "ws";
import { UserRegistry } from "./users";

export interface CipherMessage {
  type: "message";
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  messageNumber: number;
  payload: {
    encrypted: string;
    iv: string;
    tag: string;
  };
  timestamp: number;
}

export class RelayQueue {
  private queues = new Map<string, CipherMessage[]>();

  private key(userId: string, deviceId: string) {
    return `${userId}:${deviceId}`;
  }

  enqueue(message: CipherMessage) {
    const key = this.key(message.target, message.targetDeviceId);
    const queue = this.queues.get(key) ?? [];
    queue.push(message);
    this.queues.set(key, queue);
  }

  pull(userId: string, deviceId: string) {
    const key = this.key(userId, deviceId);
    const queue = this.queues.get(key) ?? [];
    this.queues.delete(key);
    return queue;
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
