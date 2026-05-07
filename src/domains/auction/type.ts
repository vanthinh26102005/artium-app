export type AuctionStatus =
  | "scheduled"
  | "live"
  | "ended"
  | "settled"
  | "cancelled";

export type AuctionStage =
  | "sketch"
  | "color"
  | "final";

export type CurrencyCode =
  | "VND"
  | "USD";

export interface Auction {
  id: string;

  artworkId: string;
  artistId: string;

  status: AuctionStatus;
  stage: AuctionStage;

  startsAt: string; // ISO string hoặc Firestore Timestamp nếu dùng Firebase
  endsAt: string;

  startingPrice: number;
  currentBid: number;
  minIncrement: number;

  topBidderId?: string | null;
  bidCount: number;

  currency: CurrencyCode;

  winnerInvoiceId?: string | null;
}

export interface AuctionBid {
  id: string;

  auctionId: string;

  bidderId: string;
  amount: number;

  createdAt: string; // ISO string hoặc Firestore Timestamp
}