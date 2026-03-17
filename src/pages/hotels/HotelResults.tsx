import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  MapPin, Star, Wifi, Car, UtensilsCrossed, Waves, Filter, X, SlidersHorizontal,
  Grid3X3, List, Heart, ArrowRight, Building2, Coffee, Dumbbell, Sparkles,
  ShieldCheck, CalendarDays, Users, Moon, ChevronRight, Loader2, BedDouble,
  Bath, AirVent, ParkingCircle, Globe, Clock, BadgeCheck, Flame, Zap,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useHotelSearch } from "@/hooks/useApiData";
import DataLoader from "@/components/DataLoader";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const WISHLIST_KEY = "st_wishlist_hotels";
const getWishlist = (): string[] => { try { return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); } catch { return []; } };
const toggleWishlistItem = (id: string): boolean => {
  const list = getWishlist();
  const idx = list.indexOf(id);
  if (idx >= 0) { list.splice(idx, 1); localStorage.setItem(WISHLIST_KEY, JSON.stringify(list)); return false; }
  list.push(id); localStorage.setItem(WISHLIST_KEY, JSON.stringify(list)); return true;
};

const amenityIconMap: Record<string, typeof Wifi> = {
  'free wifi': Wifi, 'wifi': Wifi, 'swimming pool': Waves, 'pool': Waves,
  'restaurant': UtensilsCrossed, 'parking': ParkingCircle, 'free parking': ParkingCircle,
  'fitness center': Dumbbell, 'gym': Dumbbell, 'spa': Sparkles, 'air conditioning': AirVent,
  'breakfast included': Coffee, 'business center': Building2, 'room service': BedDouble,
  'bar/lounge': Coffee, 'airport shuttle': Car, 'pet friendly': Heart,
  'laundry': Bath, 'meeting rooms': Building2,
};

const getAmenityIcon = (amenity: string) => {
  const key = amenity.toLowerCase();
  for (const [match, Icon] of Object.entries(amenityIconMap)) {
    if (key.includes(match)) return Icon;
  }
  return BadgeCheck;
};

const getRatingLabel = (rating: number) => {
  if (rating >= 4.5) return 'Exceptional';
  if (rating >= 4) return 'Excellent';
  if (rating >= 3.5) return 'Very Good';
  if (rating >= 3) return 'Good';
  return 'Pleasant';
};

const getSourceLabel = (source: string) => {
  if (source === 'sabre') return { label: 'GDS Live', color: 'bg-primary text-primary-foreground' };
  if (source === 'hotelbeds') return { label: 'HotelBeds', color: 'bg-accent text-accent-foreground' };
  return { label: 'Partner', color: 'bg-muted text-muted-foreground' };
};

const HotelResults = () => {
  const { toast } = useToast();
  const [wishlistedIds, setWishlistedIds] = useState<string[]>(getWishlist);
  const [searchParams] = useSearchParams();
  const [sortBy, setSortBy] = useState("recommended");
  const [priceRange, setPriceRange] = useState([0, 100000]);
  const [selectedStars, setSelectedStars] = useState<number[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"grid" | "list">("list");
  const [freeCancelOnly, setFreeCancelOnly] = useState(false);

  const destination = searchParams.get("destination") || searchParams.get("location") || "";
  const checkIn = searchParams.get("checkIn") || "";
  const checkOut = searchParams.get("checkOut") || "";
  const adults = searchParams.get("adults") || "2";
  const children = searchParams.get("children") || "0";
  const roomCount = searchParams.get("rooms") || "1";
  const hasRequiredParams = !!destination && !!checkIn && !!checkOut;

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 1;
    return Math.max(1, Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
  }, [checkIn, checkOut]);

  const params = hasRequiredParams ? {
    location: destination, destination, checkIn, checkOut,
    guests: adults, children, rooms: roomCount, sort: sortBy,
  } : undefined;

  const { data: rawData, isLoading, error, refetch } = useHotelSearch(params);
  const apiData = (rawData as any) || {};
  const allHotels = apiData.data || apiData.hotels || [];

  // Client-side filtering
  const filteredHotels = useMemo(() => {
    let hotels = [...allHotels];

    // Price filter
    hotels = hotels.filter((h: any) => {
      const p = h.price || h.pricePerNight || 0;
      return p >= priceRange[0] && p <= priceRange[1];
    });

    // Star filter
    if (selectedStars.length > 0) {
      hotels = hotels.filter((h: any) => selectedStars.includes(h.stars || h.starRating || 0));
    }

    // Free cancellation
    if (freeCancelOnly) {
      hotels = hotels.filter((h: any) => h.isFreeCancellation);
    }

    // Amenity filter
    if (selectedAmenities.length > 0) {
      hotels = hotels.filter((h: any) => {
        const hotelAmenities = (h.amenities || []).map((a: string) => a.toLowerCase());
        return selectedAmenities.every(sa => hotelAmenities.some((ha: string) => ha.includes(sa.toLowerCase())));
      });
    }

    // Sort
    if (sortBy === 'price-low') hotels.sort((a: any, b: any) => (a.price || 0) - (b.price || 0));
    else if (sortBy === 'price-high') hotels.sort((a: any, b: any) => (b.price || 0) - (a.price || 0));
    else if (sortBy === 'rating') hotels.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
    else if (sortBy === 'stars') hotels.sort((a: any, b: any) => (b.stars || 0) - (a.stars || 0));

    return hotels;
  }, [allHotels, priceRange, selectedStars, freeCancelOnly, selectedAmenities, sortBy]);

  // Compute dynamic price range from data
  const priceExtent = useMemo(() => {
    if (allHotels.length === 0) return [0, 100000];
    const prices = allHotels.map((h: any) => h.price || h.pricePerNight || 0).filter((p: number) => p > 0);
    if (prices.length === 0) return [0, 100000];
    return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))];
  }, [allHotels]);

  // All amenities from results
  const availableAmenities = useMemo(() => {
    const set = new Set<string>();
    for (const h of allHotels) {
      for (const a of (h as any).amenities || []) set.add(a);
    }
    return Array.from(set).slice(0, 12);
  }, [allHotels]);

  const toggleStar = (star: number) => {
    setSelectedStars(prev => prev.includes(star) ? prev.filter(s => s !== star) : [...prev, star]);
  };

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities(prev => prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]);
  };

  const resetFilters = () => {
    setPriceRange([priceExtent[0], priceExtent[1]]);
    setSelectedStars([]);
    setSelectedAmenities([]);
    setFreeCancelOnly(false);
  };

  const activeFilterCount = selectedStars.length + selectedAmenities.length + (freeCancelOnly ? 1 : 0) +
    (priceRange[0] !== priceExtent[0] || priceRange[1] !== priceExtent[1] ? 1 : 0);

  const formatDate = (d: string) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const FilterPanel = () => (
    <div className="space-y-5">
      {/* Free Cancellation */}
      <label className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 cursor-pointer hover:bg-muted transition-colors">
        <Checkbox checked={freeCancelOnly} onCheckedChange={() => setFreeCancelOnly(!freeCancelOnly)} />
        <div>
          <p className="text-sm font-semibold">Free Cancellation</p>
          <p className="text-[11px] text-muted-foreground">Only show refundable properties</p>
        </div>
      </label>

      <Separator />

      {/* Price Range */}
      <div>
        <h4 className="text-sm font-bold mb-3 flex items-center gap-2"><Flame className="w-4 h-4 text-primary" /> Price per Night</h4>
        <Slider
          value={priceRange}
          onValueChange={setPriceRange}
          min={priceExtent[0]}
          max={priceExtent[1]}
          step={Math.max(1, Math.floor((priceExtent[1] - priceExtent[0]) / 100))}
          className="mb-3"
        />
        <div className="flex justify-between text-xs font-semibold">
          <span className="bg-muted px-2 py-1 rounded-lg">৳{priceRange[0].toLocaleString()}</span>
          <span className="bg-muted px-2 py-1 rounded-lg">৳{priceRange[1].toLocaleString()}</span>
        </div>
      </div>

      <Separator />

      {/* Star Rating */}
      <div>
        <h4 className="text-sm font-bold mb-3">Star Rating</h4>
        <div className="flex flex-wrap gap-2">
          {[5, 4, 3, 2, 1].map(s => (
            <button
              key={s}
              onClick={() => toggleStar(s)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                selectedStars.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:border-primary/40'
              }`}
            >
              {s} <Star className="w-3 h-3 fill-current" />
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Amenities */}
      {availableAmenities.length > 0 && (
        <div>
          <h4 className="text-sm font-bold mb-3">Amenities</h4>
          <div className="space-y-2">
            {availableAmenities.map(a => {
              const Icon = getAmenityIcon(a);
              return (
                <label key={a} className="flex items-center gap-2.5 cursor-pointer group">
                  <Checkbox checked={selectedAmenities.includes(a)} onCheckedChange={() => toggleAmenity(a)} />
                  <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  <span className="text-sm capitalize">{a}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // Hotel Card Component — List View
  const HotelCardList = ({ hotel }: { hotel: any }) => {
    const src = getSourceLabel(hotel.source);
    const isWished = wishlistedIds.includes(String(hotel.id));
    const hasImage = hotel.img && !hotel.img.includes('placehold');

    return (
      <Card className="overflow-hidden hover:shadow-xl transition-all duration-300 group border-border/50">
        <Link to={`/hotels/${hotel.id}?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&rooms=${roomCount}`} className="flex flex-col sm:flex-row">
          {/* Image */}
          <div className="relative sm:w-72 lg:w-80 h-52 sm:h-auto shrink-0 overflow-hidden">
            {hasImage ? (
              <img src={hotel.img} alt={hotel.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <Building2 className="w-16 h-16 text-primary/20" />
              </div>
            )}
            {hotel.tags?.[0] && (
              <Badge className="absolute top-3 left-3 bg-secondary text-secondary-foreground text-[10px] font-bold shadow-lg">{hotel.tags[0]}</Badge>
            )}
            <Badge className={`absolute bottom-3 left-3 ${src.color} text-[9px] font-bold shadow-lg`}>{src.label}</Badge>
            <button className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center hover:bg-white transition-colors shadow-sm" onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const added = toggleWishlistItem(String(hotel.id));
              setWishlistedIds(getWishlist());
              toast({ title: added ? "Saved!" : "Removed", description: added ? `${hotel.name} added to wishlist` : `Removed from wishlist` });
            }}>
              <Heart className={`w-4 h-4 transition-colors ${isWished ? "fill-destructive text-destructive" : "text-muted-foreground hover:text-destructive"}`} />
            </button>
            {hotel.images?.length > 1 && (
              <div className="absolute bottom-3 right-3 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-md font-semibold backdrop-blur-sm">
                {hotel.images.length} photos
              </div>
            )}
          </div>

          {/* Content */}
          <CardContent className="flex-1 p-4 sm:p-5 flex flex-col justify-between">
            <div>
              {/* Stars + Name */}
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex-1">
                  {hotel.stars > 0 && (
                    <div className="flex gap-0.5 mb-1">
                      {Array.from({ length: Math.min(hotel.stars, 5) }).map((_, i) => (
                        <Star key={i} className="w-3 h-3 fill-warning text-warning" />
                      ))}
                    </div>
                  )}
                  <h3 className="font-bold text-base sm:text-lg leading-tight line-clamp-1 group-hover:text-primary transition-colors">{hotel.name}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" /> {hotel.location || hotel.address}
                  </p>
                </div>

                {/* Rating */}
                {hotel.rating > 0 && (
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-xs font-semibold">{getRatingLabel(hotel.rating)}</p>
                        {hotel.reviews > 0 && <p className="text-[10px] text-muted-foreground">{hotel.reviews.toLocaleString()} reviews</p>}
                      </div>
                      <span className="bg-primary text-primary-foreground text-sm font-bold px-2 py-1.5 rounded-lg min-w-[36px] text-center">
                        {hotel.rating?.toFixed(1)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Amenities */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(hotel.amenities || []).slice(0, 5).map((a: string) => {
                  const Icon = getAmenityIcon(a);
                  return (
                    <span key={a} className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md">
                      <Icon className="w-3 h-3" /> {a}
                    </span>
                  );
                })}
                {(hotel.amenities?.length || 0) > 5 && (
                  <span className="text-[11px] text-primary font-semibold px-2 py-0.5">+{hotel.amenities.length - 5} more</span>
                )}
              </div>

              {/* Tags */}
              {hotel.isFreeCancellation && (
                <p className="text-xs text-green-600 dark:text-green-400 font-semibold mt-2 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Free cancellation
                </p>
              )}
            </div>

            {/* Price */}
            <div className="flex items-end justify-between mt-4 pt-3 border-t border-border/50">
              <div className="text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Moon className="w-3 h-3" /> {nights} night{nights > 1 ? 's' : ''}, {adults} adult{parseInt(adults) > 1 ? 's' : ''}</span>
              </div>
              <div className="text-right">
                {hotel.originalPrice && <p className="text-xs text-muted-foreground line-through">${hotel.originalPrice.toLocaleString()}</p>}
                <p className="text-xl sm:text-2xl font-black text-primary">${hotel.price?.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">per night</p>
                {hotel.totalPrice > 0 && nights > 1 && (
                  <p className="text-[11px] text-muted-foreground font-medium mt-0.5">${hotel.totalPrice.toLocaleString()} total</p>
                )}
              </div>
            </div>
          </CardContent>
        </Link>
      </Card>
    );
  };

  // Hotel Card Component — Grid View
  const HotelCardGrid = ({ hotel }: { hotel: any }) => {
    const src = getSourceLabel(hotel.source);
    const isWished = wishlistedIds.includes(String(hotel.id));
    const hasImage = hotel.img && !hotel.img.includes('placehold');

    return (
      <Card className="overflow-hidden hover:shadow-xl transition-all duration-300 group border-border/50 h-full flex flex-col">
        <Link to={`/hotels/${hotel.id}?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&rooms=${roomCount}`} className="flex flex-col h-full">
          <div className="relative aspect-[4/3] overflow-hidden">
            {hasImage ? (
              <img src={hotel.img} alt={hotel.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <Building2 className="w-12 h-12 text-primary/20" />
              </div>
            )}
            {hotel.tags?.[0] && <Badge className="absolute top-3 left-3 bg-secondary text-secondary-foreground text-[10px] font-bold shadow-lg">{hotel.tags[0]}</Badge>}
            <Badge className={`absolute bottom-3 left-3 ${src.color} text-[9px] font-bold shadow-lg`}>{src.label}</Badge>
            <button className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white transition-colors" onClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              const added = toggleWishlistItem(String(hotel.id));
              setWishlistedIds(getWishlist());
              toast({ title: added ? "Saved!" : "Removed" });
            }}>
              <Heart className={`w-3.5 h-3.5 ${isWished ? "fill-destructive text-destructive" : "text-muted-foreground"}`} />
            </button>
          </div>
          <CardContent className="p-4 flex-1 flex flex-col justify-between">
            <div>
              {hotel.stars > 0 && (
                <div className="flex gap-0.5 mb-1">
                  {Array.from({ length: Math.min(hotel.stars, 5) }).map((_, i) => <Star key={i} className="w-3 h-3 fill-warning text-warning" />)}
                </div>
              )}
              <h3 className="font-bold text-sm leading-tight line-clamp-2 mb-1">{hotel.name}</h3>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mb-2 line-clamp-1"><MapPin className="w-3 h-3 shrink-0" /> {hotel.location}</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(hotel.amenities || []).slice(0, 3).map((a: string) => (
                  <span key={a} className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">{a}</span>
                ))}
              </div>
              {hotel.isFreeCancellation && (
                <p className="text-[11px] text-green-600 dark:text-green-400 font-semibold flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Free cancellation</p>
              )}
            </div>
            <div className="flex items-end justify-between pt-3 mt-3 border-t border-border/50">
              {hotel.rating > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded">{hotel.rating?.toFixed(1)}</span>
                  <span className="text-[10px] text-muted-foreground">{hotel.reviews || 0}</span>
                </div>
              )}
              <div className="text-right">
                <p className="text-lg font-black text-primary">${hotel.price?.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{nights} night{nights > 1 ? 's' : ''}</p>
              </div>
            </div>
          </CardContent>
        </Link>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Search Summary Header */}
      <div className="bg-card border-b border-border pt-36 lg:pt-48 pb-5">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">
                {destination || "Hotels"}: {filteredHotels.length} {filteredHotels.length === 1 ? 'property' : 'properties'} found
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-muted-foreground">
                {checkIn && checkOut && (
                  <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {formatDate(checkIn)} — {formatDate(checkOut)}</span>
                )}
                <span className="text-border">•</span>
                <span className="flex items-center gap-1"><Moon className="w-3.5 h-3.5" /> {nights} night{nights > 1 ? 's' : ''}</span>
                <span className="text-border">•</span>
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {adults} adult{parseInt(adults) > 1 ? 's' : ''}{parseInt(children) > 0 ? `, ${children} child${parseInt(children) > 1 ? 'ren' : ''}` : ''}, {roomCount} room{parseInt(roomCount) > 1 ? 's' : ''}</span>
                {(apiData.sources?.sabre > 0 || apiData.sources?.hotelbeds > 0) && (
                  <>
                    <span className="text-border">•</span>
                    <span className="flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" />
                      {apiData.sources?.sabre > 0 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-primary/40 text-primary font-semibold">Sabre GDS: {apiData.sources.sabre}</Badge>}
                      {apiData.sources?.hotelbeds > 0 && <Badge variant="outline" className="text-[10px] py-0 h-5">HotelBeds: {apiData.sources.hotelbeds}</Badge>}
                    </span>
                  </>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" className="rounded-xl font-semibold gap-2" asChild>
              <Link to="/"><MapPin className="w-4 h-4" /> Modify Search</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        {!hasRequiredParams ? (
          <Card className="border-dashed"><CardContent className="py-20 text-center">
            <Building2 className="w-20 h-20 mx-auto mb-5 text-muted-foreground/20" />
            <h2 className="text-xl font-bold mb-2">Find Your Perfect Stay</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">Search from thousands of hotels worldwide with real-time availability and best rates from Sabre GDS.</p>
            <Button asChild size="lg" className="rounded-xl font-bold"><Link to="/">Search Hotels</Link></Button>
          </CardContent></Card>
        ) : (
        <div className="flex gap-6">
          {/* Sidebar Filters */}
          <aside className="hidden lg:block w-72 shrink-0">
            <Card className="sticky top-28 shadow-sm"><CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Filters</h3>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs text-primary h-7 font-semibold" onClick={resetFilters}>
                    Reset ({activeFilterCount})
                  </Button>
                )}
              </div>
              <FilterPanel />
            </CardContent></Card>
          </aside>

          {/* Results */}
          <div className="flex-1 space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[200px] rounded-xl text-sm font-semibold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[
                      { value: "recommended", label: "Recommended" },
                      { value: "price-low", label: "Price: Low to High" },
                      { value: "price-high", label: "Price: High to Low" },
                      { value: "rating", label: "Guest Rating" },
                      { value: "stars", label: "Star Rating" },
                    ].map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden sm:flex gap-0.5 border border-border rounded-xl p-0.5">
                  <button onClick={() => setView("list")} className={`p-1.5 rounded-lg transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><List className="w-4 h-4" /></button>
                  <button onClick={() => setView("grid")} className={`p-1.5 rounded-lg transition-colors ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}><Grid3X3 className="w-4 h-4" /></button>
                </div>
                <Button variant="outline" size="sm" className="lg:hidden rounded-xl font-semibold" onClick={() => setShowFilters(true)}>
                  <Filter className="w-4 h-4 mr-1" /> Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
                </Button>
              </div>
            </div>

            <DataLoader isLoading={isLoading} error={error} skeleton="cards" retry={refetch}>
              {filteredHotels.length === 0 ? (
                <Card className="border-dashed"><CardContent className="py-16 text-center">
                  <Building2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground/20" />
                  <h3 className="font-bold text-lg mb-1">No properties found</h3>
                  <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or search for a different destination.</p>
                  {activeFilterCount > 0 && <Button variant="outline" onClick={resetFilters}>Clear All Filters</Button>}
                </CardContent></Card>
              ) : view === "list" ? (
                <div className="space-y-3">
                  {filteredHotels.map((hotel: any) => (
                    <motion.div key={hotel.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                      <HotelCardList hotel={hotel} />
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredHotels.map((hotel: any) => (
                    <motion.div key={hotel.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                      <HotelCardGrid hotel={hotel} />
                    </motion.div>
                  ))}
                </div>
              )}
            </DataLoader>
          </div>
        </div>
        )}
      </div>

      {/* Mobile Filter Drawer */}
      <AnimatePresence>
        {showFilters && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50" onClick={() => setShowFilters(false)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 250 }} className="absolute right-0 top-0 bottom-0 w-80 bg-card overflow-y-auto">
              <div className="sticky top-0 bg-card z-10 p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-bold text-lg">Filters</h3>
                <button onClick={() => setShowFilters(false)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5"><FilterPanel /></div>
              <div className="sticky bottom-0 bg-card p-4 border-t border-border">
                <Button className="w-full h-11 font-bold rounded-xl" onClick={() => setShowFilters(false)}>
                  Show {filteredHotels.length} properties
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HotelResults;
