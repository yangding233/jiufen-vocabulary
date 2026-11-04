# Windows local learning contract (2.0.0)

## Product scope

The application is Windows-only and works without runtime network requests. There is no iPhone host, USB transport, pairing, receipt, background phone poll or multi-device merge UI.

The primary flow is today's task → recall/material → grade → local persistence → continue later. Wordbooks, file import, dictionary enrichment and personal notes are supporting library tools. History and external backup/recovery remain available.

## Storage and compatibility

The existing Electron application name and user-data directory remain stable: `%APPDATA%/九分词汇离线学习/offline-v1`. `JIUFEN_DATA_DIR` is reserved for isolated development/test profiles. Tests must never default to a user's daily database.

Current learning state is authoritative. Ordinary feedback must not reconstruct state from an ever-growing cross-device operation log. Saving uses the desktop bridge and an atomic SQLite transaction; the UI must distinguish a committed save from pending work and failures. A failed write must not be reported as saved. Process exit must account for any outstanding write.

The former `jiufen-usb` schema 1/2 document and checksummed packet are accepted only as legacy inputs. Materialize them during migration/recovery, preserve the old archive in an independent backup before replacing its active representation, and preserve the semantic state: vocabulary IDs/order, cards, histories, learning dates, plans, session, notes, personal cues, mastery and wordbook metadata. Do not invent new feedback timestamps or re-enroll existing words as a side effect of conversion.

The new local representation is not a promise of reverse compatibility with pre-2.0 applications. A user who returns to an old executable needs the pre-upgrade backup. No automatic union of independent histories remains in the product.

## Import, enrichment and recovery

File parsing and preview are read-only. Confirmed word imports and dictionary adoption commit as a unit. Existing card/history data survive lexical edits. Missing meanings remain drafts until completed and deliberately enrolled. Dictionary data load lazily and never generate audio or mnemonic content implicitly.

Full backups include current learning state, custom words, books and notes. Export cancellation does not update the confirmed external-backup time. Recovery previews do not replace the active document. A confirmed replacement first preserves the current archive in an independent backup; malformed or invalid inputs leave it intact. Keep existing internal snapshots readable through the compatibility layer.

## Code ownership and resource safety

`web/` is the maintained interface. `shared/` owns reusable data rules, with any browser copies checked for equality. Content-only tools must not edit personal learning state. The Windows preload exposes a narrow allowlist of operations; renderer Node integration remains disabled and runtime network access blocked.

Release checks reject embedded personal progress and mismatched offline resources. Release archives exclude databases, backups, credentials, development environments and models. Third-party license notices ship with the software.

## Validation

Meaningful regression covers old archive conversion, invalid archive rejection, save failure/retry, rapid feedback, close/reopen persistence, mastery undo, personal notes, independent recovery, import and enrichment. Performance measurements must describe the fixture, runtime and measured interaction; they do not establish a universal latency guarantee for all computers.
