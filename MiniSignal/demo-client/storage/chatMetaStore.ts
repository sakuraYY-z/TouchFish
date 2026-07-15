import fs from "fs";
import path from "path";

export interface ChatMeta {
  remoteUserId: string;
  remoteDeviceId: string;
  pinned: boolean;
  muted: boolean;
  remark?: string;
  archived?: boolean;
  updatedAt: number;
}

const storageDir = path.join(__dirname);

function ensureStorageDir() {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
}

function metaFile(userId: string, deviceId: string) {
  ensureStorageDir();
  return path.join(storageDir, `chat_meta_${userId}_${deviceId}.json`);
}

function chatKey(userId: string, deviceId: string) {
  return `${userId}/${deviceId}`;
}

export class ChatMetaStore {
  static loadAll(userId: string, deviceId: string): ChatMeta[] {
    const file = metaFile(userId, deviceId);

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  static saveAll(userId: string, deviceId: string, items: ChatMeta[]) {
    const file = metaFile(userId, deviceId);
    fs.writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
  }

  static setPinned(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    pinned: boolean
  ) {
    const items = this.loadAll(userId, deviceId);
    const key = chatKey(remoteUserId, remoteDeviceId);

    const existing = items.find(
      (item) => chatKey(item.remoteUserId, item.remoteDeviceId) === key
    );

    if (existing) {
      existing.pinned = pinned;
      existing.updatedAt = Date.now();
    } else {
      items.push({
        remoteUserId,
        remoteDeviceId,
        pinned,
        muted: false,
        archived: false,
        updatedAt: Date.now(),
      });
    }

    this.saveAll(userId, deviceId, items);
  }

  static isPinned(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const items = this.loadAll(userId, deviceId);

    return items.some(
      (item) =>
        item.remoteUserId === remoteUserId &&
        item.remoteDeviceId === remoteDeviceId &&
        item.pinned
    );
  }
  static setMuted(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    muted: boolean
  ) {
    const items = this.loadAll(userId, deviceId);
    const key = chatKey(remoteUserId, remoteDeviceId);

    const existing = items.find(
      (item) => chatKey(item.remoteUserId, item.remoteDeviceId) === key
    );

    if (existing) {
      existing.muted = muted;
      existing.updatedAt = Date.now();

      if (existing.pinned === undefined) {
        existing.pinned = false;
      }
    } else {
      items.push({
        remoteUserId,
        remoteDeviceId,
        pinned: false,
        muted,
        archived: false,
        updatedAt: Date.now(),
      });
    }

    this.saveAll(userId, deviceId, items);
  }

  static isMuted(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const items = this.loadAll(userId, deviceId);

    return items.some(
      (item) =>
        item.remoteUserId === remoteUserId &&
        item.remoteDeviceId === remoteDeviceId &&
        item.muted
    );
  }

  static setRemark(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    remark: string | null
  ) {
    const items = this.loadAll(userId, deviceId);
    const key = chatKey(remoteUserId, remoteDeviceId);

    const existing = items.find(
      (item) => chatKey(item.remoteUserId, item.remoteDeviceId) === key
    );

    if (existing) {
      if (remark && remark.trim()) {
        existing.remark = remark.trim();
      } else {
        delete existing.remark;
      }

      if (existing.pinned === undefined) {
        existing.pinned = false;
      }

      if (existing.muted === undefined) {
        existing.muted = false;
      }

      existing.updatedAt = Date.now();
    } else {
      items.push({
        remoteUserId,
        remoteDeviceId,
        pinned: false,
        muted: false,
        archived: false,
        remark: remark && remark.trim() ? remark.trim() : undefined,
        updatedAt: Date.now(),
      });
    }

    this.saveAll(userId, deviceId, items);
  }

  static getRemark(
    userId: string,
    deviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const items = this.loadAll(userId, deviceId);

    const item = items.find(
      (x) =>
        x.remoteUserId === remoteUserId &&
        x.remoteDeviceId === remoteDeviceId
    );

    return item?.remark ?? null;
  }

  static setArchived(
  userId: string,
  deviceId: string,
  remoteUserId: string,
  remoteDeviceId: string,
  archived: boolean
) {
  const items = this.loadAll(userId, deviceId);
  const key = chatKey(remoteUserId, remoteDeviceId);

  const existing = items.find(
    (item) => chatKey(item.remoteUserId, item.remoteDeviceId) === key
  );

  if (existing) {
    existing.archived = archived;
    existing.updatedAt = Date.now();

    if (existing.pinned === undefined) {
      existing.pinned = false;
    }

    if (existing.muted === undefined) {
      existing.muted = false;
    }
  } else {
    items.push({
      remoteUserId,
      remoteDeviceId,
      pinned: false,
      muted: false,
      archived,
      updatedAt: Date.now(),
    });
  }

  this.saveAll(userId, deviceId, items);
}

static isArchived(
  userId: string,
  deviceId: string,
  remoteUserId: string,
  remoteDeviceId: string
  ) {
    const items = this.loadAll(userId, deviceId);

    return items.some(
      (item) =>
      item.remoteUserId === remoteUserId &&
      item.remoteDeviceId === remoteDeviceId &&
      item.archived
    );
  }
}
