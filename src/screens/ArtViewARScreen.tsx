import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  LayoutChangeEvent,
  Pressable,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Dimension = {
  w?: number;
  h?: number;
  unit?: string;
};

type ArtViewARRouteParams = {
  artworkId: string;
  title: string;
  imageUrl?: string;
  dimension?: Dimension;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toCm = (value: number, unit?: string) => {
  if (!value || value <= 0) return 0;
  const normalized = (unit || "cm").toLowerCase();
  if (normalized === "m") return value * 100;
  if (normalized === "mm") return value / 10;
  if (normalized === "inch" || normalized === "in" || normalized === "inches") return value * 2.54;
  return value;
};

export default function ArtViewARScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<any>(null);
  const params = (route.params || {}) as ArtViewARRouteParams;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanReady, setScanReady] = useState(false);
  const [scanHint, setScanHint] = useState("Hãy di chuyển điện thoại chậm rãi để quét bức tường của bạn");
  const [isPlaced, setIsPlaced] = useState(false);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });
  const [isTakingSnapshot, setIsTakingSnapshot] = useState(false);

  const dim = params.dimension || {};
  const widthCm = toCm(dim.w || 0, dim.unit);
  const heightCm = toCm(dim.h || 0, dim.unit);
  const aspect = useMemo(() => {
    if (widthCm > 0 && heightCm > 0) return widthCm / heightCm;
    return 1;
  }, [heightCm, widthCm]);

  const frameWidth = useMemo(() => {
    if (cameraLayout.width <= 0) return 220;
    if (widthCm <= 0) return clamp(cameraLayout.width * 0.38, 180, cameraLayout.width * 0.72);
    const estimated = (widthCm / 260) * cameraLayout.width;
    return clamp(estimated, 170, cameraLayout.width * 0.75);
  }, [cameraLayout.width, widthCm]);

  const frameHeight = useMemo(() => clamp(frameWidth / aspect, 120, 420), [aspect, frameWidth]);

  const posX = useSharedValue(0);
  const posY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);

  const minScale = 0.6;
  const maxScale = 1.6;

  useEffect(() => {
    if (!permission?.granted) return;
    setScanHint("Đang nhận diện mặt phẳng đứng...");
    const timer = setTimeout(() => {
      setScanReady(true);
      setScanHint("Chạm vào vị trí trên tường để đặt tranh");
    }, 1300);
    return () => clearTimeout(timer);
  }, [permission?.granted]);

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCameraLayout({ width, height });
  }, []);

  const placeFrameAt = useCallback((x: number, y: number) => {
    const boundedX = clamp(x - frameWidth / 2, 0, Math.max(cameraLayout.width - frameWidth, 0));
    const boundedY = clamp(y - frameHeight / 2, 0, Math.max(cameraLayout.height - frameHeight, 0));
    posX.value = boundedX;
    posY.value = boundedY;
    scale.value = 1;
    setIsPlaced(true);
    setScanHint("Dùng hai ngón tay để kéo và zoom tranh");
  }, [cameraLayout.height, cameraLayout.width, frameHeight, frameWidth, posX, posY, scale]);

  const handleSurfacePress = useCallback(
    (event: any) => {
      if (!scanReady || !params.imageUrl) return;
      const { locationX, locationY } = event.nativeEvent;
      placeFrameAt(locationX, locationY);
    },
    [params.imageUrl, placeFrameAt, scanReady]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isPlaced)
        .onStart(() => {
          startX.value = posX.value;
          startY.value = posY.value;
        })
        .onUpdate((event) => {
          const rawX = startX.value + event.translationX;
          const rawY = startY.value + event.translationY;
          const scaledWidth = frameWidth * scale.value;
          const scaledHeight = frameHeight * scale.value;
          const maxX = Math.max(cameraLayout.width - scaledWidth, 0);
          const maxY = Math.max(cameraLayout.height - scaledHeight, 0);
          posX.value = Math.min(Math.max(rawX, 0), maxX);
          posY.value = Math.min(Math.max(rawY, 0), maxY);
        }),
    [cameraLayout.height, cameraLayout.width, frameHeight, frameWidth, isPlaced, posX, posY, scale, startX, startY]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(isPlaced)
        .onStart(() => {
          startScale.value = scale.value;
        })
        .onUpdate((event) => {
          const nextScale = startScale.value * event.scale;
          scale.value = Math.min(Math.max(nextScale, minScale), maxScale);
          const scaledWidth = frameWidth * scale.value;
          const scaledHeight = frameHeight * scale.value;
          const maxX = Math.max(cameraLayout.width - scaledWidth, 0);
          const maxY = Math.max(cameraLayout.height - scaledHeight, 0);
          posX.value = Math.min(Math.max(posX.value, 0), maxX);
          posY.value = Math.min(Math.max(posY.value, 0), maxY);
        }),
    [cameraLayout.height, cameraLayout.width, frameHeight, frameWidth, isPlaced, posX, posY, scale, startScale]
  );

  const artworkAnimatedStyle = useAnimatedStyle(() => ({
    width: frameWidth,
    height: frameHeight,
    transform: [{ translateX: posX.value }, { translateY: posY.value }, { scale: scale.value }],
  }));

  const handleSnapshot = useCallback(async () => {
    if (!cameraRef.current?.takePictureAsync || isTakingSnapshot) return;
    try {
      setIsTakingSnapshot(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (photo?.uri) {
        Alert.alert("Đã chụp snapshot", "Ảnh demo đã được chụp thành công.");
      }
    } catch (err) {
      console.error("Failed to take AR snapshot:", err);
      Alert.alert("Không thể chụp ảnh", "Vui lòng thử lại.");
    } finally {
      setIsTakingSnapshot(false);
    }
  }, [isTakingSnapshot]);

  if (!permission) {
    return <View className="flex-1 bg-black" />;
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-slate-950 px-6 items-center justify-center">
        <Ionicons name="camera-outline" size={36} color="#E2E8F0" />
        <Text className="text-slate-100 text-lg font-semibold mt-4 text-center">
          ArtView AR cần quyền Camera
        </Text>
        <Text className="text-slate-400 text-center mt-2">
          Bật camera để thử treo tranh lên tường trong không gian thật.
        </Text>
        <Pressable
          onPress={requestPermission}
          className="mt-6 bg-[#0B73FF] px-6 py-3 rounded-full"
        >
          <Text className="text-white font-semibold">Cho phép camera</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} className="mt-3 px-4 py-2">
          <Text className="text-slate-300">Quay lại</Text>
        </Pressable>
      </View>
    );
  }

  if (!params.imageUrl) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-6">
        <Text className="text-white text-lg font-semibold text-center">
          Không tìm thấy ảnh tranh để hiển thị AR.
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          className="mt-5 bg-[#0B73FF] px-6 py-3 rounded-full"
        >
          <Text className="text-white font-semibold">Quay lại đấu giá</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        onLayout={handleCameraLayout}
      />

      <Pressable
        className="absolute inset-0"
        onPress={handleSurfacePress}
      />

      {isPlaced ? (
        <GestureDetector gesture={Gesture.Simultaneous(panGesture, pinchGesture)}>
          <Animated.View className="absolute left-0 top-0" style={artworkAnimatedStyle}>
            <Image
              source={{ uri: params.imageUrl }}
              resizeMode="cover"
              className="w-full h-full rounded-xl border border-white/60"
            />
          </Animated.View>
        </GestureDetector>
      ) : null}

      <View
        className="absolute left-0 right-0"
        style={{ top: Math.max(insets.top + 10, 22), paddingHorizontal: 16 }}
        pointerEvents="box-none"
      >
        <View className="rounded-2xl bg-black/55 px-4 py-3">
          <Text className="text-white font-semibold">{params.title}</Text>
          <Text className="text-slate-200 text-xs mt-1">ArtView AR - Trải nghiệm trước, sở hữu sau</Text>
          <Text className="text-slate-100 text-sm mt-2">{scanHint}</Text>
          {widthCm > 0 && heightCm > 0 ? (
            <Text className="text-slate-300 text-xs mt-1">
              Tỉ lệ thật: {Math.round(widthCm)} x {Math.round(heightCm)} cm
            </Text>
          ) : null}
        </View>
      </View>

      <View
        className="absolute left-0 right-0 px-4"
        style={{ bottom: Math.max(insets.bottom + 18, 18) }}
      >
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleSnapshot}
            className="flex-1 rounded-full bg-white/90 py-3 px-4 flex-row items-center justify-center"
          >
            <Ionicons name="camera-outline" size={18} color="#0F172A" />
            <Text className="ml-2 text-slate-900 font-semibold">
              {isTakingSnapshot ? "Đang chụp..." : "Chụp snapshot"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            className="flex-1 rounded-full bg-[#0B73FF] py-3 px-4 flex-row items-center justify-center"
          >
            <Ionicons name="pricetag-outline" size={18} color="#ffffff" />
            <Text className="ml-2 text-white font-semibold">Quay lại đấu giá</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
