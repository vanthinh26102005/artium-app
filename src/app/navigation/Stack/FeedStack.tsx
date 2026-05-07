// Stack navigator for Feed flow
// src/app/navigation/Stack/FeedStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import FeedScreen from "../../../screens/FeedScreen";
import FeedDetailScreen from "../../../screens/FeedDetailScreen";
import BlogScreen from "../../../screens/BlogScreen";
import BlogDetailScreen from "../../../screens/BlogDetailScreen";
import UserProfileScreen from "../../../screens/UserProfileScreen";
import ProfileScreen from "../../../screens/ProfileScreen";
import EditProfileScreen from "../../../screens/EditProfileScreen";
import FollowsScreen from "../../../screens/FollowsScreen";
import ArtworkDetailScreen from "../../../screens/ArtworkDetailScreen";
import MoodboardDetailScreen from "../../../screens/MoodboardDetailScreen";
import { FeedPost } from "../../../domains/feed/types";

export type FeedStackParamList = {
  FeedMain: { refreshKey?: number } | undefined;
  FeedDetail: { post: FeedPost };
  Blog: undefined;
  BlogDetail: { blogId: string };
  UserProfile: { userId: string };
  Profile: undefined;
  EditProfile: undefined;
  Follows: { type: "followers" | "following" };
  ArtworkDetail: { id: string };
  MoodboardDetail: { id: string; ownerId?: string; title?: string; cover?: string | null; ownerName?: string };
};

const Stack = createNativeStackNavigator<FeedStackParamList>();

export default function FeedStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="FeedMain" component={FeedScreen} />
      <Stack.Screen name="FeedDetail" component={FeedDetailScreen} />
      <Stack.Screen name="Blog" component={BlogScreen} />
      <Stack.Screen name="BlogDetail" component={BlogDetailScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Follows" component={FollowsScreen} />
      <Stack.Screen name="ArtworkDetail" component={ArtworkDetailScreen} />
      <Stack.Screen name="MoodboardDetail" component={MoodboardDetailScreen} />
    </Stack.Navigator>
  );
}

