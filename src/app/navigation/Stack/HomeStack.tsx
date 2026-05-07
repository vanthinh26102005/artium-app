import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../../../screens/HomeScreen";
import InventoryScreen from "../../../screens/InventoryScreen";
import EventScreen from "../../../screens/EventScreen";
import ArtworkDetailScreen from "../../../screens/ArtworkDetailScreen";
import ProfileScreen from "../../../screens/ProfileScreen";
import EditProfileScreen from "../../../screens/EditProfileScreen";
import CheckoutScreen from "../../../screens/CheckoutScreen";
import PopularArtistsScreen from "../../../screens/PopularArtistsScreen";
import SimilarSavedScreen from "../../../screens/SimilarSavedScreen";
import EventDetailScreen from "../../../screens/EventDetailScreen";
import EditArtworkScreen from "../../../screens/EditArtworkScreen";
import type { ArtworkDetail } from "../../../domains/artwork/types";
import type { EventItem } from "../../../domains/discover/types";
import BlogDetailScreen from "../../../screens/BlogDetailScreen"; // Renamed import
import BlogScreen from "../../../screens/BlogScreen";
import NotificationsScreen from "../../../screens/NotificationsScreen";
import UserProfileScreen from "../../../screens/UserProfileScreen";
import FeedDetailScreen from "../../../screens/FeedDetailScreen";
import type { FeedPost } from "../../../domains/feed/types";
import MoodboardDetailScreen from "../../../screens/MoodboardDetailScreen";
import FollowsScreen from "../../../screens/FollowsScreen";
import InvoicesScreen from "../../../screens/InvoicesScreen";
import CreateInvoiceScreen from "../../../screens/CreateInvoiceScreen";
import InvoiceDetailScreen from "../../../screens/InvoiceDetailScreen";
import PreviewInvoiceScreen from "../../../screens/PreviewInvoiceScreen";

export type HomeStackParamList = {
  HomeMain: undefined;
  Inventory: undefined;
  Events: undefined;
  ArtworkDetail: { id: string };
  Profile: undefined;
  UserProfile: { userId: string };
  EditProfile: undefined;
  Checkout: { artwork?: ArtworkDetail };
  PopularArtists: undefined;
  SimilarSaved: undefined;
  BlogDetail: { blogId: string };
  Notifications: undefined;
  FeedDetail: { post: FeedPost };
  MoodboardDetail: { id: string; ownerId?: string; title?: string; cover?: string | null; ownerName?: string };
  Follows: { type: "followers" | "following" };
  Invoices: undefined;
  CreateInvoice: undefined;
  PreviewInvoice: { invoiceId: string };
  InvoiceDetail: { invoiceId: string };
  EventDetail: {
    id?: string;
    initialRsvp?: "none" | "going" | "maybe" | "notGoing";
    onRsvpChange?: (status: "none" | "going" | "maybe" | "notGoing") => void;
    event?: EventItem;
  };
  Blog: undefined;
  EditArtwork: { artwork: ArtworkDetail };
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="Inventory" component={InventoryScreen} />
      <Stack.Screen name="Events" component={EventScreen} />
      <Stack.Screen name="ArtworkDetail" component={ArtworkDetailScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="PopularArtists" component={PopularArtistsScreen} />
      <Stack.Screen name="SimilarSaved" component={SimilarSavedScreen} />
      <Stack.Screen name="BlogDetail" component={BlogDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Blog" component={BlogScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="FeedDetail" component={FeedDetailScreen} />
      <Stack.Screen name="MoodboardDetail" component={MoodboardDetailScreen} />
      <Stack.Screen name="Follows" component={FollowsScreen} />
      <Stack.Screen name="Invoices" component={InvoicesScreen} />
      <Stack.Screen name="CreateInvoice" component={CreateInvoiceScreen} />
      <Stack.Screen name="PreviewInvoice" component={PreviewInvoiceScreen} />
      <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} />
      <Stack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      <Stack.Screen name="EditArtwork" component={EditArtworkScreen} />
    </Stack.Navigator>
  );
}
