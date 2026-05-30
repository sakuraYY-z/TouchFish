import fs from "fs";
import path from "path";

export interface NotificationItem {
  id: string;
  from: string;
  fromDeviceId: string;
  to: string;
  toDeviceId: string;
  type: "x3dh-init" | "message" | "offline-message" | "session-reset";
  messageNumber?: number;
  timestamp: number;
  read: boolean;
  note: string;
}

export class NotificationStore {
  private static storageDir = __dirname;

  private static filePath(userId: string, deviceId: string) {
    return path.join(
      this.storageDir,
      `notifications_${userId}_${deviceId}.json`
    );
  }

  private static loadAll(userId: string, deviceId: string): NotificationItem[] {
    const file = this.filePath(userId, deviceId);

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  private static saveAll(
    userId: string,
    deviceId: string,
    items: NotificationItem[]
  ) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    fs.writeFileSync(
      this.filePath(userId, deviceId),
      JSON.stringify(items, null, 2),
      "utf8"
    );
  }

  static add(userId: string, deviceId: string, item: NotificationItem) {
    const items = this.loadAll(userId, deviceId);

    if (items.some((x) => x.id === item.id)) {
      return;
    }

    items.push(item);
    this.saveAll(userId, deviceId, items);
  }

  static list(userId: string, deviceId: string) {
    return this.loadAll(userId, deviceId);
  }

  static unread(userId: string, deviceId: string) {
    return this.loadAll(userId, deviceId).filter((x) => !x.read);
  }

  static markAllRead(userId: string, deviceId: string) {
    const items = this.loadAll(userId, deviceId).map((x) => ({
      ...x,
      read: true,
    }));

    this.saveAll(userId, deviceId, items);
  }
}