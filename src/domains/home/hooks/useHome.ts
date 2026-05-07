import { useCallback, useEffect, useMemo, useState } from "react";
import { Image } from "expo-image";
import { HOME_CONSTANTS } from "../constants";
import { getLatestBlogs, getOldestEditorialsAsNews } from "../services/blogService";
import { getEvents } from "../../discover/services/eventService"; // Re-use from discover
import { getTrendingArtworks } from "../../artwork/services/artworkService"; // Re-use from artwork
import { getPopularArtists } from "../services/artistService"; // New service
import type { HomeBlogItem, HomeNewsItem, HomeEventItem, HomeFollowingProfile } from "../types";
import type { Artwork } from "../../discover/types";

const prefetchImages = (urls: Array<string | undefined | null>) => {
  const uniqueUrls = Array.from(
    new Set(
      urls.filter(
        (url): url is string => typeof url === "string" && url.trim().length > 0
      )
    )
  );
  if (uniqueUrls.length) {
    void Image.prefetch(uniqueUrls.slice(0, 18));
  }
};

/**
 * Hook for home screen data.
 * Fetches real data for all sections from Firestore.
 */
export function useHome() {
  const [blogs, setBlogs] = useState<HomeBlogItem[]>([]);
  const [news, setNews] = useState<HomeNewsItem[]>([]);
  const [events, setEvents] = useState<HomeEventItem[]>([]);
  const [sellItems, setSellItems] = useState<Artwork[]>([]);
  const [following, setFollowing] = useState<HomeFollowingProfile[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(
    async (asRefresh: boolean) => {
      try {
        if (asRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        const loadBlogs = getLatestBlogs(5).then((fetchedBlogs) => {
          setBlogs(fetchedBlogs);
          prefetchImages(
            fetchedBlogs.flatMap((item) => [item.image, item.authorAvatar])
          );
          return fetchedBlogs;
        });

        const loadNews = getOldestEditorialsAsNews(5).then((fetchedNews) => {
          setNews(fetchedNews);
          prefetchImages(fetchedNews.map((item) => item.image));
          return fetchedNews;
        });

        const loadEvents = getEvents(5, null, {
          includeAttendeeCounts: false,
        }).then((res) => {
          const fetchedEvents = res.events.map((event) => ({
            ...event,
            dateLabel: event.timeLabel ?? "",
            dateISO: event.datetime ?? event.startDate,
            label: event.eventType,
          }));
          setEvents(fetchedEvents);
          prefetchImages(fetchedEvents.map((item) => item.image));
          return fetchedEvents;
        });

        const loadTrending = getTrendingArtworks(10).then((fetchedTrending) => {
          setSellItems(fetchedTrending);
          prefetchImages(
            fetchedTrending.flatMap((item) => [item.image, item.artistAvatar])
          );
          return fetchedTrending;
        });

        const loadArtists = getPopularArtists(15).then((fetchedArtists) => {
          setFollowing(fetchedArtists);
          prefetchImages(fetchedArtists.map((item) => item.avatar));
          return fetchedArtists;
        });

        const results = await Promise.allSettled([
          loadBlogs,
          loadNews,
          loadEvents,
          loadTrending,
          loadArtists,
        ]);

        const failed = results.find((result) => result.status === "rejected");
        if (failed && failed.status === "rejected") {
          throw failed.reason;
        }
      } catch (err: any) {
        setError(err);
      } finally {
        if (asRefresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const sellItemsPreview = useMemo(
    () => sellItems.slice(0, HOME_CONSTANTS.SELL_ITEMS_PREVIEW_COUNT),
    [sellItems]
  );
  
  const popularArtists = useMemo(() => following, [following]);

  return {
    news,
    blogs,
    events,
    sellItems,
    following,
    popularArtists,
    sellItemsPreview,
    isLoading,
    isRefreshing,
    refreshHome: () => fetchData(true),
    error,
  };
}

/*
// READY FOR API INTEGRATION
// Uncomment this code when backend is ready:

import { useState, useEffect } from "react";
import type { HomeData } from "../types";

type UseHomeWithAPIReturn = {
  data: HomeData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  // Backward compatible selectors
  news: HomeData["news"];
  blogs: HomeData["blogs"];
  events: HomeData["events"];
  sellItems: HomeData["sellItems"];
  sellItemsPreview: HomeData["sellItems"];
  following: HomeData["following"];
  popularArtists: HomeData["following"];
};

export function useHomeWithAPI(): UseHomeWithAPIReturn {
  const [data, setData] = useState<HomeData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchHomeData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // TODO: Replace with actual API call
      // const response = await homeService.getHomeData();
      // setData(response);

      await new Promise((resolve) => setTimeout(resolve, 100));
      setData(homeMockData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch home data"));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHomeData();
  }, []);

  const news = useMemo(() => data?.news ?? [], [data]);
  const blogs = useMemo(() => data?.blogs ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);
  const sellItems = useMemo(() => data?.sellItems ?? [], [data]);
  const sellItemsPreview = useMemo(
    () => data?.sellItems.slice(0, HOME_CONSTANTS.SELL_ITEMS_PREVIEW_COUNT) ?? [],
    [data]
  );
  const popularArtists = useMemo(() => data?.following ?? [], [data]);
  const following = useMemo(
    () => data?.following.slice(0, HOME_CONSTANTS.FOLLOWING_PREVIEW_COUNT) ?? [],
    [data]
  );

  return {
    data,
    isLoading,
    error,
    refetch: fetchHomeData,
    // Backward compatible fields
    news,
    blogs,
    events,
    sellItems,
    sellItemsPreview,
    following,
    popularArtists,
  };
}
*/
