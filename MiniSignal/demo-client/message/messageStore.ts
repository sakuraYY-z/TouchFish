import fs from "fs";
import path from "path";

export type MessageDirection = "in" | "out";
export type MessageStatus = "sent" | "delivered" | "read";

export interface ChatMessageRecord {
  direction: MessageDirection;
  from: string;
  fromDeviceId: string;
  to: string;
  toDeviceId: string;
  text: string;
  timestamp: number;
  messageNumber: number;
  status?: MessageStatus;
  deliveredAt?: number;
  read?: boolean;
  readAt?: number;
}

export class MessageStore {
  private static storageDir() {
    return path.join(__dirname, "..", "storage");
  }

  private static getPath(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    return path.join(
      this.storageDir(),
      `messages_${localUserId}_${localDeviceId}__${remoteUserId}_${remoteDeviceId}.json`
    );
  }

  static append(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    record: ChatMessageRecord
  ) {
    if (!fs.existsSync(this.storageDir())) {
      fs.mkdirSync(this.storageDir(), { recursive: true });
    }

    const file = this.getPath(
      localUserId,
      localDeviceId,
      remoteUserId,
      remoteDeviceId
    );

    let messages: ChatMessageRecord[] = [];

    if (fs.existsSync(file)) {
      try {
        messages = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        messages = [];
      }
    }

    // 防重复逻辑：检查是否已存在相同的消息
    const exists = messages.some((item: any) => {
      return (
        item.direction === record.direction &&
        item.from === record.from &&
        item.fromDeviceId === record.fromDeviceId &&
        item.to === record.to &&
        item.toDeviceId === record.toDeviceId &&
        item.messageNumber === record.messageNumber
      );
    });

    if (exists) {
      return;
    }

    messages.push(record);
    fs.writeFileSync(file, JSON.stringify(messages, null, 2), "utf8");
  }

  static list(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ): ChatMessageRecord[] {
    const file = this.getPath(
      localUserId,
      localDeviceId,
      remoteUserId,
      remoteDeviceId
    );

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  static load(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ): ChatMessageRecord[] {
    return this.list(localUserId, localDeviceId, remoteUserId, remoteDeviceId);
  }

  static save(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    messages: ChatMessageRecord[]
  ) {
    if (!fs.existsSync(this.storageDir())) {
      fs.mkdirSync(this.storageDir(), { recursive: true });
    }

    const file = this.getPath(
      localUserId,
      localDeviceId,
      remoteUserId,
      remoteDeviceId
    );

    fs.writeFileSync(file, JSON.stringify(messages, null, 2), "utf8");
  }

  static updateStatus(
    localUserId: string,
    localDeviceId: string,
    peerUserId: string,
    peerDeviceId: string,
    messageNumber: number,
    status: "delivered" | "read",
    timestamp: number
  ) {
    const messages = this.load(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId
    );

    let updated = false;

    for (const item of messages) {
      if (
        item.direction === "out" &&
        item.to === peerUserId &&
        item.toDeviceId === peerDeviceId &&
        item.messageNumber === messageNumber
      ) {
        item.status = status;

        if (status === "delivered") {
          item.deliveredAt = timestamp;
        }

        if (status === "read") {
          item.readAt = timestamp;
        }

        updated = true;
        break;
      }
    }

    if (updated) {
      this.save(localUserId, localDeviceId, peerUserId, peerDeviceId, messages);
    }

    return updated;
  }

  static clear(
    localUserId: string,
    localDeviceId: string,
    peerUserId: string,
    peerDeviceId: string
  ) {
    const file = this.getPath(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId
    );

    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  static clearAllForDevice(localUserId: string, localDeviceId: string) {
    const storageDir = this.storageDir();
    
    if (!fs.existsSync(storageDir)) {
      return;
    }

    const prefix = `messages_${localUserId}_${localDeviceId}__`;

    const files = fs.readdirSync(storageDir);

    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(".json")) {
        fs.unlinkSync(path.join(storageDir, file));
      }
    }
  }

  static deleteByMessageNumber(
    localUserId: string,
    localDeviceId: string,
    peerUserId: string,
    peerDeviceId: string,
    messageNumber: number
  ) {
    const messages = this.load(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId
    );

    const before = messages.length;

    const nextMessages = messages.filter((item: any) => {
      return item.messageNumber !== messageNumber;
    });

    this.save(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId,
      nextMessages
    );

    return before - nextMessages.length;
  }

  static deleteByIndex(
    localUserId: string,
    localDeviceId: string,
    peerUserId: string,
    peerDeviceId: string,
    index: number
  ) {
    const messages = this.load(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId
    );

    const realIndex = index - 1;

    if (realIndex < 0 || realIndex >= messages.length) {
      return null;
    }

    const deleted = messages.splice(realIndex, 1)[0];

    this.save(
      localUserId,
      localDeviceId,
      peerUserId,
      peerDeviceId,
      messages
    );

    return deleted;
  }
}