import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from "firebase/firestore";
import { firestore } from "@/configs/firebase";
import type {
  Invoice,
  InvoiceBuyer,
  InvoiceItem,
  InvoiceTotals,
  SellerSnapshot,
} from "../types";

const INVOICES_COLLECTION = "invoices";

type CreateInvoiceDraftParams = {
  sellerId: string;
  sellerSnapshot: SellerSnapshot;
  buyer: InvoiceBuyer;
  buyerId?: string; // Optional: set when buyer creates invoice (checkout flow)
  items: InvoiceItem[];
  currency: string;
  totals: InvoiceTotals;
};

const toMillis = (value: any) => {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  return undefined;
};

const mapInvoice = (id: string, data: any): Invoice => ({
  id,
  invoiceNumber: data.invoiceNumber,
  status: data.status ?? "draft",
  deliveryMethod: data.deliveryMethod,
  shippingAddress: data.shippingAddress,
  payment: data.payment
    ? {
        ...data.payment,
        createdAt: toMillis(data.payment.createdAt),
        paidAt: toMillis(data.payment.paidAt),
      }
    : undefined,
  isActive: data.isActive ?? true,
  paidAt: toMillis(data.paidAt),
  sellerId: data.sellerId,
  sellerSnapshot: data.sellerSnapshot,
  buyer: data.buyer,
  items: data.items ?? [],
  currency: data.currency,
  totals: data.totals,
  createdAt: toMillis(data.createdAt),
  updatedAt: toMillis(data.updatedAt),
  lastSentAt: toMillis(data.lastSentAt),
  sentCount: data.sentCount,
});

const buildInvoiceNumber = (id: string) => {
  const prefix = id.slice(0, 4).toUpperCase();
  const suffix = id.slice(-8).toUpperCase();
  return `IV-${prefix}-${suffix}`;
};

export const createInvoiceDraft = async (
  params: CreateInvoiceDraftParams
): Promise<{ invoiceId: string }> => {
  const { sellerId, sellerSnapshot, buyer, buyerId, items, currency, totals } = params;
  const docRef = doc(collection(firestore, INVOICES_COLLECTION));
  const invoiceNumber = buildInvoiceNumber(docRef.id);
  const invoiceData: Record<string, any> = {
    status: "draft",
    invoiceNumber,
    isActive: true,
    sellerId,
    sellerSnapshot,
    buyer,
    items,
    currency,
    totals,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  // Add buyerId if provided (checkout flow where buyer creates invoice)
  if (buyerId) {
    invoiceData.buyerId = buyerId;
  }
  await setDoc(docRef, invoiceData);
  return { invoiceId: docRef.id };
};

export const getInvoiceById = async (invoiceId: string): Promise<Invoice> => {
  const invoiceRef = doc(firestore, INVOICES_COLLECTION, invoiceId);
  const snap = await getDoc(invoiceRef);
  if (!snap.exists()) {
    throw new Error("Invoice not found");
  }
  return mapInvoice(snap.id, snap.data());
};

export const updateInvoice = async (
  invoiceId: string,
  patch: Partial<Invoice>
): Promise<void> => {
  const invoiceRef = doc(firestore, INVOICES_COLLECTION, invoiceId);
  await updateDoc(invoiceRef, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
};

export const markInvoiceSent = async (invoiceId: string): Promise<void> => {
  const invoiceRef = doc(firestore, INVOICES_COLLECTION, invoiceId);
  await updateDoc(invoiceRef, {
    status: "sent",
    lastSentAt: serverTimestamp(),
    sentCount: increment(1),
    updatedAt: serverTimestamp(),
  });
};

export const fetchInvoicesBySeller = async (
  sellerId: string
): Promise<Invoice[]> => {
  const q = query(
    collection(firestore, INVOICES_COLLECTION),
    where("sellerId", "==", sellerId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((docSnap) => mapInvoice(docSnap.id, docSnap.data()))
    .filter((invoice) => invoice.isActive !== false)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
};
