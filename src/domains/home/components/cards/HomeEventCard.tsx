import React from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { HomeEventItem } from "../../types";
import { HOME_COLORS } from "../../constants";
import { parseCalendarInfo } from "../../utils/dateParser";

const cardShadow = {
  shadowColor: HOME_COLORS.SHADOW,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 4,
};

type Props = {
  item: HomeEventItem;
  onPress?: (item: HomeEventItem) => void;
  width?: number;
  height?: number;
};

function HomeEventCard({ item, onPress, width, height }: Props) {
  const Container = onPress ? Pressable : View;
  const cardHeight = height ?? 150;
  const imageHeight = Math.round(cardHeight * 0.55);
  const calendarInfo = parseCalendarInfo(item.dateISO ?? item.dateLabel);
  const month = calendarInfo?.month;
  const day = calendarInfo?.day;
  const showCalendar = !!month && !!day;

  // Null safety check
  if (!item?.image || !item?.title) {
    return null;
  }

  return (
    <Container
      className="rounded-3xl bg-white border border-slate-100 overflow-hidden"
      style={[cardShadow, { width: width ?? 260, height: cardHeight }]}
      onPress={() => onPress?.(item)}
    >
      <View className="relative">
        <Image
          source={{ uri: item.image }}
          style={{ width: "100%", height: imageHeight }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
        />
        {showCalendar ? (
          <View className="absolute top-3 right-3 rounded-2xl bg-white px-3 py-2 shadow-sm">
            <Text className="text-[10px] font-semibold text-[#2563EB]">
              {month}
            </Text>
            <Text
              className="text-[16px] font-extrabold text-slate-900 mt-0.5"
              style={{ lineHeight: 20 }}
            >
              {day}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="flex-1 px-3 py-3 justify-center">
        <Text className="text-[10px] font-semibold text-slate-400">
          {item.label ?? "UPCOMING EVENT"}
        </Text>
        <Text
          className="text-[14px] font-semibold text-slate-900 leading-5 mt-1"
          numberOfLines={2}
        >
          {item.title}
        </Text>
      </View>
    </Container>
  );
}

export default React.memo(HomeEventCard);
