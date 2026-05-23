import crypto from "crypto";

import {
  PrivateKey,
  PublicKey
} from "@signalapp/libsignal-client";

import {
  SessionManager
} from "./session";

export class X3DHManager {
  static initiator(
    identityPrivate: PrivateKey,
    remoteIdentityPublic: PublicKey,
    remoteSignedPreKeyPublic: PublicKey,
    remoteOneTimePreKeyPublic: PublicKey | null
  ) {
    const ephemeralPrivate = PrivateKey.generate();

    const dh1 = SessionManager.createSharedSecret(
      identityPrivate,
      remoteSignedPreKeyPublic
    );

    const dh2 = SessionManager.createSharedSecret(
      ephemeralPrivate,
      remoteIdentityPublic
    );

    const dh3 = SessionManager.createSharedSecret(
      ephemeralPrivate,
      remoteSignedPreKeyPublic
    );

    const dhParts: Buffer[] = [
      Buffer.from(dh1),
      Buffer.from(dh2),
      Buffer.from(dh3),
    ];

    if (remoteOneTimePreKeyPublic) {
      const dh4 = SessionManager.createSharedSecret(
        ephemeralPrivate,
        remoteOneTimePreKeyPublic
      );

      dhParts.push(Buffer.from(dh4));
    }

    const sharedSecret = Buffer.concat(dhParts);

    const rootKey = crypto
      .createHash("sha256")
      .update(sharedSecret)
      .digest();

    return {
      rootKey: rootKey.toString("base64"),
      ephemeralPublic: Buffer.from(
        ephemeralPrivate.getPublicKey().serialize()
      ).toString("base64"),
    };
  }

  static responder(
    identityPrivate: PrivateKey,
    signedPreKeyPrivate: PrivateKey,
    oneTimePreKeyPrivate: PrivateKey | null,
    remoteEphemeralPublic: PublicKey,
    remoteIdentityPublic: PublicKey
  ) {
    const dh1 = SessionManager.createSharedSecret(
      signedPreKeyPrivate,
      remoteIdentityPublic
    );

    const dh2 = SessionManager.createSharedSecret(
      identityPrivate,
      remoteEphemeralPublic
    );

    const dh3 = SessionManager.createSharedSecret(
      signedPreKeyPrivate,
      remoteEphemeralPublic
    );

    const dhParts: Buffer[] = [
      Buffer.from(dh1),
      Buffer.from(dh2),
      Buffer.from(dh3),
    ];

    if (oneTimePreKeyPrivate) {
      const dh4 = SessionManager.createSharedSecret(
        oneTimePreKeyPrivate,
        remoteEphemeralPublic
      );

      dhParts.push(Buffer.from(dh4));
    }

    const sharedSecret = Buffer.concat(dhParts);

    const rootKey = crypto
      .createHash("sha256")
      .update(sharedSecret)
      .digest();

    return rootKey.toString("base64");
  }
}