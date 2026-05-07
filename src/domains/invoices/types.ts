import type { AddressForm } from "../checkout/types";

export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
export type InvoiceDeliveryMethod = "seller" | "artium" | "invoice";
export type InvoicePaymentStatus = "pending" | "paid" | "failed" | "canceled";

export type InvoicePayment = {
  provider: "payos";
  status: InvoicePaymentStatus;
  orderCode: string | number;
  paymentLinkId?: string;
  checkoutUrl?: string;
  returnUrl?: string;
  cancelUrl?: string;
  version?: number;
  createdAt?: number;
  paidAt?: number;
  transactionId?: string;
  rawPayload?: Record<string, unknown>;
};

export type SellerSnapshot = {
  uid: string;
  displayName?: string;
  photoURL?: string;
};

export type InvoiceBuyer = {
  name?: string;
  email: string;
  message?: string;
};

export type InvoiceItem = {
  type: "artwork" | "custom";
  title: string;
  quantity: number;
  unitPrice: number;
  artworkId?: string;
  image?: string;
};

export type InvoiceTotals = {
  subtotal: number;
  depositApplied?: number;
  discount?: number;
  tax?: number;
  shipping?: number;
  total: number;
};

export type Invoice = {
  id: string;
  invoiceNumber?: string;
  source?: "auction" | string;
  type?: "auction" | string;
  auctionId?: string;
  artworkId?: string;
  depositId?: string;
  depositApplied?: number;
  status: InvoiceStatus;
  deliveryMethod?: InvoiceDeliveryMethod;
  shippingAddress?: AddressForm;
  payment?: InvoicePayment;
  isActive: boolean;
  paidAt?: number;
  sellerId: string;
  buyerId?: string; // Set when buyer creates invoice (checkout flow)
  sellerSnapshot: SellerSnapshot;
  buyer: InvoiceBuyer;
  items: InvoiceItem[];
  currency: string;
  totals: InvoiceTotals;
  createdAt?: number;
  updatedAt?: number;
  lastSentAt?: number;
  sentCount?: number;
};
