import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Star, MapPin, Heart, ArrowRight, CheckCircle2, Loader2, ChevronLeft, ChevronRight,
  Wifi, Waves, UtensilsCrossed, Dumbbell, Sparkles, Coffee, Building2, BedDouble,
  Users, Moon, ShieldCheck, Clock, CalendarDays, BadgeCheck, X, AirVent, Car,
  ParkingCircle, Bath, Phone, Mail, Globe, CreditCard, Info, AlertCircle,
} from "lucide-react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { usePrefixedNavigate } from "@/hooks/useRoutePrefix";
import { useHotelDetails } from "@/hooks/useApiData";
import { useAuth } from "@/hooks/useAuth";
import AuthGateModal from "@/components/AuthGateModal";
import DataLoader from "@/components/DataLoader";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const amenityIconMap: Record<string, typeof Wifi> = {
  'wifi': Wifi, 'free wifi': Wifi, 'pool': Waves, 'swimming pool': Waves,
  'restaurant': UtensilsCrossed, 'parking': ParkingCircle, 'free parking': ParkingCircle,
  'fitness': Dumbbell, 'gym': Dumbbell, 'spa': Sparkles, 'air conditioning': AirVent,
  'breakfast': Coffee, 'business': Building2, 'room service': BedDouble,
  'bar': Coffee, 'shuttle': Car, 'laundry': Bath,
};
const getIcon = (a: string) => {
  const k = a.toLowerCase();
  for (const [m, I] of Object.entries(amenityIconMap)) { if (k.includes(m)) return I; }
  return BadgeCheck;
};

const getRatingLabel = (r: number) => {
  if (r >= 4.5) return 'Exceptional';
  if (r >= 4) return 'Excellent';
  if (r >= 3.5) return 'Very Good';
  if (r >= 3) return 'Good';
  return 'Pleasant';
};

const HotelDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const { toast } = useToast();

  const checkIn = searchParams.get('checkIn') || '';
  const checkOut = searchParams.get('checkOut') || '';
  const adults = searchParams.get('adults') || '2';
  const roomCount = searchParams.get('rooms') || '1';

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 1;
    return Math.max(1, Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
  }, [checkIn, checkOut]);

  const detailParams = id ? {
    checkIn, checkOut, adults, rooms: roomCount,
  } : undefined;

  const { data, isLoading, error, refetch } = useHotelDetails(id);
  const hotel = (data as any)?.hotel || {};
  const rooms = hotel?.rooms || [];
  const images = (hotel.images || []).filter((img: string) => img && !img.includes('placehold'));
  const cheapestRoom = rooms.reduce((min: any, r: any) => (!min || r.price < min.price) ? r : min, null);

  const formatDate = (d: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const handleBookRoom = (room: any) => {
    setSelectedRoom(room);
    if (!isAuthenticated) { setAuthOpen(true); return; }
    submitBooking(room);
  };

  const submitBooking = async (room: any) => {
    setBookingLoading(true);
    try {
      const result: any = await api.post('/hotels/book', {
        hotelId: id,
        hotelCode: hotel.sabreHotelCode || id,
        hotelName: hotel.name,
        source: hotel.source || 'db',
        rateKey: room.rateKey,
        bookingKey: room.bookingKey,
        checkIn, checkOut,
        roomCount: parseInt(roomCount),
        guests: [{ firstName: 'Guest', lastName: 'Traveler' }],
        totalAmount: room.totalPrice || (room.price * nights),
      });
      navigate("/booking/confirmation", {
        state: {
          booking: {
            type: "Hotel",
            bookingRef: result.bookingRef || result.id,
            route: `${hotel.name} — ${hotel.location || hotel.city}`,
            baseFare: room.price * nights,
            taxes: Math.round(room.price * nights * 0.15),
            total: room.totalPrice || Math.round(room.price * nights * 1.15),
            paymentMethod: "Pending",
            passenger: "Guest",
            pnr: result.sabrePnr || result.bookingRef,
            sabrePnr: result.sabrePnr,
          },
        },
      });
    } catch (err: any) {
      toast({ title: "Booking Failed", description: err?.message || "Could not complete booking.", variant: "destructive" });
    } finally {
      setBookingLoading(false);
    }
  };

  const openLightbox = (idx: number) => { setLightboxIdx(idx); setLightboxOpen(true); };

  return (
    <div className="min-h-screen bg-muted/30 pt-32 lg:pt-44">
      <DataLoader isLoading={isLoading} error={error} skeleton="detail" retry={refetch}>
        {/* Image Gallery */}
        {images.length > 0 && (
          <div className="container mx-auto px-4 mb-6">
            <div className="grid grid-cols-4 grid-rows-2 gap-2 rounded-2xl overflow-hidden max-h-[420px] cursor-pointer">
              <div className="col-span-2 row-span-2" onClick={() => openLightbox(0)}>
                <img src={images[0]} alt={hotel.name} className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
              </div>
              {images.slice(1, 5).map((img: string, i: number) => (
                <div key={i} className="relative" onClick={() => openLightbox(i + 1)}>
                  <img src={img} alt="" className="w-full h-full object-cover hover:opacity-90 transition-opacity" loading="lazy" />
                  {i === 3 && images.length > 5 && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-white text-lg font-bold">+{images.length - 5} photos</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {images.length === 0 && (
          <div className="container mx-auto px-4 mb-6">
            <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-primary/10 to-primary/5 h-48 flex items-center justify-center">
              <Building2 className="w-24 h-24 text-primary/15" />
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 pb-10">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Header */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {hotel.stars > 0 && (
                    <div className="flex gap-0.5">
                      {Array.from({ length: Math.min(hotel.stars, 5) }).map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-warning text-warning" />
                      ))}
                    </div>
                  )}
                  {hotel.source === 'sabre' && <Badge className="bg-primary text-primary-foreground text-[10px]">GDS Live</Badge>}
                </div>
                <h1 className="text-2xl sm:text-3xl font-black mb-1 tracking-tight">{hotel.name}</h1>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 shrink-0" /> {hotel.address || hotel.location || `${hotel.city}, ${hotel.country}`}
                </p>

                {hotel.rating > 0 && (
                  <div className="flex items-center gap-3 mt-4">
                    <span className="bg-primary text-primary-foreground text-lg font-bold px-3 py-1.5 rounded-xl">{hotel.rating?.toFixed?.(1) || hotel.rating}</span>
                    <div>
                      <p className="font-bold text-sm">{getRatingLabel(hotel.rating)}</p>
                      {hotel.reviews > 0 && <p className="text-xs text-muted-foreground">{hotel.reviews.toLocaleString()} reviews</p>}
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="w-full justify-start bg-muted/50 rounded-xl h-11">
                  <TabsTrigger value="overview" className="rounded-lg font-semibold">Overview</TabsTrigger>
                  <TabsTrigger value="rooms" className="rounded-lg font-semibold">Rooms ({rooms.length})</TabsTrigger>
                  <TabsTrigger value="amenities" className="rounded-lg font-semibold">Amenities</TabsTrigger>
                  <TabsTrigger value="policies" className="rounded-lg font-semibold">Policies</TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6 mt-4">
                  {hotel.description && (
                    <div>
                      <h2 className="text-lg font-bold mb-2">About this property</h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">{hotel.description}</p>
                    </div>
                  )}

                  {/* Key amenities */}
                  {hotel.amenities?.length > 0 && (
                    <div>
                      <h2 className="text-lg font-bold mb-3">Popular amenities</h2>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {hotel.amenities.slice(0, 9).map((a: string) => {
                          const Icon = getIcon(a);
                          return (
                            <div key={a} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <Icon className="w-4 h-4 text-primary" />
                              </div>
                              <span className="text-sm font-medium capitalize">{a}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Check-in/out */}
                  <Card className="bg-muted/30 border-border/50">
                    <CardContent className="p-4 flex flex-wrap gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Check-in</p>
                          <p className="font-bold text-sm">{hotel.checkInTime || '15:00'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
                          <Clock className="w-5 h-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Check-out</p>
                          <p className="font-bold text-sm">{hotel.checkOutTime || '11:00'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Rooms Tab */}
                <TabsContent value="rooms" className="space-y-4 mt-4">
                  {rooms.length === 0 ? (
                    <Card className="border-dashed"><CardContent className="py-10 text-center">
                      <BedDouble className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
                      <p className="font-semibold mb-1">Room rates not available</p>
                      <p className="text-sm text-muted-foreground">Please contact us for availability and pricing.</p>
                    </CardContent></Card>
                  ) : rooms.map((room: any, i: number) => (
                    <Card key={room.id || i} className="overflow-hidden hover:shadow-lg transition-shadow border-border/50">
                      <CardContent className="p-0">
                        <div className="flex flex-col sm:flex-row">
                          {/* Room info */}
                          <div className="flex-1 p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="font-bold text-base">{room.name}</h3>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                                  {room.bedType && <span className="flex items-center gap-1"><BedDouble className="w-3.5 h-3.5" /> {room.bedType}</span>}
                                  {room.maxGuests && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Max {room.maxGuests} guests</span>}
                                  {room.type && room.type !== 'Standard' && <Badge variant="outline" className="text-[10px] font-medium">{room.type}</Badge>}
                                </div>
                              </div>
                            </div>

                            {/* Room amenities */}
                            {room.amenities?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-3">
                                {room.amenities.slice(0, 4).map((a: string) => (
                                  <span key={a} className="text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-md">{a}</span>
                                ))}
                              </div>
                            )}

                            {/* Meal plan */}
                            {room.mealPlan && (
                              <p className="text-xs text-primary font-semibold mt-2 flex items-center gap-1">
                                <Coffee className="w-3.5 h-3.5" /> {room.mealPlan}
                              </p>
                            )}

                            {/* Cancellation */}
                            <div className="mt-3">
                              {room.isRefundable ? (
                                <p className="text-xs text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
                                  <ShieldCheck className="w-3.5 h-3.5" /> Free cancellation
                                  {room.paymentDeadline && <span className="font-normal text-muted-foreground ml-1">before {room.paymentDeadline}</span>}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" /> {room.cancellationPolicy || 'Non-refundable'}
                                </p>
                              )}
                            </div>

                            {room.availableRooms && room.availableRooms <= 5 && (
                              <p className="text-xs text-destructive font-semibold mt-2 flex items-center gap-1">
                                <Info className="w-3.5 h-3.5" /> Only {room.availableRooms} room{room.availableRooms > 1 ? 's' : ''} left!
                              </p>
                            )}
                          </div>

                          {/* Price + Book */}
                          <div className="sm:w-52 p-5 sm:border-l border-t sm:border-t-0 border-border/50 flex flex-col justify-center items-end text-right bg-muted/20">
                            <p className="text-2xl font-black text-primary">${room.price?.toLocaleString()}</p>
                            <p className="text-[10px] text-muted-foreground">per night</p>
                            {room.totalPrice > 0 && nights > 1 && (
                              <p className="text-xs text-muted-foreground font-medium mt-0.5">${room.totalPrice.toLocaleString()} for {room.nights || nights} nights</p>
                            )}
                            <Button
                              className="mt-3 w-full sm:w-auto font-bold rounded-xl shadow-lg shadow-primary/20"
                              onClick={() => handleBookRoom(room)}
                              disabled={bookingLoading}
                            >
                              {bookingLoading && selectedRoom?.id === room.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                              Reserve
                            </Button>
                            {room.guaranteeRequired && (
                              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><CreditCard className="w-3 h-3" /> Card required</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                {/* Amenities Tab */}
                <TabsContent value="amenities" className="mt-4">
                  {hotel.amenities?.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {hotel.amenities.map((a: string) => {
                        const Icon = getIcon(a);
                        return (
                          <div key={a} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Icon className="w-4 h-4 text-primary" />
                            </div>
                            <span className="text-sm font-medium capitalize">{a}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">Amenity details not available for this property.</p>
                  )}
                </TabsContent>

                {/* Policies Tab */}
                <TabsContent value="policies" className="mt-4 space-y-4">
                  <Card className="bg-muted/30 border-border/50">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center gap-3">
                        <Clock className="w-5 h-5 text-primary shrink-0" />
                        <div>
                          <p className="text-sm font-bold">Check-in / Check-out</p>
                          <p className="text-xs text-muted-foreground">Check-in from {hotel.checkInTime || '15:00'} · Check-out by {hotel.checkOutTime || '11:00'}</p>
                        </div>
                      </div>
                      {hotel.policies?.length > 0 && hotel.policies.map((p: string, i: number) => (
                        <div key={i} className="flex items-start gap-3">
                          <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-sm text-muted-foreground">{p}</p>
                        </div>
                      ))}
                      {(!hotel.policies || hotel.policies.length === 0) && (
                        <p className="text-sm text-muted-foreground">Contact the property for detailed policies.</p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            {/* Sticky Sidebar */}
            <div className="space-y-4">
              {/* Booking Card */}
              <Card className="sticky top-28 shadow-md border-border/50">
                <CardContent className="p-5 space-y-4">
                  {/* Stay Summary */}
                  {checkIn && checkOut && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold">Check-in</p>
                        <p className="text-sm font-bold">{formatDate(checkIn)}</p>
                      </div>
                      <div className="text-center px-3">
                        <Moon className="w-4 h-4 text-muted-foreground mx-auto mb-0.5" />
                        <p className="text-[10px] font-semibold">{nights} night{nights > 1 ? 's' : ''}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground uppercase font-semibold">Check-out</p>
                        <p className="text-sm font-bold">{formatDate(checkOut)}</p>
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* Price */}
                  <div className="text-center">
                    {cheapestRoom ? (
                      <>
                        <p className="text-xs text-muted-foreground mb-1">Rooms from</p>
                        <p className="text-3xl font-black text-primary">${cheapestRoom.price?.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">per night</p>
                        {cheapestRoom.totalPrice > 0 && nights > 1 && (
                          <p className="text-sm text-muted-foreground font-medium mt-1">${cheapestRoom.totalPrice.toLocaleString()} total for {nights} nights</p>
                        )}
                      </>
                    ) : hotel.price ? (
                      <>
                        <p className="text-3xl font-black text-primary">${hotel.price?.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">per night</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Contact for rates</p>
                    )}
                  </div>

                  {/* Rating */}
                  {hotel.rating > 0 && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
                      <span className="bg-primary text-primary-foreground text-sm font-bold px-2.5 py-1.5 rounded-lg">{hotel.rating?.toFixed?.(1) || hotel.rating}</span>
                      <div>
                        <p className="text-sm font-semibold">{getRatingLabel(hotel.rating)}</p>
                        <p className="text-[10px] text-muted-foreground">{hotel.reviews || 0} reviews</p>
                      </div>
                    </div>
                  )}

                  {cheapestRoom && (
                    <Button
                      className="w-full h-12 font-bold rounded-xl text-base shadow-lg shadow-primary/20"
                      onClick={() => handleBookRoom(cheapestRoom)}
                      disabled={bookingLoading}
                    >
                      {bookingLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Reserve Now <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  )}

                  {cheapestRoom?.isRefundable && (
                    <p className="text-[11px] text-center text-green-600 dark:text-green-400 font-semibold flex items-center justify-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Free cancellation available
                    </p>
                  )}

                  <p className="text-[10px] text-center text-muted-foreground">No payment required at this stage</p>
                </CardContent>
              </Card>

              {/* Property highlights */}
              {hotel.amenities?.length > 0 && (
                <Card className="border-border/50">
                  <CardContent className="p-4">
                    <h4 className="text-sm font-bold mb-3">Property highlights</h4>
                    <div className="space-y-2">
                      {hotel.amenities.slice(0, 5).map((a: string) => {
                        const Icon = getIcon(a);
                        return (
                          <div key={a} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Icon className="w-4 h-4 text-primary shrink-0" /> {a}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </DataLoader>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && images.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
            onClick={() => setLightboxOpen(false)}
          >
            <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white z-10" onClick={() => setLightboxOpen(false)}>
              <X className="w-6 h-6" />
            </button>
            <button className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white z-10" onClick={(e) => {
              e.stopPropagation(); setLightboxIdx(prev => prev > 0 ? prev - 1 : images.length - 1);
            }}><ChevronLeft className="w-6 h-6" /></button>
            <button className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white z-10" onClick={(e) => {
              e.stopPropagation(); setLightboxIdx(prev => prev < images.length - 1 ? prev + 1 : 0);
            }}><ChevronRight className="w-6 h-6" /></button>
            <img src={images[lightboxIdx]} alt="" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
            <div className="absolute bottom-4 text-white/70 text-sm font-semibold">{lightboxIdx + 1} / {images.length}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AuthGateModal
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthenticated={() => { setAuthOpen(false); if (selectedRoom) submitBooking(selectedRoom); }}
        title="Sign in to book your hotel"
        description="Create an account or sign in to complete your reservation."
      />
    </div>
  );
};

export default HotelDetail;
