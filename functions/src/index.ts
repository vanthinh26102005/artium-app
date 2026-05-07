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
  type:
    | "like"
    | "comment"
    | "reshare"
    | "auction_outbid"
    | "auction_ended"
    | "auction_won";
  actorId: string;
  actorName: string;
  postId?: string;
  auctionId?: string;
  artworkId?: string;
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

const buildInvoiceNumber = (id: string) => {
  const prefix = id.slice(0, 4).toUpperCase();
  const suffix = id.slice(-8).toUpperCase();
  return `IV-${prefix}-${suffix}`;
};

type AuctionStage = "sketch" | "color" | "final";
type AuctionStatus =
  | "scheduled"
  | "live"
  | "ended"
  | "awaiting_payment"
  | "settled"
  | "cancelled";

type DepositStatus =
  | "pending"
  | "paid"
  | "applied"
  | "refund_pending"
  | "refunded"
  | "forfeited"
  | "cancelled";

type PlaceBidTransactionResult = {
  auctionId: string;
  bidId: string;
  artworkId?: string;
  currentBid: number;
  topBidderId: string;
  bidCount: number;
};

type CloseAuctionResult = {
  hasWinner: boolean;
  shouldNotifyArtist: boolean;
  artistId?: string;
  topBidderId?: string;
  artworkId?: string;
};

type UserSnapshot = {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
};

type WinnerInvoiceResult = {
  invoiceId: string;
  created: boolean;
  artworkId?: string;
  artistId?: string;
  topBidderId?: string;
};

type PayosLinkResult = {
  checkoutUrl: string;
  orderCode: number;
  paymentLinkId?: string;
  returnUrl: string;
  cancelUrl: string;
};

const AUCTION_STAGES: AuctionStage[] = ["sketch", "color", "final"];
const AUCTION_CURRENCIES = ["VND", "USD"];
const TRUST_SCORE_DEPOSIT_THRESHOLD = 80;
const BID_DEPOSIT_RATE = 0.1;
const WINNER_PAYMENT_DEADLINE_HOURS = 24;

const isDemoModeEnabled = () => {
  return process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.ARTIUM_DEMO_MODE === "true";
};

const assertDemoMode = () => {
  if (!isDemoModeEnabled()) {
    throw new HttpsError(
      "permission-denied",
      "Demo actions are only available in emulator/dev mode."
    );
  }
};

const isAuctionStage = (value: unknown): value is AuctionStage => {
  return typeof value === "string" &&
    AUCTION_STAGES.includes(value as AuctionStage);
};

const readRequiredString = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} is required.`
    );
  }
  return value.trim();
};

const readOptionalString = (value: unknown) => {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const readPositiveNumber = (value: unknown, fieldName: string) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a positive number.`
    );
  }
  return numberValue;
};

const normalizeTrustScore = (value: unknown) => {
  const score = Number(value);
  if (!Number.isFinite(score)) return 100;
  return Math.max(0, Math.min(100, score));
};

const getUserTrustScore = async (uid: string): Promise<number> => {
  const snap = await db.collection("users").doc(uid).get();
  return normalizeTrustScore(snap.data()?.trustScore);
};

const calculateBidDepositAmount = (amount: number, currency: string) => {
  const rawAmount = amount * BID_DEPOSIT_RATE;
  if (currency === "VND") return Math.round(rawAmount);
  return Math.round(rawAmount * 100) / 100;
};

const isInvoiceParticipant = (
  invoiceData: admin.firestore.DocumentData,
  uid?: string
) => {
  return !!uid && (invoiceData.sellerId === uid || invoiceData.buyerId === uid);
};

const getInvoiceSource = (invoiceData: admin.firestore.DocumentData) => {
  return readOptionalString(invoiceData.source) ||
    readOptionalString(invoiceData.type) ||
    "";
};

const getPaymentDueAt = () => {
  return admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + WINNER_PAYMENT_DEADLINE_HOURS * 60 * 60 * 1000)
  );
};

const getRecordNumber = (
  value: Record<string, unknown>,
  keys: string[]
) => {
  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
};

const readAuctionDate = (value: unknown, fieldName: string) => {
  let date: Date | null = null;

  if (value instanceof admin.firestore.Timestamp) {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" || typeof value === "string") {
    date = new Date(value);
  } else if (value && typeof value === "object") {
    const recordValue = value as Record<string, unknown>;
    const seconds = getRecordNumber(recordValue, ["seconds", "_seconds"]);
    if (seconds !== null) {
      date = new Date(seconds * 1000);
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a valid date.`
    );
  }

  return date;
};

const getUserSnapshot = async (uid: string): Promise<UserSnapshot> => {
  let data: admin.firestore.DocumentData = {};
  try {
    const snap = await db.collection("users").doc(uid).get();
    data = snap.data() || {};
  } catch (err) {
    console.warn("Failed to fetch user document", err);
  }

  try {
    const authUser = await admin.auth().getUser(uid);
    return {
      uid,
      displayName:
        readOptionalString(data.displayName) ||
        readOptionalString(data.name) ||
        readOptionalString(data.username) ||
        readOptionalString(authUser.displayName),
      email: readOptionalString(data.email) || authUser.email || undefined,
      photoURL:
        readOptionalString(data.photoURL) ||
        readOptionalString(data.avatar) ||
        readOptionalString(data.avatarUrl) ||
        authUser.photoURL ||
        undefined,
    };
  } catch {
    return {
      uid,
      displayName:
        readOptionalString(data.displayName) ||
        readOptionalString(data.name) ||
        readOptionalString(data.username),
      email: readOptionalString(data.email),
      photoURL:
        readOptionalString(data.photoURL) ||
        readOptionalString(data.avatar) ||
        readOptionalString(data.avatarUrl),
    };
  }
};

const resolveFirstArtworkImage = (
  images: unknown
): string | undefined => {
  if (!Array.isArray(images)) return undefined;
  for (const item of images) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const value =
        readOptionalString(record.uri) ||
        readOptionalString(record.url) ||
        readOptionalString(record.image) ||
        readOptionalString(record.imageUrl);
      if (value) return value;
    }
  }
  return undefined;
};

const getInvoiceAuctionId = (
  invoiceData: admin.firestore.DocumentData
) => {
  const source = readOptionalString(invoiceData.source) ||
    readOptionalString(invoiceData.type);
  const auctionId = readOptionalString(invoiceData.auctionId);
  return source === "auction" && auctionId ? auctionId : null;
};

const collectInvoiceArtworkIds = (
  invoiceData: admin.firestore.DocumentData
) => {
  const artworkIds = new Set<string>();
  const directArtworkId = readOptionalString(invoiceData.artworkId);
  if (directArtworkId) {
    artworkIds.add(directArtworkId);
  }
  if (Array.isArray(invoiceData.items)) {
    invoiceData.items.forEach((item: {artworkId?: string}) => {
      if (item?.artworkId) {
        artworkIds.add(String(item.artworkId));
      }
    });
  }
  return artworkIds;
};

const addPaidInvoiceSettlement = (
  batch: FirebaseFirestore.WriteBatch,
  invoiceRef: FirebaseFirestore.DocumentReference,
  invoiceData: admin.firestore.DocumentData,
  invoiceUpdate: Record<string, unknown> = {}
) => {
  batch.update(invoiceRef, {
    ...invoiceUpdate,
    "payment.status": "paid",
    "payment.paidAt": admin.firestore.FieldValue.serverTimestamp(),
    "status": "paid",
    "isActive": false,
    "paidAt": admin.firestore.FieldValue.serverTimestamp(),
  });

  const auctionId = getInvoiceAuctionId(invoiceData);
  if (auctionId) {
    batch.update(db.collection("auctions").doc(auctionId), {
      status: "settled",
      settledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  const depositId = readOptionalString(invoiceData.depositId);
  if (depositId) {
    batch.update(db.collection("auctionDeposits").doc(depositId), {
      status: "applied" satisfies DepositStatus,
      appliedToInvoiceId: invoiceRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  const buyerId = readOptionalString(invoiceData.buyerId);
  if (auctionId && buyerId) {
    batch.set(db.collection("users").doc(buyerId), {
      "auctionStats.wonAuctions": FieldValue.increment(1),
      "auctionStats.paidWins": FieldValue.increment(1),
      "updatedAt": FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  collectInvoiceArtworkIds(invoiceData).forEach((artworkId) => {
    batch.update(db.collection("artworks").doc(artworkId), {
      status: "sold",
      isActive: false,
      soldAt: admin.firestore.FieldValue.serverTimestamp(),
      soldByInvoiceId: invoiceRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
};

const markLosingDepositsRefundPending = async (
  auctionId: string,
  winnerId: string
) => {
  const snapshot = await db.collection("auctionDeposits")
    .where("auctionId", "==", auctionId)
    .where("status", "==", "paid")
    .get();
  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.docs.forEach((docSnap) => {
    const deposit = docSnap.data();
    if (deposit.bidderId === winnerId) return;
    batch.update(docSnap.ref, {
      status: "refund_pending" satisfies DepositStatus,
      refundAmount: Number(deposit.depositAmount ?? 0),
      refundReason: "lost_auction",
      refundRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
};

const markAllAuctionDepositsRefundPending = async (
  auctionId: string,
  reason: "auction_cancelled" | "winner_changed"
) => {
  const snapshot = await db.collection("auctionDeposits")
    .where("auctionId", "==", auctionId)
    .where("status", "==", "paid")
    .get();
  if (snapshot.empty) return;

  const batch = db.batch();
  snapshot.docs.forEach((docSnap) => {
    const deposit = docSnap.data();
    batch.update(docSnap.ref, {
      status: "refund_pending" satisfies DepositStatus,
      refundAmount: Number(deposit.depositAmount ?? 0),
      refundReason: reason,
      refundRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
};

const getVerifiedPayosStatus = async (
  invoiceData: admin.firestore.DocumentData
) => {
  const orderCode = invoiceData?.payment?.orderCode;
  if (orderCode === undefined || orderCode === null || orderCode === "") {
    throw new HttpsError(
      "failed-precondition",
      "Invoice does not have a PayOS order code."
    );
  }

  const response = await fetch(`${PAYOS_ENDPOINT}/${orderCode}`, {
    method: "GET",
    headers: {
      "x-client-id": PAYOS_CLIENT_ID.value(),
      "x-api-key": PAYOS_API_KEY.value(),
    },
  });
  const json = (await response.json()) as {
    data?: {
      status?: string | number;
      paymentLinkId?: string;
      transactions?: Array<{ reference?: string; transactionId?: string }>;
    };
  };

  if (!response.ok) {
    console.error("PayOS status error:", json);
    throw new HttpsError("internal", "Failed to verify PayOS payment.");
  }

  const status = mapPayosStatus(json.data?.status);
  return {
    status,
    rawPayload: json,
    paymentLinkId: json.data?.paymentLinkId,
    transactionId:
      json.data?.transactions?.[0]?.transactionId ||
      json.data?.transactions?.[0]?.reference,
  };
};

const getDefaultPayosBases = (
  requestReturnBase?: string,
  requestCancelBase?: string
) => {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new HttpsError("internal", "Missing Firebase project id.");
  }
  const hostingBase =
    process.env.PAYOS_HOSTING_BASE_URL || `https://${projectId}.web.app`;
  const normalizedBase = hostingBase.replace(/\/+$/, "");
  return {
    baseReturnUrl: requestReturnBase || `${normalizedBase}/payos/return`,
    baseCancelUrl: requestCancelBase || `${normalizedBase}/payos/cancel`,
  };
};

const createPayosLinkForInvoice = async (
  invoiceId: string,
  invoiceData: admin.firestore.DocumentData,
  requestReturnBase?: string,
  requestCancelBase?: string
): Promise<PayosLinkResult> => {
  const total = Number(invoiceData?.totals?.total ?? 0);
  if (!total || Number.isNaN(total) || total <= 0) {
    throw new HttpsError("invalid-argument", "Invalid invoice total.");
  }

  const {baseReturnUrl, baseCancelUrl} = getDefaultPayosBases(
    requestReturnBase,
    requestCancelBase
  );

  if (invoiceData.payment?.checkoutUrl && invoiceData.payment?.orderCode) {
    const existingReturnUrl = buildRedirectUrl(baseReturnUrl, {
      invoiceId,
      orderCode: invoiceData.payment.orderCode,
    });
    const existingCancelUrl = buildRedirectUrl(baseCancelUrl, {
      invoiceId,
      orderCode: invoiceData.payment.orderCode,
    });
    const canReuse =
      invoiceData.payment.status !== "paid" &&
      invoiceData.payment.returnUrl === existingReturnUrl &&
      invoiceData.payment.cancelUrl === existingCancelUrl &&
      invoiceData.payment.version === PAYOS_LINK_VERSION;

    if (canReuse) {
      return {
        checkoutUrl: invoiceData.payment.checkoutUrl,
        orderCode: Number(invoiceData.payment.orderCode),
        paymentLinkId: invoiceData.payment.paymentLinkId,
        returnUrl: invoiceData.payment.returnUrl,
        cancelUrl: invoiceData.payment.cancelUrl,
      };
    }
  }

  const orderCode = buildOrderCode();
  const returnUrl = buildRedirectUrl(baseReturnUrl, {invoiceId, orderCode});
  const cancelUrl = buildRedirectUrl(baseCancelUrl, {invoiceId, orderCode});
  const description = `Invoice ${invoiceData.invoiceNumber || invoiceId}`;
  const amount = Math.round(total);
  const payload = {
    orderCode,
    amount,
    description,
    returnUrl,
    cancelUrl,
    signature: buildPayosSignature({
      amount,
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

  return {
    checkoutUrl: json.data.checkoutUrl,
    orderCode: json.data.orderCode ?? orderCode,
    paymentLinkId: json.data.paymentLinkId,
    returnUrl,
    cancelUrl,
  };
};

const buildPaymentPatch = (link: PayosLinkResult) => ({
  payment: {
    provider: "payos",
    status: "pending",
    orderCode: link.orderCode,
    paymentLinkId: link.paymentLinkId,
    checkoutUrl: link.checkoutUrl,
    returnUrl: link.returnUrl,
    cancelUrl: link.cancelUrl,
    version: PAYOS_LINK_VERSION,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  },
});

const resolveAuctionStatus = (
  now: Date,
  startsAt: Date,
  endsAt: Date
): AuctionStatus => {
  if (now < startsAt) return "scheduled";
  if (now >= endsAt) return "ended";
  return "live";
};

const assertAuctionAcceptsBid = (
  auction: admin.firestore.DocumentData,
  uid: string,
  amount: number
) => {
  if (auction.artistId === uid) {
    throw new HttpsError(
      "failed-precondition",
      "Artists cannot bid on their own auction."
    );
  }

  if (
    ["ended", "awaiting_payment", "settled", "cancelled"].includes(
      auction.status
    )
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This auction is no longer accepting bids."
    );
  }

  const now = new Date();
  const startsAt = readAuctionDate(auction.startsAt, "startsAt");
  const endsAt = readAuctionDate(auction.endsAt, "endsAt");

  if (now < startsAt) {
    throw new HttpsError(
      "failed-precondition",
      "This auction has not started yet."
    );
  }

  if (now >= endsAt) {
    throw new HttpsError(
      "failed-precondition",
      "This auction has already ended."
    );
  }

  const currentBid = Number(auction.currentBid ?? auction.startingPrice ?? 0);
  const minIncrement = Number(auction.minIncrement ?? 0);
  const minimumBid = currentBid + minIncrement;

  if (amount < minimumBid) {
    throw new HttpsError(
      "invalid-argument",
      `Bid must be at least ${minimumBid}.`
    );
  }
};

const validatePaidDepositForBid = async (
  uid: string,
  auctionId: string,
  amount: number,
  depositId?: string
) => {
  if (!depositId) {
    throw new HttpsError(
      "failed-precondition",
      "A paid bid deposit is required before placing this bid."
    );
  }
  const depositRef = db.collection("auctionDeposits").doc(depositId);
  const depositSnap = await depositRef.get();
  if (!depositSnap.exists) {
    throw new HttpsError("not-found", "Bid deposit not found.");
  }
  const deposit = depositSnap.data() || {};
  if (
    deposit.auctionId !== auctionId ||
    deposit.bidderId !== uid ||
    Number(deposit.bidAmount) !== amount ||
    deposit.status !== "paid"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "A matching paid bid deposit is required before placing this bid."
    );
  }
  return {
    ref: depositRef,
    data: deposit,
    depositId,
    depositAmount: Number(deposit.depositAmount ?? 0),
  };
};

const placeBidForUser = async ({
  uid,
  auctionId,
  amount,
  deposit,
}: {
  uid: string;
  auctionId: string;
  amount: number;
  deposit?: {
    ref: FirebaseFirestore.DocumentReference;
    data: admin.firestore.DocumentData;
    depositId: string;
    depositAmount: number;
  };
}): Promise<PlaceBidTransactionResult> => {
  const auctionRef = db.collection("auctions").doc(auctionId);
  const bidRef = auctionRef.collection("bids").doc();
  let result: PlaceBidTransactionResult | null = null;
  let previousTopBidderId: string | null = null;

  await db.runTransaction(async (tx) => {
    const auctionSnap = await tx.get(auctionRef);
    if (!auctionSnap.exists) {
      throw new HttpsError("not-found", "Auction not found.");
    }

    const auction = auctionSnap.data() || {};
    assertAuctionAcceptsBid(auction, uid, amount);
    if (deposit) {
      const latestDepositSnap = await tx.get(deposit.ref);
      const latestDeposit = latestDepositSnap.data() || {};
      if (
        latestDeposit.bidId ||
        latestDeposit.status !== "paid" ||
        latestDeposit.auctionId !== auctionId ||
        latestDeposit.bidderId !== uid ||
        Number(latestDeposit.bidAmount) !== amount
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This bid deposit has already been used or is no longer valid."
        );
      }
    }

    previousTopBidderId =
      typeof auction.topBidderId === "string" ? auction.topBidderId : null;
    const nextBidCount = Number(auction.bidCount ?? 0) + 1;
    const bidData: Record<string, unknown> = {
      auctionId,
      bidderId: uid,
      amount,
      depositRequired: !!deposit,
      depositStatus: deposit ? "paid" : "not_required",
      createdAt: FieldValue.serverTimestamp(),
    };
    if (deposit) {
      bidData.depositId = deposit.depositId;
      bidData.depositAmount = deposit.depositAmount;
    }

    tx.set(bidRef, bidData);

    tx.update(auctionRef, {
      status: "live",
      currentBid: amount,
      topBidderId: uid,
      bidCount: nextBidCount,
      lastBidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (deposit) {
      tx.update(deposit.ref, {
        bidId: bidRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(db.collection("users").doc(uid), {
      "auctionStats.totalBids": FieldValue.increment(1),
      "updatedAt": FieldValue.serverTimestamp(),
    }, {merge: true});

    result = {
      auctionId,
      bidId: bidRef.id,
      artworkId: typeof auction.artworkId === "string" ?
        auction.artworkId :
        undefined,
      currentBid: amount,
      topBidderId: uid,
      bidCount: nextBidCount,
    };
  });

  const bidResult = result as PlaceBidTransactionResult | null;
  if (!bidResult) {
    throw new HttpsError("internal", "Bid transaction did not finish.");
  }

  if (previousTopBidderId && previousTopBidderId !== uid) {
    const actorName = await getUserName(uid);
    await createNotification(previousTopBidderId, {
      type: "auction_outbid",
      actorId: uid,
      actorName,
      auctionId,
      artworkId: bidResult.artworkId,
      message: `${actorName} placed a higher bid on an auction.`,
    });
  }

  return bidResult;
};

const findPaidDepositForBidder = async (
  auctionId: string,
  bidderId: string,
  bidAmount?: number
) => {
  let depositQuery: FirebaseFirestore.Query = db
    .collection("auctionDeposits")
    .where("auctionId", "==", auctionId)
    .where("bidderId", "==", bidderId)
    .where("status", "==", "paid");
  if (typeof bidAmount === "number") {
    depositQuery = depositQuery.where("bidAmount", "==", bidAmount);
  }
  const snapshot = await depositQuery.limit(1).get();
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return {
    id: docSnap.id,
    ref: docSnap.ref,
    data: docSnap.data(),
  };
};

const settlePaidDepositInvoice = async (
  invoiceRef: FirebaseFirestore.DocumentReference,
  invoiceData: admin.firestore.DocumentData,
  invoiceUpdate: Record<string, unknown>
) => {
  const depositId = readRequiredString(invoiceData.depositId, "depositId");
  const depositRef = db.collection("auctionDeposits").doc(depositId);
  const depositSnap = await depositRef.get();
  if (!depositSnap.exists) {
    throw new HttpsError("not-found", "Auction deposit not found.");
  }
  const deposit = depositSnap.data() || {};
  const isAlreadyPaid = deposit.status === "paid" && deposit.bidId;
  if (isAlreadyPaid) {
    const batch = db.batch();
    batch.update(invoiceRef, {
      ...invoiceUpdate,
      "payment.status": "paid",
      "payment.paidAt": FieldValue.serverTimestamp(),
      "status": "paid",
      "isActive": false,
      "paidAt": FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return;
  }

  const batch = db.batch();
  batch.update(invoiceRef, {
    ...invoiceUpdate,
    "payment.status": "paid",
    "payment.paidAt": FieldValue.serverTimestamp(),
    "status": "paid",
    "isActive": false,
    "paidAt": FieldValue.serverTimestamp(),
  });
  batch.update(depositRef, {
    status: "paid" satisfies DepositStatus,
    paidAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  const latestDeposit = (await depositRef.get()).data() || {};
  if (latestDeposit.bidId) return;
  try {
    await placeBidForUser({
      uid: readRequiredString(latestDeposit.bidderId, "bidderId"),
      auctionId: readRequiredString(latestDeposit.auctionId, "auctionId"),
      amount: readPositiveNumber(latestDeposit.bidAmount, "bidAmount"),
      deposit: {
        ref: depositRef,
        data: latestDeposit,
        depositId,
        depositAmount: Number(latestDeposit.depositAmount ?? 0),
      },
    });
  } catch (err) {
    console.error("Failed to auto-place deposited bid:", err);
    const auctionId = readOptionalString(latestDeposit.auctionId);
    const auctionSnap = auctionId ?
      await db.collection("auctions").doc(auctionId).get() :
      null;
    const auctionStatus = auctionSnap?.data()?.status;
    if (["ended", "awaiting_payment", "settled", "cancelled"].includes(
      auctionStatus
    )) {
      await depositRef.update({
        status: "refund_pending" satisfies DepositStatus,
        refundAmount: Number(latestDeposit.depositAmount ?? 0),
        refundReason: auctionStatus === "cancelled" ?
          "auction_cancelled" :
          "lost_auction",
        refundRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
};

const finalizePaidInvoice = async (
  invoiceRef: FirebaseFirestore.DocumentReference,
  invoiceData: admin.firestore.DocumentData,
  invoiceUpdate: Record<string, unknown>
) => {
  if (getInvoiceSource(invoiceData) === "auction_deposit") {
    await settlePaidDepositInvoice(invoiceRef, invoiceData, invoiceUpdate);
    return;
  }

  const batch = db.batch();
  addPaidInvoiceSettlement(batch, invoiceRef, invoiceData, invoiceUpdate);
  await batch.commit();

  const auctionId = getInvoiceAuctionId(invoiceData);
  const winnerId = readOptionalString(invoiceData.buyerId);
  if (auctionId && winnerId) {
    await markLosingDepositsRefundPending(auctionId, winnerId);
  }
};

const penalizeUnpaidWinner = async (uid: string) => {
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const currentTrust = normalizeTrustScore(userSnap.data()?.trustScore);
    tx.set(userRef, {
      "trustScore": Math.max(0, currentTrust - 15),
      "auctionStats.unpaidWins": FieldValue.increment(1),
      "auctionStats.depositForfeitedCount": FieldValue.increment(1),
      "updatedAt": FieldValue.serverTimestamp(),
    }, {merge: true});
  });
};

const chooseNextEligibleBid = async (
  auctionId: string,
  failedWinnerIds: string[]
) => {
  const failed = new Set(failedWinnerIds);
  const bidsSnap = await db.collection("auctions")
    .doc(auctionId)
    .collection("bids")
    .orderBy("amount", "desc")
    .get();
  for (const bidDoc of bidsSnap.docs) {
    const bid = bidDoc.data();
    const bidderId = readOptionalString(bid.bidderId);
    if (!bidderId || failed.has(bidderId)) continue;
    return {
      bidderId,
      amount: Number(bid.amount ?? 0),
    };
  }
  return null;
};

const createWinnerInvoiceForAuction = async (
  auctionId: string
): Promise<WinnerInvoiceResult> => {
  const auctionRef = db.collection("auctions").doc(auctionId);
  const auctionSnap = await auctionRef.get();
  if (!auctionSnap.exists) {
    throw new HttpsError("not-found", "Auction not found.");
  }

  const auction = auctionSnap.data() || {};
  const artworkId = readOptionalString(auction.artworkId);
  const artistId = readOptionalString(auction.artistId);
  const topBidderId = readOptionalString(auction.topBidderId);
  const amount = Number(auction.currentBid ?? 0);
  const currency = readOptionalString(auction.currency) || "USD";

  if (!artworkId || !artistId || !topBidderId) {
    throw new HttpsError(
      "failed-precondition",
      "Auction does not have a winner."
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Auction winning amount is invalid."
    );
  }

  const [artworkSnap, seller, buyer] = await Promise.all([
    db.collection("artworks").doc(artworkId).get(),
    getUserSnapshot(artistId),
    getUserSnapshot(topBidderId),
  ]);
  const artwork = artworkSnap.data() || {};
  const title = readOptionalString(artwork.title) || "Auction artwork";
  const image = resolveFirstArtworkImage(artwork.images);
  const paidDeposit = await findPaidDepositForBidder(
    auctionId,
    topBidderId,
    amount
  );
  const depositAmount = paidDeposit ?
    Number(paidDeposit.data.depositAmount ?? 0) :
    0;
  const depositApplied = Number.isFinite(depositAmount) ?
    Math.min(amount, Math.max(0, depositAmount)) :
    0;
  const remainingAmount = Math.max(0, amount - depositApplied);
  const invoiceRef = db.collection("invoices").doc();
  const invoiceNumber = buildInvoiceNumber(invoiceRef.id);
  const invoiceItem: Record<string, unknown> = {
    type: "artwork",
    title,
    quantity: 1,
    unitPrice: amount,
    artworkId,
  };
  if (image) {
    invoiceItem.image = image;
  }

  const txResult = await db.runTransaction(async (tx) => {
    const latestSnap = await tx.get(auctionRef);
    if (!latestSnap.exists) {
      throw new HttpsError("not-found", "Auction not found.");
    }
    const latest = latestSnap.data() || {};
    const existingInvoiceId = readOptionalString(latest.winnerInvoiceId);
    if (existingInvoiceId) {
      return {
        invoiceId: existingInvoiceId,
        created: false,
      };
    }

    tx.set(invoiceRef, {
      status: "sent",
      source: "auction",
      type: "auction",
      auctionId,
      artworkId,
      invoiceNumber,
      isActive: true,
      sellerId: artistId,
      buyerId: topBidderId,
      sellerSnapshot: {
        uid: artistId,
        displayName: seller.displayName || "Artist",
        photoURL: seller.photoURL || "",
      },
      buyer: {
        name: buyer.displayName || buyer.email || "Auction winner",
        email: buyer.email || "",
        message: "Auction winner invoice",
      },
      items: [invoiceItem],
      currency,
      totals: {
        subtotal: amount,
        depositApplied,
        total: remainingAmount,
      },
      depositId: paidDeposit?.id,
      depositApplied,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSentAt: FieldValue.serverTimestamp(),
      sentCount: 1,
    });

    tx.update(auctionRef, {
      status: "awaiting_payment",
      winnerInvoiceId: invoiceRef.id,
      endedAt: latest.endedAt || FieldValue.serverTimestamp(),
      paymentDueAt: getPaymentDueAt(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      invoiceId: invoiceRef.id,
      created: true,
    };
  });

  if (txResult.created) {
    await createNotification(topBidderId, {
      type: "auction_won",
      actorId: artistId,
      actorName: seller.displayName || "Artium",
      auctionId,
      artworkId,
      message: "You won the auction. Please complete your invoice.",
    });
  }

  return {
    ...txResult,
    artworkId,
    artistId,
    topBidderId,
  };
};

const closeAuctionNow = async (
  auctionId: string
): Promise<{
  auctionId: string;
  status: AuctionStatus;
  invoiceId?: string;
  invoiceCreated?: boolean;
  hasWinner: boolean;
}> => {
  const auctionRef = db.collection("auctions").doc(auctionId);
  const closeResult = await db.runTransaction(async (tx) => {
    const auctionSnap = await tx.get(auctionRef);
    if (!auctionSnap.exists) {
      throw new HttpsError("not-found", "Auction not found.");
    }

    const auction = auctionSnap.data() || {};
    const currentStatus = auction.status as AuctionStatus;
    if (currentStatus === "settled") {
      return {
        status: currentStatus,
        hasWinner: !!auction.topBidderId && Number(auction.bidCount ?? 0) > 0,
      };
    }
    if (currentStatus === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "Cancelled auctions cannot be closed for demo."
      );
    }

    const artworkId = readOptionalString(auction.artworkId);
    if (!artworkId) {
      throw new HttpsError(
        "failed-precondition",
        "Auction is missing artworkId."
      );
    }

    const hasWinner =
      !!readOptionalString(auction.topBidderId) &&
      Number(auction.bidCount ?? 0) > 0;

    tx.update(auctionRef, {
      status: "ended",
      endedAt: auction.endedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (!hasWinner) {
      tx.update(db.collection("artworks").doc(artworkId), {
        saleMode: "fixed",
        status: "for_sale",
        auctionId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      status: "ended" as AuctionStatus,
      hasWinner,
    };
  });

  if (!closeResult.hasWinner) {
    return {
      auctionId,
      status: closeResult.status,
      hasWinner: false,
    };
  }

  const invoiceResult = await createWinnerInvoiceForAuction(auctionId);
  return {
    auctionId,
    status: "ended",
    invoiceId: invoiceResult.invoiceId,
    invoiceCreated: invoiceResult.created,
    hasWinner: true,
  };
};

export const createAuction = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const artworkId = readRequiredString(request.data?.artworkId, "artworkId");
  const startsAt = readAuctionDate(request.data?.startsAt, "startsAt");
  const endsAt = readAuctionDate(request.data?.endsAt, "endsAt");
  const startingPrice = readPositiveNumber(
    request.data?.startingPrice,
    "startingPrice"
  );
  const minIncrement = readPositiveNumber(
    request.data?.minIncrement,
    "minIncrement"
  );
  const currency =
    typeof request.data?.currency === "string" &&
    AUCTION_CURRENCIES.includes(request.data.currency) ?
      request.data.currency :
      "USD";
  const stage = isAuctionStage(request.data?.stage) ?
    request.data.stage :
    "sketch";
  const now = new Date();

  if (startsAt >= endsAt) {
    throw new HttpsError(
      "invalid-argument",
      "startsAt must be before endsAt."
    );
  }

  if (endsAt <= now) {
    throw new HttpsError(
      "invalid-argument",
      "endsAt must be in the future."
    );
  }

  const artworkRef = db.collection("artworks").doc(artworkId);
  const auctionRef = db.collection("auctions").doc();
  const status = resolveAuctionStatus(now, startsAt, endsAt);

  await db.runTransaction(async (tx) => {
    const artworkSnap = await tx.get(artworkRef);
    if (!artworkSnap.exists) {
      throw new HttpsError("not-found", "Artwork not found.");
    }

    const artwork = artworkSnap.data() || {};
    const artistId = artwork.artistId || artwork.authorId;
    if (artistId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the artwork owner can create an auction."
      );
    }

    if (artwork.status === "sold" || artwork.isActive === false) {
      throw new HttpsError(
        "failed-precondition",
        "Sold artworks cannot be auctioned."
      );
    }

    if (artwork.saleMode === "auction" && artwork.auctionId) {
      throw new HttpsError(
        "failed-precondition",
        "This artwork already has an auction."
      );
    }

    // Tao auction va khoa artwork sang trang thai on_auction trong cung
    // transaction de tranh 1 artwork bi mo nhieu phien cung luc.
    tx.set(auctionRef, {
      artworkId,
      artistId: uid,
      status,
      stage,
      startsAt: admin.firestore.Timestamp.fromDate(startsAt),
      endsAt: admin.firestore.Timestamp.fromDate(endsAt),
      startingPrice,
      currentBid: startingPrice,
      minIncrement,
      topBidderId: null,
      bidCount: 0,
      currency,
      depositPolicy: {
        thresholdTrustScore: TRUST_SCORE_DEPOSIT_THRESHOLD,
        depositRate: BID_DEPOSIT_RATE,
      },
      winnerInvoiceId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.update(artworkRef, {
      saleMode: "auction",
      auctionId: auctionRef.id,
      status: "on_auction",
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    auctionId: auctionRef.id,
    status,
  };
});

export const prepareBid = onCall(
  {
    secrets: [PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

    const auctionId = readRequiredString(request.data?.auctionId, "auctionId");
    const amount = readPositiveNumber(request.data?.amount, "amount");
    const auctionSnap = await db.collection("auctions").doc(auctionId).get();
    if (!auctionSnap.exists) {
      throw new HttpsError("not-found", "Auction not found.");
    }
    const auction = auctionSnap.data() || {};
    assertAuctionAcceptsBid(auction, uid, amount);

    const trustScore = await getUserTrustScore(uid);
    if (trustScore >= TRUST_SCORE_DEPOSIT_THRESHOLD) {
      return {
        requiresDeposit: false,
        trustScore,
        threshold: TRUST_SCORE_DEPOSIT_THRESHOLD,
      };
    }

    const currency = readOptionalString(auction.currency) || "USD";
    const depositAmount = calculateBidDepositAmount(amount, currency);
    const depositRef = db.collection("auctionDeposits").doc();
    const invoiceRef = db.collection("invoices").doc();
    const invoiceNumber = buildInvoiceNumber(invoiceRef.id);
    const [seller, buyer] = await Promise.all([
      getUserSnapshot(readRequiredString(auction.artistId, "artistId")),
      getUserSnapshot(uid),
    ]);
    const invoiceData: admin.firestore.DocumentData = {
      status: "sent",
      source: "auction_deposit",
      type: "auction_deposit",
      auctionId,
      depositId: depositRef.id,
      invoiceNumber,
      isActive: true,
      sellerId: auction.artistId,
      buyerId: uid,
      sellerSnapshot: {
        uid: auction.artistId,
        displayName: seller.displayName || "Artist",
        photoURL: seller.photoURL || "",
      },
      buyer: {
        name: buyer.displayName || buyer.email || "Bidder",
        email: buyer.email || "",
        message: "Auction bid deposit",
      },
      items: [
        {
          type: "custom",
          title: "Auction bid deposit",
          quantity: 1,
          unitPrice: depositAmount,
        },
      ],
      currency,
      totals: {
        subtotal: depositAmount,
        total: depositAmount,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSentAt: FieldValue.serverTimestamp(),
      sentCount: 1,
    };
    const link = await createPayosLinkForInvoice(
      invoiceRef.id,
      invoiceData,
      request.data?.returnUrlBase,
      request.data?.cancelUrlBase
    );

    const batch = db.batch();
    batch.set(invoiceRef, {
      ...invoiceData,
      ...buildPaymentPatch(link),
    });
    batch.set(depositRef, {
      auctionId,
      bidderId: uid,
      bidAmount: amount,
      depositAmount,
      currency,
      status: "pending" satisfies DepositStatus,
      paymentInvoiceId: invoiceRef.id,
      paymentOrderCode: link.orderCode,
      checkoutUrl: link.checkoutUrl,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return {
      requiresDeposit: true,
      depositId: depositRef.id,
      depositAmount,
      checkoutUrl: link.checkoutUrl,
      paymentInvoiceId: invoiceRef.id,
      trustScore,
      threshold: TRUST_SCORE_DEPOSIT_THRESHOLD,
    };
  }
);

export const placeBid = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const auctionId = readRequiredString(request.data?.auctionId, "auctionId");
  const amount = readPositiveNumber(request.data?.amount, "amount");
  const trustScore = await getUserTrustScore(uid);
  const deposit = trustScore >= TRUST_SCORE_DEPOSIT_THRESHOLD ?
    undefined :
    await validatePaidDepositForBid(
      uid,
      auctionId,
      amount,
      readOptionalString(request.data?.depositId)
    );

  return placeBidForUser({uid, auctionId, amount, deposit});
});

export const createWinnerInvoice = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const auctionId = readRequiredString(request.data?.auctionId, "auctionId");
  const auctionSnap = await db.collection("auctions").doc(auctionId).get();
  if (!auctionSnap.exists) {
    throw new HttpsError("not-found", "Auction not found.");
  }

  const auction = auctionSnap.data() || {};
  const artistId = readOptionalString(auction.artistId);
  const topBidderId = readOptionalString(auction.topBidderId);
  const status = readOptionalString(auction.status);
  const endsAt = readAuctionDate(auction.endsAt, "endsAt");
  if (status === "cancelled") {
    throw new HttpsError(
      "failed-precondition",
      "Cancelled auctions cannot create winner invoices."
    );
  }
  const canCreateAfterExpiry =
    ["scheduled", "live"].includes(status || "") &&
    Date.now() >= endsAt.getTime();
  if (!["ended", "settled"].includes(status || "") && !canCreateAfterExpiry) {
    throw new HttpsError(
      "failed-precondition",
      "Winner invoice can only be created after the auction ends."
    );
  }
  if (uid !== artistId && uid !== topBidderId) {
    throw new HttpsError(
      "permission-denied",
      "Only the artist or winner can create the winner invoice."
    );
  }

  return createWinnerInvoiceForAuction(auctionId);
});

export const demoCloseAuction = onCall(async (request) => {
  assertDemoMode();
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const auctionId = readRequiredString(request.data?.auctionId, "auctionId");
  const auctionSnap = await db.collection("auctions").doc(auctionId).get();
  if (!auctionSnap.exists) {
    throw new HttpsError("not-found", "Auction not found.");
  }
  const auction = auctionSnap.data() || {};
  if (auction.artistId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Only the artist can close this auction for demo."
    );
  }

  return closeAuctionNow(auctionId);
});

export const advanceAuctionStage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const auctionId = readRequiredString(request.data?.auctionId, "auctionId");
  const auctionRef = db.collection("auctions").doc(auctionId);

  return db.runTransaction(async (tx) => {
    const auctionSnap = await tx.get(auctionRef);
    if (!auctionSnap.exists) {
      throw new HttpsError("not-found", "Auction not found.");
    }

    const auction = auctionSnap.data() || {};
    if (auction.artistId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the artist can update auction stage."
      );
    }
    if (auction.status === "cancelled") {
      throw new HttpsError(
        "failed-precondition",
        "Cancelled auctions cannot change stage."
      );
    }

    const currentStage = isAuctionStage(auction.stage) ?
      auction.stage :
      "sketch";
    const currentIndex = AUCTION_STAGES.indexOf(currentStage);
    const nextStage = AUCTION_STAGES[currentIndex + 1];
    if (!nextStage) {
      throw new HttpsError(
        "failed-precondition",
        "Auction is already at final stage."
      );
    }

    tx.update(auctionRef, {
      stage: nextStage,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      auctionId,
      stage: nextStage,
    };
  });
});

// Scheduled function chot cac phien dau gia het gio.
// Chay moi 5 phut de kiem tra cac auction da het han.
export const closeExpiredAuctions = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await db.collection("auctions")
      .where("status", "in", ["scheduled", "live"])
      .where("endsAt", "<=", now)
      .get();

    if (snapshot.empty) {
      console.log("No expired auctions to close.");
      return null;
    }

    let closedWithWinner = 0;
    let closedWithoutBids = 0;

    for (const docSnap of snapshot.docs) {
      const auction = docSnap.data();
      const auctionId = docSnap.id;
      const auctionRef = docSnap.ref;
      const artworkId = auction.artworkId;

      if (typeof artworkId !== "string" || !artworkId) {
        console.warn(`Auction ${auctionId} missing artworkId, skipping.`);
        continue;
      }

      try {
        const closeResult = await db.runTransaction(async (tx) => {
          const latestSnap = await tx.get(auctionRef);
          if (!latestSnap.exists) return null;
          const latest = latestSnap.data() || {};
          const currentStatus = latest.status as AuctionStatus;

          if (["ended", "settled", "cancelled"].includes(currentStatus)) {
            return null;
          }

          const topBidderId = typeof latest.topBidderId === "string" ?
            latest.topBidderId :
            null;
          const hasBids = Number(latest.bidCount ?? 0) > 0;
          const hasWinner = !!topBidderId && hasBids;
          const artistId = typeof latest.artistId === "string" ?
            latest.artistId :
            undefined;
          const artworkRef = db.collection("artworks").doc(artworkId);
          const artworkSnap = hasBids ? null : await tx.get(artworkRef);

          if (hasWinner) {
            tx.update(auctionRef, {
              status: "ended",
              endedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            return {
              hasWinner: true,
              shouldNotifyArtist: true,
              artistId,
              topBidderId,
              artworkId,
            } satisfies CloseAuctionResult;
          } else {
            tx.update(auctionRef, {
              status: "ended",
              endedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            if (artworkSnap?.exists) {
              tx.update(artworkRef, {
                saleMode: "fixed",
                status: "for_sale",
                auctionId: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }

            if (hasBids) {
              console.warn(
                `Auction ${auctionId} has bids but no topBidderId.`
              );
            }

            return {
              hasWinner: false,
              shouldNotifyArtist: false,
            } satisfies CloseAuctionResult;
          }
        });

        if (!closeResult) continue;

        if (closeResult.hasWinner) {
          closedWithWinner++;
          const invoiceResult = await createWinnerInvoiceForAuction(auctionId);
          if (
            closeResult.shouldNotifyArtist &&
            closeResult.artistId &&
            closeResult.topBidderId
          ) {
            await createNotification(closeResult.artistId, {
              type: "auction_ended",
              actorId: closeResult.topBidderId,
              actorName: "Artium",
              auctionId,
              artworkId: closeResult.artworkId,
              message: invoiceResult.created ?
                "Your auction ended. Winner invoice is ready." :
                "Your auction ended. You have a winner!",
            });
          }
        } else {
          closedWithoutBids++;
        }
      } catch (err) {
        console.error(`Failed to close auction ${auctionId}:`, err);
      }
    }

    console.log(
      "closeExpiredAuctions done. " +
      `Closed: ${closedWithWinner} with winner, ` +
      `${closedWithoutBids} without bids.`
    );
    return null;
  });

export const handleOverdueAuctionPayments = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await db.collection("auctions")
      .where("status", "==", "awaiting_payment")
      .where("paymentDueAt", "<=", now)
      .get();

    if (snapshot.empty) {
      console.log("No overdue auction payments.");
      return null;
    }

    for (const auctionSnap of snapshot.docs) {
      const auctionId = auctionSnap.id;
      const auctionRef = auctionSnap.ref;
      const auction = auctionSnap.data() || {};
      const currentWinnerId = readOptionalString(auction.topBidderId);
      const currentInvoiceId = readOptionalString(auction.winnerInvoiceId);
      if (!currentWinnerId) continue;

      const invoiceRef = currentInvoiceId ?
        db.collection("invoices").doc(currentInvoiceId) :
        null;
      const invoiceSnap = invoiceRef ? await invoiceRef.get() : null;
      const invoiceData = invoiceSnap?.data() || {};
      if (
        invoiceData.status === "paid" ||
        invoiceData.payment?.status === "paid"
      ) {
        continue;
      }

      const failedWinnerIds = Array.isArray(auction.failedWinnerIds) ?
        auction.failedWinnerIds.filter((id: unknown): id is string =>
          typeof id === "string"
        ) :
        [];
      const nextFailedWinnerIds = Array.from(
        new Set([...failedWinnerIds, currentWinnerId])
      );
      const nextBid = await chooseNextEligibleBid(
        auctionId,
        nextFailedWinnerIds
      );

      await db.runTransaction(async (tx) => {
        const latestAuctionSnap = await tx.get(auctionRef);
        if (!latestAuctionSnap.exists) return;
        const latestAuction = latestAuctionSnap.data() || {};
        if (latestAuction.status !== "awaiting_payment") return;
        if (latestAuction.topBidderId !== currentWinnerId) return;

        if (invoiceRef) {
          tx.update(invoiceRef, {
            status: "cancelled",
            isActive: false,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const depositId = readOptionalString(invoiceData.depositId);
        if (depositId) {
          tx.update(db.collection("auctionDeposits").doc(depositId), {
            status: "forfeited" satisfies DepositStatus,
            forfeitedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const auctionUpdate: Record<string, unknown> = {
          failedWinnerIds: nextFailedWinnerIds,
          paymentDueAt: FieldValue.delete(),
          winnerInvoiceId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (nextBid) {
          auctionUpdate.status = "ended";
          auctionUpdate.topBidderId = nextBid.bidderId;
          auctionUpdate.currentBid = nextBid.amount;
        } else {
          auctionUpdate.status = "ended";
        }
        tx.update(auctionRef, auctionUpdate);
      });

      await penalizeUnpaidWinner(currentWinnerId);

      if (nextBid) {
        await createWinnerInvoiceForAuction(auctionId);
      } else {
        await markAllAuctionDepositsRefundPending(auctionId, "winner_changed");
      }
    }

    return null;
  });

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
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }

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
    if (!isInvoiceParticipant(invoice, uid)) {
      throw new HttpsError(
        "permission-denied",
        "Only the invoice buyer or seller can create a payment link."
      );
    }

    if (invoice.payment?.status === "paid") {
      throw new HttpsError("failed-precondition", "Invoice already paid.");
    }

    const link = await createPayosLinkForInvoice(
      invoiceId,
      invoice,
      request.data?.returnUrlBase,
      request.data?.cancelUrlBase
    );
    await invoiceRef.update(buildPaymentPatch(link));

    return {
      checkoutUrl: link.checkoutUrl,
      orderCode: link.orderCode,
      paymentLinkId: link.paymentLinkId,
      returnUrl: link.returnUrl,
      cancelUrl: link.cancelUrl,
    };
  }
);

export const finalizePayosPayment = onCall(
  {
    secrets: [PAYOS_CLIENT_ID, PAYOS_API_KEY],
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

    const invoiceData = invoiceSnap.data() as admin.firestore.DocumentData;
    const isAlreadyPaid =
      invoiceData?.payment?.status === "paid" || invoiceData?.status === "paid";
    if (isAlreadyPaid) {
      if (getInvoiceSource(invoiceData) === "auction_deposit") {
        await settlePaidDepositInvoice(invoiceRef, invoiceData, {});
      }
      return {status: "paid"};
    }

    const verified = await getVerifiedPayosStatus(invoiceData);
    const update: Record<string, unknown> = {
      "payment.status": verified.status ?? "pending",
      "payment.rawPayload": verified.rawPayload,
    };
    if (verified.paymentLinkId) {
      update["payment.paymentLinkId"] = verified.paymentLinkId;
    }
    if (verified.transactionId) {
      update["payment.transactionId"] = verified.transactionId;
    }

    if (verified.status === "paid") {
      await finalizePaidInvoice(invoiceRef, invoiceData, update);
    } else {
      const batch = db.batch();
      batch.update(invoiceRef, update);
      await batch.commit();
    }
    return {status: verified.status ?? "pending"};
  }
);

export const demoMarkAuctionInvoicePaid = onCall(async (request) => {
  assertDemoMode();
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const invoiceId = readRequiredString(request.data?.invoiceId, "invoiceId");
  const invoiceRef = db.collection("invoices").doc(invoiceId);
  const invoiceSnap = await invoiceRef.get();
  if (!invoiceSnap.exists) {
    throw new HttpsError("not-found", "Invoice not found.");
  }

  const invoiceData = invoiceSnap.data() as admin.firestore.DocumentData;
  const auctionId = getInvoiceAuctionId(invoiceData);
  if (!auctionId) {
    throw new HttpsError(
      "failed-precondition",
      "Demo payment is only available for auction invoices."
    );
  }
  if (invoiceData.buyerId !== uid && invoiceData.sellerId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Only the invoice buyer or seller can mark this demo invoice paid."
    );
  }

  const isAlreadyPaid =
    invoiceData?.payment?.status === "paid" || invoiceData?.status === "paid";
  if (isAlreadyPaid) {
    return {status: "paid", invoiceId};
  }

  await finalizePaidInvoice(invoiceRef, invoiceData, {
    "payment.provider": invoiceData.payment?.provider || "payos",
    "payment.rawPayload": {
      source: "demoMarkAuctionInvoicePaid",
      markedBy: uid,
    },
  });
  return {status: "paid", invoiceId};
});

export const demoMarkDepositRefunded = onCall(async (request) => {
  assertDemoMode();
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  const depositId = readRequiredString(request.data?.depositId, "depositId");
  const depositRef = db.collection("auctionDeposits").doc(depositId);
  const depositSnap = await depositRef.get();
  if (!depositSnap.exists) {
    throw new HttpsError("not-found", "Auction deposit not found.");
  }
  const deposit = depositSnap.data() || {};
  if (deposit.status !== "refund_pending") {
    throw new HttpsError(
      "failed-precondition",
      "Only refund_pending deposits can be marked refunded."
    );
  }
  const auctionSnap = await db.collection("auctions")
    .doc(readRequiredString(deposit.auctionId, "auctionId"))
    .get();
  const auction = auctionSnap.data() || {};
  if (deposit.bidderId !== uid && auction.artistId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Only the bidder or auction artist can mark this demo deposit refunded."
    );
  }

  await depositRef.update({
    status: "refunded" satisfies DepositStatus,
    refundedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {depositId, status: "refunded"};
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
      await finalizePaidInvoice(invoiceDoc.ref, invoiceData, update);
    } else {
      const batch = db.batch();
      batch.update(invoiceDoc.ref, update);
      await batch.commit();
    }
    res.status(200).send("ok");
  }
);
