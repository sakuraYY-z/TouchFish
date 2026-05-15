import fs from "fs";
import path from "path";

import {
  PrivateKey
} from "@signalapp/libsignal-client";

export class IdentityManager {

  private identityKey: PrivateKey;

  constructor(userId: string) {

    const storagePath =
      path.join(
        __dirname,
        "..",
        "storage",
        `${userId}.json`
      );

    // 已存在身份
    if (fs.existsSync(storagePath)) {

      const data =
        JSON.parse(
          fs.readFileSync(
            storagePath,
            "utf8"
          )
        );

      this.identityKey =
        PrivateKey.deserialize(
          Buffer.from(
            data.privateKey,
            "base64"
          )
        );

      console.log(
        `${userId} identity loaded`
      );
    }

    // 首次生成身份
    else {

      this.identityKey =
        PrivateKey.generate();

      fs.writeFileSync(
        storagePath,
        JSON.stringify({
          privateKey:
            Buffer
              .from(
                this.identityKey.serialize()
              )
              .toString("base64")
        })
      );

      console.log(
        `${userId} identity created`
      );
    }
  }

  getPrivateKey() {
    return this.identityKey;
  }

  getPublicKey() {
    return this.identityKey.getPublicKey();
  }

  getPublicKeyBase64() {

    return Buffer
      .from(
        this.getPublicKey().serialize()
      )
      .toString("base64");
  }
}