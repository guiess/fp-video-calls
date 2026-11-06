import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { setImmediate as flushAsync } from "node:timers/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-location-auth";
const OWNER = "synthetic-owner";
const RECIPIENT = "synthetic-recipient";
const STRANGER = "synthetic-stranger";
const SETTINGS_PATH = `users/${OWNER}/private/userData`;
const LOCATION_COLLECTIONS = ["location", "locationHistory"];
const POINT = { lat: 0, lng: 0, accuracy: 10, timestamp: 1000 };
const LISTENER_TIMEOUT_MS = 10000;
const TEST_OPTIONS = { timeout: 20000 };
let environment;

before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.equal(host, "127.0.0.1:8087", "Only the isolated local emulator is allowed");
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8087,
      rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

after(async () => {
  await environment?.cleanup();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, SETTINGS_PATH), {
      locationSharing: { sharedWith: [RECIPIENT] },
      email: "synthetic@example.invalid",
      fcmToken: "synthetic-not-a-token",
    });
    batch.set(doc(database, `users/${OWNER}`), { displayName: "Synthetic Owner" });
    for (const name of LOCATION_COLLECTIONS) {
      batch.set(doc(database, `users/${OWNER}/${name}/current`), POINT);
      batch.set(doc(database, `users/${OWNER}/${name}/older`), { ...POINT, timestamp: 500 });
    }
    await batch.commit();
  });
});

function databaseFor(uid) {
  return uid === null
    ? environment.unauthenticatedContext().firestore()
    : environment.authenticatedContext(uid).firestore();
}

function locationReference(database, name) {
  return doc(database, `users/${OWNER}/${name}/current`);
}

function locationQuery(database, name) {
  return query(collection(database, `users/${OWNER}/${name}`), orderBy("timestamp", "desc"), limit(50));
}

async function replaceSettings(settings) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const reference = doc(context.firestore(), SETTINGS_PATH);
    await (settings === undefined ? deleteDoc(reference) : setDoc(reference, settings));
  });
}

function listenFromServer(reference) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(reject, new assert.AssertionError({
      message: "Timed out waiting for a server-authorized location snapshot",
    })), LISTENER_TIMEOUT_MS);
    const unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.metadata.fromCache) finish(resolve, snapshot);
    }, (error) => finish(reject, error));
    function finish(callback, result) {
      clearTimeout(timeout);
      unsubscribe();
      callback(result);
    }
  });
}

async function assertListenerRejectsNextUpdate(
  reference,
  ownerReference,
  actions = { subscribe: onSnapshot, update: updateDoc },
) {
  let unsubscribe;
  let serverSnapshots = 0;
  let pendingMutations = Promise.resolve();
  const timeout = setTimeout(() => rejectRevocation(new assert.AssertionError({
    message: "Active listener did not reject a location update after recipient removal",
  })), LISTENER_TIMEOUT_MS);
  let rejectRevocation;
  const revoked = new Promise((resolve, reject) => {
    rejectRevocation = reject;
    unsubscribe = actions.subscribe(reference, { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.metadata.fromCache) {
        if (++serverSnapshots > 1) {
          reject(new assert.AssertionError({ message: "Revoked listener received new location data" }));
          return;
        }
        pendingMutations = actions.update(doc(databaseFor(OWNER), SETTINGS_PATH), {
          "locationSharing.sharedWith": [],
        }).then(() => actions.update(ownerReference, { accuracy: 30 }));
        pendingMutations.catch(reject);
      }
    }, resolve);
  });
  try {
    assert.equal((await revoked).code, "permission-denied");
    assert.equal(serverSnapshots, 1, "Listener must be authorized before recipient removal");
  } finally {
    clearTimeout(timeout);
    unsubscribe();
    await pendingMutations;
  }
}

for (const name of LOCATION_COLLECTIONS) {
  test(`${name}: signed-out and unselected users cannot read, query, or listen`, TEST_OPTIONS, async () => {
    for (const uid of [null, STRANGER]) {
      const database = databaseFor(uid);
      await assertFails(getDocFromServer(locationReference(database, name)));
      await assertFails(getDocsFromServer(locationQuery(database, name)));
      await assertFails(listenFromServer(locationReference(database, name)));
    }
  });

  test(`${name}: owner and selected recipient can read, query, and listen`, TEST_OPTIONS, async () => {
    for (const uid of [OWNER, RECIPIENT]) {
      const database = databaseFor(uid);
      assert.deepEqual((await assertSucceeds(getDocFromServer(locationReference(database, name)))).data(), POINT);
      const result = await assertSucceeds(getDocsFromServer(locationQuery(database, name)));
      assert.deepEqual(result.docs.map((entry) => entry.id), ["current", "older"]);
      assert.equal((await assertSucceeds(listenFromServer(locationReference(database, name)))).exists(), true);
      assert.equal((await assertSucceeds(listenFromServer(locationQuery(database, name)))).size, 2);
    }
  });

  test(`${name}: only owner can create, update, and delete`, TEST_OPTIONS, async () => {
    for (const uid of [null, STRANGER, RECIPIENT, OWNER]) {
      const database = databaseFor(uid);
      const verify = uid === OWNER ? assertSucceeds : assertFails;
      await verify(setDoc(doc(database, `users/${OWNER}/${name}/new`), POINT));
      await verify(updateDoc(locationReference(database, name), { accuracy: 20 }));
      await verify(deleteDoc(locationReference(database, name)));
    }
  });

  test(`${name}: owner history-cleanup query remains authorized`, TEST_OPTIONS, async () => {
    const database = databaseFor(OWNER);
    const result = await assertSucceeds(getDocsFromServer(query(
      collection(database, `users/${OWNER}/${name}`),
      where("timestamp", "<", POINT.timestamp),
      limit(50),
    )));
    assert.deepEqual(result.docs.map((entry) => entry.id), ["older"]);
  });

  test(`${name}: collection-group queries cannot bypass owner-scoped authorization`, TEST_OPTIONS, async () => {
    await assertFails(getDocsFromServer(collectionGroup(databaseFor(RECIPIENT), name)));
  });

  test(`${name}: removing and re-adding a recipient changes subsequent server access`, TEST_OPTIONS, async () => {
    const database = databaseFor(RECIPIENT);
    const reference = locationReference(database, name);
    await assertSucceeds(getDocFromServer(reference));
    await updateDoc(doc(databaseFor(OWNER), SETTINGS_PATH), { "locationSharing.sharedWith": [] });
    await assertFails(getDocFromServer(reference));
    await assertFails(getDocsFromServer(locationQuery(database, name)));
    await assertFails(listenFromServer(reference));
    await updateDoc(doc(databaseFor(OWNER), SETTINGS_PATH), { "locationSharing.sharedWith": [RECIPIENT] });
    await assertSucceeds(getDocFromServer(reference));
    await assertSucceeds(getDocsFromServer(locationQuery(database, name)));
    await assertSucceeds(listenFromServer(reference));
  });

  test(`${name}: active listener cannot receive new data after recipient removal`, TEST_OPTIONS, async () => {
    await assertListenerRejectsNextUpdate(
      locationReference(databaseFor(RECIPIENT), name),
      locationReference(databaseFor(OWNER), name),
    );
  });

  test(`${name}: active ordered-query listener cannot receive new data after removal`, TEST_OPTIONS, async () => {
    await assertListenerRejectsNextUpdate(
      locationQuery(databaseFor(RECIPIENT), name),
      locationReference(databaseFor(OWNER), name),
    );
  });
}

const INVALID_SETTINGS = [
  ["missing private document", undefined],
  ["missing sharing settings", {}],
  ["null sharing settings", { locationSharing: null }],
  ["boolean sharing settings", { locationSharing: false }],
  ["string sharing settings", { locationSharing: RECIPIENT }],
  ["array sharing settings", { locationSharing: [RECIPIENT] }],
  ["empty sharing map", { locationSharing: {} }],
  ["null recipients", { locationSharing: { sharedWith: null } }],
  ["empty recipient list", { locationSharing: { sharedWith: [] } }],
  ["string instead of list", { locationSharing: { sharedWith: RECIPIENT } }],
  ["map instead of list", { locationSharing: { sharedWith: { [RECIPIENT]: true } } }],
  ["boolean instead of list", { locationSharing: { sharedWith: true } }],
  ["number instead of list", { locationSharing: { sharedWith: 1 } }],
  ["non-string list entries", { locationSharing: { sharedWith: [null, 1, true, {}] } }],
  ["different recipient", { locationSharing: { sharedWith: [STRANGER] } }],
];

for (const [description, settings] of INVALID_SETTINGS) {
  test(`fail closed for ${description}; owner retains reads and writes`, TEST_OPTIONS, async () => {
    await replaceSettings(settings);
    for (const name of LOCATION_COLLECTIONS) {
      await assertFails(getDocFromServer(locationReference(databaseFor(RECIPIENT), name)));
      await assertFails(getDocsFromServer(locationQuery(databaseFor(RECIPIENT), name)));
      const owner = databaseFor(OWNER);
      await assertSucceeds(getDocFromServer(locationReference(owner, name)));
      await assertSucceeds(getDocsFromServer(locationQuery(owner, name)));
      await assertSucceeds(updateDoc(locationReference(owner, name), { accuracy: 30 }));
      await assertSucceeds(deleteDoc(locationReference(owner, name)));
    }
  });
}

test("public profile settings cannot grant location access", TEST_OPTIONS, async () => {
  await replaceSettings(undefined);
  await setDoc(doc(databaseFor(OWNER), `users/${OWNER}`), {
    locationSharing: { sharedWith: [RECIPIENT] },
  });
  for (const name of LOCATION_COLLECTIONS) {
    await assertFails(getDocFromServer(locationReference(databaseFor(RECIPIENT), name)));
  }
});

test("private settings remain owner-only, including recipient reads and self-grants", TEST_OPTIONS, async () => {
  for (const uid of [null, RECIPIENT, STRANGER]) {
    const database = databaseFor(uid);
    const reference = doc(database, SETTINGS_PATH);
    await assertFails(getDocFromServer(reference));
    await assertFails(getDocsFromServer(collection(database, `users/${OWNER}/private`)));
    await assertFails(setDoc(reference, { locationSharing: { sharedWith: [uid] } }));
    await assertFails(updateDoc(reference, { "locationSharing.sharedWith": [uid] }));
    await assertFails(deleteDoc(reference));
  }
  await assertSucceeds(getDocFromServer(doc(databaseFor(OWNER), SETTINGS_PATH)));
});

test("tracking toggle is not a remote access condition for retained locations", TEST_OPTIONS, async () => {
  await replaceSettings({ locationSharing: { sharedWith: [RECIPIENT] } });
  for (const name of LOCATION_COLLECTIONS) {
    await assertSucceeds(getDocFromServer(locationReference(databaseFor(RECIPIENT), name)));
  }
});

test("sharing one owner's location does not grant another owner's data", TEST_OPTIONS, async () => {
  const otherOwner = "synthetic-other-owner";
  await environment.withSecurityRulesDisabled(async (context) => {
    for (const name of LOCATION_COLLECTIONS) {
      await setDoc(doc(context.firestore(), `users/${otherOwner}/${name}/current`), POINT);
    }
  });
  for (const name of LOCATION_COLLECTIONS) {
    await assertFails(getDocFromServer(doc(databaseFor(RECIPIENT), `users/${otherOwner}/${name}/current`)));
  }
});

function createListenerProbe() {
  const mutations = [];
  const callbacks = {};
  const actions = {
    subscribe(reference, options, next, error) {
      Object.assign(callbacks, { next, error });
      return () => { callbacks.isUnsubscribed = true; };
    },
    update() {
      const mutation = Promise.withResolvers();
      mutations.push(mutation);
      return mutation.promise;
    },
  };
  return { actions, callbacks, mutations };
}

for (const code of ["permission-denied", "unavailable"]) {
  test(`listener helper settles writes before returning after ${code}`, TEST_OPTIONS, async () => {
    const probe = createListenerProbe();
    let hasCompleted = false;
    const completion = assertListenerRejectsNextUpdate(null, null, probe.actions)
      .then(() => null, (error) => error)
      .finally(() => { hasCompleted = true; });
    probe.callbacks.next({ metadata: { fromCache: false } });
    probe.callbacks.error({ code });
    await flushAsync();
    const completedBeforeRemoval = hasCompleted;
    probe.mutations[0].resolve();
    await flushAsync();
    const completedBeforeUpdate = hasCompleted;
    assert.equal(probe.mutations.length, 2);
    probe.mutations[1].resolve();
    const error = await completion;
    assert.equal(completedBeforeRemoval, false);
    assert.equal(completedBeforeUpdate, false);
    assert.equal(error === null, code === "permission-denied");
    assert.equal(probe.callbacks.isUnsubscribed, true);
  });
}

test("listener helper reports a failed owner update after an early permission denial", TEST_OPTIONS, async () => {
  const probe = createListenerProbe();
  const expectedError = new TypeError("Synthetic owner location update failed");
  const completion = assertListenerRejectsNextUpdate(null, null, probe.actions)
    .then(() => null, (error) => error);
  probe.callbacks.next({ metadata: { fromCache: false } });
  probe.callbacks.error({ code: "permission-denied" });
  probe.mutations[0].resolve();
  await flushAsync();
  assert.equal(probe.mutations.length, 2);
  probe.mutations[1].reject(expectedError);
  assert.equal(await completion, expectedError);
  assert.equal(probe.callbacks.isUnsubscribed, true);
});
