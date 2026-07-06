import fs from "fs";
import path from "path";
import Database = require("better-sqlite3");

export interface RegisteredDevice {
  userId: string;
  deviceId: string;
  publicKey?: string;
  lastSeen: number;
}

export interface OneTimePreKeyPublic {
  keyId: number;
  publicKey: string;
}

export interface PreKeyBundle {
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeys: OneTimePreKeyPublic[];
}

export interface CipherMessage {
  type: "message";
  from: string;
  fromDeviceId: string;
  target: string;
  targetDeviceId: string;
  ratchetPublicKey?: string | null;
  previousSendCounter?: number;
  messageNumber: number;
  payload: {
    encrypted: string;
    iv: string;
    tag: string;
  };
  timestamp: number;
}

const storageDir = path.join(__dirname, "storage");

if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const dbPath = path.join(storageDir, "minisignal.db");

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS registered_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  public_key TEXT,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS prekey_bundles (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  signed_prekey_id INTEGER NOT NULL,
  signed_prekey TEXT NOT NULL,
  signed_prekey_signature TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, key_id)
);

CREATE TABLE IF NOT EXISTS offline_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  from_device_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  message_number INTEGER NOT NULL,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  ratchet_public_key TEXT,
  previous_send_counter INTEGER NOT NULL DEFAULT 0,
  timestamp INTEGER NOT NULL
);
`);

export function saveRegisteredDevice(device: RegisteredDevice) {
  db.prepare(`
    INSERT INTO registered_devices (
      user_id,
      device_id,
      public_key,
      last_seen
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, device_id)
    DO UPDATE SET
      public_key = excluded.public_key,
      last_seen = excluded.last_seen
  `).run(
    device.userId,
    device.deviceId,
    device.publicKey ?? null,
    device.lastSeen
  );
}

export function getRegisteredDevices(userId: string): RegisteredDevice[] {
  const rows = db.prepare(`
    SELECT
      user_id AS userId,
      device_id AS deviceId,
      public_key AS publicKey,
      last_seen AS lastSeen
    FROM registered_devices
    WHERE user_id = ?
    ORDER BY device_id ASC
  `).all(userId) as RegisteredDevice[];

  return rows;
}

export function saveOrMergePreKeyBundle(
  userId: string,
  deviceId: string,
  bundle: PreKeyBundle
) {
  const old = getPreKeyBundle(userId, deviceId);

  const identityChanged =
    !!old && old.identityKey !== bundle.identityKey;

  const signedPreKeyChanged =
    !!old &&
    (
      old.signedPreKey !== bundle.signedPreKey ||
      Number(old.signedPreKeyId) !== Number(bundle.signedPreKeyId)
    );

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO prekey_bundles (
        user_id,
        device_id,
        identity_key,
        signed_prekey_id,
        signed_prekey,
        signed_prekey_signature
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, device_id)
      DO UPDATE SET
        identity_key = excluded.identity_key,
        signed_prekey_id = excluded.signed_prekey_id,
        signed_prekey = excluded.signed_prekey,
        signed_prekey_signature = excluded.signed_prekey_signature
    `).run(
      userId,
      deviceId,
      bundle.identityKey,
      Number(bundle.signedPreKeyId),
      bundle.signedPreKey,
      bundle.signedPreKeySignature
    );

    if (!old || identityChanged || signedPreKeyChanged) {
      db.prepare(`
        DELETE FROM one_time_prekeys
        WHERE user_id = ? AND device_id = ?
      `).run(userId, deviceId);
    }

    const insertOneTimePreKey = db.prepare(`
      INSERT OR IGNORE INTO one_time_prekeys (
        user_id,
        device_id,
        key_id,
        public_key
      )
      VALUES (?, ?, ?, ?)
    `);

    for (const item of bundle.oneTimePreKeys ?? []) {
      insertOneTimePreKey.run(
        userId,
        deviceId,
        Number(item.keyId),
        item.publicKey
      );
    }
  });

  tx();
}

export function getPreKeyBundle(
  userId: string,
  deviceId: string
): PreKeyBundle | null {
  const row = db.prepare(`
    SELECT
      identity_key AS identityKey,
      signed_prekey_id AS signedPreKeyId,
      signed_prekey AS signedPreKey,
      signed_prekey_signature AS signedPreKeySignature
    FROM prekey_bundles
    WHERE user_id = ? AND device_id = ?
  `).get(userId, deviceId) as any;

  if (!row) {
    return null;
  }

  const oneTimePreKeys = db.prepare(`
    SELECT
      key_id AS keyId,
      public_key AS publicKey
    FROM one_time_prekeys
    WHERE user_id = ? AND device_id = ?
    ORDER BY key_id ASC
  `).all(userId, deviceId) as OneTimePreKeyPublic[];

  return {
    identityKey: row.identityKey,
    signedPreKeyId: Number(row.signedPreKeyId),
    signedPreKey: row.signedPreKey,
    signedPreKeySignature: row.signedPreKeySignature,
    oneTimePreKeys,
  };
}

export function consumeOneTimePreKey(
  userId: string,
  deviceId: string
): OneTimePreKeyPublic | null {
  const tx = db.transaction(() => {
    const row = db.prepare(`
      SELECT
        key_id AS keyId,
        public_key AS publicKey
      FROM one_time_prekeys
      WHERE user_id = ? AND device_id = ?
      ORDER BY key_id ASC
      LIMIT 1
    `).get(userId, deviceId) as OneTimePreKeyPublic | undefined;

    if (!row) {
      return null;
    }

    db.prepare(`
      DELETE FROM one_time_prekeys
      WHERE user_id = ? AND device_id = ? AND key_id = ?
    `).run(userId, deviceId, Number(row.keyId));

    return {
      keyId: Number(row.keyId),
      publicKey: row.publicKey,
    };
  });

  return tx();
}

export function countOneTimePreKeys(
  userId: string,
  deviceId: string
): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM one_time_prekeys
    WHERE user_id = ? AND device_id = ?
  `).get(userId, deviceId) as any;

  return Number(row.count);
}

export function enqueueOfflineMessage(message: CipherMessage) {
  db.prepare(`
    INSERT INTO offline_messages (
      from_user_id,
      from_device_id,
      target_user_id,
      target_device_id,
      message_number,
      encrypted,
      iv,
      tag,
      ratchet_public_key,
      previous_send_counter,
      timestamp
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.from,
    message.fromDeviceId,
    message.target,
    message.targetDeviceId,
    Number(message.messageNumber),
    message.payload.encrypted,
    message.payload.iv,
    message.payload.tag,
    message.ratchetPublicKey ?? null,
    Number(message.previousSendCounter ?? 0),
    Number(message.timestamp ?? Date.now())
  );
}

export function pullOfflineMessages(
  userId: string,
  deviceId: string
): CipherMessage[] {
  const tx = db.transaction(() => {
    const rows = db.prepare(`
      SELECT
        id,
        from_user_id AS fromUserId,
        from_device_id AS fromDeviceId,
        target_user_id AS targetUserId,
        target_device_id AS targetDeviceId,
        message_number AS messageNumber,
        encrypted,
        iv,
        tag,
        ratchet_public_key AS ratchetPublicKey,
        previous_send_counter AS previousSendCounter,
        timestamp
      FROM offline_messages
      WHERE target_user_id = ? AND target_device_id = ?
      ORDER BY id ASC
    `).all(userId, deviceId) as any[];

    const ids = rows.map((row) => Number(row.id));

    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      db.prepare(`
        DELETE FROM offline_messages
        WHERE id IN (${placeholders})
      `).run(...ids);
    }

    return rows.map((row) => ({
      type: "message" as const,
      from: row.fromUserId,
      fromDeviceId: row.fromDeviceId,
      target: row.targetUserId,
      targetDeviceId: row.targetDeviceId,
      messageNumber: Number(row.messageNumber),
      payload: {
        encrypted: row.encrypted,
        iv: row.iv,
        tag: row.tag,
      },
      timestamp: Number(row.timestamp),
      ratchetPublicKey: row.ratchetPublicKey ?? null,
      previousSendCounter: Number(row.previousSendCounter ?? 0),
    }));
  });

  return tx();
}

export function countOfflineMessages(): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM offline_messages
  `).get() as any;

  return Number(row.count);
}