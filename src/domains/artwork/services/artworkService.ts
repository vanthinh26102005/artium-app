import { doc, getDoc, collection, getDocs, query, where, DocumentData, updateDoc, increment, orderBy, limit, startAfter, QueryDocumentSnapshot, runTransaction, serverTimestamp, deleteDoc } from "firebase/firestore";
import { firestore } from "@/configs/firebase";
import { ArtworkDetail } from "../types";
import { Artwork as DiscoverArtwork } from "../../discover/types";

const ARTWORKS_COLLECTION = "artworks";

// --- HELPERS ---

const toNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const formatPrice = (price: any): string => {
  if (price === undefined || price === null) return "Price on Request";
  if (typeof price === "string") return price; // Legacy data support
  if (typeof price === "number") {
    return `$${price.toLocaleString()}`;
  }
  if (typeof price === "object") {
    const amountRaw = price.amount;
    if (amountRaw === undefined || amountRaw === null || amountRaw === "") {
      return "Price on Request";
    }
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    const amountLabel = Number.isFinite(amount)
      ? amount.toLocaleString()
      : String(amountRaw);
    const currency =
      typeof price.currency === "string" && price.currency.trim()
        ? price.currency
        : "USD";
    const prefix = currency === "USD" ? "$" : `${currency} `;
    return `${prefix}${amountLabel}`;
  }
  return "Price on Request";
};

const formatWeight = (weight: any): string => {
  if (weight === undefined || weight === null) return "";
  if (typeof weight === "string") return weight;
  if (typeof weight === "number") return `${weight}`;
  if (typeof weight === "object") {
    const value = toNumber(weight.value, 0);
    const unit = typeof weight.unit === "string" ? weight.unit : "";
    return unit ? `${value} ${unit}` : `${value}`;
  }
  return "";
};

const formatAuctionPrice = (amount: number, currency?: string): string => {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (currency === "VND") {
    return `${Math.round(amount).toLocaleString("vi-VN")} VND`;
  }
  return `$${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
};

const resolveArtistSnapshot = (data: any) => {
  const readString = (value: any) =>
    typeof value === "string" ? value.trim() : "";
  const sources = [
    data.artistSnapshot,
    data.artistsSnapshot,
    data.artist,
  ];
  const snapshot = sources.find((candidate: any) => {
    if (!candidate) return false;
    if (typeof candidate === "string") return candidate.trim().length > 0;
    if (typeof candidate !== "object") return false;
    const name =
      readString(candidate.name) ||
      readString(candidate.displayName) ||
      readString(candidate.fullName);
    const avatar =
      readString(candidate.avatar) ||
      readString(candidate.avatarUrl) ||
      readString(candidate.photoURL) ||
      readString(candidate.photoUrl) ||
      readString(candidate.image) ||
      readString(candidate.imageUrl);
    return Boolean(name || avatar);
  }) ?? {};

  if (typeof snapshot === "string") {
    return {
      name: snapshot || "Unknown",
      avatar: "",
      verified: false,
    };
  }

  const name =
    readString(snapshot.name) ||
    readString(snapshot.displayName) ||
    readString(snapshot.fullName) ||
    readString(data.authorName) ||
    "Unknown";
  const avatar =
    readString(snapshot.avatar) ||
    readString(snapshot.avatarUrl) ||
    readString(snapshot.photoURL) ||
    readString(snapshot.photoUrl) ||
    readString(snapshot.image) ||
    readString(snapshot.imageUrl) ||
    readString(data.authorAvatar) ||
    "";
  return {
    name,
    avatar,
    verified: !!snapshot.verified,
  };
};

const normalizeDimension = (dimension: any) => {
  const source = dimension || {};
  const unit =
    typeof source.unit === "string" && source.unit.trim() ? source.unit : "in";
  return {
    h: toNumber(source.height ?? source.h, 0),
    w: toNumber(source.width ?? source.w, 0),
    d: toNumber(source.depth ?? source.d, 0),
    unit,
  };
};

const normalizeImageList = (images: any): string[] => {
  if (!Array.isArray(images)) return [];
  return images
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return (
          item.uri ||
          item.url ||
          item.image ||
          item.imageUrl ||
          ""
        );
      }
      return "";
    })
    .filter((item) => typeof item === "string" && item.trim().length > 0);
};

const resolveFirstImage = (images: any): string => {
  return normalizeImageList(images)[0] || "";
};

const mapDiscoverArtwork = (
  id: string,
  data: DocumentData,
  isTrending: boolean
): DiscoverArtwork => {
  const artist = resolveArtistSnapshot(data);
  return {
    id,
    title: data.title || "Untitled",
    artist: artist.name || "Unknown Artist",
    artistId: data.artistId || data.authorId,
    artistAvatar: artist.avatar || "",
    image: resolveFirstImage(data.images),
    price: formatPrice(data.price),
    isTrending,
    saleMode: data.saleMode,
    auctionId: data.auctionId,
    status: data.status,
  };
};

const attachAuctionSummaries = async (
  artworks: DiscoverArtwork[]
): Promise<DiscoverArtwork[]> => {
  const auctionIds = Array.from(
    new Set(
      artworks
        .map((artwork) => artwork.auctionId)
        .filter((auctionId): auctionId is string => !!auctionId)
    )
  );
  if (!auctionIds.length) return artworks;

  const auctionEntries = await Promise.all(
    auctionIds.map(async (auctionId) => {
      try {
        const snap = await getDoc(doc(firestore, "auctions", auctionId));
        return [auctionId, snap.exists() ? snap.data() : null] as const;
      } catch (error) {
        console.warn("Unable to load auction summary:", auctionId, error);
        return [auctionId, null] as const;
      }
    })
  );
  const auctionsById = new Map(auctionEntries);

  return artworks.map((artwork) => {
    if (!artwork.auctionId) return artwork;
    const auction = auctionsById.get(artwork.auctionId);
    if (!auction) return artwork;

    const currentBid = Number(auction.currentBid ?? auction.startingPrice ?? 0);
    const currency =
      typeof auction.currency === "string" && auction.currency
        ? auction.currency
        : "USD";
    const currentBidLabel = formatAuctionPrice(currentBid, currency);
    return {
      ...artwork,
      auctionCurrentBid: currentBid,
      auctionCurrency: currency,
      price: currentBidLabel ? `Current bid ${currentBidLabel}` : artwork.price,
    };
  });
};

// --- METRIC UPDATES ---

export const incrementArtworkView = async (artworkId: string): Promise<void> => {
  if (!artworkId) return;
  const artworkRef = doc(firestore, ARTWORKS_COLLECTION, artworkId);
  try {
    await updateDoc(artworkRef, { "metrics.views": increment(1) });
  } catch (error) {
    console.warn("Could not increment artwork view count:", error);
  }
};

export const toggleArtworkLike = async (
  artworkId: string,
  userId: string,
  isCurrentlyLiked: boolean
): Promise<boolean> => {
  if (!artworkId || !userId) {
    throw new Error("artworkId and userId are required to like an artwork.");
  }
  const artworkRef = doc(firestore, ARTWORKS_COLLECTION, artworkId);
  const likeRef = doc(collection(artworkRef, "likes"), userId);

  try {
    await runTransaction(firestore, async (tx) => {
      const likeSnap = await tx.get(likeRef);
      const artworkSnap = await tx.get(artworkRef);
      if (!artworkSnap.exists()) {
        throw new Error("Artwork not found");
      }

      if (likeSnap.exists()) {
        tx.delete(likeRef);
        tx.update(artworkRef, { "metrics.likes": increment(-1) });
      } else {
        tx.set(likeRef, { createdAt: serverTimestamp(), userId });
        tx.update(artworkRef, { "metrics.likes": increment(1) });
      }
    });
    return !isCurrentlyLiked;
  } catch (error) {
    console.error("Failed to toggle artwork like:", error);
    throw error;
  }
};

// --- DATA FETCHING (PAGINATED) ---

export type PaginatedArtworksResult = {
  artworks: DiscoverArtwork[];
  lastVisible: QueryDocumentSnapshot<DocumentData> | null;
};

/**
 * Fetches a paginated list of artworks.
 */
export const getArtworks = async (
  pageSize: number,
  lastVisible: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<PaginatedArtworksResult> => {
  try {
    let artworkQuery;
    const collectionRef = collection(firestore, ARTWORKS_COLLECTION);

    if (lastVisible) {
      artworkQuery = query(collectionRef, orderBy("createdAt", "desc"), startAfter(lastVisible), limit(pageSize));
    } else {
      artworkQuery = query(collectionRef, orderBy("createdAt", "desc"), limit(pageSize));
    }

    const snapshot = await getDocs(artworkQuery);
    const artworks = await attachAuctionSummaries(
      snapshot.docs.map((doc) => mapDiscoverArtwork(doc.id, doc.data(), false))
    );

    return {
      artworks,
      lastVisible: snapshot.docs[snapshot.docs.length - 1] || null,
    };
  } catch (error) {
    console.error("Error getting artworks:", error);
    throw error;
  }
};

/**
 * Fetches trending artworks (non-paginated for this example, usually a smaller set).
 */
export const getTrendingArtworks = async (count: number = 10): Promise<DiscoverArtwork[]> => {
  try {
    const artworkQuery = query(
      collection(firestore, ARTWORKS_COLLECTION),
      where("popularityScore", ">", 0),
      orderBy("popularityScore", "desc"),
      limit(count)
    );
    const querySnapshot = await getDocs(artworkQuery);

    return attachAuctionSummaries(
      querySnapshot.docs.map((doc) => mapDiscoverArtwork(doc.id, doc.data(), true))
    );
  } catch (error) {
    console.error("Error getting trending artworks:", error);
    throw error;
  }
};

/**
 * Fetches an artwork by ID.
 */
export const getArtworkById = async (id: string, userId?: string): Promise<ArtworkDetail | null> => {
  try {
    const artworkRef = doc(firestore, ARTWORKS_COLLECTION, id);
    const artworkSnap = await getDoc(artworkRef);

    if (!artworkSnap.exists()) {
      return null;
    }

    const data = artworkSnap.data();
    const artist = resolveArtistSnapshot(data);

    let liked = false;
    if (userId) {
      try {
        const likeRef = doc(collection(artworkRef, "likes"), userId);
        const likeSnap = await getDoc(likeRef);
        liked = likeSnap.exists();
      } catch (err) {
        console.warn("Failed to check artwork like status:", err);
      }
    }

    const artworkDetail: ArtworkDetail = {
      id: artworkSnap.id,
      title: data.title || "Untitled",
      artist: {
        id: data.artistId,
        name: artist.name,
        avatar: artist.avatar,
        verified: artist.verified,
      },
      stats: data.stats || { worksSold: 0, buyers: 0 },
      price: formatPrice(data.price),
      availabilityNote: data.availabilityNote,
      images: normalizeImageList(data.images),
      tags: data.tags || [],
      dimension: normalizeDimension(data.dimension),
      weight: formatWeight(data.weight),
      weightValue:
        data.weight && typeof data.weight === "object"
          ? toNumber(data.weight.value, 0)
          : undefined,
      weightUnit:
        data.weight && typeof data.weight === "object"
          ? data.weight.unit
          : undefined,
      year: toNumber(data.year, 0),
      edition: toNumber(data.edition, 0),
      materials: data.materials || "",
      shipping: (data.shipping || []).map((item: any) => ({
        title: item.title,
        subtitle: item.subtitle,
      })),
      description: data.description || "",
      metrics: data.metrics,
      saleMode: data.saleMode,
      auctionId: data.auctionId,
      status: data.status,
      isActive: data.isActive,
      soldAt: data.soldAt?.toDate?.() ? data.soldAt.toDate().getTime() : undefined,
      soldByInvoiceId: data.soldByInvoiceId,
      priceSnapshot: typeof data.price === "object" ? data.price : undefined,
      artistId: data.artistId,
      liked,
    };

    return artworkDetail;
  } catch (error) {
    console.error("Error getting artwork by ID:", error);
    throw error;
  }
};

/**
 * Update an artwork
 */
export const updateArtwork = async (
  artworkId: string,
  userId: string,
  updates: {
    title?: string;
    description?: string;
    year?: number;
    edition?: number;
    materials?: string;
    price?: string | { amount?: number; currency?: string };
    images?: string[];
    tags?: string[];
    dimension?: {
      h: number;
      w: number;
      d: number;
      unit: string;
    };
    weight?: string | { value: number; unit: string };
    status?: string;
  }
) => {
  try {
    const artworkRef = doc(firestore, ARTWORKS_COLLECTION, artworkId);
    const artworkSnap = await getDoc(artworkRef);

    if (!artworkSnap.exists()) {
      throw new Error("Artwork not found");
    }

    const artworkData = artworkSnap.data();
    const artistId = artworkData.artistId;

    // Check permission: must be artist owner
    if (artistId !== userId) {
      throw new Error("You don't have permission to edit this artwork");
    }

    // Update the artwork
    await updateDoc(artworkRef, updates);

    return true;
  } catch (error) {
    console.error("Error updating artwork:", error);
    throw error;
  }
};

/**
 * Delete an artwork and all its subcollections (likes)
 */
export const deleteArtwork = async (artworkId: string, userId: string) => {
  try {
    const artworkRef = doc(firestore, ARTWORKS_COLLECTION, artworkId);
    const artworkSnap = await getDoc(artworkRef);

    if (!artworkSnap.exists()) {
      throw new Error("Artwork not found");
    }

    const artworkData = artworkSnap.data();
    const artistId = artworkData.artistId;

    // Check permission: must be artist owner
    if (artistId !== userId) {
      throw new Error("You don't have permission to delete this artwork");
    }

    // Delete all likes
    const likesRef = collection(firestore, ARTWORKS_COLLECTION, artworkId, "likes");
    const likesSnap = await getDocs(likesRef);
    const likesDeletePromises = likesSnap.docs.map((likeDoc) => deleteDoc(likeDoc.ref));
    await Promise.all(likesDeletePromises);

    // Delete the artwork itself
    await deleteDoc(artworkRef);

    return true;
  } catch (error) {
    console.error("Error deleting artwork:", error);
    throw error;
  }
};

/**
 * Updates artistSnapshot for all artworks by a specific user
 * Used when user updates their profile (avatar, name, etc.)
 */
export const updateUserArtworksArtistSnapshot = async (
  userId: string,
  newArtistSnapshot: {
    name: string;
    avatar?: string;
    verified?: boolean;
  }
) => {
  try {
    // Import writeBatch and deleteField dynamically to avoid circular deps
    const { writeBatch, deleteField } = await import("firebase/firestore");

    // Query all artworks by this user
    const q = query(
      collection(firestore, ARTWORKS_COLLECTION),
      where("artistId", "==", userId)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("No artworks found for user:", userId);
      return;
    }

    console.log(`Updating artistSnapshot for ${snapshot.size} artworks`);

    // Firestore batch write limit is 500 operations
    const batchSize = 500;
    const batches: any[] = [];
    let currentBatch = writeBatch(firestore);
    let operationCount = 0;


    snapshot.docs.forEach((docSnapshot) => {
      // Update artistSnapshot and clear legacy fields that resolveArtistSnapshot might read from
      currentBatch.update(docSnapshot.ref, {
        artistSnapshot: {
          name: newArtistSnapshot.name,
          avatar: newArtistSnapshot.avatar || "",
          verified: newArtistSnapshot.verified ?? false,
        },
        // Clear legacy artist fields that might be read by resolveArtistSnapshot
        artist: deleteField(),
        artistsSnapshot: deleteField(),
        authorName: deleteField(),
        authorAvatar: deleteField(),
        updatedAt: serverTimestamp(),
      });
      operationCount++;

      // If we reach batch size limit, start a new batch
      if (operationCount === batchSize) {
        batches.push(currentBatch);
        currentBatch = writeBatch(firestore);
        operationCount = 0;
      }
    });

    // Add the last batch if it has operations
    if (operationCount > 0) {
      batches.push(currentBatch);
    }

    // Commit all batches
    await Promise.all(batches.map((batch) => batch.commit()));

    console.log(`Successfully updated artistSnapshot for ${snapshot.size} artworks`);
  } catch (error) {
    console.error("Error updating user artworks artist snapshot:", error);
    throw error;
  }
};
