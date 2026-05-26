import fs from "fs";
import path from "path";
import WebSocket from "ws";

export interface DeviceClient {
  userId: string;
  deviceId: string;
  ws: WebSocket;
  publicKey?: string;
}

export interface RegisteredDevice {
  userId: string;
  deviceId: string;
  publicKey?: string;
  lastSeen: number;
}

export class UserRegistry {
  private clients = new Map<string, Map<string, DeviceClient>>();
  private registeredDevices = new Map<string, RegisteredDevice>();

  private storageDir = path.join(__dirname, "storage");
  private storagePath = path.join(this.storageDir, "registered_devices.json");

  constructor() {
    this.load();
  }

  private key(userId: string, deviceId: string) {
    return `${userId}:${deviceId}`;
  }

  private save() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const objectData: Record<string, RegisteredDevice> = {};

    for (const [key, device] of this.registeredDevices.entries()) {
      objectData[key] = device;
    }

    fs.writeFileSync(
      this.storagePath,
      JSON.stringify(objectData, null, 2),
      "utf8"
    );
  }

  private load() {
    if (!fs.existsSync(this.storagePath)) {
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));

      for (const key of Object.keys(data)) {
        this.registeredDevices.set(key, data[key]);
      }

      console.log(`registered devices loaded: ${this.registeredDevices.size}`);
    } catch {
      console.log("failed to load registered devices, starting empty");
      this.registeredDevices.clear();
    }
  }

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

    const key = this.key(userId, deviceId);

    this.registeredDevices.set(key, {
      userId,
      deviceId,
      publicKey,
      lastSeen: Date.now(),
    });

    this.save();
  }

  getDevice(userId: string, deviceId: string) {
    return this.clients.get(userId)?.get(deviceId);
  }

  getDevices(userId: string) {
    return this.clients.get(userId);
  }

  getRegisteredDevices(userId: string) {
    const result: RegisteredDevice[] = [];

    for (const device of this.registeredDevices.values()) {
      if (device.userId === userId) {
        result.push(device);
      }
    }

    return result;
  }

  removeSocket(ws: WebSocket) {
    for (const [userId, devices] of this.clients.entries()) {
      for (const [deviceId, client] of devices.entries()) {
        if (client.ws === ws) {
          devices.delete(deviceId);

          if (devices.size === 0) {
            this.clients.delete(userId);
          }

          return { userId, deviceId };
        }
      }
    }

    return null;
  }
}
