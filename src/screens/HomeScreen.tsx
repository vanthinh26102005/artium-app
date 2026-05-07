import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CompositeNavigationProp } from "@react-navigation/native";
import ScreenHeader from "../shared/components/ScreenHeader";
import Sidebar from "../shared/components/Sidebar";
import {
  SidebarActionKey,
  SidebarKey,
  useSidebarItems,
} from "../shared/hooks/useSidebar";
import UnderlineHome from "../../assets/headers/underline-home.svg";
import { TabParamList } from "../app/navigation/tabTypes";
import type { HomeStackParamList } from "../app/navigation/Stack/HomeStack";
import { useHome } from "../domains/home/hooks/useHome";
import HomeNewsCarousel from "../domains/home/components/cards/HomeNewsCarousel";
import HomeBlogCard from "../domains/home/components/cards/HomeBlogCard";
import HomeEventCard from "../domains/home/components/cards/HomeEventCard";
import HomeFollowingCard from "../domains/home/components/cards/HomeFollowingCard";
import { useProfileContext } from "../domains/user/contexts/ProfileContext";
import {
  HomeFollowingProfile,
  HomeBlogItem,
  HomeEventItem,
} from "../domains/home/types";
import ArtworkCard from "../domains/discover/components/cards/ArtworkCard";
import type { Artwork } from "../domains/discover/types";
import { navigateToUserProfile } from "../shared/utils/navigateToUserProfile";
import { useLogout } from "../domains/auth/hooks/useLogout";
import { LogoutConfirmModal } from "../domains/auth/components/LogoutConfirmModal";
import { useAuth } from "../domains/auth/contexts/AuthContext";

type HomeScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, "HomeMain">,
  BottomTabNavigationProp<TabParamList>
>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const items = useSidebarItems();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(96);
  const [activeKey, setActiveKey] = useState<SidebarKey>("home");
  const [sellCardMeasuredHeight, setSellCardMeasuredHeight] = useState<
    number | null
  >(null);
  const { width } = useWindowDimensions();
  const {
    news,
    blogs,
    events,
    sellItemsPreview,
    following,
    popularArtists,
    isLoading,
    isRefreshing,
    refreshHome,
    error,
  } = useHome();
  const { isFollowing, toggleFollow } = useProfileContext();
  const {
    logout,
    loading: logoutLoading,
    showConfirmModal,
    onConfirmLogout,
    onCancelLogout,
  } = useLogout();
  const { currentUser } = useAuth();
  const highlightCardWidth = Math.min(320, Math.round(width * 0.72));
  const highlightCardHeight = Math.round(highlightCardWidth * 0.55);
  const sellCardWidth = Math.round((width - 16 * 2 - 12) / 2);
  const followingCardWidth = sellCardWidth;
  const sellCardHeight = Math.round(sellCardWidth * (4 / 3) + 96);
  const seeMoreCardHeight = sellCardMeasuredHeight ?? sellCardHeight;
  const highlights = useMemo(() => {
    const result: HighlightItem[] = [];
    const max = Math.max(blogs.length, events.length);
    for (let i = 0; i < max; i += 1) {
      if (blogs[i]) result.push({ type: "blog", item: blogs[i] });
      if (events[i]) result.push({ type: "event", item: events[i] });
    }
    return result;
  }, [blogs, events]);
  const handleSeeAllSaved = useCallback(() => {
    navigation.navigate("SimilarSaved");
  }, [navigation]);
  const handleSeeAllPopular = useCallback(() => {
    navigation.navigate("PopularArtists");
  }, [navigation]);
  const handleOpenEventDetail = useCallback(
    (event: HomeEventItem) => {
      navigation.navigate("EventDetail", { id: event.id });
    },
    [navigation]
  );
  const handleSellCardLayout = useCallback(
    (height: number) => {
      if (
        !sellCardMeasuredHeight ||
        Math.abs(height - sellCardMeasuredHeight) > 1
      ) {
        setSellCardMeasuredHeight(height);
      }
    },
    [sellCardMeasuredHeight]
  );

  const handleSidebarSelect = (key: SidebarActionKey) => {
    setSidebarOpen(false);

    if (key === "logout") {
      logout();
      return;
    }

    if (key === "inventory") {
      navigation.navigate("Inventory");
      return;
    }

    if (key === "profile") {
      navigation.navigate("Profile");
      return;
    }

    if (key === "events") {
      navigation.navigate("Events");
      return;
    }

    if (key === "notifications") {
      navigation.navigate("Notifications" as never);
      return;
    }

    if (key === "invoices") {
      navigation.navigate("Invoices");
      return;
    }

    if (key === "messages") {
      navigation.navigate("Inbox");
      return;
    }

    console.log("Sidebar selected:", key);
  };

  useFocusEffect(
    useCallback(() => {
      setActiveKey("home");
    }, [setActiveKey])
  );

  return (
    <View className="flex-1 bg-white">
      <ScreenHeader
        title="Home"
        badgeLabel="Blog"
        onPressBadge={() => navigation.navigate("Blog")}
        actionType="menu"
        isMenuOpen={sidebarOpen}
        onPressAction={() => setSidebarOpen((prev) => !prev)}
        onHeightChange={(h) => setHeaderHeight(h)}
        underlineSource={UnderlineHome}
      />
      {isLoading ? (
        <HomeSkeleton
          highlightCardWidth={highlightCardWidth}
          highlightCardHeight={highlightCardHeight}
          sellCardWidth={sellCardWidth}
          sellCardHeight={sellCardHeight}
          followingCardWidth={followingCardWidth}
        />
      ) : error ? (
        <View className="flex-1 justify-center items-center p-4">
          <Text className="text-lg text-red-500 text-center">
            Failed to load home content. Please try again later.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={refreshHome} />
          }
        >
          <View className="px-4 pt-4">
            <HomeNewsCarousel data={news} />
          </View>

          <View className="mt-4">
            <FlatList
              data={highlights}
              horizontal
              keyExtractor={(item) => item.item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 4,
              }}
              ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
              renderItem={({ item }) =>
                item.type === "blog" ? (
                  <HomeBlogCard
                    item={item.item}
                    width={highlightCardWidth}
                    height={highlightCardHeight}
                    onPress={(blog) => navigation.navigate("BlogDetail", { blogId: blog.id })}
                  />
                ) : (
                  <HomeEventCard
                    item={item.item}
                    width={highlightCardWidth}
                    height={highlightCardHeight}
                    onPress={handleOpenEventDetail}
                  />
                )
              }
            />
          </View>

          <SectionHeader
            title="Pick For You"
            onPressAction={handleSeeAllSaved}
          />
          <FlatList
            data={sellItemsPreview}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }: ListRenderItemInfo<Artwork>) => (
              <View
                style={{ width: sellCardWidth, alignSelf: "flex-start" }}
              >
                <ArtworkCard
                  item={item}
                  onLayout={
                    index === 0
                      ? (event) =>
                          handleSellCardLayout(event.nativeEvent.layout.height)
                      : undefined
                  }
                  onPress={() =>
                    (navigation.navigate as any)("ArtworkDetail", { id: item.id })
                  }
                />
              </View>
            )}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={horizontalContent}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            ListFooterComponent={
              <View style={{ marginLeft: 12, width: sellCardWidth }}>
                <SeeMoreCard
                  height={seeMoreCardHeight}
                  onPress={handleSeeAllSaved}
                />
              </View>
            }
          />

          <SectionHeader
            title="Popular in Your Area"
            onPressAction={handleSeeAllPopular}
          />
          <FlatList
            data={following.filter((item) => item.id !== currentUser?.uid)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }: ListRenderItemInfo<HomeFollowingProfile>) => (
              <View style={{ width: followingCardWidth }}>
                <HomeFollowingCard
                  item={item}
                  isFollowing={isFollowing(item.id)}
                  onToggleFollow={toggleFollow}
                  onPress={() => navigateToUserProfile(item.id)}
                />
              </View>
            )}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={horizontalContent}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          />
        </ScrollView>
      )}

      <Sidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={handleSidebarSelect}
        topOffset={headerHeight}
        activeKey={activeKey}
        items={items}
      />

      <LogoutConfirmModal
        visible={showConfirmModal}
        onConfirm={onConfirmLogout}
        onCancel={onCancelLogout}
        loading={logoutLoading}
      />
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onPressAction?: () => void;
};

type HighlightItem =
  | { type: "blog"; item: HomeBlogItem }
  | { type: "event"; item: HomeEventItem };

function SectionHeader({
  title,
  actionLabel = "SEE ALL",
  onPressAction,
}: SectionHeaderProps) {
  return (
    <View className="mt-6 px-4 mb-3 flex-row items-center justify-between">
      <View className="flex-1 pr-6">
        <Text className="text-[18px] font-semibold text-slate-900">
          {title}
        </Text>
      </View>
      <Pressable onPress={onPressAction}>
        <Text className="text-[12px] font-semibold text-[#2D74ED]">
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const horizontalContent = {
  paddingHorizontal: 16,
  paddingBottom: 16,
};

function SeeMoreCard({
  height,
  onPress,
}: {
  height: number;
  onPress?: () => void;
}) {
  return (
    <Pressable
      className="rounded-3xl bg-white border border-slate-100 items-center justify-center active:opacity-90"
      style={[
        cardShadow,
        {
          height,
        },
      ]}
      onPress={onPress}
    >
      <Text className="text-[16px] font-semibold text-[#2D74ED]">
        See More
      </Text>
    </Pressable>
  );
}

const cardShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 4,
};

function HomeSkeleton({
  highlightCardWidth,
  highlightCardHeight,
  sellCardWidth,
  sellCardHeight,
  followingCardWidth,
}: {
  highlightCardWidth: number;
  highlightCardHeight: number;
  sellCardWidth: number;
  sellCardHeight: number;
  followingCardWidth: number;
}) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <View className="px-4 pt-4 animate-pulse">
        <View className="h-44 rounded-3xl bg-slate-200" />
      </View>

      <View className="mt-4 animate-pulse">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}
        >
          {[0, 1, 2].map((idx) => (
            <View
              key={`highlight-skeleton-${idx}`}
              className="rounded-3xl bg-white border border-slate-100 overflow-hidden"
              style={[
                cardShadow,
                {
                  width: highlightCardWidth,
                  height: highlightCardHeight,
                  marginRight: idx < 2 ? 12 : 0,
                },
              ]}
            >
              <View className="h-full w-full bg-slate-200" />
            </View>
          ))}
        </ScrollView>
      </View>

      <View className="mt-6 px-4 mb-3 animate-pulse flex-row items-center justify-between">
        <View className="h-5 w-32 rounded bg-slate-200" />
        <View className="h-3 w-12 rounded bg-slate-200" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={horizontalContent}
        className="animate-pulse"
      >
        {[0, 1, 2].map((idx) => (
          <View
            key={`sell-skeleton-${idx}`}
            className="rounded-3xl bg-white border border-slate-100 overflow-hidden"
            style={[
              cardShadow,
              {
                width: sellCardWidth,
                height: sellCardHeight,
                marginRight: idx < 2 ? 12 : 0,
              },
            ]}
          >
            <View className="h-44 bg-slate-200" />
            <View className="px-4 py-3 gap-2">
              <View className="h-4 w-24 rounded bg-slate-200" />
              <View className="h-3 w-16 rounded bg-slate-200" />
              <View className="h-3 w-12 rounded bg-slate-200" />
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="mt-6 px-4 mb-3 animate-pulse flex-row items-center justify-between">
        <View className="h-5 w-40 rounded bg-slate-200" />
        <View className="h-3 w-12 rounded bg-slate-200" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={horizontalContent}
        className="animate-pulse"
      >
        {[0, 1, 2].map((idx) => (
          <View
            key={`follow-skeleton-${idx}`}
            className="rounded-3xl bg-white border border-slate-100 items-center px-4 py-5"
            style={[
              cardShadow,
              {
                width: followingCardWidth,
                marginRight: idx < 2 ? 12 : 0,
              },
            ]}
          >
            <View className="h-16 w-16 rounded-full bg-slate-200" />
            <View className="mt-3 h-4 w-24 rounded bg-slate-200" />
            <View className="mt-2 h-3 w-16 rounded bg-slate-200" />
            <View className="mt-4 h-8 w-20 rounded-full bg-slate-200" />
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );
}
