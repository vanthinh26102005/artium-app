const admin = require("firebase-admin");
const {execFileSync} = require("child_process");
const fs = require("fs");
const path = require("path");

const BATCH_LIMIT = 450;
const PAGE_SIZE = 300;

const readFirebaseProjectId = () => {
  const firebaseRcPath = path.resolve(process.cwd(), ".firebaserc");
  if (!fs.existsSync(firebaseRcPath)) return undefined;

  const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, "utf8"));
  return firebaseRc.projects?.default;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    projectId: readFirebaseProjectId(),
    score: 100,
    onlyMissing: true,
    dryRun: false,
    auth: "admin",
  };

  for (const arg of args) {
    if (arg.startsWith("--project=")) {
      options.projectId = arg.slice("--project=".length);
    } else if (arg.startsWith("--score=")) {
      options.score = Number(arg.slice("--score=".length));
    } else if (arg === "--overwrite") {
      options.onlyMissing = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--auth=")) {
      options.auth = arg.slice("--auth=".length);
    }
  }

  if (!options.projectId) {
    throw new Error("Missing Firebase project id. Pass --project=<project-id>.");
  }

  if (!Number.isFinite(options.score) || options.score < 0 || options.score > 100) {
    throw new Error("--score must be a number from 0 to 100.");
  }

  return options;
};

const initializeAdmin = (projectId) => {
  if (admin.apps.length) return;

  const serviceAccountPath = path.resolve(process.cwd(), "serviceAccount.json");
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
};

const backfillUserTrustScore = async () => {
  const options = parseArgs();

  if (options.auth === "gcloud-rest") {
    await backfillUserTrustScoreWithRest(options);
    return;
  }

  initializeAdmin(options.projectId);

  const db = admin.firestore();
  let lastDoc = null;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let pendingWrites = 0;

  const flush = async () => {
    if (pendingWrites === 0) return;
    if (!options.dryRun) {
      await batch.commit();
    }
    batch = db.batch();
    pendingWrites = 0;
  };

  console.log(
    `Backfilling users.trustScore=${options.score} on ${options.projectId} ` +
      `(${options.onlyMissing ? "only missing" : "overwrite enabled"})` +
      `${options.dryRun ? " [dry-run]" : ""}`
  );

  while (true) {
    let query = db
      .collection("users")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      scanned += 1;
      const data = doc.data() || {};
      const hasTrustScore = typeof data.trustScore !== "undefined";

      if (options.onlyMissing && hasTrustScore) {
        skipped += 1;
        continue;
      }

      batch.update(doc.ref, {
        trustScore: options.score,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      pendingWrites += 1;
      updated += 1;

      if (pendingWrites >= BATCH_LIMIT) {
        await flush();
      }
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    console.log(`Scanned ${scanned} users | queued ${updated} updates | skipped ${skipped}`);
  }

  await flush();

  console.log(
    `Done. Scanned ${scanned} users | ${options.dryRun ? "would update" : "updated"} ${updated} | skipped ${skipped}`
  );
};

const getGcloudAccessToken = () => {
  return execFileSync("gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
};

const firestoreFetch = async (url, token, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST request failed ${response.status}: ${body}`);
  }

  return response.json();
};

const commitRestWrites = async (projectId, token, writes) => {
  if (writes.length === 0) return;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  await firestoreFetch(url, token, {
    method: "POST",
    body: JSON.stringify({writes}),
  });
};

const backfillUserTrustScoreWithRest = async (options) => {
  const token = getGcloudAccessToken();
  let pageToken = "";
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let writes = [];

  console.log(
    `Backfilling users.trustScore=${options.score} on ${options.projectId} via gcloud REST ` +
      `(${options.onlyMissing ? "only missing" : "overwrite enabled"})` +
      `${options.dryRun ? " [dry-run]" : ""}`
  );

  while (true) {
    const params = new URLSearchParams({pageSize: String(PAGE_SIZE)});
    if (pageToken) params.set("pageToken", pageToken);

    const url =
      `https://firestore.googleapis.com/v1/projects/${options.projectId}` +
      `/databases/(default)/documents/users?${params.toString()}`;
    const result = await firestoreFetch(url, token);
    const documents = result.documents || [];

    for (const document of documents) {
      scanned += 1;
      const fields = document.fields || {};
      const hasTrustScore = typeof fields.trustScore !== "undefined";

      if (options.onlyMissing && hasTrustScore) {
        skipped += 1;
        continue;
      }

      writes.push({
        update: {
          name: document.name,
          fields: {
            trustScore: {
              integerValue: String(options.score),
            },
          },
        },
        updateMask: {
          fieldPaths: ["trustScore"],
        },
      });
      updated += 1;

      if (writes.length >= BATCH_LIMIT) {
        if (!options.dryRun) {
          await commitRestWrites(options.projectId, token, writes);
        }
        writes = [];
      }
    }

    console.log(`Scanned ${scanned} users | queued ${updated} updates | skipped ${skipped}`);

    pageToken = result.nextPageToken || "";
    if (!pageToken) break;
  }

  if (!options.dryRun) {
    await commitRestWrites(options.projectId, token, writes);
  }

  console.log(
    `Done. Scanned ${scanned} users | ${options.dryRun ? "would update" : "updated"} ${updated} | skipped ${skipped}`
  );
};

backfillUserTrustScore()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
