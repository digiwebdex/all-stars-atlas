/**
 * Per-airline markup configuration component for Admin Markup & Revenue page.
 * Allows setting individual discount % per airline or using global defaults.
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plane, Globe } from "lucide-react";
import { AIRLINES_DATABASE, type AirlineEntry } from "@/lib/airlines-database";

export interface AirlineMarkupEntry {
  useGlobal: boolean;
  discount: number;
  markup: number;
  fixedMarkup: number;
  commission?: number;
}

interface AirlineMarkupConfigProps {
  airlineMarkups: Record<string, AirlineMarkupEntry>;
  globalDiscount: number;
  globalAitVat: number;
  onChange: (airlineMarkups: Record<string, AirlineMarkupEntry>) => void;
}

const defaultAirlineEntry: AirlineMarkupEntry = {
  useGlobal: true,
  discount: 0,
  markup: 0,
  fixedMarkup: 0,
  commission: 0,
};

const AirlineMarkupConfig = ({ airlineMarkups, globalDiscount, globalAitVat, onChange }: AirlineMarkupConfigProps) => {
  const [search, setSearch] = useState("");
  const [selectedAirline, setSelectedAirline] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return AIRLINES_DATABASE;
    const q = search.toLowerCase();
    return AIRLINES_DATABASE.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.country.toLowerCase().includes(q)
    );
  }, [search]);

  const getEntry = (code: string): AirlineMarkupEntry => {
    return airlineMarkups[code] || { ...defaultAirlineEntry, discount: globalDiscount };
  };

  const updateAirline = (code: string, updates: Partial<AirlineMarkupEntry>) => {
    const current = getEntry(code);
    onChange({ ...airlineMarkups, [code]: { ...current, ...updates } });
  };

  const selectedEntry = selectedAirline ? getEntry(selectedAirline) : null;
  const selectedInfo = selectedAirline ? AIRLINES_DATABASE.find((a) => a.code === selectedAirline) : null;

  const configuredCount = Object.values(airlineMarkups).filter((e) => !e.useGlobal).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plane className="w-4 h-4" />
          Per-Airline Markup Settings
          {configuredCount > 0 && (
            <Badge variant="secondary" className="text-xs">{configuredCount} customized</Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Each airline uses <strong>Global Settings</strong> by default. Switch to <strong>Individual</strong> to set custom discount for specific airlines.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          {/* Airline list */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search airline code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <ScrollArea className="h-[400px] border rounded-lg">
              <div className="p-1">
                {filtered.map((airline) => {
                  const entry = getEntry(airline.code);
                  const isCustom = !entry.useGlobal;
                  const isSelected = selectedAirline === airline.code;
                  return (
                    <button
                      key={airline.code}
                      onClick={() => setSelectedAirline(airline.code)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                        isSelected
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="font-mono font-bold text-xs w-8 shrink-0">{airline.code}</span>
                      <span className="truncate flex-1">{airline.name}</span>
                      {isCustom && (
                        <Badge variant="default" className="text-[9px] shrink-0 bg-primary/80">Custom</Badge>
                      )}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No airlines found</p>
                )}
              </div>
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground">{AIRLINES_DATABASE.length} airlines available</p>
          </div>

          {/* Config panel */}
          <div>
            {selectedAirline && selectedEntry && selectedInfo ? (
              <div className="border rounded-lg p-4 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm flex items-center gap-2">
                      <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{selectedInfo.code}</span>
                      {selectedInfo.name}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedInfo.country}
                      {selectedInfo.alliance && ` • ${selectedInfo.alliance}`}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Global vs Individual toggle */}
                <div className="flex items-center justify-between bg-muted/40 rounded-lg p-3">
                  <div>
                    <Label className="text-sm font-semibold">
                      {selectedEntry.useGlobal ? "Using Global Settings" : "Using Individual Settings"}
                    </Label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {selectedEntry.useGlobal
                        ? `Discount: ${globalDiscount}% • AIT VAT: ${globalAitVat}% (from global)`
                        : "Custom discount for this airline only"}
                    </p>
                  </div>
                  <Switch
                    checked={!selectedEntry.useGlobal}
                    onCheckedChange={(v) => updateAirline(selectedAirline, { useGlobal: !v })}
                  />
                </div>

                {/* Individual settings (only shown when not global) */}
                {!selectedEntry.useGlobal && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Discount on Base Fare (%)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={selectedEntry.discount}
                          onChange={(e) => updateAirline(selectedAirline, { discount: Math.abs(parseFloat(e.target.value) || 0) })}
                          className="h-9"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Overrides global {globalDiscount}% — always entered as a positive number, it is deducted from the base fare.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Markup on Base Fare (%)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={selectedEntry.markup}
                          onChange={(e) => updateAirline(selectedAirline, { markup: Math.max(0, parseFloat(e.target.value) || 0) })}
                          className="h-9"
                        />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Additional Fixed Markup (BDT)</Label>
                        <Input
                          type="number"
                          step="1"
                          value={selectedEntry.fixedMarkup}
                          onChange={(e) => updateAirline(selectedAirline, { fixedMarkup: parseFloat(e.target.value) || 0 })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Agent Commission (%)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={selectedEntry.commission ?? 0}
                          onChange={(e) => updateAirline(selectedAirline, { commission: parseFloat(e.target.value) || 0 })}
                          className="h-9"
                        />
                        <p className="text-[10px] text-muted-foreground">Per-airline commission paid to agents.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div className="bg-muted/30 rounded-lg p-3 border">
                  <h5 className="text-xs font-semibold mb-2 text-muted-foreground">Preview (on BDT 100,000 base fare)</h5>
                  {(() => {
                    const base = 100000;
                    const discPct = Math.abs(selectedEntry.useGlobal ? globalDiscount : selectedEntry.discount);
                    const disc = Math.round(base * discPct / 100);
                    const aitVat = Math.round((base - disc) * globalAitVat / 100);
                    const mkp = selectedEntry.useGlobal ? 0 : Math.max(0, Math.round(base * selectedEntry.markup / 100));
                    const fixedMkp = selectedEntry.useGlobal ? 0 : Math.max(0, selectedEntry.fixedMarkup);
                    return (
                      <div className="grid grid-cols-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">Base Fare:</span>
                        <span className="text-right">BDT {base.toLocaleString()}</span>
                        <span className="text-muted-foreground">Discount ({discPct}%):</span>
                        <span className="text-right text-destructive">- BDT {disc.toLocaleString()}</span>
                        <span className="text-muted-foreground">AIT VAT ({globalAitVat}%):</span>
                        <span className="text-right">+ BDT {aitVat.toLocaleString()}</span>
                        {mkp > 0 && (
                          <>
                            <span className="text-muted-foreground">Markup:</span>
                            <span className="text-right">+ BDT {mkp.toLocaleString()}</span>
                          </>
                        )}
                        {fixedMkp > 0 && (
                          <>
                            <span className="text-muted-foreground">Fixed Markup:</span>
                            <span className="text-right">+ BDT {fixedMkp.toLocaleString()}</span>
                          </>
                        )}
                        <Separator className="col-span-2 my-1" />
                        <span className="font-semibold">Effective Base:</span>
                        <span className="text-right font-bold">BDT {(base - disc + aitVat + mkp + fixedMkp).toLocaleString()}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground border rounded-lg">
                <Globe className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm font-medium">Select an airline</p>
                <p className="text-xs mt-1">Choose from the list to configure individual markup</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AirlineMarkupConfig;
