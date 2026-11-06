# M² Calls asset provenance

This directory contains editable architecture source, a reviewed render, safe
capture fixtures, public screenshots, and machine-readable provenance.

## Architecture diagram

- Editable source:
  [architecture/system-overview.mmd](architecture/system-overview.mmd)
- Rendered asset:
  [architecture/system-overview.svg](architecture/system-overview.svg)
- Meaning: see the complete text equivalent in
  [ARCHITECTURE.md](../../ARCHITECTURE.md)
- Source baseline:
  `482a83a83db50d75792610fc009f0fb87d24971d`
- Review date: 2026-11-06
- Rendering rule: diagram meaning cannot depend on color, and no secret values
  may appear.

## Screenshot fixture

[fixtures/owner-prepared-v3.json](fixtures/owner-prepared-v3.json) records the
owner-prepared, owner-approved capture package dated 2026-11-06. Visible
red/yellow privacy masks are intentional and preserved. The record does not
claim that every visible identity is synthetic.

## Screenshot provenance

[screenshots/provenance.json](screenshots/provenance.json) is the authoritative
record for every public PNG. Each entry binds a filename to:

- canonical or historical product identity;
- live URL/revision status or installed APK digest;
- platform and capture environment;
- date, operator, fixture version, and scenario;
- dimensions, byte size, and SHA-256;
- crop/mask/annotation history;
- owner mask review, PNG metadata, and human review status;
- caption, alt text, and evidence limitation.

The capture set contains six app-content-only images from the live M² Calls web
experience and five Android images from the installed historical
`mobile-v1.0` debug APK. The web deployment revision is unknown. Historical
Android images are not represented as current-main output.

The web set covers guest entry, guest room creation/join, a guest group call,
logged-in chats, logged-in rooms, and logged-in calls. The Android set covers
chats, a conversation, contacts, rooms, and a group call.

## Review procedure

1. Use only the owner-prepared, owner-approved capture package.
2. Capture the actual application UI; generated mockups are not runtime
   evidence.
3. Keep the raw capture outside the repository.
4. Preserve the supplied pixels and visible red/yellow masks.
5. Do not resize, recolor, crop, or change privacy masks.
6. Remove EXIF, XMP, IPTC, PNG text chunks, thumbnails, and editor history.
7. Recompute dimensions, size, and SHA-256.
8. Compare every PNG with its caption, alt text, and evidence limitation.
9. Run `node --test scripts/tests/portfolio-docs.test.mjs`.

No prohibited PNG metadata was present, so the supplied PNG bytes were copied
unchanged. Human visual review and local structure/metadata validation are
recorded as complete.

UI captures demonstrate visible surfaces only. They do not prove successful
cross-platform calling, authenticated access, TURN relay selection, backend
health, or current-source compatibility unless a separate test record says so.
The guest and Android group-call images show participant presence but do not
establish production readiness, reliability, or capacity.
