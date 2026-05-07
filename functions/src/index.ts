import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {createHmac} from "crypto";
import {Expo, ExpoPushMessage} from "expo-server-sdk";

const expo = new Expo();
const PAYOS_CLIENT_ID = defineSecret("PAYOS_CLIENT_ID");
const PAYOS_API_KEY = defineSecret("PAYOS_API_KEY");
const PAYOS_CHECKSUM_KEY = defineSecret("PAYOS_CHECKSUM_KEY");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type NotificationPayload = {
  type: "like" | "comment" | "reshare";
  actorId: string;
  actorName: string;
  postId: string;
  message: string;
};

const getUserName = async (uid: string): Promise<string> => {
  try {
    const snap = await db.collection("users").doc(uid).get();
    if (snap.exists) {
      const data = snap.data() || {};
      return (
        data.displayName ||
        data.name ||
        data.username ||
        data.email ||
        "Someone"
      );
    }
  } catch (err) {
    console.warn("Failed to fetch user name", err);
  }
  return "Someone";
};

const createNotification = async (
  targetUserId: string,
  payload: NotificationPayload
) => {
  const userRef = db.collection("users").doc(targetUserId);
  const notifRef = userRef.collection("notifications").doc();

  await notifRef.set({
    ...payload,
    createdAt: FieldValue.serverTimestamp(),
    read: false,
  });

  // Logic gửi Push Notification
  try {
    const userSnap = await userRef.get();
    const userData = userSnap.data();
    const pushToken = userData?.expoPushToken;

    if (pushToken && Expo.isExpoPushToken(pushToken)) {
      const messages: ExpoPushMessage[] = [
        {
          to: pushToken,
          sound: "default",
          title: "Artium",
          body: payload.message,
          data: {...payload},
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      for (const chunk of chunks) {
        try {
          await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
          console.error("Error sending push notification chunk:", error);
        }
      }
    }
  } catch (error) {
    console.error("Error processing push notification:", error);
  }
};

const PAYOS_ENDPOINT = "https://api-merchant.payos.vn/v2/payment-requests";
const PAYOS_LINK_VERSION = 2;

const resolveProjectId = (): string | null => {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.FIREBASE_CONFIG) {
    try {
      const config = JSON.parse(process.env.FIREBASE_CONFIG);
      if (config?.projectId) return config.projectId as string;
    } catch (err) {
      console.warn("Failed to parse FIREBASE_CONFIG", err);
    }
  }
  return null;
};

const buildRedirectUrl = (
  baseUrl: string,
  params: Record<string, string | number | undefined>
) => {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
};

const buildPayosSignature = (payload: {
  amount: number;
  cancelUrl: string;
  description: string;
  orderCode: number;
  returnUrl: string;
}) => {
  const raw = [
    `amount=${payload.amount}`,
    `cancelUrl=${payload.cancelUrl}`,
    `description=${payload.description}`,
    `orderCode=${payload.orderCode}`,
    `returnUrl=${payload.returnUrl}`,
  ].join("&");
  return createHmac("sha256", PAYOS_CHECKSUM_KEY.value())
    .update(raw)
    .digest("hex");
};

type SignatureRequest = {
  get: (name: string) => string | undefined;
};

const getSignatureHeader = (req: SignatureRequest) => {
  return (
    req.get("x-payos-signature") ||
    req.get("x-signature") ||
    req.get("x-payOS-signature")
  );
};

const mapPayosStatus = (status?: string | number) => {
  if (typeof status === "number") {
    if (status === 1) return "paid";
    if (status === 0) return "pending";
  }
  const normalized =
    typeof status === "string" ? status.toLowerCase().trim() : undefined;
  if (!normalized) return null;
  if (normalized === "1") return "paid";
  if (normalized === "0") return "pending";
  if (["paid", "success"].includes(normalized)) return "paid";
  if (["cancel", "canceled", "cancelled"].includes(normalized)) {
    return "canceled";
  }
  if (["failed", "error"].includes(normalized)) return "failed";
  return null;
};

const buildOrderCode = () => {
  const now = Date.now();
  const random = Math.floor(Math.random() * 90) + 10;
  return Number(`${now}${random}`.slice(0, 15));
};

// Scheduled function to recalc popularity scores every hour
export const calculatePopularityScores = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const artworksRef = db.collection("artworks");
    const snapshot = await artworksRef.get();

    if (snapshot.empty) {
      console.log("No artworks found.");
      return null;
    }

    const batch = db.batch();

    snapshot.forEach((doc) => {
      const artwork = doc.data();
      const metrics = artwork.metrics || {likes: 0, views: 0};

      // Assumes you have a 'createdAt' Firestore Timestamp; fallback to now
      // to avoid NaN.
      const createdAt = artwork.createdAt?.toDate?.() || new Date();

      // --- Scoring Formula ---
      const points = (metrics.likes || 0) * 2 + (metrics.views || 0) * 0.5;
      const hoursSinceCreation =
        (Date.now() - createdAt.getTime()) / 3_600_000;
      const gravity = 1.8; // Gravity factor
      const score = points / Math.pow(hoursSinceCreation + 2, gravity);
      // -----------------------

      const artworkRefToUpdate = artworksRef.doc(doc.id);
      batch.update(artworkRefToUpdate, {popularityScore: score});
    });

    await batch.commit();
    console.log(`Updated popularity scores for ${snapshot.size} artworks.`);
    return null;
  });

// Notify post author when someone likes their post
export const onPostLike = functions.firestore
  .document("posts/{postId}/likes/{userId}")
  .onCreate(async (snap, context) => {
    const {postId, userId} = context.params;
    console.log("=== onPostLike triggered ===", {postId, userId});
    try {
      const postSnap = await db.collection("posts").doc(postId).get();
      if (!postSnap.exists) {
        console.log("Post not found:", postId);
        return null;
      }
      const postData = postSnap.data() || {};
      console.log("Post data:", JSON.stringify(postData, null, 2));
      const authorId =
        postData.authorId ||
        postData.authorSnapshot?.id ||
        postData.author?.id ||
        postData.userId;
      console.log("Extracted authorId:", authorId, "actorId (userId):", userId);
      if (!authorId) {
        console.log("No authorId found in post");
        return null;
      }
      if (authorId === userId) {
        console.log("Self-like detected, skipping notification");
        return null;
      }

      console.log("Creating notification for authorId:", authorId);
      const actorName = await getUserName(userId);
      console.log("Actor name:", actorName);
      await createNotification(authorId, {
        type: "like",
        actorId: userId,
        actorName,
        postId,
        message: `${actorName} liked your post`,
      });
      console.log("Notification created successfully");
    } catch (err) {
      console.error("onPostLike failed", err);
    }
    return null;
  });

// Notify artwork owner when someone likes their artwork
export const onArtworkLike = functions.firestore
  .document("artworks/{artworkId}/likes/{userId}")
  .onCreate(async (_snap, context) => {
    const {artworkId, userId} = context.params;
    try {
      const artworkSnap = await db.collection("artworks").doc(artworkId).get();
      if (!artworkSnap.exists) return null;
      const artwork = artworkSnap.data() || {};
      const authorId = artwork.authorId || artwork.artistId;
      if (!authorId || authorId === userId) return null;

      console.log("onArtworkLike create notification", {
        artworkId,
        actorId: userId,
        authorId,
      });
      const actorName = await getUserName(userId);
      const title = artwork.title ? ` "${artwork.title}"` : "";
      await createNotification(authorId, {
        type: "like",
        actorId: userId,
        actorName,
        postId: artworkId,
        message: `${actorName} liked your artwork${title}`,
      });
    } catch (err) {
      console.error("onArtworkLike failed", err);
    }
    return null;
  });

// Notify post author when someone comments
export const onPostComment = functions.firestore
  .document("posts/{postId}/comments/{commentId}")
  .onCreate(async (snap, context) => {
    const {postId} = context.params;
    const data = snap.data() || {};
    const actorId = data.author?.id || data.author?.uid || data.authorId;
    if (!actorId) return null;

    try {
      const postSnap = await db.collection("posts").doc(postId).get();
      if (!postSnap.exists) return null;
      const postData = postSnap.data() || {};
      const authorId = postData.authorId;
      if (!authorId || authorId === actorId) return null;

      const actorName = data.author?.name || (await getUserName(actorId));
      await createNotification(authorId, {
        type: "comment",
        actorId,
        actorName,
        postId,
        message: `${actorName} commented on your post`,
      });
    } catch (err) {
      console.error("onPostComment failed", err);
    }
    return null;
  });

// Notify original author when someone reshares
export const onPostReshare = functions.firestore
  .document("posts/{postId}")
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    if (!data.isReshare) return null;
    const targetAuthorId = data.resharedFrom?.id || data.resharedFrom?.authorId;
    const actorId = data.authorId;
    if (!targetAuthorId || !actorId || targetAuthorId === actorId) return null;

    try {
      const actorName =
        data.authorSnapshot?.name || (await getUserName(actorId));
      await createNotification(targetAuthorId, {
        type: "reshare",
        actorId,
        actorName,
        postId: snap.id,
        message: `${actorName} reshared your post`,
      });
    } catch (err) {
      console.error("onPostReshare failed", err);
    }
    return null;
  });

export const createPayosPaymentLink = onCall(
  {
    secrets: [PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY],
  },
  async (request) => {
    const invoiceId = request.data?.invoiceId as string | undefined;
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "invoiceId is required.");
    }

    const invoiceRef = db.collection("invoices").doc(invoiceId);
    const invoiceSnap = await invoiceRef.get();
    if (!invoiceSnap.exists) {
      throw new HttpsError("not-found", "Invoice not found.");
    }

    const invoice = invoiceSnap.data() as admin.firestore.DocumentData;
    console.log("=== Payment Permission Check (relaxed) ===", {
      requestUid: request.auth?.uid ?? "anonymous",
      sellerId: invoice.sellerId,
      buyerId: invoice.buyerId,
      invoiceId,
    });

    if (invoice.payment?.status === "paid") {
      throw new HttpsError("failed-precondition", "Invoice already paid.");
    }

    const total = Number(invoice?.totals?.total ?? 0);
    if (!total || Number.isNaN(total) || total <= 0) {
      throw new HttpsError("invalid-argument", "Invalid invoice total.");
    }

    const description = `Invoice ${invoice.invoiceNumber || invoiceId}`;
    const projectId = resolveProjectId();
    if (!projectId) {
      throw new HttpsError("internal", "Missing Firebase project id.");
    }
    const hostingBase =
      process.env.PAYOS_HOSTING_BASE_URL || `https://${projectId}.web.app`;
    const normalizedBase = hostingBase.replace(/\/+$/, "");
    const requestReturnBase = request.data?.returnUrlBase as string | undefined;
    const requestCancelBase = request.data?.cancelUrlBase as string | undefined;
    const baseReturnUrl = requestReturnBase || `${normalizedBase}/payos/return`;
    const baseCancelUrl = requestCancelBase || `${normalizedBase}/payos/cancel`;

    if (invoice.payment?.checkoutUrl && invoice.payment?.orderCode) {
      const existingReturnUrl = buildRedirectUrl(baseReturnUrl, {
        invoiceId,
        orderCode: invoice.payment.orderCode,
      });
      const existingCancelUrl = buildRedirectUrl(baseCancelUrl, {
        invoiceId,
        orderCode: invoice.payment.orderCode,
      });
      const canReuse =
        invoice.payment.status !== "paid" &&
        invoice.payment.returnUrl === existingReturnUrl &&
        invoice.payment.cancelUrl === existingCancelUrl &&
        invoice.payment.version === PAYOS_LINK_VERSION;

      if (canReuse) {
        return {
          checkoutUrl: invoice.payment.checkoutUrl,
          orderCode: invoice.payment.orderCode,
          paymentLinkId: invoice.payment.paymentLinkId,
          returnUrl: invoice.payment.returnUrl,
          cancelUrl: invoice.payment.cancelUrl,
        };
      }
    }

    const orderCode = buildOrderCode();
    const returnUrl = buildRedirectUrl(baseReturnUrl, {
      invoiceId,
      orderCode,
    });
    const cancelUrl = buildRedirectUrl(baseCancelUrl, {
      invoiceId,
      orderCode,
    });

    const payload = {
      orderCode,
      amount: Math.round(total),
      description,
      returnUrl,
      cancelUrl,
      signature: buildPayosSignature({
        amount: Math.round(total),
        cancelUrl,
        description,
        orderCode,
        returnUrl,
      }),
    };

    const response = await fetch(PAYOS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": PAYOS_CLIENT_ID.value(),
        "x-api-key": PAYOS_API_KEY.value(),
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json()) as {
      data?: {
        checkoutUrl?: string;
        orderCode?: number;
        paymentLinkId?: string;
      };
    };
    if (!response.ok || !json.data?.checkoutUrl) {
      console.error("PayOS error:", json);
      throw new HttpsError("internal", "Failed to create payment link.");
    }

    const paymentData = json.data;

    await invoiceRef.update({
      payment: {
        provider: "payos",
        status: "pending",
        orderCode: paymentData.orderCode ?? orderCode,
        paymentLinkId: paymentData.paymentLinkId,
        checkoutUrl: paymentData.checkoutUrl,
        returnUrl,
        cancelUrl,
        version: PAYOS_LINK_VERSION,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    return {
      checkoutUrl: paymentData.checkoutUrl,
      orderCode: paymentData.orderCode ?? orderCode,
      paymentLinkId: paymentData.paymentLinkId,
      returnUrl,
      cancelUrl,
    };
  }
);

export const finalizePayosPayment = onCall(async (request) => {
  const invoiceId = request.data?.invoiceId as string | undefined;
  if (!invoiceId) {
    throw new HttpsError("invalid-argument", "invoiceId is required.");
  }

  const invoiceRef = db.collection("invoices").doc(invoiceId);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) {
    throw new HttpsError("not-found", "Invoice not found.");
  }

  const invoiceData = invoiceSnap.data() as admin.firestore.DocumentData;
  const isAlreadyPaid =
    invoiceData?.payment?.status === "paid" || invoiceData?.status === "paid";
  if (isAlreadyPaid) {
    return {status: "paid"};
  }

  const batch = db.batch();
  batch.update(invoiceRef, {
    "payment.status": "paid",
    "payment.paidAt": admin.firestore.FieldValue.serverTimestamp(),
    "status": "paid",
    "isActive": false,
    "paidAt": admin.firestore.FieldValue.serverTimestamp(),
  });

  const artworkIds = new Set<string>();
  if (invoiceData?.artworkId) {
    artworkIds.add(String(invoiceData.artworkId));
  }
  if (Array.isArray(invoiceData?.items)) {
    invoiceData.items.forEach((item: { artworkId?: string }) => {
      if (item?.artworkId) {
        artworkIds.add(String(item.artworkId));
      }
    });
  }

  artworkIds.forEach((artworkId) => {
    const artworkRef = db.collection("artworks").doc(artworkId);
    batch.update(artworkRef, {
      status: "sold",
      isActive: false,
      soldAt: admin.firestore.FieldValue.serverTimestamp(),
      soldByInvoiceId: invoiceRef.id,
    });
  });

  await batch.commit();
  return {status: "paid"};
});

export const payosWebhook = onRequest(
  {
    secrets: [PAYOS_CHECKSUM_KEY],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = getSignatureHeader(req);
    if (!signature) {
      res.status(400).send("Missing signature");
      return;
    }

    const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    const expected = createHmac("sha256", PAYOS_CHECKSUM_KEY.value())
      .update(rawBody)
      .digest("hex");

    if (signature !== expected) {
      res.status(401).send("Invalid signature");
      return;
    }

    const payload = req.body ?? {};
    const data = payload?.data ?? payload;
    const orderCode = data?.orderCode;
    const paymentLinkId = data?.paymentLinkId;
    const status = mapPayosStatus(data?.status ?? payload?.status);

    if (!orderCode && !paymentLinkId) {
      res.status(400).send("Missing orderCode");
      return;
    }

    const queryBase = db.collection("invoices");
    let snapshot:
      | FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>
      | null = null;

    const orderCodeCandidates: Array<string | number> = [];
    if (orderCode !== undefined && orderCode !== null) {
      if (typeof orderCode === "string") {
        orderCodeCandidates.push(orderCode);
        const parsed = Number(orderCode);
        if (!Number.isNaN(parsed)) {
          orderCodeCandidates.push(parsed);
        }
      } else {
        orderCodeCandidates.push(orderCode);
        orderCodeCandidates.push(String(orderCode));
      }
    }

    for (const candidate of orderCodeCandidates) {
      const candidateSnapshot = await queryBase
        .where("payment.orderCode", "==", candidate)
        .limit(1)
        .get();
      if (!candidateSnapshot.empty) {
        snapshot = candidateSnapshot;
        break;
      }
    }

    if ((!snapshot || snapshot.empty) && paymentLinkId) {
      snapshot = await queryBase
        .where("payment.paymentLinkId", "==", paymentLinkId)
        .limit(1)
        .get();
    }

    if (!snapshot) {
      res.status(400).send("Missing orderCode");
      return;
    }
    if (snapshot.empty) {
      res.status(404).send("Invoice not found");
      return;
    }

    const invoiceDoc = snapshot.docs[0];
    const invoiceData = invoiceDoc.data() as admin.firestore.DocumentData;
    const update: Record<string, unknown> = {
      "payment.status": status ?? "pending",
      "payment.rawPayload": payload,
    };
    if (data?.paymentLinkId) {
      update["payment.paymentLinkId"] = data.paymentLinkId;
    }
    if (data?.transactionId) {
      update["payment.transactionId"] = data.transactionId;
    }
    if (status === "paid") {
      update["payment.paidAt"] = admin.firestore.FieldValue.serverTimestamp();
      update["status"] = "paid";
      update["isActive"] = false;
      update["paidAt"] = admin.firestore.FieldValue.serverTimestamp();
    }
    const batch = db.batch();
    batch.update(invoiceDoc.ref, update);

    if (status === "paid") {
      const artworkIds = new Set<string>();
      if (invoiceData?.artworkId) {
        artworkIds.add(String(invoiceData.artworkId));
      }
      if (Array.isArray(invoiceData?.items)) {
        invoiceData.items.forEach((item: { artworkId?: string }) => {
          if (item?.artworkId) {
            artworkIds.add(String(item.artworkId));
          }
        });
      }

      artworkIds.forEach((artworkId) => {
        const artworkRef = db.collection("artworks").doc(artworkId);
        batch.update(artworkRef, {
          status: "sold",
          isActive: false,
          soldAt: admin.firestore.FieldValue.serverTimestamp(),
          soldByInvoiceId: invoiceDoc.id,
        });
      });
    }

    await batch.commit();
    res.status(200).send("ok");
  }
);
