import fs from "fs";
import path from "path";
import { PrivateKey } from "@signalapp/libsignal-client";

export class IdentityManager {
  private identityKey: PrivateKey;

  constructor(userId: string, deviceId: string) {
    const dir = path.join(__dirname, "..", "storage");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const storagePath = path.join(dir, `${userId}_${deviceId}_identity.json`);

    if (fs.existsSync(storagePath)) {
      const data = JSON.parse(fs.readFileSync(storagePath, "utf8"));
      this.identityKey = PrivateKey.deserialize(Buffer.from(data.privateKey, "base64"));
      console.log(`${userId}/${deviceId} identity loaded`);
      return;
    }

    this.identityKey = PrivateKey.generate();

    fs.writeFileSync(
      storagePath,
      JSON.stringify(
        {
          privateKey: Buffer.from(this.identityKey.serialize()).toString("base64"),
        },
        null,
        2
      )
    );

    console.log(`${userId}/${deviceId} identity created`);
  }

  getPrivateKey() {
    return this.identityKey;
  }

  getPublicKey() {
    return this.identityKey.getPublicKey();
  }

  getPublicKeyBase64() {
    return Buffer.from(this.getPublicKey().serialize()).toString("base64");
  }
}
