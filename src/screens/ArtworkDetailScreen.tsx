// Detailed Artwork Screen
// src/screens/ArtworkDetailScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModalProvider, BottomSheetModal, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import * as WebBrowser from "expo-web-browser";
import { httpsCallable } from "firebase/functions";

import { discoverMockData } from "../domains/discover/mockData";
import { Artwork as DiscoverArtwork } from "../domains/discover/types";
import { useTabBarVisibility } from "../app/navigation/TabBarVisibilityContext";
import ReshareSheet from "../domains/feed/components/sheets/ReshareSheet";
import { FeedPost } from "../domains/feed/types";
import { Artwork as InventoryArtwork } from "../domains/inventory/types";

// Domain Imports
import { ArtworkDetail } from "../domains/artwork/types";
// --- UPDATED IMPORTS ---
import {
  getArtworkById,
  incrementArtworkView,
  toggleArtworkLike,
  deleteArtwork,
} from "../domains/artwork/services/artworkService";
import { addArtworkToMoodboard, findMoodboardForArtwork } from "../domains/artwork/services/moodboardService";
import SaveSheet from "../domains/artwork/components/SaveSheet";
import ReportSheet from "../domains/artwork/components/ReportSheet";
import ArtworkCarousel from "../domains/artwork/components/ArtworkCarousel";
import { shareArtwork } from "../shared/utils/shareArtwork";

// New Components
import ArtworkHeader from "../domains/artwork/components/ArtworkHeader";
import ArtworkInfo from "../domains/artwork/components/ArtworkInfo";
import ArtworkDetails from "../domains/artwork/components/ArtworkDetails";
import ArtworkActionBar from "../domains/artwork/components/ArtworkActionBar";
import { useAuth } from "../domains/auth/contexts/AuthContext";
import { createPost } from "../domains/feed/services/feedService";
import ImageViewing from "react-native-image-viewing";
import type { Auction, AuctionBid } from "../domains/auction/type";
import {
  advanceAuctionStage,
  createAuction,
  createWinnerInvoice,
  demoCloseAuction,
  placeBid,
  prepareBid,
  subscribeToArtworkAuction,
  subscribeToAuctionBids,
} from "../domains/auction/services/auctionService";
import { functions } from "../configs/firebase";

const PAYOS_RETURN_URL_BASE = "artium://payos/return";
const PAYOS_CANCEL_URL_BASE = "artium://payos/cancel";

export default function ArtworkDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { hidden, setHidden, height: tabHeight } = useTabBarVisibility();
  const { currentUser } = useAuth();
  const scrollY = useRef(0);
  const initialHeaderHeight = Math.max(insets.top + 56, 56);

  // States
  const [artwork, setArtwork] = useState<ArtworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [savedBoardId, setSavedBoardId] = useState<string | null>(null);
  const saved = !!savedBoardId;
  const [reshared, setReshared] = useState(false);
  const actionBottom = useRef(new RNAnimated.Value(tabHeight + 12)).current;
  const [showReshareSheet, setShowReshareSheet] = useState(false);
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [isResharing, setIsResharing] = useState(false);
  const [heroImageLoaded, setHeroImageLoaded] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(initialHeaderHeight);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [auctionBids, setAuctionBids] = useState<AuctionBid[]>([]);
  const [auctionNow, setAuctionNow] = useState(Date.now());
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [isPlacingBid, setIsPlacingBid] = useState(false);
  const [showStartAuctionModal, setShowStartAuctionModal] = useState(false);
  const [startAuctionPrice, setStartAuctionPrice] = useState("");
  const [startAuctionIncrement, setStartAuctionIncrement] = useState("");
  const [startAuctionDurationHours, setStartAuctionDurationHours] = useState("24");
  const [startAuctionCurrency, setStartAuctionCurrency] = useState<"VND" | "USD">("USD");
  const [isCreatingAuction, setIsCreatingAuction] = useState(false);
  const [isAdvancingStage, setIsAdvancingStage] = useState(false);
  const [isPreparingWinnerInvoice, setIsPreparingWinnerInvoice] = useState(false);
  const [isDemoClosingAuction, setIsDemoClosingAuction] = useState(false);
  const [depositPrompt, setDepositPrompt] = useState<{
    depositId: string;
    paymentInvoiceId: string;
    checkoutUrl: string;
    amount: number;
    depositAmount: number;
    trustScore: number;
    threshold: number;
  } | null>(null);
  const [isPayingDeposit, setIsPayingDeposit] = useState(false);

  // Image viewer state
  const viewerKeyRef = useRef(0);
  const [viewerState, setViewerState] = useState<{
    visible: boolean;
    images: { uri: string }[];
    initialIndex: number;
    key: string;
  }>({
    visible: false,
    images: [],
    initialIndex: 0,
    key: "viewer-0",
  });

  // Bottom Sheet Refs
  const optionsSheetRef = useRef<BottomSheetModal>(null);

  // --- DATA FETCHING & VIEW COUNT LOGIC ---
  const fetchArtwork = useCallback(async (showLoader = true) => {
    const artworkId = route.params?.id;
    if (!artworkId) {
      setError("No artwork ID provided.");
      setLoading(false);
      return;
    }

    try {
      if (showLoader) {
        setLoading(true);
        setHeroImageLoaded(false);
      }
      const artworkData: any = await getArtworkById(artworkId, currentUser?.uid);
      setArtwork(artworkData);
      setLiked(Boolean(artworkData?.liked));
      if (!artworkData?.images?.length) {
        setHeroImageLoaded(true);
      }
      // Increment view count after successfully fetching artwork
      if (artworkData) {
        await incrementArtworkView(artworkId);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching the artwork.");
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [route.params?.id, currentUser?.uid]);

  useEffect(() => {
    fetchArtwork();
  }, [fetchArtwork]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchArtwork(false);
    setRefreshing(false);
  }, [fetchArtwork]);

  useEffect(() => {
    if (!currentUser?.uid || !artwork?.id) {
      setSavedBoardId(null);
      return;
    }
    let isActive = true;
    findMoodboardForArtwork(currentUser.uid, artwork.id)
      .then((boardId) => {
        if (isActive) setSavedBoardId(boardId);
      })
      .catch((err) => {
        console.warn("Failed to load moodboard selection:", err);
        if (isActive) setSavedBoardId(null);
      });
    return () => {
      isActive = false;
    };
  }, [currentUser?.uid, artwork?.id]);

  useEffect(() => {
    if (!artwork?.id) {
      setAuction(null);
      return;
    }

    // ArtworkDetail chi biet artwork.id, nen nghe auction theo artworkId.
    return subscribeToArtworkAuction(
      artwork.id,
      setAuction,
      (err) => console.warn("Failed to load auction:", err)
    );
  }, [artwork?.id]);

  useEffect(() => {
    if (!auction?.id) {
      setAuctionBids([]);
      return;
    }

    return subscribeToAuctionBids(
      auction.id,
      setAuctionBids,
      (err) => console.warn("Failed to load bids:", err),
      8
    );
  }, [auction?.id]);

  useEffect(() => {
    if (!auction) return;

    const timerId = setInterval(() => {
      setAuctionNow(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [auction]);


  const reshareTarget: FeedPost | null = useMemo(() => {
    if (!artwork) return null;
    const quoteMedia =
      artwork.images?.length > 0
        ? {
          url: artwork.images[0],
          placeholderColor: "#CBD5E1",
          aspectRatio: 3 / 3,
        }
        : undefined;
    return {
      id: artwork.id,
      author: {
        id: artwork.artist.name,
        name: artwork.artist.name,
        handle: artwork.artist.name.replace(/\s+/g, "").toLowerCase(),
        avatar: artwork.artist.avatar,
        verified: artwork.artist.verified,
      },
      content: `${artwork.title} · ${artwork.price}`,
      createdAt: Date.now(),
      relativeTime: "Just now",
      media: quoteMedia,
      quote: {
        id: artwork.id,
        authorId: artwork.artist.name,
        authorName: artwork.artist.name,
        handle: artwork.artist.name.replace(/\s+/g, "").toLowerCase(),
        avatar: artwork.artist.avatar,
        title: artwork.title,
        subtitle: artwork.artist.name,
        priceLabel: artwork.price,
        content: artwork.description || artwork.title,
        createdAt: Date.now(),
        media: quoteMedia,
        relativeTime: "Just now",
      },
      metrics: { likes: 0, comments: 0, shares: 0 },
    };
  }, [artwork]);

  const isSold = artwork?.status === "sold" || artwork?.isActive === false;
  const isArtworkOwner = artwork?.artistId === currentUser?.uid;
  const hasAuction = !!auction;
  const auctionStartsAt = auction ? new Date(auction.startsAt).getTime() : 0;
  const auctionEndsAt = auction ? new Date(auction.endsAt).getTime() : 0;
  const isAuctionStarted = hasAuction && auctionNow >= auctionStartsAt;
  const isAuctionEnded =
    hasAuction &&
    (auctionNow >= auctionEndsAt ||
      ["ended", "awaiting_payment", "settled", "cancelled"].includes(auction.status));
  const isAuctionOwner = !!auction && auction.artistId === currentUser?.uid;
  const isAuctionWinner =
    !!auction?.topBidderId && auction.topBidderId === currentUser?.uid;
  const canOpenWinnerInvoice =
    !!auction?.winnerInvoiceId &&
    isAuctionWinner &&
    ["ended", "awaiting_payment", "settled"].includes(auction.status);
  const canPrepareWinnerInvoice =
    !!auction &&
    !auction.winnerInvoiceId &&
    isAuctionWinner &&
    isAuctionEnded &&
    auction.bidCount > 0;
  const canAdvanceAuctionStage =
    !!auction &&
    isAuctionOwner &&
    auction.status !== "cancelled" &&
    auction.stage !== "final";
  const canDemoCloseAuction =
    __DEV__ &&
    !!auction &&
    isAuctionOwner &&
    ["scheduled", "live"].includes(auction.status);
  const canPlaceBid =
    !!auction &&
    !isSold &&
    !isAuctionOwner &&
    isAuctionStarted &&
    !isAuctionEnded;
  const canStartAuction = !!artwork && isArtworkOwner && !auction && !isSold;
  const nextBidAmount = auction
    ? auction.currentBid + auction.minIncrement
    : 0;
  const auctionPrimaryLabel = useMemo(() => {
    if (!auction) return undefined;
    if (canOpenWinnerInvoice) {
      return auction.status === "settled" ? "View invoice" : "Pay invoice";
    }
    if (canPrepareWinnerInvoice) return "Prepare invoice";
    if (isSold) return "Sold";
    if (isAuctionOwner) return "Your auction";
    if (!isAuctionStarted) return "Scheduled";
    if (isAuctionEnded) return "Ended";
    return "Place bid";
  }, [
    auction,
    canOpenWinnerInvoice,
    canPrepareWinnerInvoice,
    isAuctionEnded,
    isAuctionOwner,
    isAuctionStarted,
    isSold,
  ]);
  const primaryActionLabel = canStartAuction
    ? "Start auction"
    : auctionPrimaryLabel;
  const primaryActionIcon = canStartAuction
    ? "timer-outline"
    : auction
      ? "pricetag-outline"
      : "cart-outline";

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        pressBehavior="close"
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.4}
      />
    ),
    []
  );

  // Action bottom animation
  useEffect(() => {
    const targetBottom = hidden
      ? Math.max(insets.bottom + 6, 6)
      : tabHeight + 4;

    RNAnimated.spring(actionBottom, {
      toValue: targetBottom,
      useNativeDriver: false,
      damping: 16,
      stiffness: 200,
    }).start();
  }, [hidden, tabHeight, insets.bottom, actionBottom]);

  useEffect(
    () => () => {
      setHidden(false);
    },
    [setHidden]
  );

  const handleScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const diff = y - scrollY.current;
    if (Math.abs(diff) > 8) {
      if (diff > 0 && !hidden) {
        setHidden(true);
      } else if (diff < 0 && hidden) {
        setHidden(false);
      }
    }
    scrollY.current = y;
  };

  // --- LIKE HANDLER ---
  const handleLike = async () => {
    if (!artwork) return;
    if (!currentUser) {
      Alert.alert("Sign in required", "Please sign in to like this artwork.");
      return;
    }

    // Immediately update UI for better UX
    const newLikedState = !liked;
    setLiked(newLikedState);

    try {
      // Call the service to update Firestore
      await toggleArtworkLike(artwork.id, currentUser.uid, liked); // send previous state
    } catch (err) {
      // If the update fails, revert the UI and show an error
      console.error("Failed to update like status:", err);
      setLiked(!newLikedState); // Revert to original state
      Alert.alert("Error", "Could not update like status. Please try again.");
    }
  };

  // Sheet handlers
  const handleOpenOptionsSheet = useCallback(() => {
    setHidden(true);
    optionsSheetRef.current?.present();
  }, [setHidden]);

  const handleOpenSaveSheet = useCallback(() => {
    setHidden(true);
    setShowSaveSheet(true);
  }, [setHidden]);

  const handleOpenReshareSheet = useCallback(() => {
    if (!reshareTarget) return;
    setHidden(true);
    setShowReshareSheet(true);
  }, [setHidden, reshareTarget]);

  const handleOpenReportSheet = useCallback(() => {
    optionsSheetRef.current?.dismiss();
    setTimeout(() => {
      setShowReportSheet(true);
    }, 300);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setHidden(false);
  }, [setHidden]);

  // Image viewer handlers
  const handleOpenImageViewer = useCallback(
    (images: { uri: string }[], index: number) => {
      viewerKeyRef.current += 1;
      const key = `viewer-${viewerKeyRef.current}-${images.length}-${index}`;
      setViewerState({ visible: false, images, initialIndex: index, key });
      requestAnimationFrame(() => {
        setViewerState((prev) => ({ ...prev, visible: true }));
      });
    },
    []
  );

  const handleCloseImageViewer = useCallback(() => {
    setViewerState((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleShare = useCallback(async () => {
    if (!artwork) return;
    try {
      await shareArtwork({
        title: artwork.title,
        artistName: artwork.artist.name,
        marketing: "Khám phá tác phẩm này",
        deepLink: `https://www.artium.com/artwork/${artwork.id}`,
      });
    } catch (err) {
      Alert.alert("Share unavailable", "Không thể mở chia sẻ trên thiết bị này.");
    }
  }, [artwork]);

  const handleOpenArtViewAR = useCallback(() => {
    if (!artwork) return;
    if (!artwork.images?.[0]) {
      Alert.alert("Thiếu ảnh tranh", "Không có ảnh để thử treo tường.");
      return;
    }

    navigation.navigate("ArtViewAR", {
      artworkId: artwork.id,
      title: artwork.title,
      imageUrl: artwork.images[0],
      dimension: artwork.dimension,
    });
  }, [artwork, navigation]);

  const handleEditArtwork = useCallback(() => {
    if (!artwork) return;
    optionsSheetRef.current?.dismiss();
    setTimeout(() => {
      navigation.navigate("EditArtwork", { artwork });
    }, 300);
  }, [artwork, navigation]);

  const handleDeleteArtwork = useCallback(() => {
    if (!artwork || !currentUser) return;

    optionsSheetRef.current?.dismiss();

    setTimeout(() => {
      Alert.alert(
        'Delete artwork?',
        'If you delete this artwork, you won\'t be able to restore it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteArtwork(artwork.id, currentUser.uid);
                navigation.goBack();
              } catch (error: any) {
                console.error("Failed to delete artwork:", error);
                Alert.alert("Error", error.message || "Could not delete artwork. Please try again.");
              }
            }
          },
        ]
      );
    }, 300);
  }, [artwork, currentUser, navigation]);

  const handleOpenStartAuctionModal = useCallback(() => {
    if (!artwork) return;
    if (!currentUser) {
      Alert.alert("Sign in required", "Please sign in to start an auction.");
      return;
    }
    if (!canStartAuction) {
      Alert.alert("Unavailable", "This artwork cannot start a new auction.");
      return;
    }

    const defaultPrice = resolveArtworkPriceAmount(artwork);
    const defaultIncrement = Math.max(1, Math.round(defaultPrice * 0.05));
    setStartAuctionPrice(defaultPrice ? String(defaultPrice) : "");
    setStartAuctionIncrement(defaultIncrement ? String(defaultIncrement) : "");
    setStartAuctionDurationHours("24");
    setStartAuctionCurrency(
      artwork.priceSnapshot?.currency === "VND" ? "VND" : "USD"
    );
    setShowStartAuctionModal(true);
  }, [artwork, canStartAuction, currentUser]);

  const handleOpenStartAuctionFromOptions = useCallback(() => {
    optionsSheetRef.current?.dismiss();
    setTimeout(handleOpenStartAuctionModal, 250);
  }, [handleOpenStartAuctionModal]);

  const handleSubmitStartAuction = useCallback(async () => {
    if (!artwork || isCreatingAuction) return;

    const startingPrice = parseNumericInput(startAuctionPrice);
    const minIncrement = parseNumericInput(startAuctionIncrement);
    const durationHours = parseNumericInput(startAuctionDurationHours);

    if (!startingPrice || !minIncrement || !durationHours) {
      Alert.alert("Missing info", "Please enter price, increment, and duration.");
      return;
    }

    const startsAt = Date.now();
    const endsAt = startsAt + durationHours * 60 * 60 * 1000;

    try {
      setIsCreatingAuction(true);
      await createAuction({
        artworkId: artwork.id,
        startsAt,
        endsAt,
        startingPrice,
        minIncrement,
        currency: startAuctionCurrency,
        stage: "sketch",
      });
      setShowStartAuctionModal(false);
      await fetchArtwork(false);
    } catch (err: any) {
      console.error("Failed to create auction:", err);
      Alert.alert(
        "Could not start auction",
        err?.message || "Please try again."
      );
    } finally {
      setIsCreatingAuction(false);
    }
  }, [
    artwork,
    fetchArtwork,
    isCreatingAuction,
    startAuctionCurrency,
    startAuctionDurationHours,
    startAuctionIncrement,
    startAuctionPrice,
  ]);

  const handleOpenWinnerInvoice = useCallback(() => {
    if (!auction?.winnerInvoiceId) return;

    navigation.navigate("Tabs", {
      screen: "Home",
      params: {
        screen: "InvoiceDetail",
        params: { invoiceId: auction.winnerInvoiceId },
      },
    });
  }, [auction?.winnerInvoiceId, navigation]);

  const handlePrepareWinnerInvoice = useCallback(async () => {
    if (!auction || isPreparingWinnerInvoice) return;

    try {
      setIsPreparingWinnerInvoice(true);
      const result = await createWinnerInvoice({ auctionId: auction.id });
      navigation.navigate("Tabs", {
        screen: "Home",
        params: {
          screen: "InvoiceDetail",
          params: { invoiceId: result.invoiceId },
        },
      });
    } catch (err: any) {
      console.error("Failed to prepare winner invoice:", err);
      Alert.alert(
        "Invoice not ready",
        err?.message || "Please wait a moment and try again."
      );
    } finally {
      setIsPreparingWinnerInvoice(false);
    }
  }, [auction, isPreparingWinnerInvoice, navigation]);

  const handleAdvanceAuctionStage = useCallback(async () => {
    if (!auction || isAdvancingStage) return;
    if (!canAdvanceAuctionStage) {
      Alert.alert("Stage locked", "This auction cannot move to another stage.");
      return;
    }

    try {
      setIsAdvancingStage(true);
      await advanceAuctionStage({ auctionId: auction.id });
    } catch (err: any) {
      console.error("Failed to advance auction stage:", err);
      Alert.alert(
        "Could not update stage",
        err?.message || "Please refresh and try again."
      );
    } finally {
      setIsAdvancingStage(false);
    }
  }, [auction, canAdvanceAuctionStage, isAdvancingStage]);

  const handleDemoCloseAuction = useCallback(async () => {
    if (!auction || isDemoClosingAuction) return;
    if (!canDemoCloseAuction) {
      Alert.alert("Demo close unavailable", "Only the artist can close an active demo auction.");
      return;
    }

    try {
      setIsDemoClosingAuction(true);
      const result = await demoCloseAuction({ auctionId: auction.id });
      await fetchArtwork(false);
      Alert.alert(
        "Auction closed",
        result.hasWinner
          ? "Winner invoice is ready for the buyer."
          : "Auction closed without bids."
      );
    } catch (err: any) {
      console.error("Failed to close demo auction:", err);
      Alert.alert(
        "Demo close unavailable",
        err?.message || "Run this action against the Functions emulator/dev mode."
      );
    } finally {
      setIsDemoClosingAuction(false);
    }
  }, [auction, canDemoCloseAuction, fetchArtwork, isDemoClosingAuction]);

  const handleOpenBidModal = useCallback(() => {
    if (!auction) return;
    if (!currentUser) {
      Alert.alert("Sign in required", "Please sign in to place a bid.");
      return;
    }
    if (!canPlaceBid) {
      Alert.alert("Auction unavailable", "This auction is not accepting bids.");
      return;
    }

    setBidAmount(String(nextBidAmount));
    setShowBidModal(true);
  }, [auction, canPlaceBid, currentUser, nextBidAmount]);

  const handleSubmitBid = useCallback(async () => {
    if (!auction || isPlacingBid) return;
    const amount = Number(bidAmount.replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(amount) || amount < nextBidAmount) {
      Alert.alert(
        "Bid too low",
        `Your bid must be at least ${formatAuctionCurrency(nextBidAmount, auction.currency)}.`
      );
      return;
    }

    try {
      setIsPlacingBid(true);
      const bidPreparation = await prepareBid({
        auctionId: auction.id,
        amount,
        returnUrlBase: PAYOS_RETURN_URL_BASE,
        cancelUrlBase: PAYOS_CANCEL_URL_BASE,
      });
      if (bidPreparation.requiresDeposit) {
        if (
          !bidPreparation.depositId ||
          !bidPreparation.checkoutUrl ||
          !bidPreparation.paymentInvoiceId ||
          typeof bidPreparation.depositAmount !== "number"
        ) {
          throw new Error("Missing deposit checkout details.");
        }
        setDepositPrompt({
          depositId: bidPreparation.depositId,
          paymentInvoiceId: bidPreparation.paymentInvoiceId,
          checkoutUrl: bidPreparation.checkoutUrl,
          amount,
          depositAmount: bidPreparation.depositAmount,
          trustScore: bidPreparation.trustScore,
          threshold: bidPreparation.threshold,
        });
        setShowBidModal(false);
      } else {
        await placeBid({ auctionId: auction.id, amount });
        setShowBidModal(false);
      }
    } catch (err: any) {
      console.error("Failed to place bid:", err);
      Alert.alert(
        "Could not place bid",
        err?.message || "Please refresh and try again."
      );
    } finally {
      setIsPlacingBid(false);
    }
  }, [auction, bidAmount, isPlacingBid, nextBidAmount]);

  const handlePayDeposit = useCallback(async () => {
    if (!depositPrompt || isPayingDeposit) return;

    try {
      setIsPayingDeposit(true);
      const authResult = await WebBrowser.openAuthSessionAsync(
        depositPrompt.checkoutUrl,
        PAYOS_RETURN_URL_BASE
      );
      if (authResult.type === "success") {
        const returnedUrl = authResult.url || "";
        if (returnedUrl.includes("payos/cancel")) {
          return;
        }
        const finalizePayosPayment = httpsCallable(
          functions,
          "finalizePayosPayment"
        );
        await finalizePayosPayment({
          invoiceId: depositPrompt.paymentInvoiceId,
        });
        setDepositPrompt(null);
        Alert.alert(
          "Deposit paid",
          "Your bid will appear once the payment is verified."
        );
      }
    } catch (err: any) {
      console.error("Failed to pay bid deposit:", err);
      Alert.alert(
        "Deposit payment failed",
        err?.message || "Please try again."
      );
    } finally {
      setIsPayingDeposit(false);
    }
  }, [depositPrompt, isPayingDeposit]);

  // Conditional Rendering
  if (loading) {
    return (
      <View className="flex-1 bg-white">
        <View
          style={{ zIndex: 3 }}
          onLayout={(event) => {
            const nextHeight = event?.nativeEvent?.layout?.height;
            if (nextHeight && nextHeight !== headerHeight) {
              setHeaderHeight(nextHeight);
            }
          }}
        >
          <ArtworkHeader
            onBack={() => navigation.goBack()}
            onShare={handleShare}
            onOptions={handleOpenOptionsSheet}
          />
        </View>
        <ArtworkDetailSkeleton />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 justify-center items-center bg-white p-4">
        <Text className="text-lg text-red-500 text-center">{error}</Text>

        <Pressable onPress={() => navigation.goBack()} className="mt-4">
          <Text className="text-blue-500">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!artwork) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <Text className="text-lg text-slate-500">Artwork not found.</Text>
        <Pressable onPress={() => navigation.goBack()} className="mt-4">
          <Text className="text-blue-500">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <BottomSheetModalProvider>
      <View className="flex-1 bg-white">
        {/* Custom Header */}
        <View
          style={{ zIndex: 3 }}
          onLayout={(event) => {
            const nextHeight = event?.nativeEvent?.layout?.height;
            if (nextHeight && nextHeight !== headerHeight) {
              setHeaderHeight(nextHeight);
            }
          }}
        >
          <ArtworkHeader
            onBack={() => navigation.goBack()}
            onShare={handleShare}
            onOptions={handleOpenOptionsSheet}
          />
        </View>

        {/* Content */}
        <ScrollView
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0B73FF"
              colors={["#0B73FF"]}
            />
          }
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom + tabHeight + 10, 80),
          }}
        >
          <View className="px-4 pt-4">
            <ArtworkCarousel
              images={artwork.images}
              onImageLoad={() => setHeroImageLoaded(true)}
              onPressImage={handleOpenImageViewer}
            />
          </View>

          <ArtworkInfo detail={artwork} />
          {auction ? (
            <AuctionPanel
              auction={auction}
              bids={auctionBids}
              now={auctionNow}
              currentUserId={currentUser?.uid}
              canPlaceBid={canPlaceBid}
              canOpenWinnerInvoice={canOpenWinnerInvoice}
              canPrepareWinnerInvoice={canPrepareWinnerInvoice}
              canAdvanceStage={canAdvanceAuctionStage}
              canDemoClose={canDemoCloseAuction}
              nextBidAmount={nextBidAmount}
              advancingStage={isAdvancingStage}
              preparingWinnerInvoice={isPreparingWinnerInvoice}
              demoClosing={isDemoClosingAuction}
              onPlaceBid={handleOpenBidModal}
              onOpenWinnerInvoice={handleOpenWinnerInvoice}
              onPrepareWinnerInvoice={handlePrepareWinnerInvoice}
              onAdvanceStage={handleAdvanceAuctionStage}
              onDemoClose={handleDemoCloseAuction}
            />
          ) : null}
          <ArtworkDetails detail={artwork} />

          {/* Similar Works section removed for now */}
        </ScrollView>

        {/* Action Bar */}
        <RNAnimated.View
          className="absolute right-3"
          style={{
            bottom: RNAnimated.add(actionBottom, 72),
            zIndex: 2,
          }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleOpenArtViewAR}
            className="rounded-full bg-slate-900 px-4 py-3 border border-slate-700 flex-row items-center gap-2 active:opacity-90"
          >
            <Ionicons name="cube-outline" size={16} color="#ffffff" />
            <Text className="text-white font-semibold">Thử treo tường</Text>
          </Pressable>
        </RNAnimated.View>

        <ArtworkActionBar
          liked={liked}
          saved={saved}
          reshared={reshared}
          actionBottom={actionBottom}
          onLike={handleLike}
          onReshare={handleOpenReshareSheet}
          onSave={handleOpenSaveSheet}
          onBuy={
            canStartAuction
              ? handleOpenStartAuctionModal
              : auction
                ? canOpenWinnerInvoice
                  ? handleOpenWinnerInvoice
                  : canPrepareWinnerInvoice
                    ? handlePrepareWinnerInvoice
                    : handleOpenBidModal
                : () => navigation.navigate("Checkout", { artwork })
          }
          buyDisabled={
            auction
              ? !(canPlaceBid || canOpenWinnerInvoice || canPrepareWinnerInvoice)
              : isSold && !canStartAuction
          }
          primaryLabel={primaryActionLabel}
          primaryIcon={primaryActionIcon}
        />

        <StartAuctionModal
          visible={showStartAuctionModal}
          startingPrice={startAuctionPrice}
          minIncrement={startAuctionIncrement}
          durationHours={startAuctionDurationHours}
          currency={startAuctionCurrency}
          submitting={isCreatingAuction}
          onChangeStartingPrice={setStartAuctionPrice}
          onChangeMinIncrement={setStartAuctionIncrement}
          onChangeDurationHours={setStartAuctionDurationHours}
          onChangeCurrency={setStartAuctionCurrency}
          onClose={() => {
            if (!isCreatingAuction) setShowStartAuctionModal(false);
          }}
          onSubmit={handleSubmitStartAuction}
        />

        <BidModal
          visible={showBidModal}
          auction={auction}
          amount={bidAmount}
          nextBidAmount={nextBidAmount}
          submitting={isPlacingBid}
          onChangeAmount={setBidAmount}
          onClose={() => {
            if (!isPlacingBid) setShowBidModal(false);
          }}
          onSubmit={handleSubmitBid}
        />

        <BidDepositModal
          visible={!!depositPrompt}
          auction={auction}
          deposit={depositPrompt}
          paying={isPayingDeposit}
          onClose={() => {
            if (!isPayingDeposit) setDepositPrompt(null);
          }}
          onPay={handlePayDeposit}
        />

        {/* Reshare Sheet */}
        {reshareTarget && (
          <ReshareSheet
            visible={showReshareSheet}
            target={reshareTarget}
            isSubmitting={isResharing}
            onClose={() => {
              setShowReshareSheet(false);
              handleCloseSheet();
            }}
            onSubmit={async (note: string) => {
              if (isResharing) return;
              if (!currentUser || !reshareTarget) {
                Alert.alert("Sign in required", "Please log in to reshare.");
                return;
              }
              try {
                setIsResharing(true);
                await createPost({
                  authorId: currentUser.uid,
                  authorSnapshot: {
                    id: currentUser.uid,
                    name:
                      currentUser.displayName ||
                      currentUser.email?.split("@")[0] ||
                      "User",
                    handle:
                      currentUser.email?.split("@")[0] ||
                      currentUser.displayName ||
                      "user",
                    avatar: currentUser.photoURL,
                  },
                  content: note,
                  media: null,
                  quote: reshareTarget.quote || {
                    id: reshareTarget.id,
                    authorId: reshareTarget.author?.id,
                    authorName: reshareTarget.author?.name || "",
                    handle: reshareTarget.author?.handle || "",
                    avatar: reshareTarget.author?.avatar,
                    title: artwork?.title,
                    subtitle: reshareTarget.author?.name,
                    priceLabel: artwork?.price,
                    content: reshareTarget.content,
                    createdAt: reshareTarget.createdAt,
                    media: reshareTarget.media,
                    relativeTime: "Just now",
                  },
                  isReshare: true,
                  resharedFrom: reshareTarget.author,
                } as any);
                setReshared(true);
                setShowReshareSheet(false);
                handleCloseSheet();
                const refreshKey = Date.now();
                const parent = navigation.getParent?.();
                const parentRoutes = parent?.getState?.()?.routeNames;
                if (parent && parentRoutes?.includes("Feed")) {
                  parent.navigate("Feed", {
                    screen: "FeedMain",
                    params: { refreshKey },
                  });
                } else {
                  navigation.navigate("Tabs", {
                    screen: "Feed",
                    params: { screen: "FeedMain", params: { refreshKey } },
                  });
                }
              } catch (err) {
                console.error("Failed to reshare artwork:", err);
                Alert.alert("Error", "Could not reshare. Please try again.");
              } finally {
                setIsResharing(false);
              }
            }}
          />
        )}

        {/* Save Sheet */}
        <SaveSheet
          visible={showSaveSheet}
          onClose={() => {
            setShowSaveSheet(false);
            handleCloseSheet();
          }}
          initialSelectedId={savedBoardId}
          userId={currentUser?.uid}
          onSelect={async (id) => {
            if (!id || !artwork) {
              setSavedBoardId(null);
              setShowSaveSheet(false);
              handleCloseSheet();
              return;
            }
            if (!currentUser) {
              Alert.alert("Sign in required", "Please sign in to save to a moodboard.");
              return;
            }
            try {
              await addArtworkToMoodboard(currentUser.uid, id, {
                id: artwork.id,
                title: artwork.title,
                image: artwork.images?.[0],
                price: artwork.price,
              });
              setSavedBoardId(id);
            } catch (err) {
              console.error("Failed to save to moodboard:", err);
              Alert.alert("Error", "Could not save to moodboard. Please try again.");
            } finally {
              setShowSaveSheet(false);
              handleCloseSheet();
            }
          }}
        />

        {/* Options Sheet */}
        <BottomSheetModal
          ref={optionsSheetRef}
          snapPoints={artwork?.artistId === currentUser?.uid ? [380] : [200]}
          backdropComponent={renderBackdrop}
          enablePanDownToClose
          handleIndicatorStyle={{ backgroundColor: "#CBD5E1", width: 40, height: 4 }}
          backgroundStyle={{ backgroundColor: "white" }}
          enableDynamicSizing={false}
          onDismiss={handleCloseSheet}
        >
          <View style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
            <Text className="text-lg font-bold text-slate-900 px-5 pt-2 pb-3">
              Options
            </Text>
            {artwork?.artistId === currentUser?.uid && (
              <>
                {canStartAuction ? (
                  <Pressable
                    onPress={handleOpenStartAuctionFromOptions}
                    className="flex-row items-center gap-3 px-5 py-4 active:bg-slate-50"
                    style={{ backgroundColor: 'transparent' }}
                  >
                    <Ionicons name="timer-outline" size={24} color="#0B73FF" />
                    <Text className="text-base font-semibold text-[#0B73FF]">Start Auction</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={handleEditArtwork}
                  className="flex-row items-center gap-3 px-5 py-4 active:bg-slate-50"
                  style={{ backgroundColor: 'transparent' }}
                >
                  <Ionicons name="create-outline" size={24} color="#0F172A" />
                  <Text className="text-base font-semibold text-slate-900">Edit Artwork</Text>
                </Pressable>
                <Pressable
                  onPress={handleDeleteArtwork}
                  className="flex-row items-center gap-3 px-5 py-4 active:bg-slate-50"
                  style={{ backgroundColor: 'transparent' }}
                >
                  <Ionicons name="trash-outline" size={24} color="#EF4444" />
                  <Text className="text-base font-semibold text-red-500">Delete</Text>
                </Pressable>
              </>
            )}
            <Pressable
              onPress={handleOpenReportSheet}
              className="flex-row items-center gap-3 px-5 py-4 active:bg-slate-50"
              style={{ backgroundColor: 'transparent' }}
            >
              <Ionicons name="alert-outline" size={24} color="#0F172A" />
              <Text className="text-base font-semibold text-slate-900">Report Artwork</Text>
            </Pressable>
          </View>
        </BottomSheetModal>

        {/* Report Sheet */}
        <ReportSheet
          visible={showReportSheet}
          onClose={() => {
            setShowReportSheet(false);
            handleCloseSheet();
          }}
          onReport={() => {
            setShowReportSheet(false);
            handleCloseSheet();
          }}
        />

        {!heroImageLoaded ? (
          <View
            className="absolute left-0 right-0 bottom-0 bg-white"
            style={{ top: headerHeight, zIndex: 2 }}
            pointerEvents="auto"
          >
            <ArtworkDetailSkeleton />
          </View>
        ) : null}

        {/* Image Viewer Modal */}
        <ImageViewing
          key={viewerState.key}
          images={viewerState.images}
          imageIndex={viewerState.initialIndex}
          visible={viewerState.visible}
          onRequestClose={handleCloseImageViewer}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
          backgroundColor="black"
          animationType="none"
        />
      </View>
    </BottomSheetModalProvider>
  );
}

function AuctionPanel({
  auction,
  bids,
  now,
  currentUserId,
  canPlaceBid,
  canOpenWinnerInvoice,
  canPrepareWinnerInvoice,
  canAdvanceStage,
  canDemoClose,
  nextBidAmount,
  advancingStage,
  preparingWinnerInvoice,
  demoClosing,
  onPlaceBid,
  onOpenWinnerInvoice,
  onPrepareWinnerInvoice,
  onAdvanceStage,
  onDemoClose,
}: {
  auction: Auction;
  bids: AuctionBid[];
  now: number;
  currentUserId?: string;
  canPlaceBid: boolean;
  canOpenWinnerInvoice: boolean;
  canPrepareWinnerInvoice: boolean;
  canAdvanceStage: boolean;
  canDemoClose: boolean;
  nextBidAmount: number;
  advancingStage: boolean;
  preparingWinnerInvoice: boolean;
  demoClosing: boolean;
  onPlaceBid: () => void;
  onOpenWinnerInvoice: () => void;
  onPrepareWinnerInvoice: () => void;
  onAdvanceStage: () => void;
  onDemoClose: () => void;
}) {
  const startsAt = new Date(auction.startsAt).getTime();
  const endsAt = new Date(auction.endsAt).getTime();
  const isBeforeStart = now < startsAt;
  const isEnded =
    now >= endsAt || ["ended", "settled", "cancelled"].includes(auction.status);
  const countdownTarget = isBeforeStart ? startsAt : endsAt;
  const countdownLabel = isBeforeStart ? "Starts in" : "Ends in";
  const statusLabel =
    auction.status === "settled"
      ? "Settled"
      : isEnded && auction.bidCount === 0
        ? "No bids"
        : isEnded
          ? "Ended"
          : isBeforeStart
            ? "Scheduled"
            : "Live";

  return (
    <View className="mx-4 mb-4 rounded-3xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View
            className={`h-2.5 w-2.5 rounded-full ${
              statusLabel === "Live" || statusLabel === "Settled"
                ? "bg-emerald-500"
                : "bg-slate-400"
            }`}
          />
          <Text className="text-xs font-bold uppercase tracking-[1px] text-slate-500">
            Auction {statusLabel}
          </Text>
        </View>
        <Text className="text-xs font-semibold text-slate-500">
          {formatAuctionStage(auction.stage)}
        </Text>
      </View>

      <View className="mt-4 flex-row gap-3">
        <View className="flex-1 rounded-2xl bg-slate-50 p-3">
          <Text className="text-xs font-semibold uppercase text-slate-500">
            {isEnded && auction.bidCount > 0 ? "Winning bid" : "Current bid"}
          </Text>
          <Text className="mt-1 text-xl font-bold text-slate-950">
            {formatAuctionCurrency(auction.currentBid, auction.currency)}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            {auction.bidCount} bids
          </Text>
        </View>
        <View className="flex-1 rounded-2xl bg-slate-50 p-3">
          <Text className="text-xs font-semibold uppercase text-slate-500">
            {isEnded ? "Status" : countdownLabel}
          </Text>
          <Text className="mt-1 text-xl font-bold text-slate-950">
            {auction.status === "settled"
              ? "Paid"
              : isEnded
                ? "Closed"
                : formatCountdown(countdownTarget - now)}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            Step {formatAuctionCurrency(auction.minIncrement, auction.currency)}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row items-center gap-2">
        {(["sketch", "color", "final"] as const).map((stage, index) => {
          const active = stage === auction.stage;
          const done = stageOrder(stage) < stageOrder(auction.stage);
          return (
            <View key={stage} className="flex-1">
              <View
                className={`h-2 rounded-full ${
                  active || done ? "bg-[#0B73FF]" : "bg-slate-200"
                }`}
              />
              <Text
                className={`mt-1 text-[11px] font-semibold ${
                  active ? "text-[#0B73FF]" : "text-slate-500"
                }`}
              >
                {index + 1}. {formatAuctionStage(stage)}
              </Text>
            </View>
          );
        })}
      </View>

      {canOpenWinnerInvoice || canPrepareWinnerInvoice ? (
        <Pressable
          onPress={
            canOpenWinnerInvoice ? onOpenWinnerInvoice : onPrepareWinnerInvoice
          }
          disabled={preparingWinnerInvoice}
          className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-3 ${
            preparingWinnerInvoice ? "bg-slate-300" : "bg-[#0B73FF]"
          }`}
        >
          {preparingWinnerInvoice ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Ionicons name="receipt-outline" size={18} color="#ffffff" />
          )}
          <Text className="font-bold text-white">
            {preparingWinnerInvoice
              ? "Preparing..."
              : canOpenWinnerInvoice
                ? auction.status === "settled"
                  ? "View invoice"
                  : "Pay invoice"
                : "Prepare invoice"}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onPlaceBid}
          disabled={!canPlaceBid}
          className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-3 ${
            canPlaceBid ? "bg-[#0B73FF]" : "bg-slate-300"
          }`}
        >
          <Ionicons name="pricetag-outline" size={18} color="#ffffff" />
          <Text className="font-bold text-white">
            {canPlaceBid
              ? `Place ${formatAuctionCurrency(nextBidAmount, auction.currency)}`
              : "Bidding unavailable"}
          </Text>
        </Pressable>
      )}

      {canAdvanceStage ? (
        <Pressable
          onPress={onAdvanceStage}
          disabled={advancingStage}
          className={`mt-3 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-3 ${
            advancingStage ? "bg-slate-200" : "bg-slate-900"
          }`}
        >
          {advancingStage ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Ionicons name="arrow-forward-circle-outline" size={18} color="#ffffff" />
          )}
          <Text className="font-bold text-white">
            {advancingStage ? "Updating..." : `Advance to ${formatAuctionStage(nextAuctionStage(auction.stage))}`}
          </Text>
        </Pressable>
      ) : null}

      {canDemoClose ? (
        <Pressable
          onPress={onDemoClose}
          disabled={demoClosing}
          className={`mt-3 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-3 ${
            demoClosing ? "bg-slate-200" : "bg-amber-500"
          }`}
        >
          {demoClosing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Ionicons name="flash-outline" size={18} color="#ffffff" />
          )}
          <Text className="font-bold text-white">
            {demoClosing ? "Closing..." : "Close now (demo)"}
          </Text>
        </Pressable>
      ) : null}

      {isEnded && auction.bidCount === 0 ? (
        <View className="mt-3 rounded-2xl bg-slate-50 px-3 py-4">
          <Text className="text-sm text-slate-500">
            This auction ended without bids.
          </Text>
        </View>
      ) : null}

      <View className="mt-5">
        <Text className="text-sm font-bold text-slate-900">Bid history</Text>
        <View className="mt-3 gap-2">
          {bids.length ? (
            bids.map((bid) => (
              <View
                key={bid.id}
                className="flex-row items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"
              >
                <View>
                  <Text className="text-sm font-semibold text-slate-800">
                    {bid.bidderId === currentUserId
                      ? "You"
                      : shortUserId(bid.bidderId)}
                  </Text>
                  <Text className="text-xs text-slate-500">
                    {formatBidTime(bid.createdAt)}
                  </Text>
                </View>
                <Text className="text-sm font-bold text-slate-950">
                  {formatAuctionCurrency(bid.amount, auction.currency)}
                </Text>
              </View>
            ))
          ) : (
            <View className="rounded-2xl bg-slate-50 px-3 py-4">
              <Text className="text-sm text-slate-500">
                No bids yet. The first valid bid starts the race.
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function BidModal({
  visible,
  auction,
  amount,
  nextBidAmount,
  submitting,
  onChangeAmount,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  auction: Auction | null;
  amount: string;
  nextBidAmount: number;
  submitting: boolean;
  onChangeAmount: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!auction) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-[28px] bg-white px-5 pb-8 pt-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-slate-950">Place bid</Text>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
            >
              <Ionicons name="close" size={20} color="#0F172A" />
            </Pressable>
          </View>

          <Text className="mt-2 text-sm text-slate-500">
            Minimum bid is {formatAuctionCurrency(nextBidAmount, auction.currency)}.
          </Text>

          <View className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Text className="text-xs font-bold uppercase text-slate-500">
              Your bid
            </Text>
            <TextInput
              value={amount}
              onChangeText={onChangeAmount}
              keyboardType="numeric"
              editable={!submitting}
              placeholder={String(nextBidAmount)}
              className="mt-1 text-2xl font-bold text-slate-950"
            />
          </View>

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-4 ${
              submitting ? "bg-slate-300" : "bg-[#0B73FF]"
            }`}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
            )}
            <Text className="text-base font-bold text-white">
              {submitting ? "Placing bid..." : "Confirm bid"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BidDepositModal({
  visible,
  auction,
  deposit,
  paying,
  onClose,
  onPay,
}: {
  visible: boolean;
  auction: Auction | null;
  deposit: {
    amount: number;
    depositAmount: number;
    trustScore: number;
    threshold: number;
  } | null;
  paying: boolean;
  onClose: () => void;
  onPay: () => void;
}) {
  if (!auction || !deposit) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-[28px] bg-white px-5 pb-8 pt-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-slate-950">
              Refundable deposit
            </Text>
            <Pressable
              onPress={onClose}
              disabled={paying}
              className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
            >
              <Ionicons name="close" size={20} color="#0F172A" />
            </Pressable>
          </View>

          <Text className="mt-2 text-sm leading-5 text-slate-500">
            Your trust score requires a refundable deposit before this bid can
            be accepted.
          </Text>

          <View className="mt-4 gap-2 rounded-2xl bg-slate-50 p-4">
            <DepositRow label="Trust score" value={`${deposit.trustScore}/${deposit.threshold}`} />
            <DepositRow
              label="Bid amount"
              value={formatAuctionCurrency(deposit.amount, auction.currency)}
            />
            <DepositRow
              label="Deposit required"
              value={formatAuctionCurrency(deposit.depositAmount, auction.currency)}
            />
          </View>

          <View className="mt-4 gap-2">
            <Text className="text-xs leading-4 text-slate-500">
              Deposit required: 10%.
            </Text>
            <Text className="text-xs leading-4 text-slate-500">
              It will be deducted if you win and refunded if you lose after
              auction settlement.
            </Text>
            <Text className="text-xs leading-4 text-slate-500">
              It may be forfeited if you win but do not complete payment.
            </Text>
          </View>

          <Pressable
            onPress={onPay}
            disabled={paying}
            className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-4 ${
              paying ? "bg-slate-300" : "bg-[#0B73FF]"
            }`}
          >
            {paying ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Ionicons name="card-outline" size={20} color="#ffffff" />
            )}
            <Text className="text-base font-bold text-white">
              {paying ? "Opening payment..." : "Pay deposit"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DepositRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-slate-500">{label}</Text>
      <Text className="text-sm font-bold text-slate-950">{value}</Text>
    </View>
  );
}

function StartAuctionModal({
  visible,
  startingPrice,
  minIncrement,
  durationHours,
  currency,
  submitting,
  onChangeStartingPrice,
  onChangeMinIncrement,
  onChangeDurationHours,
  onChangeCurrency,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  startingPrice: string;
  minIncrement: string;
  durationHours: string;
  currency: "VND" | "USD";
  submitting: boolean;
  onChangeStartingPrice: (value: string) => void;
  onChangeMinIncrement: (value: string) => void;
  onChangeDurationHours: (value: string) => void;
  onChangeCurrency: (value: "VND" | "USD") => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-[28px] bg-white px-5 pb-8 pt-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-slate-950">Start auction</Text>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              className="h-10 w-10 items-center justify-center rounded-full bg-slate-100"
            >
              <Ionicons name="close" size={20} color="#0F172A" />
            </Pressable>
          </View>

          <Text className="mt-2 text-sm text-slate-500">
            The auction starts immediately and opens at the sketch stage.
          </Text>

          <View className="mt-5 flex-row gap-2 rounded-2xl bg-slate-100 p-1">
            {(["USD", "VND"] as const).map((option) => {
              const active = currency === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => onChangeCurrency(option)}
                  disabled={submitting}
                  className={`flex-1 items-center rounded-xl px-4 py-2 ${
                    active ? "bg-white" : ""
                  }`}
                >
                  <Text
                    className={`font-bold ${
                      active ? "text-[#0B73FF]" : "text-slate-500"
                    }`}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-4 gap-3">
            <AuctionInputField
              label="Starting price"
              value={startingPrice}
              placeholder={currency === "VND" ? "1000000" : "100"}
              disabled={submitting}
              onChangeText={onChangeStartingPrice}
            />
            <AuctionInputField
              label="Minimum increment"
              value={minIncrement}
              placeholder={currency === "VND" ? "50000" : "10"}
              disabled={submitting}
              onChangeText={onChangeMinIncrement}
            />
            <AuctionInputField
              label="Duration (hours)"
              value={durationHours}
              placeholder="24"
              disabled={submitting}
              onChangeText={onChangeDurationHours}
            />
          </View>

          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl px-4 py-4 ${
              submitting ? "bg-slate-300" : "bg-[#0B73FF]"
            }`}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Ionicons name="timer-outline" size={20} color="#ffffff" />
            )}
            <Text className="text-base font-bold text-white">
              {submitting ? "Starting..." : "Start auction"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function AuctionInputField({
  label,
  value,
  placeholder,
  disabled,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <Text className="text-xs font-bold uppercase text-slate-500">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        editable={!disabled}
        placeholder={placeholder}
        className="mt-1 text-xl font-bold text-slate-950"
      />
    </View>
  );
}

function formatAuctionCurrency(amount: number, currency: string) {
  if (currency === "VND") {
    return `${Math.round(amount).toLocaleString("vi-VN")} VND`;
  }
  return `$${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAuctionStage(stage: Auction["stage"]) {
  if (stage === "sketch") return "Sketch";
  if (stage === "color") return "Color";
  return "Final";
}

function stageOrder(stage: Auction["stage"]) {
  if (stage === "sketch") return 0;
  if (stage === "color") return 1;
  return 2;
}

function nextAuctionStage(stage: Auction["stage"]): Auction["stage"] {
  if (stage === "sketch") return "color";
  if (stage === "color") return "final";
  return "final";
}

function shortUserId(userId: string) {
  if (!userId) return "Bidder";
  return `Bidder ${userId.slice(0, 6)}`;
}

function formatBidTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMs = Date.now() - time;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseNumericInput(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveArtworkPriceAmount(artwork: ArtworkDetail) {
  if (artwork.priceSnapshot?.amount) return artwork.priceSnapshot.amount;
  return parseNumericInput(artwork.price || "");
}

function ArtworkDetailSkeleton() {
  return (
    <View className="flex-1 bg-white animate-pulse">
      <View className="px-4 pt-4 gap-4">
        <View className="rounded-3xl bg-slate-200" style={{ height: 320 }} />
        <View className="rounded-3xl border border-slate-200 bg-white p-5 gap-3">
          <View className="h-4 w-24 rounded bg-slate-200" />
          <View className="h-6 w-48 rounded bg-slate-200" />
          <View className="h-4 w-32 rounded bg-slate-200" />
          <View className="h-4 w-28 rounded bg-slate-200" />
          <View className="mt-2 h-3 w-full rounded bg-slate-200" />
          <View className="h-3 w-5/6 rounded bg-slate-200" />
        </View>
        <View className="rounded-3xl border border-slate-200 bg-white p-5 gap-3">
          <View className="h-4 w-28 rounded bg-slate-200" />
          <View className="h-3 w-full rounded bg-slate-200" />
          <View className="h-3 w-11/12 rounded bg-slate-200" />
          <View className="h-3 w-4/5 rounded bg-slate-200" />
        </View>
      </View>
    </View>
  );
}
