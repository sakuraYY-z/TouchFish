import fs from "fs";
import path from "path";

export class TrustedIdentityStore {
  private static storageDir() {
    return path.join(__dirname, "..", "storage");
  }

  private static getPath(localUserId: string, localDeviceId: string) {
    return path.join(
      this.storageDir(),
      `trusted_identities_${localUserId}_${localDeviceId}.json`
    );
  }

  static load(localUserId: string, localDeviceId: string): Record<string, string> {
    const file = this.getPath(localUserId, localDeviceId);

    if (!fs.existsSync(file)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  static save(
    localUserId: string,
    localDeviceId: string,
    trusted: Record<string, string>
  ) {
    if (!fs.existsSync(this.storageDir())) {
      fs.mkdirSync(this.storageDir(), { recursive: true });
    }

    fs.writeFileSync(
      this.getPath(localUserId, localDeviceId),
      JSON.stringify(trusted, null, 2),
      "utf8"
    );
  }

  static checkAndTrust(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string,
    remoteIdentityKey: string
  ) {
    const trusted = this.load(localUserId, localDeviceId);
    const key = `${remoteUserId}:${remoteDeviceId}`;

    const oldIdentity = trusted[key];

    if (!oldIdentity) {
      trusted[key] = remoteIdentityKey;
      this.save(localUserId, localDeviceId, trusted);

      return {
        ok: true,
        firstTrust: true,
        changed: false,
      };
    }

    if (oldIdentity !== remoteIdentityKey) {
      return {
        ok: false,
        firstTrust: false,
        changed: true,
      };
    }

    return {
      ok: true,
      firstTrust: false,
      changed: false,
    };
  }

  static forget(
    localUserId: string,
    localDeviceId: string,
    remoteUserId: string,
    remoteDeviceId: string
  ) {
    const trusted = this.load(localUserId, localDeviceId);
    const key = `${remoteUserId}:${remoteDeviceId}`;

    delete trusted[key];

    this.save(localUserId, localDeviceId, trusted);
  }
}