// Stack navigator for Discovery flow
// src/app/navigation/Stack/DiscoverStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DiscoverScreen from "../../../screens/DiscoverScreen";
import ArtworkDetailScreen from "../../../screens/ArtworkDetailScreen";
import CheckoutScreen from "../../../screens/CheckoutScreen";
import UserProfileScreen from "../../../screens/UserProfileScreen";
import ProfileScreen from "../../../screens/ProfileScreen";
import EditProfileScreen from "../../../screens/EditProfileScreen";
import FollowsScreen from "../../../screens/FollowsScreen";
import FeedDetailScreen from "../../../screens/FeedDetailScreen";
import MoodboardDetailScreen from "../../../screens/MoodboardDetailScreen";
import type { FeedPost } from "../../../domains/feed/types";
import EventDetailScreen from "../../../screens/EventDetailScreen";
import EditArtworkScreen from "../../../screens/EditArtworkScreen";
import BlogScreen from "../../../screens/BlogScreen";
import BlogDetailScreen from "../../../screens/BlogDetailScreen";
import type { ArtworkDetail } from "../../../domains/artwork/types";
import type { EventItem } from "../../../domains/discover/types";

export type DiscoverStackParamList = {
  DiscoverMain: undefined;
  ArtworkDetail: { id: string };
  Checkout: { artwork?: ArtworkDetail };
  UserProfile: { userId: string };
  Profile: undefined;
  EditProfile: undefined;
  Follows: { type: "followers" | "following" };
  MomentDetail: { post: FeedPost };
  MoodboardDetail: { id: string; ownerId?: string; title?: string; cover?: string | null; ownerName?: string };
  EventDetail: {
    id?: string;
    initialRsvp?: "none" | "going" | "maybe" | "notGoing";
    onRsvpChange?: (status: "none" | "going" | "maybe" | "notGoing") => void;
    event?: EventItem;
  };
  EditArtwork: { artwork: ArtworkDetail };
  Blog: undefined;
  BlogDetail: { blogId: string };
};

const Stack = createNativeStackNavigator<DiscoverStackParamList>();

export default function DiscoverStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DiscoverMain" component={DiscoverScreen} />
      <Stack.Screen name="ArtworkDetail" component={ArtworkDetailScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Follows" component={FollowsScreen} />
      <Stack.Screen name="MomentDetail" component={FeedDetailScreen} />
      <Stack.Screen name="MoodboardDetail" component={MoodboardDetailScreen} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      <Stack.Screen name="EditArtwork" component={EditArtworkScreen} />
      <Stack.Screen name="Blog" component={BlogScreen} />
      <Stack.Screen name="BlogDetail" component={BlogDetailScreen} />
    </Stack.Navigator>
  );
}

