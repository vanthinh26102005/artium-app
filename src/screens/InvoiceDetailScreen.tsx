import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal, BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Invoice } from "../domains/invoices/types";
import { updateInvoice } from "../domains/invoices/services/invoiceService";
import { useTabBarVisibility } from "../app/navigation/TabBarVisibilityContext";
import { createEmptyAddress } from "../domains/checkout/constants";
import { AddressSheet } from "../domains/checkout/components/sheets/AddressSheet";
import type { AddressForm } from "../domains/checkout/types";
import { firestore, functions } from "../configs/firebase";
import { doc, getDoc, onSnapshot, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import * as WebBrowser from "expo-web-browser";
import type { HomeStackParamList } from "../app/navigation/Stack/HomeStack";
import { demoMarkAuctionInvoicePaid } from "../domains/auction/services/auctionService";

const DELIVERY_OPTION_SELLER = "Pick up / Ship by seller";
const DELIVERY_OPTION_ARTIUM = "Ship by Artium";
const DELIVERY_OPTION_INVOICE = "Invoice Only";
const PAYOS_RETURN_URL_BASE = "artium://payos/return";
const PAYOS_CANCEL_URL_BASE = "artium://payos/cancel";

type DeliveryOption =
  | typeof DELIVERY_OPTION_SELLER
  | typeof DELIVERY_OPTION_ARTIUM
  | typeof DELIVERY_OPTION_INVOICE;

const DELIVERY_METHOD_MAP: Record<DeliveryOption, "seller" | "artium" | "invoice"> = {
  [DELIVERY_OPTION_SELLER]: "seller",
  [DELIVERY_OPTION_ARTIUM]: "artium",
  [DELIVERY_OPTION_INVOICE]: "invoice",
};

const DELIVERY_CONTENT: Record<DeliveryOption, any> = {
  [DELIVERY_OPTION_SELLER]: {
    info:
      "Once your payment is processed, you will receive an email to arrange the pick up, drop off, or coordinate their own shipping method of your artwork.",
    addressTitle: "Pick up / Ship Address",
    addressHelper:
      "Add your contact information and shipping address here for pick up arrangement purpose.",
  },
  [DELIVERY_OPTION_ARTIUM]: {
    title: "Artium handles shipping and insurance",
    description:
      "Selecting this option adds on shipping fee, calculated based on order subtotal. Flat fee of 5% for domestic, 8% for international. Oversized artworks will incur a flat fee of 10% for domestic, 15% for international shipping.",
    addressTitle: "Shipping Address",
    addressHelper:
      "Add buyer contact information and shipping address here for delivery purpose.",
    learnMore: "Learn more",
  },
  [DELIVERY_OPTION_INVOICE]: {
    info:
      "Select this for commission deposits, custom fees, non-artwork items, or items that don’t require Artium’s shipping or insurance. By choosing this option, you opt out of Artium’s refund policy, and all shipping/insurance must be arranged directly with the seller.",
  },
} as const;

const formatCurrency = (amount: number, currency: string) => {
  const prefix = currency === "USD" ? "US$ " : `${currency} `;
  return `${prefix}${amount.toFixed(2)}`;
};

const toMillis = (value: any) => {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  return undefined;
};

const mapInvoiceData = (id: string, data: any): Invoice => ({
  id,
  invoiceNumber: data.invoiceNumber,
  source: data.source,
  type: data.type,
  auctionId: data.auctionId,
  artworkId: data.artworkId,
  depositId: data.depositId,
  depositApplied: data.depositApplied,
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
  buyerId: data.buyerId,
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

const formatInvoiceNumber = (id: string) => {
  if (!id) return "Invoice";
  const prefix = id.slice(0, 4).toUpperCase();
  const suffix = id.slice(-8).toUpperCase();
  return `IV-${prefix}-${suffix}`;
};

export default function InvoiceDetailScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList, "InvoiceDetail">>();
  const route = useRoute<RouteProp<HomeStackParamList, "InvoiceDetail">>();
  const insets = useSafeAreaInsets();
  const [delivery, setDelivery] = useState<DeliveryOption>(
    DELIVERY_OPTION_SELLER
  );
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [demoPaying, setDemoPaying] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const paidHandledRef = useRef(false);
  const { setHidden } = useTabBarVisibility();
  const addressSheetRef = useRef<BottomSheetModal>(null);
  const [addressByMethod, setAddressByMethod] = useState<
    Record<"seller" | "artium", AddressForm>
  >({
    seller: createEmptyAddress(),
    artium: createEmptyAddress(),
  });

  const deliveryMethod = useMemo(
    () => DELIVERY_METHOD_MAP[delivery],
    [delivery]
  );
  const addressMethod = deliveryMethod === "artium" ? "artium" : "seller";
  const currentAddress = addressByMethod[addressMethod];
  const hasAddress = useMemo(
    () => Object.values(currentAddress).some((value) => value.trim().length > 0),
    [currentAddress]
  );
  const addressTitle =
    addressMethod === "artium" ? "Shipping Address" : "Pick up / ship address";
  const openAddressSheet = useCallback(() => {
    addressSheetRef.current?.present();
  }, []);

  const addressName = [currentAddress.firstName, currentAddress.lastName]
    .filter(Boolean)
    .join(" ");
  const addressLine = [currentAddress.address1, currentAddress.address2]
    .filter(Boolean)
    .join(", ");
  const addressLocation = [
    currentAddress.city,
    currentAddress.state,
    currentAddress.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const { invoiceId } = route.params;

  useEffect(() => {
    paidHandledRef.current = false;
    if (!invoiceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const invoiceRef = doc(firestore, "invoices", invoiceId);
    const unsubscribe = onSnapshot(
      invoiceRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setInvoice(null);
          setLoading(false);
          return;
        }
        setInvoice(mapInvoiceData(snapshot.id, snapshot.data()));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load invoice:", err);
        Alert.alert("Invoice not found", "Please try again.");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [invoiceId]);

  const handleRefresh = useCallback(async () => {
    if (!invoiceId) return;
    setRefreshing(true);
    try {
      const invoiceRef = doc(firestore, "invoices", invoiceId);
      const snapshot = await getDoc(invoiceRef);
      if (snapshot.exists()) {
        setInvoice(mapInvoiceData(snapshot.id, snapshot.data()));
      }
    } catch (err) {
      console.error("Failed to refresh invoice:", err);
    } finally {
      setRefreshing(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (!invoice) return;
    if (invoice.deliveryMethod === "seller") {
      setDelivery(DELIVERY_OPTION_SELLER);
    } else if (invoice.deliveryMethod === "artium") {
      setDelivery(DELIVERY_OPTION_ARTIUM);
    } else if (invoice.deliveryMethod === "invoice") {
      setDelivery(DELIVERY_OPTION_INVOICE);
    }
    if (invoice.shippingAddress) {
      const method =
        invoice.deliveryMethod === "artium" ? "artium" : "seller";
      setAddressByMethod((prev) => ({
        ...prev,
        [method]: invoice.shippingAddress ?? prev[method],
      }));
    }
  }, [invoice]);

  const handleSaveInvoiceAddress = useCallback(
    async (address: AddressForm) => {
      if (!invoiceId) return;
      if (deliveryMethod === "invoice") return;
      setAddressByMethod((prev) => ({
        ...prev,
        [deliveryMethod]: address,
      }));
      try {
        await updateInvoice(invoiceId, {
          deliveryMethod,
          shippingAddress: address,
        });
        setInvoice((prev) =>
          prev
            ? {
              ...prev,
              deliveryMethod,
              shippingAddress: address,
            }
            : prev
        );
      } catch (err) {
        console.error("Failed to save address:", err);
        Alert.alert("Save failed", "Please try again.");
      }
    },
    [deliveryMethod, invoiceId]
  );

  const handleSelectDelivery = useCallback(
    async (option: DeliveryOption) => {
      setDelivery(option);
      if (!invoiceId) return;
      const method = DELIVERY_METHOD_MAP[option];
      try {
        await updateInvoice(invoiceId, { deliveryMethod: method });
        setInvoice((prev) =>
          prev
            ? {
              ...prev,
              deliveryMethod: method,
            }
            : prev
        );
      } catch (err) {
        console.error("Failed to update delivery method:", err);
        Alert.alert("Update failed", "Please try again.");
      }
    },
    [invoiceId]
  );

  const createPayosPaymentLink = useMemo(
    () => httpsCallable(functions, "createPayosPaymentLink"),
    []
  );
  const finalizePayosPayment = useMemo(
    () => httpsCallable(functions, "finalizePayosPayment"),
    []
  );

  const isPaid =
    invoice?.status === "paid" || invoice?.payment?.status === "paid";
  const showDemoPay =
    __DEV__ && invoice?.source === "auction" && !isPaid;
  const depositApplied =
    typeof invoice?.totals?.depositApplied === "number" ?
      invoice.totals.depositApplied :
      typeof invoice?.depositApplied === "number" ?
        invoice.depositApplied :
        0;

  const handlePayWithCard = useCallback(async () => {
    if (!invoiceId || isPaid) return;
    setPaying(true);
    try {
      const result = await createPayosPaymentLink({
        invoiceId,
        returnUrlBase: PAYOS_RETURN_URL_BASE,
        cancelUrlBase: PAYOS_CANCEL_URL_BASE,
      });
      const data = result.data as {
        checkoutUrl?: string;
        returnUrl?: string;
      };
      if (!data?.checkoutUrl) {
        throw new Error("Missing checkoutUrl");
      }
      const returnUrl = data.returnUrl || PAYOS_RETURN_URL_BASE;
      const authResult = await WebBrowser.openAuthSessionAsync(
        data.checkoutUrl,
        returnUrl
      );
      if (authResult.type === "success") {
        const returnedUrl = authResult.url || "";
        if (returnedUrl.includes("payos/cancel")) {
          return;
        }
        await finalizePayosPayment({ invoiceId });
      }
    } catch (err) {
      console.error("Failed to start payment:", err);
      Alert.alert("Payment failed", "Please try again.");
    } finally {
      setPaying(false);
    }
  }, [createPayosPaymentLink, finalizePayosPayment, invoiceId, isPaid]);

  const handleDemoMarkPaid = useCallback(async () => {
    if (!invoiceId || isPaid || demoPaying) return;
    try {
      setDemoPaying(true);
      await demoMarkAuctionInvoicePaid({ invoiceId });
      await handleRefresh();
    } catch (err: any) {
      console.error("Failed to mark demo invoice paid:", err);
      Alert.alert(
        "Demo payment unavailable",
        err?.message || "Run this action against the Functions emulator/dev mode."
      );
    } finally {
      setDemoPaying(false);
    }
  }, [demoPaying, handleRefresh, invoiceId, isPaid]);

  useFocusEffect(
    React.useCallback(() => {
      setHidden(true);
      const parent = navigation.getParent();
      parent?.setOptions({ tabBarStyle: { display: "none" } });
      return () => {
        setHidden(false);
        parent?.setOptions({ tabBarStyle: undefined });
      };
    }, [navigation, setHidden])
  );

  const invoiceNumber = useMemo(() => {
    if (!invoice?.id) return "";
    return invoice.invoiceNumber || formatInvoiceNumber(invoice.id);
  }, [invoice?.id, invoice?.invoiceNumber]);

  useEffect(() => {
    if (!invoice || !isPaid || paidHandledRef.current) return;
    setRedirecting(true);
    const timer = setTimeout(() => {
      setRedirecting(false);
      paidHandledRef.current = true;
    }, 1200);
    return () => clearTimeout(timer);
  }, [invoice, isPaid]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!invoice) {
    return (
      <View style={styles.loading}>
        <Text style={styles.emptyText}>Invoice not available.</Text>
      </View>
    );
  }

  return (
    <BottomSheetModalProvider>
      <View style={styles.container}>
        <ImageBackground
          source={require("../../assets/auth-decor.jpg")}
          style={styles.background}
        >
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
          <View style={styles.overlay} />

          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom + 24, 32) },
            ]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
          >
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => navigation.goBack()}
                hitSlop={8}
                style={styles.backButton}
              >
                <Ionicons name="arrow-back" size={20} color="#0F172A" />
              </Pressable>
            </View>

            <Text style={styles.title}>Invoice{"\n"}#{invoiceNumber}</Text>
            {isPaid ? (
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                <Text style={styles.paidBadgeText}>Paid</Text>
              </View>
            ) : null}

            <View style={styles.secureRow}>
              <Ionicons name="lock-closed-outline" size={16} color="#94A3B8" />
              <Text style={styles.secureText}>SECURE CHECKOUT</Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={styles.primaryPill}>
                <Ionicons name="mail-outline" size={16} color="#0F172A" />
                <Text style={styles.primaryPillText}>Send Invoice</Text>
              </Pressable>

              <View style={styles.iconRow}>
                <IconButton icon="create-outline" onPress={() => { }} />
                <IconButton icon="qr-code-outline" onPress={() => { }} />
                <IconButton icon="link-outline" onPress={() => { }} />
                <IconButton icon="trash-outline" onPress={() => { }} />
              </View>
            </View>

            <InvoiceCardSection title="FROM">
              <Text style={styles.cardTitle}>
                {invoice.sellerSnapshot?.displayName || "Seller"}
              </Text>
              {invoice.sellerSnapshot?.uid ? (
                <Text style={styles.cardSubtitle}>{invoice.sellerSnapshot.uid}</Text>
              ) : null}
            </InvoiceCardSection>

            <InvoiceCardSection title="TO">
              <Text style={styles.cardTitle}>
                {invoice.buyer?.name || "Buyer"}
              </Text>
              <Text style={styles.cardSubtitle}>{invoice.buyer?.email}</Text>
            </InvoiceCardSection>

            <InvoiceCardSection title="ITEMS">
              {invoice.items.map((item, index) => (
                <View key={`${item.title}-${index}`} style={styles.itemRow}>
                  <Text style={styles.itemIndex}>#{index + 1}</Text>
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemName}>{item.title}</Text>
                    <Text style={styles.itemQty}>
                      Qty {item.quantity} ·{" "}
                      {formatCurrency(item.unitPrice, invoice.currency)}
                    </Text>
                  </View>
                </View>
              ))}
            </InvoiceCardSection>

            <InvoiceCardSection title="DELIVERY METHOD">
              {/* TODO: Wire delivery method when invoice schema supports it. */}
              <View style={styles.segmentGroup}>
                <View style={styles.segmentRow}>
                  <DeliveryOptionButton
                    label={DELIVERY_OPTION_SELLER}
                    selected={delivery === DELIVERY_OPTION_SELLER}
                    onPress={() => handleSelectDelivery(DELIVERY_OPTION_SELLER)}
                    fullWidth
                  />
                </View>
                <View style={styles.segmentRow}>
                  <DeliveryOptionButton
                    label={DELIVERY_OPTION_ARTIUM}
                    selected={delivery === DELIVERY_OPTION_ARTIUM}
                    onPress={() => handleSelectDelivery(DELIVERY_OPTION_ARTIUM)}
                  />
                  <DeliveryOptionButton
                    label={DELIVERY_OPTION_INVOICE}
                    selected={delivery === DELIVERY_OPTION_INVOICE}
                    onPress={() => handleSelectDelivery(DELIVERY_OPTION_INVOICE)}
                  />
                </View>
              </View>

              <View style={styles.deliveryBody}>
                {delivery === DELIVERY_OPTION_ARTIUM ? (
                  <>
                    <Text style={styles.deliveryTitle}>
                      {DELIVERY_CONTENT[DELIVERY_OPTION_ARTIUM].title}
                    </Text>
                    <Text style={styles.deliveryDescription}>
                      {DELIVERY_CONTENT[DELIVERY_OPTION_ARTIUM].description}{" "}
                      <Text style={styles.deliveryLink}>
                        {DELIVERY_CONTENT[DELIVERY_OPTION_ARTIUM].learnMore}
                      </Text>
                    </Text>
                    <Pressable style={styles.addressCard} onPress={openAddressSheet}>
                      <View style={styles.addressRow}>
                        <Text style={styles.addressTitle}>
                          {DELIVERY_CONTENT[DELIVERY_OPTION_ARTIUM].addressTitle}
                        </Text>
                        <Text style={styles.addressAction}>
                          {hasAddress ? "EDIT" : "ADD"}
                        </Text>
                      </View>
                      {hasAddress ? (
                        <View style={styles.addressDetails}>
                          {addressName ? (
                            <Text style={styles.addressName}>{addressName}</Text>
                          ) : null}
                          {currentAddress.email ? (
                            <Text style={styles.addressHelper}>
                              {currentAddress.email}
                            </Text>
                          ) : null}
                          {addressLine ? (
                            <Text style={styles.addressHelper}>{addressLine}</Text>
                          ) : null}
                          {addressLocation ? (
                            <Text style={styles.addressHelper}>
                              {addressLocation}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.addressHelper}>
                          {DELIVERY_CONTENT[DELIVERY_OPTION_ARTIUM].addressHelper}
                        </Text>
                      )}
                    </Pressable>
                  </>
                ) : delivery === DELIVERY_OPTION_SELLER ? (
                  <>
                    <View style={styles.infoCard}>
                      <View style={styles.infoIcon}>
                        <Ionicons
                          name="information-circle-outline"
                          size={18}
                          color="#64748B"
                        />
                      </View>
                      <Text style={styles.infoText}>
                        {DELIVERY_CONTENT[DELIVERY_OPTION_SELLER].info}
                      </Text>
                    </View>
                    <Pressable style={styles.addressCard} onPress={openAddressSheet}>
                      <View style={styles.addressRow}>
                        <Text style={styles.addressTitle}>
                          {DELIVERY_CONTENT[DELIVERY_OPTION_SELLER].addressTitle}
                        </Text>
                        <Text style={styles.addressAction}>
                          {hasAddress ? "EDIT" : "ADD"}
                        </Text>
                      </View>
                      {hasAddress ? (
                        <View style={styles.addressDetails}>
                          {addressName ? (
                            <Text style={styles.addressName}>{addressName}</Text>
                          ) : null}
                          {currentAddress.email ? (
                            <Text style={styles.addressHelper}>
                              {currentAddress.email}
                            </Text>
                          ) : null}
                          {addressLine ? (
                            <Text style={styles.addressHelper}>{addressLine}</Text>
                          ) : null}
                          {addressLocation ? (
                            <Text style={styles.addressHelper}>
                              {addressLocation}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.addressHelper}>
                          {DELIVERY_CONTENT[DELIVERY_OPTION_SELLER].addressHelper}
                        </Text>
                      )}
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.infoCard}>
                    <View style={styles.infoIcon}>
                      <Ionicons
                        name="information-circle-outline"
                        size={18}
                        color="#64748B"
                      />
                    </View>
                    <Text style={styles.infoText}>
                      {DELIVERY_CONTENT[DELIVERY_OPTION_INVOICE].info}
                    </Text>
                  </View>
                )}
              </View>
            </InvoiceCardSection>

            <InvoiceCardSection title="ORDER SUMMARY">
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>
                  {depositApplied > 0 ? "Winning bid" : "Subtotal"}
                </Text>
                <Text style={styles.summaryValue}>
                  {formatCurrency(invoice.totals.subtotal, invoice.currency)}
                </Text>
              </View>
              {depositApplied > 0 ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Deposit applied</Text>
                  <Text style={styles.summaryValue}>
                    -{formatCurrency(depositApplied, invoice.currency)}
                  </Text>
                </View>
              ) : null}
              {typeof invoice.totals.discount === "number" ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Discount</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(invoice.totals.discount, invoice.currency)}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.summaryRow, styles.summaryTotal]}>
                <Text style={styles.summaryTotalLabel}>Total</Text>
                <Text style={styles.summaryTotalValue}>
                  {formatCurrency(invoice.totals.total, invoice.currency)}
                </Text>
              </View>
            </InvoiceCardSection>

            <InvoiceCardSection title="IN-PERSON PAYMENT">
              <Text style={styles.paymentDescription}>
                To complete an in-person sale, select Tap to Pay for contactless or
                Pay by Card for other methods.
              </Text>
              <View style={styles.paymentRow}>
                <Pressable
                  style={[styles.paymentButton, styles.paymentButtonDisabled]}
                  disabled
                >
                  <Text style={styles.paymentButtonText}>Tap to Pay</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.paymentButton,
                    (isPaid || paying) && styles.paymentButtonDisabled,
                  ]}
                  onPress={handlePayWithCard}
                  disabled={isPaid || paying}
                >
                  {paying ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.paymentButtonText}>Pay with Card</Text>
                  )}
                </Pressable>
              </View>
              {showDemoPay ? (
                <Pressable
                  style={[
                    styles.demoPaymentButton,
                    demoPaying && styles.paymentButtonDisabled,
                  ]}
                  onPress={handleDemoMarkPaid}
                  disabled={demoPaying}
                >
                  {demoPaying ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <>
                      <Ionicons name="flash-outline" size={16} color="#0F172A" />
                      <Text style={styles.demoPaymentButtonText}>
                        Mark paid demo
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </InvoiceCardSection>

            <View style={styles.trustCard}>
              <View style={styles.trustIcon}>
                <Ionicons name="lock-closed-outline" size={18} color="#0B73FF" />
              </View>
              <View style={styles.trustCopy}>
                <Text style={styles.trustTitle}>
                  Your Trust is Our Priority
                </Text>
                <Text style={styles.trustText}>
                  Orders shipped with Artium are eligible for 100% money-back
                  guarantee, easy returns within a 48 hour window. Learn more in our{" "}
                  <Text style={styles.trustLink}>terms of service</Text>.
                </Text>
              </View>
            </View>

            <View style={styles.powered}>
              <Text style={styles.poweredLabel}>Powered by</Text>
              <Text style={styles.poweredBrand}>ARTIUM</Text>
            </View>
          </ScrollView>
          {redirecting ? (
            <View style={styles.redirectOverlay}>
              <View style={styles.redirectCard}>
                <ActivityIndicator color="#0B73FF" />
                <Text style={styles.redirectTitle}>Updating payment...</Text>
                <Text style={styles.redirectSubtitle}>
                  Please wait while we refresh your invoice.
                </Text>
              </View>
            </View>
          ) : null}
        </ImageBackground>

        <AddressSheet
          sheetRef={addressSheetRef}
          initialAddress={currentAddress}
          title={addressTitle}
          onSave={handleSaveInvoiceAddress}
        />
      </View>
    </BottomSheetModalProvider>
  );
}

function InvoiceCardSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardSectionTitle}>{title}</Text>
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

function IconButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.iconButton} onPress={onPress}>
      <Ionicons name={icon} size={18} color="#0F172A" />
    </Pressable>
  );
}

function DeliveryOptionButton({
  label,
  selected,
  onPress,
  fullWidth = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segment,
        fullWidth ? styles.segmentFull : styles.segmentHalf,
        selected ? styles.segmentActive : styles.segmentInactive,
      ]}
    >
      <Text style={selected ? styles.segmentTextActive : styles.segmentText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },
  background: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(248, 250, 252, 0.82)",
  },
  loading: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#64748B",
  },
  redirectOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  redirectCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  redirectTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  redirectSubtitle: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 18,
  },
  header: {
    height: 44,
    justifyContent: "center",
  },
  backButton: {
    height: 36,
    width: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 38,
  },
  paidBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#DCFCE7",
  },
  paidBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#15803D",
  },
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secureText: {
    fontSize: 12,
    letterSpacing: 0.8,
    color: "#94A3B8",
    fontWeight: "600",
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  primaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.15)",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  primaryPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  iconRow: {
    flexDirection: "row",
    gap: 10,
  },
  iconButton: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.8)",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    padding: 16,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  cardSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#94A3B8",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  cardSubtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  itemIndex: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94A3B8",
  },
  itemDetails: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },
  itemQty: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 6,
  },
  segmentGroup: {
    gap: 10,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 10,
  },
  segment: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentFull: {
    flex: 1,
  },
  segmentHalf: {
    flex: 1,
  },
  segmentActive: {
    borderColor: "#0B73FF",
    backgroundColor: "#EFF6FF",
  },
  segmentInactive: {
    borderColor: "rgba(148, 163, 184, 0.5)",
    backgroundColor: "rgba(255, 255, 255, 0.8)",
  },
  segmentText: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
  },
  segmentTextActive: {
    fontSize: 12,
    color: "#0B73FF",
    fontWeight: "700",
  },
  deliveryBody: {
    marginTop: 16,
    gap: 14,
  },
  deliveryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  deliveryDescription: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
  },
  deliveryLink: {
    color: "#0B73FF",
    textDecorationLine: "underline",
  },
  infoCard: {
    borderRadius: 16,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  infoIcon: {
    height: 28,
    width: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
  },
  addressCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#0B73FF",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255, 255, 255, 0.96)",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addressTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94A3B8",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  addressAction: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0B73FF",
  },
  addressHelper: {
    marginTop: 8,
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
  },
  addressDetails: {
    marginTop: 8,
    gap: 4,
  },
  addressName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0F172A",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#64748B",
  },
  summaryValue: {
    fontSize: 14,
    color: "#0F172A",
    fontWeight: "600",
  },
  summaryTotal: {
    marginTop: 4,
  },
  summaryTotalLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  summaryTotalValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  paymentDescription: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 16,
  },
  paymentRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  paymentButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B73FF",
  },
  paymentButtonDisabled: {
    backgroundColor: "#94A3B8",
  },
  paymentButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  demoPaymentButton: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  demoPaymentButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  trustCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    padding: 16,
    flexDirection: "row",
    gap: 12,
  },
  trustIcon: {
    height: 36,
    width: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  trustCopy: {
    flex: 1,
  },
  trustTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  trustText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 6,
    lineHeight: 16,
  },
  trustLink: {
    textDecorationLine: "underline",
  },
  powered: {
    alignItems: "center",
    paddingBottom: 8,
  },
  poweredLabel: {
    fontSize: 12,
    color: "#94A3B8",
  },
  poweredBrand: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: "700",
    color: "#CBD5E1",
    letterSpacing: 2,
  },
});
