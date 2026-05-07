import React from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { HomeBlogItem } from "../../types";
import { HOME_CONSTANTS, HOME_COLORS } from "../../constants";

const cardShadow = {
  shadowColor: HOME_COLORS.SHADOW,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 4,
};

type Props = {
  item: HomeBlogItem;
  onPress?: (item: HomeBlogItem) => void;
  width?: number;
  height?: number;
};

function HomeBlogCard({ item, onPress, width, height }: Props) {
  const Container = onPress ? Pressable : View;
  const cardHeight = height ?? HOME_CONSTANTS.BLOG_CARD_DEFAULT_HEIGHT;
  const imageWidth = Math.round(cardHeight * HOME_CONSTANTS.EVENT_CARD_ASPECT_RATIO);

  // Null safety check
  if (!item?.image || !item?.title) {
    return null;
  }

  return (
    <Container
      className="rounded-3xl bg-white border border-slate-100 overflow-hidden"
      style={[cardShadow, { width: width ?? HOME_CONSTANTS.BLOG_CARD_DEFAULT_WIDTH, height: cardHeight }]}
      onPress={() => onPress?.(item)}
    >
      <View className="flex-row" style={{ height: cardHeight }}>
        <Image
          source={{ uri: item.image }}
          style={{ width: imageWidth, height: cardHeight }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
        />
        <View className="flex-1 px-3 py-3 justify-between">
          <View className="flex-row items-center gap-2">
            <View className="h-6 w-6 rounded-full bg-slate-200 overflow-hidden">
              {item.authorAvatar ? (
                <Image
                  source={{ uri: item.authorAvatar }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  transition={0}
                  cachePolicy="memory-disk"
                />
              ) : null}
            </View>
            <Text className="text-[11px] font-semibold text-slate-500">
              {item.author}
            </Text>
          </View>
          <Text
            className="text-[14px] font-semibold text-slate-900 leading-5"
            numberOfLines={2}
          >
            {item.title}
          </Text>
          <Text className="text-[11px] text-slate-400">{item.dateLabel}</Text>
        </View>
      </View>
    </Container>
  );
}

export default React.memo(HomeBlogCard);
