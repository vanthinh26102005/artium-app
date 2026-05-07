export type AuctionStatus =
  | "scheduled"
  | "live"
  | "ended"
  | "awaiting_payment"
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
  depositRequired?: boolean;
  depositId?: string;
  depositAmount?: number;
  depositStatus?: "paid" | "not_required";
}

export type DepositStatus =
  | "pending"
  | "paid"
  | "applied"
  | "refund_pending"
  | "refunded"
  | "forfeited"
  | "cancelled";

export interface AuctionDeposit {
  id: string;
  auctionId: string;
  bidderId: string;
  bidAmount: number;
  depositAmount: number;
  currency: CurrencyCode;
  status: DepositStatus;
  paymentInvoiceId?: string;
  paymentOrderCode?: number;
  checkoutUrl?: string;
  bidId?: string;
  appliedToInvoiceId?: string;
  refundAmount?: number;
  refundReason?: "lost_auction" | "auction_cancelled" | "winner_changed";
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string;
  refundedAt?: string;
  forfeitedAt?: string;
}
