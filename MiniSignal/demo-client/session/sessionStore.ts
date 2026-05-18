import fs from "fs";
import path from "path";
import { MiniSessionState } from "./sessionState";

const SESSION_VERSION = 3;

export class SessionStore {
  static storageDir() {
    return path.join(__dirname, "..", "storage");
  }

  static getPath(
    userId: string,
    deviceId: string,
    targetId: string,
    targetDeviceId: string
  ) {
    return path.join(
      this.storageDir(),
      `session_${userId}_${deviceId}__${targetId}_${targetDeviceId}.json`
    );
  }

  static save(state: MiniSessionState) {
    if (!fs.existsSync(this.storageDir())) {
      fs.mkdirSync(this.storageDir(), { recursive: true });
    }

    fs.writeFileSync(
      this.getPath(
        state.localUserId,
        state.localDeviceId,
        state.remoteUserId,
        state.remoteDeviceId
      ),
      JSON.stringify({ ...state, version: SESSION_VERSION }, null, 2)
    );
  }

  static load(
    userId: string,
    deviceId: string,
    targetId: string,
    targetDeviceId: string
  ): MiniSessionState | null {
    const file = this.getPath(userId, deviceId, targetId, targetDeviceId);

    if (!fs.existsSync(file)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

    if (parsed.version !== SESSION_VERSION) {
      return null;
    }

    return parsed as MiniSessionState;
  }

  static delete(
    userId: string,
    deviceId: string,
    targetId: string,
    targetDeviceId: string
  ) {
    const file = this.getPath(userId, deviceId, targetId, targetDeviceId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}
