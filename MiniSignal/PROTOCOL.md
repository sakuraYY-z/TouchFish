# MiniSignal Protocol Design

本文档说明 MiniSignal 当前阶段实现的端到端加密协议流程。项目参考 Signal 协议的核心思想，实现了 X3DH 会话建立、DH Ratchet、Chain Ratchet、Skipped Message Keys、Replay Protection 和端到端加密消息传输。

## 1. 总体设计目标

MiniSignal 的目标是在本地开发环境中实现一个简化版 Signal 风格通信系统，使两个用户之间能够安全地建立会话并传输加密消息。

系统需要满足以下目标：

1. 服务端只负责转发消息，不能看到明文。
2. 双方第一次通信时可以自动建立共享密钥。
3. 每条消息使用不同的 messageKey 加密。
4. 即使某个 messageKey 泄露，也不影响其他消息。
5. 支持 DH Ratchet，使会话密钥可以随着通信过程持续更新。
6. 支持乱序消息解密。
7. 支持防重放，避免旧消息被重复发送造成安全问题。

## 2. 参与角色

系统中主要有三个角色：

```text
Alice 客户端
Bob 客户端
Local Server 本地服务端
服务端只做消息转发，不参与密钥协商，也不保存明文。

Alice  <---- encrypted message ---->  Server  <---- encrypted message ---->  Bob

服务端看到的内容包括：

发送者
接收者
设备名
密文 ciphertext
IV
tag
ratchet 公钥
消息编号

服务端看不到：

明文内容
messageKey
chainKey
rootKey
用户私钥
3. X3DH 会话建立

X3DH 用于双方第一次通信时建立初始共享密钥。

在 MiniSignal 中，用户会生成以下密钥：

identity key
signed prekey
one-time prekey
ephemeral key
ratchet key

Alice 第一次给 Bob 发消息时，会从服务端获取 Bob 的 prekey bundle，然后执行多次 DH 计算。

简化流程如下：

Alice identity private key      + Bob signed prekey public key
Alice ephemeral private key     + Bob identity public key
Alice ephemeral private key     + Bob signed prekey public key
Alice ephemeral private key     + Bob one-time prekey public key

这些 DH 结果会合并后通过 KDF 派生出初始 rootKey。

DH outputs -> KDF -> rootKey

Bob 收到 Alice 的第一条消息后，也使用自己的私钥和 Alice 发送过来的公钥计算相同的 DH 结果，从而得到相同的 rootKey。

因此，Alice 和 Bob 不需要通过网络直接传输 rootKey，也可以得到一致的会话密钥。

4. rootKey 的作用

rootKey 是当前会话的根密钥。

它不直接用于加密消息，而是用于继续派生新的密钥材料。

在 MiniSignal 中，rootKey 主要用于：

建立发送链 chainKey
建立接收链 chainKey
在 DH Ratchet 发生时更新自身

设计原因：

rootKey 如果直接加密消息，一旦泄露会影响整个会话。
使用 rootKey 派生 chainKey，可以让每条消息使用不同密钥。
DH Ratchet 更新 rootKey 后，可以提供更强的前向安全性。
5. DH Ratchet

DH Ratchet 用于在通信过程中更新 rootKey。

当一方发现对方消息中携带的 ratchet 公钥发生变化时，说明对方已经进入了新的 DH Ratchet 阶段。

此时本地执行 DH 计算：

local ratchet private key + remote ratchet public key -> DH output

然后将 DH output 和旧 rootKey 输入 KDF，得到新的 rootKey 和新的 chainKey。

old rootKey + DH output -> KDF -> new rootKey + new chainKey

在 MiniSignal 中，DH Ratchet 的作用是：

更新 rootKey
重置接收链
生成新的本地 ratchet key
准备新的发送链

这样可以保证会话密钥不会长期停留在同一个状态。

6. Chain Ratchet

Chain Ratchet 用于为每条消息派生不同的 messageKey。

每个方向都有自己的 chainKey：

Alice sending chainKey
Bob receiving chainKey

Bob sending chainKey
Alice receiving chainKey

每发送或接收一条消息，chainKey 都会向前推进一次。

简化流程如下：

chainKey -> KDF -> messageKey
chainKey -> KDF -> next chainKey

也就是：

当前 chainKey
   |
   |-- 派生 messageKey，用于当前消息加密或解密
   |
   |-- 派生 next chainKey，用于下一条消息

这样设计的好处是：

每条消息都有独立的 messageKey。
旧 messageKey 不会重复使用。
即使当前 messageKey 泄露，也无法推出之前的 messageKey。
chainKey 不断前进，保证密钥持续变化。
7. Message Key 加密消息

真正用于 AES-GCM 加密消息的是 messageKey。

每条消息发送时会生成：

ciphertext
iv
tag

发送内容大致如下：

{
  "type": "message",
  "from": "alice",
  "to": "bob",
  "ciphertext": "...",
  "iv": "...",
  "tag": "...",
  "ratchetPublicKey": "...",
  "messageNumber": 0
}

Bob 收到后，会使用对应的 receiving chainKey 派生出相同的 messageKey，然后解密消息。

8. Skipped Message Keys

网络通信中，消息可能乱序到达。

例如 Alice 连续发送：

message 0
message 1
message 2

但 Bob 可能先收到：

message 2

如果 Bob 只按顺序解密，就会因为缺少 message 0 和 message 1 而失败。

因此 MiniSignal 实现了 Skipped Message Keys。

当 Bob 收到 message 2 时，会先根据当前 chainKey 推进到 message 2：

message 0 key -> 暂存
message 1 key -> 暂存
message 2 key -> 用于解密当前消息

暂存的 key 会保存到 skippedMessageKeys 中。

之后如果 message 0 或 message 1 再到达，Bob 可以直接从 skippedMessageKeys 中取出对应 messageKey 解密。

9. Replay Protection

Replay Protection 用于防止旧消息被重复发送。

如果攻击者截获了一条旧密文，并重新发送给 Bob，Bob 不应该重复处理这条消息。

MiniSignal 使用已处理消息编号来防重放。

每条消息都有 messageNumber。

客户端维护 processedMessageIds 或类似结构，用于记录已经成功处理过的消息。

当收到消息时，会先检查：

这个 messageNumber 是否已经处理过？

如果已经处理过，则拒绝处理。

流程如下：

收到消息
   |
   |-- 检查 messageNumber 是否已处理
          |
          |-- 是：拒绝，判定为 replay
          |
          |-- 否：继续解密

这样可以避免攻击者重复发送旧消息导致重复显示、重复执行或破坏会话状态。

10. 服务端为什么看不到明文

MiniSignal 的服务端只负责转发消息。

消息在客户端发送前已经被 messageKey 加密。

服务端收到的是：

ciphertext
iv
tag
metadata

服务端没有以下内容：

identity private key
ratchet private key
rootKey
chainKey
messageKey

因此服务端无法解密 ciphertext。

即使服务端被监听或控制，攻击者也只能看到密文和部分通信元数据，不能直接看到用户消息内容。

11. 消息历史

MiniSignal 的消息历史保存在客户端本地。

服务端不保存明文历史。

设计原因：

符合端到端加密思想。
服务端不应该拥有用户明文。
用户自己的客户端可以保存已解密后的聊天记录。
后续可以扩展为本地文件、数据库或加密存储。
12. 当前实现的安全特性

当前 MiniSignal 已实现：

初始密钥协商
rootKey 派生
DH Ratchet
Chain Ratchet
每条消息独立 messageKey
AES-GCM 加密
乱序消息处理
防重放
服务端不可见明文
客户端本地消息历史
13. 当前限制

当前版本仍然是教学和演示性质的本地原型，存在以下限制：

没有完整用户认证系统。
没有真实数据库。
没有正式的多设备密钥同步机制。
没有群聊 Sender Key。
没有离线消息持久化。
没有生产级安全审计。
没有完整的异常恢复机制。
没有密钥备份和迁移机制。