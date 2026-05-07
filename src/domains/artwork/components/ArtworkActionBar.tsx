import React from "react";
import { View, Text, Pressable, ViewStyle, Animated as RNAnimated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import IconButton from "./ui/IconButton";

type ArtworkActionBarProps = {
  liked: boolean;
  saved: boolean;
  reshared: boolean;
  actionBottom: RNAnimated.Value;
  onLike: () => void;
  onReshare: () => void;
  onSave: () => void;
  onBuy: () => void;
  buyDisabled?: boolean;
};

const actionBarShadow: ViewStyle = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 6,
};

export default function ArtworkActionBar({
  liked,
  saved,
  reshared,
  actionBottom,
  onLike,
  onReshare,
  onSave,
  onBuy,
  buyDisabled = false,
}: ArtworkActionBarProps) {
  const buyLabel = buyDisabled ? "Sold" : "Buy now";
  return (
    <RNAnimated.View
      className="absolute left-3 right-3 rounded-full bg-white border border-slate-200 flex-row items-center px-3"
      style={[
        actionBarShadow,
        {
          bottom: actionBottom,
          paddingVertical: 7,
        },
      ]}
      pointerEvents="box-none"
    >
      <View className="flex-row items-center gap-4 flex-1 pl-1">
        <IconButton
          icon={liked ? "heart" : "heart-outline"}
          color={liked ? "#EF4444" : "#0F172A"}
          onPress={onLike}
        />
        <IconButton
          icon="repeat-outline"
          color={reshared ? "#0B73FF" : "#0F172A"}
          bg={reshared ? "rgba(11,115,255,0.08)" : undefined}
          onPress={onReshare}
        />
        <IconButton
          icon={saved ? "bookmark" : "bookmark-outline"}
          color={saved ? "#0B73FF" : "#0F172A"}
          onPress={onSave}
        />
      </View>
      <Pressable
        onPress={onBuy}
        disabled={buyDisabled}
        className={`px-5 py-3 rounded-full flex-row items-center gap-2 active:opacity-90 ${
          buyDisabled ? "bg-slate-300" : "bg-[#0B73FF]"
        }`}
      >
        <Ionicons name="cart-outline" size={18} color="#ffffff" />
        <Text className="text-white font-semibold">{buyLabel}</Text>
      </Pressable>
    </RNAnimated.View>
  );
}
