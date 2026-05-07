// Detailed Artwork Screen
// src/screens/ArtworkDetailScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated as RNAnimated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModalProvider, BottomSheetModal, BottomSheetBackdrop } from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

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
          <ArtworkDetails detail={artwork} />

          {/* Similar Works section removed for now */}
        </ScrollView>

        {/* Action Bar */}
        <ArtworkActionBar
          liked={liked}
          saved={saved}
          reshared={reshared}
          actionBottom={actionBottom}
          onLike={handleLike}
          onReshare={handleOpenReshareSheet}
          onSave={handleOpenSaveSheet}
          onBuy={() => navigation.navigate("Checkout", { artwork })}
          buyDisabled={isSold}
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
          snapPoints={artwork?.artistId === currentUser?.uid ? [320] : [200]}
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
