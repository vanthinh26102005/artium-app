// src/domains/artwork/types.ts
export type ArtworkDetail = {
  id: string;

  title: string;
  description?: string;

  artist: {
    id?: string; // User ID for navigation
    name: string;
    avatar: string;
    verified: boolean;
  };

  stats: {
    worksSold: number;
    buyers: number;
  };

  price: string;
  availabilityNote?: string;
  priceSnapshot?: {
    amount?: number;
    currency?: string;
    status?: string;
  };

  images: string[];
  tags: string[];

  dimension: {
    h: number;
    w: number;
    d: number;
    unit: string;
  };

  weight: string;
  weightValue?: number;
  weightUnit?: string;
  year: number;
  edition: number;
  materials: string;

  shipping: {
    title: string;
    subtitle?: string;
  }[];

  metrics?: {
    likes?: number;
    saves?: number;
    views?: number;
    shares?: number;
  };

  saleMode?: "fixed" | "auction";
  auctionId?: string;
  status?: "for_sale" | "on_auction" | "sold";
  isActive?: boolean;
  soldAt?: number;
  soldByInvoiceId?: string;
  liked?: boolean;
  artistId?: string;
};
