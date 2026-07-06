import WebSocket from "ws";
import {
  getRegisteredDevices,
  RegisteredDevice,
  saveRegisteredDevice,
} from "./db";

export interface DeviceClient {
  userId: string;
  deviceId: string;
  ws: WebSocket;
  publicKey?: string;
}

export class UserRegistry {
  private clients = new Map<string, Map<string, DeviceClient>>();

  login(userId: string, deviceId: string, ws: WebSocket, publicKey?: string) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Map());
    }

    this.clients.get(userId)!.set(deviceId, {
      userId,
      deviceId,
      ws,
      publicKey,
    });

    saveRegisteredDevice({
      userId,
      deviceId,
      publicKey,
      lastSeen: Date.now(),
    });
  }

  getDevice(userId: string, deviceId: string) {
    return this.clients.get(userId)?.get(deviceId);
  }

  getDevices(userId: string) {
    return this.clients.get(userId);
  }

  getRegisteredDevices(userId: string): RegisteredDevice[] {
    return getRegisteredDevices(userId);
  }

  removeSocket(ws: WebSocket) {
    for (const [userId, devices] of this.clients.entries()) {
      for (const [deviceId, client] of devices.entries()) {
        if (client.ws === ws) {
          devices.delete(deviceId);

          if (devices.size === 0) {
            this.clients.delete(userId);
          }

          return {
            userId,
            deviceId,
          };
        }
      }
    }

    return null;
  }
}