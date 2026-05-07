import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";

import { useAuth } from "../domains/auth/contexts/AuthContext";
import { firestore } from "@/configs/firebase";
import { markNotificationAsRead } from "../domains/notifications/services/notificationService";
import { navigate as rootNavigate } from "../app/navigation/navigationRef";
import { getPostById } from "../domains/feed/services/feedService";

type NotificationItem = {
  id: string;
  type: "like" | "comment" | "reshare" | string;
  actorName: string;
  message: string;
  createdAt: number;
  read?: boolean;
  postId?: string;
  auctionId?: string;
  artworkId?: string;
};

const formatTime = (ts: number) => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
};

const typeIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
  like: "heart-outline",
  comment: "chatbubble-ellipses-outline",
  reshare: "repeat-outline",
  auction_outbid: "pricetag-outline",
  auction_ended: "trophy-outline",
  auction_won: "receipt-outline",
};

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);

  const handleTestNotification = useCallback(async () => {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      console.warn("Notification permission not granted");
      return;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Artium",
        body: "Welcome to Artium! Tap to explore art and creations.",
        data: { type: "test" },
      },
      trigger: null,
    });
  }, []);

  useEffect(() => {
    if (!currentUser) {
      console.log("NotificationsScreen: No currentUser");
      return;
    }
    console.log("NotificationsScreen: Listening to notifications for user:", currentUser.uid);
    const ref = collection(firestore, "users", currentUser.uid, "notifications");
    const q = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("NotificationsScreen: Received snapshot with", snap.docs.length, "documents");
        snap.docs.forEach((doc, idx) => {
          console.log(`  [${idx}] ${doc.id}:`, doc.data());
        });
        const list: NotificationItem[] = snap.docs.map((doc) => {
          const data = doc.data() as any;
          const createdAt =
            (data.createdAt as Timestamp | undefined)?.toMillis?.() ||
            Date.now();
          return {
            id: doc.id,
            type: data.type || "comment",
            actorName: data.actorName || "Someone",
            message: data.message || "",
            createdAt,
            read: data.read,
            postId: data.postId,
            auctionId: data.auctionId,
            artworkId: data.artworkId,
          };
        });
        setItems(list);
      },
      (err) => console.warn("notifications snapshot error", err)
    );
    return () => unsub();
  }, [currentUser]);

  const handleNotificationPress = useCallback(async (item: NotificationItem) => {
    // Mark this specific notification as read
    if (currentUser && !item.read) {
      try {
        await markNotificationAsRead(currentUser.uid, item.id);
      } catch (error) {
        console.error("Error marking notification as read:", error);
      }
    }

    if (!item.postId) {
      if (
        (item.type === "auction_outbid" || item.type === "auction_ended") &&
        item.artworkId
      ) {
        rootNavigate("ArtworkDetail", { id: item.artworkId });
        return;
      }
      if (item.type === "auction_won" && item.artworkId) {
        rootNavigate("ArtworkDetail", { id: item.artworkId });
        return;
      }

      console.warn("No postId in notification");
      return;
    }

    try {
      // Fetch the post to navigate to FeedDetail
      const post = await getPostById(item.postId);

      if (post) {
        // Navigate to Feed tab with FeedDetail screen
        rootNavigate("Tabs", {
          screen: "Feed",
          params: {
            screen: "FeedDetail",
            params: { post },
          },
        });
      } else {
        console.warn("Post not found:", item.postId);
      }
    } catch (error) {
      console.error("Error navigating to post:", error);
    }
  }, [currentUser]);

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center px-4 py-3 border-b border-slate-100"
        style={{ paddingTop: insets.top }}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back-outline" size={22} color="#0F172A" />
        </Pressable>
        <Text className="ml-3 text-base font-semibold text-slate-900">
          Notifications
        </Text>
      </View>
      <View className="px-4 pt-3">
        <Pressable
          onPress={handleTestNotification}
          className="self-start rounded-full bg-slate-900 px-4 py-2"
        >
          <Text className="text-sm font-semibold text-white">
            Test push notification
          </Text>
        </Pressable>
      </View>

      {!currentUser ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-base text-slate-500 text-center">
            Please sign in to view notifications.
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-base text-slate-500 text-center">
            No notifications yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom + 40, 80),
          }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleNotificationPress(item)}
              className={`flex-row items-center rounded-2xl border px-3 py-3 active:bg-slate-50 ${
                item.read
                  ? "border-slate-200 bg-white"
                  : "border-blue-200 bg-blue-50"
              }`}
            >
              <View className="relative">
                <Ionicons
                  name={typeIcon[item.type] ?? "notifications-outline"}
                  size={20}
                  color={item.read ? "#0F172A" : "#3B82F6"}
                />
                {!item.read && (
                  <View className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full" />
                )}
              </View>
              <View className="flex-1 ml-3">
                <Text className={`text-sm ${item.read ? "font-semibold" : "font-bold"} text-slate-900`}>
                  {item.actorName}
                </Text>
                <Text className={`text-sm ${item.read ? "text-slate-600" : "text-slate-700"}`} numberOfLines={2}>
                  {item.message}
                </Text>
              </View>
              <Text className="text-[12px] text-slate-400">
                {formatTime(item.createdAt)}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
