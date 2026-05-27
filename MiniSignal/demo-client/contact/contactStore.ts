import fs from "fs";
import path from "path";

export interface ContactRecord {
  userId: string;
  deviceId: string;
  addedAt: number;
}

export class ContactStore {
  private static storageDir() {
    return path.join(__dirname, "..", "storage");
  }

  private static getPath(localUserId: string, localDeviceId: string) {
    return path.join(
      this.storageDir(),
      `contacts_${localUserId}_${localDeviceId}.json`
    );
  }

  static list(localUserId: string, localDeviceId: string): ContactRecord[] {
    const file = this.getPath(localUserId, localDeviceId);

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  }

  static save(
    localUserId: string,
    localDeviceId: string,
    contacts: ContactRecord[]
  ) {
    if (!fs.existsSync(this.storageDir())) {
      fs.mkdirSync(this.storageDir(), { recursive: true });
    }

    fs.writeFileSync(
      this.getPath(localUserId, localDeviceId),
      JSON.stringify(contacts, null, 2),
      "utf8"
    );
  }

  static add(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const contacts = this.list(localUserId, localDeviceId);

    const exists = contacts.some(
      (item) =>
        item.userId === remoteUserId && item.deviceId === remoteDeviceId
    );

    if (!exists) {
      contacts.push({
        userId: remoteUserId,
        deviceId: remoteDeviceId,
        addedAt: Date.now(),
      });

      this.save(localUserId, localDeviceId, contacts);
    }

    return !exists;
  }

  static remove(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const contacts = this.list(localUserId, localDeviceId);

    const nextContacts = contacts.filter(
      (item) =>
        !(item.userId === remoteUserId && item.deviceId === remoteDeviceId)
    );

    this.save(localUserId, localDeviceId, nextContacts);

    return nextContacts.length !== contacts.length;
  }
}