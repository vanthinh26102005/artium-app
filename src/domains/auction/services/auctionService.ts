import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { firestore, functions } from "@/configs/firebase";
import type { Auction, AuctionBid, AuctionStage, AuctionStatus } from "../type";

const AUCTIONS_COLLECTION = "auctions";
const BIDS_COLLECTION = "bids";

export type CreateAuctionInput = {
  artworkId: string;
  startsAt: string | number | Date;
  endsAt: string | number | Date;
  startingPrice: number;
  minIncrement: number;
  currency: "VND" | "USD";
  stage?: AuctionStage;
};

export type CreateAuctionResult = {
  auctionId: string;
  status: AuctionStatus;
};

export type PlaceBidInput = {
  auctionId: string;
  amount: number;
};

export type PlaceBidResult = {
  auctionId: string;
  currentBid: number;
  topBidderId: string;
  bidCount: number;
};

export type AdvanceAuctionStageInput = {
  auctionId: string;
};

export type AdvanceAuctionStageResult = {
  auctionId: string;
  stage: AuctionStage;
};

export type CreateWinnerInvoiceInput = {
  auctionId: string;
};

export type CreateWinnerInvoiceResult = {
  invoiceId: string;
  created: boolean;
  artworkId?: string;
  artistId?: string;
  topBidderId?: string;
};

export type DemoCloseAuctionResult = {
  auctionId: string;
  status: AuctionStatus;
  invoiceId?: string;
  invoiceCreated?: boolean;
  hasWinner: boolean;
};

export type DemoMarkAuctionInvoicePaidResult = {
  invoiceId: string;
  status: "paid";
};

// Chuyen cac kieu thoi gian Firestore/JS ve ISO string de UI hien countdown de hon.
const toIsoString = (value: unknown): string => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
};

// Gom data Firestore ve dung shape Auction trong domain.
const mapAuction = (id: string, data: any): Auction => ({
  id,
  artworkId: data.artworkId ?? "",
  artistId: data.artistId ?? "",
  status: data.status ?? "scheduled",
  stage: data.stage ?? "sketch",
  startsAt: toIsoString(data.startsAt),
  endsAt: toIsoString(data.endsAt),
  startingPrice: Number(data.startingPrice ?? 0),
  currentBid: Number(data.currentBid ?? data.startingPrice ?? 0),
  minIncrement: Number(data.minIncrement ?? 0),
  topBidderId: data.topBidderId ?? null,
  bidCount: Number(data.bidCount ?? 0),
  currency: data.currency ?? "USD",
  winnerInvoiceId: data.winnerInvoiceId ?? null,
});

// Gom data Firestore ve dung shape AuctionBid trong domain.
const mapBid = (id: string, auctionId: string, data: any): AuctionBid => ({
  id,
  auctionId,
  bidderId: data.bidderId ?? "",
  amount: Number(data.amount ?? 0),
  createdAt: toIsoString(data.createdAt),
});

export const getAuctionById = async (
  auctionId: string
): Promise<Auction | null> => {
  const auctionRef = doc(firestore, AUCTIONS_COLLECTION, auctionId);
  const snapshot = await getDoc(auctionRef);

  if (!snapshot.exists()) return null;
  return mapAuction(snapshot.id, snapshot.data());
};

export const getAuctionByArtworkId = async (
  artworkId: string
): Promise<Auction | null> => {
  const q = query(
    collection(firestore, AUCTIONS_COLLECTION),
    where("artworkId", "==", artworkId),
    limit(1)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;
  const auctionDoc = snapshot.docs[0];
  return mapAuction(auctionDoc.id, auctionDoc.data());
};

// Lang nghe 1 auction realtime. UI dung ham nay de currentBid nhay ngay khi co bid moi.
export const subscribeToAuction = (
  auctionId: string,
  onUpdate: (auction: Auction | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const auctionRef = doc(firestore, AUCTIONS_COLLECTION, auctionId);

  return onSnapshot(
    auctionRef,
    (snapshot) => {
      onUpdate(snapshot.exists() ? mapAuction(snapshot.id, snapshot.data()) : null);
    },
    (error) => {
      console.error("Failed to subscribe to auction:", error);
      onError?.(error);
    }
  );
};

// Lang nghe auction theo artworkId. Tien khi ArtworkDetail chi biet artwork.id.
export const subscribeToArtworkAuction = (
  artworkId: string,
  onUpdate: (auction: Auction | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const q = query(
    collection(firestore, AUCTIONS_COLLECTION),
    where("artworkId", "==", artworkId),
    limit(1)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        onUpdate(null);
        return;
      }

      const auctionDoc = snapshot.docs[0];
      onUpdate(mapAuction(auctionDoc.id, auctionDoc.data()));
    },
    (error) => {
      console.error("Failed to subscribe to artwork auction:", error);
      onError?.(error);
    }
  );
};

// Lang nghe lich su bid realtime, mac dinh lay 20 bid moi nhat.
export const subscribeToAuctionBids = (
  auctionId: string,
  onUpdate: (bids: AuctionBid[]) => void,
  onError?: (error: Error) => void,
  pageSize: number = 20
): Unsubscribe => {
  const bidsRef = collection(
    firestore,
    AUCTIONS_COLLECTION,
    auctionId,
    BIDS_COLLECTION
  );
  const q = query(bidsRef, orderBy("createdAt", "desc"), limit(pageSize));

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(
        snapshot.docs.map((bidDoc) =>
          mapBid(bidDoc.id, auctionId, bidDoc.data())
        )
      );
    },
    (error) => {
      console.error("Failed to subscribe to auction bids:", error);
      onError?.(error);
    }
  );
};

// Tao auction qua Cloud Function de server kiem tra artwork co thuoc artist hay khong.
export const createAuction = async (
  input: CreateAuctionInput
): Promise<CreateAuctionResult> => {
  const createAuctionFn =
    httpsCallable<CreateAuctionInput, CreateAuctionResult>(functions, "createAuction");
  const result = await createAuctionFn(input);
  return result.data;
};

// Dat gia qua Cloud Function. Khong update Firestore truc tiep o client de tranh gian lan gia/gio.
export const placeBid = async (
  input: PlaceBidInput
): Promise<PlaceBidResult> => {
  const placeBidFn =
    httpsCallable<PlaceBidInput, PlaceBidResult>(functions, "placeBid");
  const result = await placeBidFn(input);
  return result.data;
};

export const advanceAuctionStage = async (
  input: AdvanceAuctionStageInput
): Promise<AdvanceAuctionStageResult> => {
  const advanceStageFn =
    httpsCallable<AdvanceAuctionStageInput, AdvanceAuctionStageResult>(
      functions,
      "advanceAuctionStage"
    );
  const result = await advanceStageFn(input);
  return result.data;
};

export const createWinnerInvoice = async (
  input: CreateWinnerInvoiceInput
): Promise<CreateWinnerInvoiceResult> => {
  const createWinnerInvoiceFn =
    httpsCallable<CreateWinnerInvoiceInput, CreateWinnerInvoiceResult>(
      functions,
      "createWinnerInvoice"
    );
  const result = await createWinnerInvoiceFn(input);
  return result.data;
};

export const demoCloseAuction = async (
  input: AdvanceAuctionStageInput
): Promise<DemoCloseAuctionResult> => {
  const demoCloseAuctionFn =
    httpsCallable<AdvanceAuctionStageInput, DemoCloseAuctionResult>(
      functions,
      "demoCloseAuction"
    );
  const result = await demoCloseAuctionFn(input);
  return result.data;
};

export const demoMarkAuctionInvoicePaid = async (
  input: { invoiceId: string }
): Promise<DemoMarkAuctionInvoicePaidResult> => {
  const demoMarkPaidFn =
    httpsCallable<{ invoiceId: string }, DemoMarkAuctionInvoicePaidResult>(
      functions,
      "demoMarkAuctionInvoicePaid"
    );
  const result = await demoMarkPaidFn(input);
  return result.data;
};
