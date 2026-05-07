import React from "react";
import { View, Text, Pressable, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Artwork } from "../../types";
import { navigateToUserProfile } from "../../../../shared/utils/navigateToUserProfile";

const FALLBACK_AVATAR = require("../../../../../assets/logos/logo-light-mode.png");

const cardShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 4,
};

const cardContainer = {
  borderRadius: 28,
  borderWidth: 1,
  borderColor: "#E2E8F0",
  overflow: "hidden" as const,
};

const glassPillStyle = {
  backgroundColor: "rgba(255,255,255,0.85)",
  borderColor: "rgba(255,255,255,0.55)",
  borderWidth: 1,
  shadowColor: "#0F172A",
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 6 },
};

const pricePillStyle = {
  backgroundColor: "#EFF6FF",
  borderColor: "#BFDBFE",
  borderWidth: 1,
  shadowColor: "#2563EB",
  shadowOpacity: 0.15,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

const bodyContentStyle = {
  // Removed minHeight to let the card shrink to its content
};

const titleTextStyle = {
  lineHeight: 22,
  minHeight: 44, // Reserve space for 2 lines to keep cards even
};

export default function ArtworkCard({
  item,
  onPress,
  onLayout,
}: {
  item: Artwork;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      className="w-full bg-white overflow-hidden"
      style={[cardShadow, cardContainer]}
    >
      <View className="relative">
        <Image
          source={{ uri: item.image }}
          className="w-full"
          style={{ aspectRatio: 3 / 4, borderTopLeftRadius: 28, borderTopRightRadius: 28 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
        {item.isTrending ? (
          <View className="absolute bottom-3 left-3">
            <View
              className="flex-row items-center gap-1 rounded-full px-3 py-1"
              style={glassPillStyle}
            >
              <Ionicons name="flame" size={14} color="#F97316" />
              <Text className="text-[11px] font-semibold uppercase text-[#F97316]">
                Trending
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View className="px-4 pt-4 pb-1 bg-white rounded-b-[28px]">
        <View className="gap-y-3" style={bodyContentStyle}>
          {/* Artist info + Title */}
          <View className="gap-3">
            {/* Artist Avatar + Name */}
            <Pressable
              className="flex-row items-center gap-3"
              onPress={() => item.artistId && navigateToUserProfile(item.artistId)}
              hitSlop={4}
              disabled={!item.artistId}
            >
              <View className="h-7 w-7 rounded-full bg-slate-200 overflow-hidden">
                <Image
                  source={item.artistAvatar ? { uri: item.artistAvatar } : FALLBACK_AVATAR}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              </View>
              <Text
                className="flex-1 text-[13px] text-slate-600 font-medium"
                numberOfLines={1}
              >
                {item.artist}
              </Text>
            </Pressable>

            {/* Title */}
            <Text
              className="text-[18px] font-bold text-slate-900"
              numberOfLines={2}
              style={titleTextStyle}
            >
              {item.title}
            </Text>
          </View>

          {/* Bottom section: Location + Price */}
          <View className="gap-2 mb-2">
            {/* Location */}
            {item.location ? (
              <Text className="text-sm text-slate-400" numberOfLines={1}>
                {item.location}
              </Text>
            ) : null}

            {/* Price Pill - positioned at bottom */}
            {item.price ? (
              <View
                className="self-start rounded-full px-4 py-2"
                style={pricePillStyle}
              >
                <View className="flex-row items-center gap-1.5">
                  <Ionicons name="pricetag" size={14} color="#2563EB" />
                  <Text className="text-[14px] font-bold text-[#1E40AF] tracking-tight">
                    {item.price}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
