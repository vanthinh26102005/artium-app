// TypeScript definitions for Discover domain

import type { MomentCardItem } from "../user/components/profile/MomentCard";
import type { FeedPost } from "../feed/types";

export type DiscoverTab =
  | "topPicks"
  | "nearby"
  | "artworks"
  | "profiles"
  | "moments"
  | "events";

export type DiscoverMoment = {
  id: string;
  card: MomentCardItem;
  post: FeedPost;
};

export type Badge = {
  label: string;
  color: string;
  tint?: string;
};

export type Artwork = {
  id: string;
  title: string;
  artist: string;
  artistId?: string; // User ID for navigation
  artistAvatar?: string;
  image: string;
  isTrending?: boolean;
  price?: string;
  location?: string;
  saleMode?: "fixed" | "auction";
  auctionId?: string;
  status?: "for_sale" | "on_auction" | "sold" | string;
  auctionCurrentBid?: number;
  auctionCurrency?: string;
};

export type ArtistProfile = {
  id: string;
  name: string;
  title?: string;
  avatar: string;
  verified?: boolean;
  location?: string;
};

export type EventItem = {
  id: string;
  title: string;
  location: string;
  startDate?: string; // ISO string
  datetime?: string; // ISO string (backward-compat for UI)
  createdAt?: string; // ISO string
  endDatetime?: string; // ISO string
  timeZone?: string;
  locationType?: "inPerson" | "online";
  visibility?: "public" | "private";
  description?: string;
  venueDetails?: string;
  websiteUrl?: string;
  image: string;
  category?: string;
  eventType?: string;
  timeLabel?: string;
  attendees?: number;
  organizerSnapshot?: {
    id?: string;
    name?: string;
    handle?: string;
    avatar?: string;
    verified?: boolean;
  };
  status?: "ongoing" | "upcoming";
  rsvpLabel?: string;
  rsvpStatus?: "none" | "going" | "maybe" | "notGoing";
};

export type InspirationArticle = {
  id: string;
  title: string;
  category: string;
  author: string;
  publishedAt: string;
  readTime: string;
  image: string;
};

export type SearchSuggestion = {
  id: string;
  text: string;
};

export type DiscoverData = {
  artworks: Artwork[];
  profiles: ArtistProfile[];
  moments: DiscoverMoment[];
  events: EventItem[];
};
