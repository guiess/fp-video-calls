import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, getMetadata, listAll, ref, updateMetadata, uploadBytes } from "firebase/storage";

const PROJECT_ID = "demo-attachment-denial";
const PATHS = ["chat/conversation/message/file.txt", "chat/conversation/other.txt", "other/file.txt"];
let environment;

before(async () => {
  assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9198", "Only the isolated local emulator is allowed");
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      host: "127.0.0.1", port: 9198,
      rules: await readFile(new URL("../../storage.rules", import.meta.url), "utf8"),
    },
  });
  await environment.withSecurityRulesDisabled(async context => {
    for (const name of PATHS) await uploadBytes(ref(context.storage(), name), new Uint8Array([1, 2, 3]));
  });
});

after(async () => { await environment?.cleanup(); });

for (const uid of [null, "synthetic-owner", "synthetic-stranger"]) {
  for (const name of PATHS) {
    test(`${uid ?? "unauthenticated"} cannot get/list/create/update/delete ${name}`, async () => {
      const context = uid === null ? environment.unauthenticatedContext() : environment.authenticatedContext(uid);
      const storage = context.storage();
      const existing = ref(storage, name);
      await assertFails(getBytes(existing));
      await assertFails(getMetadata(existing));
      await assertFails(listAll(ref(storage, name.slice(0, name.lastIndexOf("/")))));
      await assertFails(uploadBytes(ref(storage, `${name}.new`), new Uint8Array([1])));
      await assertFails(uploadBytes(existing, new Uint8Array([2])));
      await assertFails(updateMetadata(existing, { contentType: "text/plain" }));
      await assertFails(deleteObject(existing));
    });
  }
  test(`${uid ?? "unauthenticated"} is denied independent of payload size`, async () => {
    const context = uid === null ? environment.unauthenticatedContext() : environment.authenticatedContext(uid);
    for (const size of [0, 1, 20 * 1024 * 1024, 20 * 1024 * 1024 + 1]) {
      await assertFails(uploadBytes(ref(context.storage(), `chat/conversation/message/size-${size}`), new Uint8Array(size)));
    }
  });
}
