# Offline USB vocabulary contract (v1)

## Wordbooks extension (1.2.0 / clientProtocol 3)

Legacy documents retain schema 1. The first deliberate wordbook edit promotes the document to schema 2 while retaining profileId, deviceId, the original baseline JSON/hash and all existing operations. Optional materialized `state.library` contains books, memberships, import batches and field overrides. `library-set` writes are recorded per entity/field and use the existing causal conflict mechanism. Membership nulls are tombstones. Imported same-spelling entries may coexist with independent IDs/history; merging those learning histories is not automatic.

New clients exchange protocol 3. Both native hosts accept document schema 1 or 2; production USB checks protocol support before changing learning/content data. Resource/audio transfer is not part of this extension. File parsing is offline and previews are read-only; a confirmed import is persisted in a single SQLite transaction. Draft entries without meanings cannot be enrolled by the import UI. Original built-in lexical fields remain in the baseline; user content overrides are applied to the rendered state after catalogue refresh.

No cloud storage, telemetry or runtime internet. Existing vocabulary ID/schema remain.

## Shared JS sync engine
`shared/sync-core.js` is UMD, exposed as `OfflineSync` in WKWebView and require() in Node.

- `createDocument(state, deviceId)` returns `{format:'jiufen-usb',schema:1,profileId,deviceId,baseline,operations, ...}`. baseline is a deep copy of existing plain learning state (schema2).
- `record(document, beforeState, afterState)` returns a NEW document, never mutates input. Called by the existing app's persist hook. Detect new feedback, removed feedback as undo, mastery/restore, personal-field/settings edits and newly added words. Keep local session; merge must rebuild/filter stale tails.
- `materialize(document)` returns existing plain schema2 learning state, valid for current app, preserving unchanged baseline. Learning day Asia/Shanghai.
- `mergeDocuments(local, incoming)` returns a NEW document, preserves local deviceId. Reject unrelated profile unless explicit bootstrap. Idempotent operation union, causal/Lamport ordering, field-level conflicts; undo references operation/event IDs, mastery protected from old feedback. Expose conflicts on document, not silent text loss.
- `encodePacket(document, batchId)` -> JSON text with checksum (integrity, not authentication).
- `decodePacket(text)` -> validated `{document,batchId}`. Bound input, schema, IDs/prototype keys, checksums.
- `summary(document)` -> UI-friendly stats.
- `resolveConflict(document, conflictId, value)` if supported, explicit resolution op.

Persisted doc is one JSON string in native SQLite key `document`. Host validates max 50MB + format/schema, application validates full state and sync engine invariants. Every write transactional; backup previous value before replacing.

## Web -> native host
Browser adapter `web/native-adapter.js` exposes synchronous `window.VocabNative.call(method,payload)`.
Windows: `window.vocabHost.call` via Electron preload sendSync.
iOS: `prompt('__JIUFEN_NATIVE__'+JSON.stringify({method,payload}), '')`; WKUIDelegate handles only the app's bundled file frame, returns JSON `{ok:true,value:...}` or `{ok:false,error:...}` without showing prompt.

Methods:
- `load` -> document object or null
- `save` payload=document -> true (only after SQLite COMMIT)
- `export` payload={name,content,type} -> true (Save dialog/share sheet)
- `syncStatus` -> object `{platform,connected?,message}`
- `prepareSync` payload=document -> true; saves and exports packet `Documents/Exchange/outgoing.json` on iOS (frozen sync session)
- `finishSync` -> true; release iOS sync lock
- `probeUsb` -> desktop device list or diagnostic result
- `syncUsb` payload={bootstrap:boolean} -> desktop result; runs asynchronous natively, returns `{started:true}`; deliver progress through `window.dispatchEvent(new CustomEvent('vocab-sync-status',{detail:...}))`.
- `readIncoming` -> iOS packet string or null
- `ackIncoming` payload={batchId} -> true; native ack only after materialized document saved

## USB protocol
Fixed app bundle ID `com.jiufen.vocabulary` (re-signing may change it: Windows UI accepts actual installed bundle ID). File Sharing Documents root contains Exchange only; database lives in Application Support, private.

1 iOS prepareSync -> snapshot packet outgoing.json, writes atomic, locks grading until finish.
2 desktop reads outgoing, validates, merges; unpaired first phone adoption requires explicit `bootstrap` confirmation, never overwrites existing phone progress silently.
3 desktop commits merged local doc and auto-backup, writes incoming.json.tmp then renames incoming.json.
4 iOS polls while sync screen visible; JS decode/merge/materialize/validate, native save COMMIT, ackIncoming writes ack.json with batchId.
5 desktop polls matching ack before reporting complete. Timeout retains pending batch and retries idempotently. No direct copying database files.

Project areas: agent ios owns apps/ios and .github/workflows/build-ios.yml. Agent desktop owns apps/windows and tools/usb_transport.py. Core agent owns shared and core tests. Root owns web integration, release docs and end-to-end tests.
