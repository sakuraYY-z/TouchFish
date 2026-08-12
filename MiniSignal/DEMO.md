# MiniSignal Demo Script

This script is for manual testing and defense demos.

## Start

Open one terminal for the server:

```bash
cd /d D:\GITcangku\TouchFish\MiniSignal
npx tsx local-server/server.ts
```

Open two client terminals:

```bash
cd /d D:\GITcangku\TouchFish\MiniSignal
npx tsx demo-client/client.ts alice desktop bob phone
```

```bash
cd /d D:\GITcangku\TouchFish\MiniSignal
npx tsx demo-client/client.ts bob phone alice desktop
```

## Core Chat Flow

```text
hello bob
/history
/history 5
/history all
/search hello
/export
```

## Conversation Management

```text
/chats
/chats bob
/stats
/chat-info
/pin
/mute
/remark boss
/chats
/unread
/archive
/chats
/archived
/chats-all
/unarchive
/unremark
/unmute
/unpin
```

Expected chat list markers:

```text
- [置顶] [静音] [归档] boss bob/phone
```

## Clear Chat Safely

```text
/clear-chat
/history
/clear-chat confirm
/history
```

Expected behavior:

```text
为了防止误删，请输入：/clear-chat confirm
已清空当前会话聊天记录：bob/phone
```

Only message history is cleared. The session is not deleted, so later messages
can still use the existing session.

## Exit

```text
/exit
```

The client should exit cleanly even if the WebSocket connection is still being
established.

## Automated Checks

```bash
cd /d D:\GITcangku\TouchFish\MiniSignal
npm test
npm run test:client
npx tsc -p tsconfig.json --noEmit
```
