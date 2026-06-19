import jsPDF from "jspdf";
import QRCode from "qrcode";

const LOGO_URL = "/images/seven-trip-logo.png";
let cachedLogoBase64: string | null = null;

// Company info — single source of truth for all PDFs
const COMPANY = {
  name: "Seven Trip",
  parent: "Evan International",
  phone: "+880 1749-373748",
  email: "support@seven-trip.com",
  address: "Beena Kanon, Flat-4A, House-03, Road-17, Block-E, Banani, Dhaka-1213",
  addressShort: "Banani, Dhaka-1213",
  website: "www.seven-trip.com",
};

async function loadLogoBase64(): Promise<string | null> {
  if (cachedLogoBase64) return cachedLogoBase64;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = LOGO_URL;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    cachedLogoBase64 = canvas.toDataURL("image/png");
    return cachedLogoBase64;
  } catch {
    return null;
  }
}

async function loadImageBase64(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function addLogo(doc: jsPDF, logo: string | null, x: number, y: number, w: number, h: number) {
  if (!logo) return;
  try {
    doc.addImage(logo, "PNG", x, y, w, h);
  } catch { /* fallback */ }
}

async function generateQRDataUrl(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { width: 120, margin: 1 });
  } catch {
    return null;
  }
}

/**
 * Draws the standard company header matching the reference PDF exactly:
 * - Purple decorative top stripe
 * - Large logo (~50mm wide)
 * - Company contact info below logo
 * - QR code in top-right corner
 */
function drawReferenceHeader(doc: jsPDF, logo: string | null, w: number, qr: string | null): number {
  // Purple decorative stripe at very top
  doc.setFillColor(120, 90, 220);
  doc.rect(0, 0, w, 4, "F");

  // Large logo
  if (logo) {
    addLogo(doc, logo, 20, 10, 50, 18);
  } else {
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(40, 180, 160);
    doc.text("Seven Trip", 20, 24);
  }

  // QR code top-right
  if (qr) {
    try { doc.addImage(qr, "PNG", w - 42, 8, 22, 22); } catch { /* skip */ }
  }

  // Company contact info below logo
  let y = 32;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  doc.text(`Call: ${COMPANY.phone}`, 20, y);
  y += 4;
  doc.text("Beena Kanon, Flat-4A, House-03,", 20, y);
  y += 4;
  doc.text("Road-17, Block-E, Banani, Dhaka-1213", 20, y);
  y += 8;

  return y;
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const scales = ["", "Thousand", "Lakh", "Crore"];

  const num = Math.floor(Math.abs(n));
  if (num === 0) return "Zero";

  // Split into groups: last 3 digits, then pairs
  const groups: number[] = [];
  let remaining = num;
  groups.push(remaining % 1000);
  remaining = Math.floor(remaining / 1000);
  while (remaining > 0) {
    groups.push(remaining % 100);
    remaining = Math.floor(remaining / 100);
  }

  function groupToWords(g: number): string {
    if (g === 0) return "";
    if (g < 20) return ones[g];
    if (g < 100) return tens[Math.floor(g / 10)] + (g % 10 ? " " + ones[g % 10] : "");
    return ones[Math.floor(g / 100)] + " Hundred" + (g % 100 ? " " + groupToWords(g % 100) : "");
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] > 0) {
      parts.push(groupToWords(groups[i]) + (scales[i] ? " " + scales[i] : ""));
    }
  }
  return parts.join(" ") + " Taka Only";
}

/* ════════════════════════════════════════════════════════════════════
   MONEY RECEIPT PDF — Matches uploaded format
   ════════════════════════════════════════════════════════════════════ */

export interface MoneyReceiptData {
  receiptNo?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  items: Array<{
    description: string;
    pax: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalAmount: number;
  due: number;
  discount: number;
  grandTotal: number;
  receivedBy?: string;
  date: string;
}

export async function generateMoneyReceiptPDF(data: MoneyReceiptData) {
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const logo = await loadLogoBase64();
  const qrText = `SevenTrip Receipt | ${data.receiptNo || "N/A"} | ${data.customerName} | BDT ${data.grandTotal} | ${data.date}`;
  const qr = await generateQRDataUrl(qrText);

  let y = drawReferenceHeader(doc, logo, w, qr);

  // Title: "Money Receipt" — large bold text (NOT in a filled bar)
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("Money Receipt", 20, y);
  y += 10;

  // Receipt for section
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(60);
  doc.text("Receipt for-", 20, y);
  y += 6;

  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(data.customerName, 20, y);
  y += 5;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  if (data.customerPhone) { doc.text(data.customerPhone, 20, y); y += 5; }
  if (data.customerAddress) { doc.text(data.customerAddress, 20, y); y += 5; }
  y += 6;

  // ── Table matching reference exactly ──
  const tableLeft = 20;
  const tableRight = w - 20;
  const tableW = tableRight - tableLeft;
  const colNo = tableLeft;
  const colDesc = tableLeft + 25;
  const colPax = tableLeft + tableW * 0.55;
  const colUnit = tableLeft + tableW * 0.68;
  const colTotal = tableRight;
  const rowH = 10;

  // Table header — light cyan/blue background
  doc.setFillColor(200, 235, 245);
  doc.rect(tableLeft, y, tableW, rowH, "F");
  doc.setDrawColor(180, 220, 235);
  doc.rect(tableLeft, y, tableW, rowH, "S");
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30);
  doc.text("No", colNo + 4, y + 7);
  doc.text("Description", colDesc, y + 7);
  doc.text("Pax", colPax, y + 7, { align: "center" });
  doc.text("Unit Price", colUnit + 10, y + 7, { align: "center" });
  doc.text("Total price", colTotal - 4, y + 7, { align: "right" });
  y += rowH;

  // Table rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0);

  const totalRows = Math.max(3, data.items.length);
  for (let i = 0; i < totalRows; i++) {
    // Alternate row background: white / very light gray
    if (i % 2 === 1) {
      doc.setFillColor(248, 248, 248);
      doc.rect(tableLeft, y, tableW, rowH, "F");
    }
    doc.setDrawColor(220, 220, 220);
    doc.rect(tableLeft, y, tableW, rowH, "S");

    const item = data.items[i];
    doc.setTextColor(0);
    doc.text(String(i + 1).padStart(2, "0"), colNo + 4, y + 7);
    if (item) {
      doc.text(item.description, colDesc, y + 7, { maxWidth: colPax - colDesc - 5 });
      doc.text(String(item.pax), colPax, y + 7, { align: "center" });
      doc.text(`${item.unitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, colUnit + 10, y + 7, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(`${item.totalPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, colTotal - 4, y + 7, { align: "right" });
      doc.setFont("helvetica", "normal");
    }
    y += rowH;
  }

  // ── Totals section — right-aligned with pink/lavender background ──
  y += 2;
  const totalsLabelX = colUnit - 10;
  const totalsValueX = colTotal - 4;
  const totalsRowH = 9;

  // Total Fair
  doc.setFillColor(235, 245, 235);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Total Fair", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Due
  doc.setFillColor(240, 230, 245);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Due", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.due.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Adjustment/Discount
  doc.setFillColor(240, 230, 245);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Adjustment/Discount", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.discount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Grand Total — pink background
  doc.setFillColor(235, 210, 230);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Grand Total", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // In Words
  y += 2;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  doc.text("In Words-", 20, y + 5);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(numberToWords(data.grandTotal), 20, y + 5);
  y += 14;

  // Received with gratitude — mint green box
  doc.setFillColor(220, 245, 230);
  const gratitudeText = `Received with gratitude from ${data.customerName}, the amount of ${numberToWords(data.grandTotal)} (BDT ${data.grandTotal.toLocaleString()}/-) towards ${data.items.map(i => i.description).join(", ")}.`;
  const gratLines = doc.splitTextToSize(gratitudeText, w - 50);
  const gratH = gratLines.length * 5 + 8;
  doc.rect(20, y, w - 40, gratH, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30);
  doc.text(gratLines, 25, y + 6);
  y += gratH + 20;

  // Signature — right-aligned, no horizontal line
  doc.setTextColor(0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  if (data.receivedBy) {
    doc.text(data.receivedBy, w - 30, y, { align: "right" });
    y += 5;
  }
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(data.date, w - 30, y, { align: "right" });
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Signature & Date", w - 30, y, { align: "right" });

  doc.save(`MoneyReceipt-${data.receiptNo || "receipt"}.pdf`);
}

export async function printMoneyReceiptPDF(data: MoneyReceiptData) {
  // Generate same as above but open for printing
  await generateMoneyReceiptPDF(data);
}

/* ════════════════════════════════════════════════════════════════════
   INVOICE PDF — Matches uploaded format with QR
   ════════════════════════════════════════════════════════════════════ */

export interface InvoiceLineItem {
  name: string;
  description?: string;
  quantity?: number;
  unitPrice: number;
  totalPrice: number;
  extra?: Record<string, string | number>;
}

export interface InvoiceData {
  invoiceNo: string;
  date: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress?: string;
  bookingRef: string;
  subtotal: number;
  tax: number;
  discount: number;
  amount: number;
  status: string;
  serviceType?: string;
  lineItems?: InvoiceLineItem[];
}

async function buildInvoiceDoc(inv: InvoiceData): Promise<jsPDF> {
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const logo = await loadLogoBase64();
  const qrText = `SevenTrip Invoice | ${inv.invoiceNo} | ${inv.customerName} | BDT ${inv.amount} | ${inv.date}`;
  const qr = await generateQRDataUrl(qrText);

  let y = drawReferenceHeader(doc, logo, w, qr);

  // Title: "Invoice" — large bold text (NOT in a filled bar)
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("Invoice", 20, y);
  y += 10;

  // Invoice for (left) + Invoice details (right)
  doc.setTextColor(60);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Invoice for", 20, y);
  doc.text("Invoice Details", w - 70, y);
  y += 6;

  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(inv.customerName, 20, y);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`# ${inv.invoiceNo}`, w - 70, y);
  y += 5;

  doc.setTextColor(80);
  doc.setFontSize(8);
  if (inv.customerPhone) { doc.text(inv.customerPhone, 20, y); }
  doc.text(`Submitted on ${inv.date}`, w - 70, y);
  y += 5;
  if (inv.customerEmail) { doc.text(inv.customerEmail, 20, y); y += 5; }
  if (inv.customerAddress) { doc.text(inv.customerAddress, 20, y); y += 5; }
  y += 6;

  // Build effective line items
  const effectiveItems: InvoiceLineItem[] = (inv.lineItems && inv.lineItems.length > 0)
    ? inv.lineItems
    : [{
        name: inv.serviceType
          ? `${inv.serviceType.charAt(0).toUpperCase() + inv.serviceType.slice(1)} Booking`
          : "Service",
        description: inv.bookingRef ? `Ref: ${inv.bookingRef}` : undefined,
        quantity: 1,
        unitPrice: inv.subtotal || inv.amount || 0,
        totalPrice: inv.subtotal || inv.amount || 0,
      }];

  const extraKeys = effectiveItems[0]?.extra ? Object.keys(effectiveItems[0].extra) : [];

  // ── Table matching reference exactly ──
  const tableLeft = 20;
  const tableRight = w - 20;
  const tableW = tableRight - tableLeft;
  const rowH = 10;

  // Table header — light cyan/blue background
  doc.setFillColor(200, 235, 245);
  doc.rect(tableLeft, y, tableW, rowH, "F");
  doc.setDrawColor(180, 220, 235);
  doc.rect(tableLeft, y, tableW, rowH, "S");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30);

  let hx = tableLeft + 4;
  doc.text("No", hx, y + 7); hx += 15;
  doc.text("Name", hx, y + 7); hx += 55;
  extraKeys.forEach(k => {
    doc.text(k, hx, y + 7); hx += 25;
  });
  if (effectiveItems[0]?.quantity !== undefined) {
    doc.text("Qty", tableRight - 65, y + 7, { align: "center" });
  }
  doc.text("Unit Price", tableRight - 38, y + 7, { align: "center" });
  doc.text("Total Price", tableRight - 4, y + 7, { align: "right" });
  y += rowH;

  // Table rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0);

  const totalRows = Math.max(3, effectiveItems.length);
  for (let i = 0; i < totalRows; i++) {
    if (y > 260) {
      doc.addPage();
      y = 20;
      // Repeat header
      doc.setFillColor(200, 235, 245);
      doc.rect(tableLeft, y, tableW, rowH, "F");
      doc.setDrawColor(180, 220, 235);
      doc.rect(tableLeft, y, tableW, rowH, "S");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30);
      let rhx = tableLeft + 4;
      doc.text("No", rhx, y + 7); rhx += 15;
      doc.text("Name", rhx, y + 7); rhx += 55;
      extraKeys.forEach(k => { doc.text(k, rhx, y + 7); rhx += 25; });
      doc.text("Total Price", tableRight - 4, y + 7, { align: "right" });
      y += rowH;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(0);
    }

    // Alternate row background
    if (i % 2 === 1) {
      doc.setFillColor(248, 248, 248);
      doc.rect(tableLeft, y, tableW, rowH, "F");
    }
    doc.setDrawColor(220, 220, 220);
    doc.rect(tableLeft, y, tableW, rowH, "S");

    const item = effectiveItems[i];
    doc.setTextColor(0);
    doc.text(String(i + 1).padStart(2, "0"), tableLeft + 4, y + 7);
    if (item) {
      doc.text(item.name.substring(0, 32), tableLeft + 19, y + 7);
      let exX = tableLeft + 74;
      extraKeys.forEach(k => {
        const val = item.extra?.[k];
        doc.text(String(val ?? ""), exX, y + 7); exX += 25;
      });
      if (item.quantity !== undefined) {
        doc.text(String(item.quantity), tableRight - 65, y + 7, { align: "center" });
      }
      doc.text(`${item.unitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, tableRight - 38, y + 7, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(`${item.totalPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, tableRight - 4, y + 7, { align: "right" });
      doc.setFont("helvetica", "normal");
    }
    y += rowH;
  }

  // ── Totals — matching reference with colored backgrounds ──
  y += 2;
  const totalsLabelX = tableRight - 85;
  const totalsValueX = tableRight - 4;
  const totalsRowH = 9;

  // Subtotal
  doc.setFillColor(235, 245, 235);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Subtotal", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${(inv.subtotal || inv.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Tax (if applicable)
  if (inv.tax > 0) {
    doc.setFillColor(240, 230, 245);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
    doc.setDrawColor(220);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
    doc.text("Tax", totalsValueX - 45, y + 6, { align: "right" });
    doc.text(`${inv.tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
    y += totalsRowH;
  }

  // Discount (if applicable)
  if (inv.discount > 0) {
    doc.setFillColor(240, 230, 245);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
    doc.setDrawColor(220);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
    doc.setTextColor(0, 130, 0);
    doc.text("Discount", totalsValueX - 45, y + 6, { align: "right" });
    doc.text(`-${inv.discount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
    doc.setTextColor(0);
    y += totalsRowH;
  }

  // Grand Total — pink background
  doc.setFillColor(235, 210, 230);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Grand Total", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${inv.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })} BDT`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // In words
  y += 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  doc.text("In Words-", 20, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text(numberToWords(inv.amount), 20, y);
  y += 12;

  // Footer
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130);
  doc.text(`Thank you for choosing ${COMPANY.name}. For queries, contact ${COMPANY.email}`, w / 2, y, { align: "center" });
  y += 4;
  doc.text("This is a computer-generated invoice and does not require a signature.", w / 2, y, { align: "center" });
  y += 4;
  doc.setFontSize(6);
  doc.text(`${COMPANY.name} — A concern of ${COMPANY.parent} | ${COMPANY.website} | ${COMPANY.phone}`, w / 2, y, { align: "center" });

  return doc;
}

export async function generateInvoicePDF(inv: InvoiceData) {
  const doc = await buildInvoiceDoc(inv);
  doc.save(`${inv.invoiceNo}.pdf`);
}

export async function printInvoicePDF(inv: InvoiceData) {
  const doc = await buildInvoiceDoc(inv);
  const pdfBlob = doc.output("blob");
  const url = URL.createObjectURL(pdfBlob);
  const printWindow = window.open(url);
  if (printWindow) {
    printWindow.onload = () => { printWindow.print(); };
  }
}

/* ════════════════════════════════════════════════════════════════════
   PREMIUM E-TICKET / TRAVEL ITINERARY PDF
   Emirates / Turkish Airlines inspired design
   ════════════════════════════════════════════════════════════════════ */

interface FlightSegment {
  airline: string;
  airlineCode?: string;
  flightNumber: string;
  origin: string;
  originCity?: string;
  destination: string;
  destinationCity?: string;
  departureTime: string;
  arrivalTime: string;
  duration?: string;
  cabinClass?: string;
  aircraft?: string;
  terminal?: string;
  arrivalTerminal?: string;
  stops?: number;
  baggage?: string;
  status?: string;
  meal?: string;
  distance?: number;
  emission?: string;
  handBaggage?: string;
  seatPitch?: string;
  wifi?: boolean;
  entertainment?: boolean;
  operatingCarrier?: string;
}

interface PassengerInfo {
  title?: string;
  firstName: string;
  lastName: string;
  passport?: string;
  seat?: string;
  ticketNumber?: string;
  type?: string;
  gender?: string;
  dob?: string;
  frequentFlyer?: string;
  seatNo?: string;
  ticketNo?: string;
  name?: string;
}

interface TicketData {
  id?: string;
  airline?: string;
  flightNo?: string;
  from?: string;
  to?: string;
  date?: string;
  time?: string;
  passenger?: string;
  pnr?: string;
  gdsPnr?: string;
  airlinePnr?: string;
  seat?: string;
  class?: string;
  bookingRef?: string;
  airlineReservationCode?: string;
  isRoundTrip?: boolean;
  outbound?: FlightSegment[];
  returnSegments?: FlightSegment[];
  passengers?: PassengerInfo[];
  meal?: string;
  extraBaggage?: string[];
  totalFare?: number;
  baseFare?: number;
  taxes?: number;
  serviceCharge?: number;
  currency?: string;
  source?: string;
  ticketNo?: string;
  bookingStatus?: string;
  issuedAt?: string;
  refundable?: boolean;
  cabinClass?: string;
  // From enriched tickets endpoint
  origin?: string;
  destination?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  stops?: number;
  baggage?: any;
  handBaggage?: any;
  aircraft?: string;
  legs?: any[];
  flightNumber?: string;
  airlineCode?: string;
  totalAmount?: number;
}

function safeTime(dt?: string): string {
  if (!dt) return "--:--";
  try {
    // Handle TTI /Date(ms+offset)/ format
    const ttiMatch = dt.match(/\/Date\((\d+)([+-]\d{4})\)\//);
    if (ttiMatch) {
      const d = new Date(parseInt(ttiMatch[1]));
      if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    const d = new Date(dt);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { /* fall through */ }
  const m = dt.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : "--:--";
}

function safeTimezone(dt?: string): string {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    if (!isNaN(d.getTime())) {
      const offset = d.getTimezoneOffset();
      const sign = offset <= 0 ? "+" : "-";
      const h = Math.floor(Math.abs(offset) / 60);
      const m = Math.abs(offset) % 60;
      return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
    }
  } catch { /* */ }
  return "";
}

function safeDateFull(dt?: string): string {
  if (!dt) return "";
  try {
    const ttiMatch = dt.match(/\/Date\((\d+)([+-]\d{4})\)\//);
    if (ttiMatch) {
      const d = new Date(parseInt(ttiMatch[1]));
      if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    }
    const d = new Date(dt);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  } catch { /* */ }
  return dt;
}

function safeDateShort(dt?: string): string {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { /* */ }
  return dt;
}

function drawBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);
}

function drawFilledBox(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, g: number, b: number) {
  doc.setFillColor(r, g, b);
  doc.rect(x, y, w, h, "F");
}

/** Draw a rounded-corner-ish separator line */
function drawSectionDivider(doc: jsPDF, y: number, w: number) {
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.4);
  doc.line(15, y, w - 15, y);
}

/** Resolve a baggage value to a string */
function baggageStr(val: any): string {
  if (!val) return "--";
  if (typeof val === "string") return val;
  if (typeof val === "object") return val.weight || val.pieces || JSON.stringify(val);
  return String(val);
}

/** Build segments from enriched ticket data */
function buildSegments(ticket: TicketData): { outbound: FlightSegment[]; ret: FlightSegment[] } {
  let outbound: FlightSegment[] = ticket.outbound || [];
  const ret: FlightSegment[] = ticket.returnSegments || [];

  // Build from legs if available
  if (outbound.length === 0 && ticket.legs && ticket.legs.length > 0) {
    outbound = ticket.legs.map((l: any) => ({
      airline: l.airline || ticket.airline || "Airline",
      airlineCode: l.airlineCode || ticket.airlineCode || "",
      flightNumber: l.flightNumber || l.flight || ticket.flightNumber || ticket.flightNo || "",
      origin: l.origin || l.departureAirport || "",
      originCity: l.originCity || "",
      destination: l.destination || l.arrivalAirport || "",
      destinationCity: l.destinationCity || "",
      departureTime: l.departureTime || l.departureDateTime || "",
      arrivalTime: l.arrivalTime || l.arrivalDateTime || "",
      duration: l.duration || "",
      cabinClass: l.cabinClass || ticket.cabinClass || ticket.class || "Economy",
      aircraft: l.aircraft || l.equipmentType || ticket.aircraft || "",
      terminal: l.terminal || "",
      arrivalTerminal: l.arrivalTerminal || "",
      baggage: baggageStr(l.baggage || ticket.baggage),
      handBaggage: baggageStr(l.handBaggage || ticket.handBaggage),
      status: "Confirmed",
      meal: l.meal || ticket.meal || "",
    }));
  }

  // Fallback: single segment from flat fields
  if (outbound.length === 0 && (ticket.from || ticket.origin)) {
    outbound.push({
      airline: ticket.airline || "Airline",
      airlineCode: ticket.airlineCode || "",
      flightNumber: ticket.flightNumber || ticket.flightNo || "",
      origin: ticket.from || ticket.origin || "",
      destination: ticket.to || ticket.destination || "",
      departureTime: ticket.departureTime || ticket.time || ticket.date || "",
      arrivalTime: ticket.arrivalTime || "",
      duration: ticket.duration || "",
      cabinClass: ticket.cabinClass || ticket.class || "Economy",
      aircraft: ticket.aircraft || "",
      baggage: baggageStr(ticket.baggage) || "20kg",
      handBaggage: baggageStr(ticket.handBaggage),
      status: "Confirmed",
      meal: ticket.meal || "",
      stops: ticket.stops,
    });
  }

  return { outbound, ret };
}

function buildPassengers(ticket: TicketData): PassengerInfo[] {
  if (ticket.passengers && ticket.passengers.length > 0) {
    return ticket.passengers.map((p: any) => ({
      firstName: p.firstName || p.name?.split(" ").slice(0, -1).join(" ") || p.name || "",
      lastName: p.lastName || p.name?.split(" ").pop() || "",
      title: p.title || "",
      seat: p.seat || p.seatNo || "",
      ticketNumber: p.ticketNumber || p.ticketNo || "",
      passport: p.passport || p.passportNumber || "",
      type: p.type || p.travelerType || "ADT",
      gender: p.gender || "",
      dob: p.dob || p.dateOfBirth || "",
      name: p.name || "",
    }));
  }
  return [{ firstName: ticket.passenger || "Traveller", lastName: "", seat: ticket.seat, ticketNumber: ticket.ticketNo || ticket.id }];
}

async function buildPremiumTicketDoc(ticket: TicketData): Promise<jsPDF> {
  const doc = new jsPDF();
  const w = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const lm = 15;
  const rm = w - 15;
  const cw = rm - lm; // content width
  const logo = await loadLogoBase64();

  const { outbound, ret: returnSegments } = buildSegments(ticket);
  const passengers = buildPassengers(ticket);
  const bookingRef = ticket.bookingRef || ticket.pnr || ticket.gdsPnr || ticket.id || "";
  const airlinesPnr = ticket.airlinePnr || "";
  const ticketNo = ticket.ticketNo || passengers[0]?.ticketNumber || "";
  const currency = ticket.currency || "BDT";
  const gdsSource = ticket.source || "";
  const allSegments = [
    ...outbound.map((s, i) => ({ ...s, direction: returnSegments.length > 0 ? "OUTBOUND" : "DEPARTURE", segIndex: i })),
    ...returnSegments.map((s, i) => ({ ...s, direction: "RETURN", segIndex: i })),
  ];
  const totalLegs = allSegments.length;

  // Final destination for trip header
  const finalDest = allSegments.length > 0
    ? (allSegments[allSegments.length - 1].destinationCity || allSegments[allSegments.length - 1].destination || "")
    : "";

  // QR Code
  const qrText = `SevenTrip E-Ticket | PNR: ${bookingRef} | ${passengers.map(p => p.name || `${p.firstName} ${p.lastName}`).join(", ")} | ${allSegments[0]?.origin || ""}-${allSegments[allSegments.length - 1]?.destination || ""}`;
  const qr = await generateQRDataUrl(qrText);

  // Airline logo
  const firstCode = outbound[0]?.airlineCode || ticket.airlineCode || "";
  let airlineLogo: string | null = null;
  if (firstCode) {
    airlineLogo = await loadImageBase64(`https://images.kiwi.com/airlines/64/${firstCode}.png`);
  }

  let currentPage = 1;

  // ─────── HELPERS ───────
  const PURPLE = [88, 55, 160] as const;
  const TEAL = [0, 180, 200] as const;
  const DARK = [30, 30, 30] as const;
  const MID = [80, 80, 80] as const;
  const LIGHT = [120, 120, 120] as const;
  const GREEN = [0, 140, 60] as const;

  function setColor(doc: jsPDF, c: readonly number[]) { doc.setTextColor(c[0], c[1], c[2]); }
  function setFill(doc: jsPDF, c: readonly number[]) { doc.setFillColor(c[0], c[1], c[2]); }

  function checkPageBreak(y: number, needed: number): number {
    if (y + needed > pageH - 30) {
      doc.addPage();
      currentPage++;
      return drawPageHeader();
    }
    return y;
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE HEADER — Premium branding bar
  // ═══════════════════════════════════════════════════════════
  function drawPageHeader(): number {
    // Top accent bar
    setFill(doc, PURPLE);
    doc.rect(0, 0, w, 3.5, "F");
    setFill(doc, TEAL);
    doc.rect(w * 0.55, 0, w * 0.45, 3.5, "F");

    // Logo
    if (logo) {
      try {
        const imgProps = doc.getImageProperties(logo);
        const maxW = 50, maxH = 18;
        const ratio = Math.min(maxW / imgProps.width, maxH / imgProps.height);
        doc.addImage(logo, "PNG", lm, 6, imgProps.width * ratio, imgProps.height * ratio);
      } catch { /* skip */ }
    } else {
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      setColor(doc, PURPLE);
      doc.text("Seven Trip", lm, 18);
    }

    // Right: Ticket & receipt
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text("Ticket & receipt", rm, 15, { align: "right" });

    // QR code top-right
    if (qr) {
      try { doc.addImage(qr, "PNG", rm - 20, 18, 18, 18); } catch { /* */ }
    }

    // Ticket number
    let hy = 28;
    if (ticketNo) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      setColor(doc, DARK);
      doc.text(`Ticket number: ${ticketNo}`, lm, hy);
    }
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    doc.text("Scan the QR code or use the ticket number above at the self check-in points in the airport.", lm, hy + 4);

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(lm, hy + 8, rm, hy + 8);

    return hy + 12;
  }

  // ═══════════════════════════════════════════════════════════
  // DRAW FLIGHT PATH ICON (Emirates-style: o─→✈→─o)
  // ═══════════════════════════════════════════════════════════
  function drawFlightPath(x: number, y: number, pathW: number, isArrival: boolean) {
    const cy = y + 1.5;
    // Departure dot
    setFill(doc, isArrival ? GREEN : PURPLE);
    doc.circle(x, cy, 1, "F");
    // Dashed line
    doc.setDrawColor(isArrival ? GREEN[0] : PURPLE[0], isArrival ? GREEN[1] : PURPLE[1], isArrival ? GREEN[2] : PURPLE[2]);
    doc.setLineWidth(0.3);
    const segments = 6;
    const segLen = pathW / (segments * 2);
    for (let i = 0; i < segments; i++) {
      const sx = x + 2 + i * segLen * 2;
      doc.line(sx, cy, sx + segLen, cy);
    }
    // Plane icon (triangle)
    const planeX = x + pathW * 0.45;
    doc.setFillColor(isArrival ? GREEN[0] : PURPLE[0], isArrival ? GREEN[1] : PURPLE[1], isArrival ? GREEN[2] : PURPLE[2]);
    doc.triangle(planeX, cy - 1.5, planeX, cy + 1.5, planeX + 3, cy, "F");
    // Arrival dot
    doc.circle(x + pathW, cy, 1, "F");
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE 1 START
  // ═══════════════════════════════════════════════════════════
  let y = drawPageHeader();

  // ── PASSENGER & BOOKING INFO TABLE ──
  const paxBoxH = 14;
  doc.setFillColor(248, 247, 252);
  doc.rect(lm, y, cw, paxBoxH, "F");
  doc.setDrawColor(220);
  doc.setLineWidth(0.2);
  doc.rect(lm, y, cw, paxBoxH);

  // Labels
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, LIGHT);
  doc.text("Passenger name", lm + 3, y + 3.5);
  doc.text("Issued by / Date", lm + cw * 0.5, y + 3.5);
  doc.text("Airline Reservation Code", lm + cw * 0.8, y + 3.5);

  // Values
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  const allPaxNames = passengers.map(p => {
    const name = p.name || `${p.lastName}/${p.firstName} ${p.title || ""}`.trim();
    return name.toUpperCase();
  });
  allPaxNames.forEach((name, i) => {
    doc.text(name.substring(0, 35), lm + 3, y + 8 + i * 3.5);
  });

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, MID);
  const issuedDate = safeDateShort(ticket.issuedAt) || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  doc.text(`${COMPANY.name}`, lm + cw * 0.5, y + 8);
  doc.text(issuedDate, lm + cw * 0.5, y + 12);

  if (airlinesPnr) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text(airlinesPnr, lm + cw * 0.8, y + 8);
  }
  y += paxBoxH + 2;

  // ── BOOKING REFERENCE — highlighted purple bar ──
  setFill(doc, PURPLE);
  doc.roundedRect(lm, y, cw, 12, 1.5, 1.5, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("Your booking reference:", lm + 4, y + 5);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(bookingRef || "—", lm + 50, y + 9);

  if (airlinesPnr && airlinesPnr !== bookingRef) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("Airlines PNR:", lm + cw * 0.6, y + 5);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 220, 120);
    doc.text(airlinesPnr, lm + cw * 0.6, y + 9);
  }

  // QR in bar
  if (qr) {
    try { doc.addImage(qr, "PNG", rm - 14, y + 1, 10, 10); } catch { /* */ }
  }
  y += 15;

  // ── Ticket storage note ──
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  setColor(doc, MID);
  const note1 = "Your ticket is stored in our booking system. This receipt is your record of your ticket and is part of your conditions of carriage. Contact Seven Trip for more information.";
  const note2 = "You might need to show this receipt to enter the airport or to prove your return or onwards travel to immigration. Please check visa requirements for your destination.";
  const n1Lines = doc.splitTextToSize(note1, cw - 4);
  const n2Lines = doc.splitTextToSize(note2, cw - 4);
  doc.text(n1Lines, lm + 2, y + 3);
  y += n1Lines.length * 3 + 2;
  doc.text(n2Lines, lm + 2, y + 1);
  y += n2Lines.length * 3 + 2;

  // ── CHECK-IN TIMELINE (Emirates-style infographic) ──
  y = checkPageBreak(y, 22);
  doc.setFillColor(248, 248, 252);
  doc.rect(lm, y, cw, 18, "F");
  doc.setDrawColor(230);
  doc.rect(lm, y, cw, 18);

  const timelineItems = [
    { icon: "[1]", title: "Check in online, or", desc: "Arrive 3 hours before departure" },
    { icon: "[2]", title: "90 minutes", desc: "Drop bags at check-in counter" },
    { icon: "[3]", title: "60 minutes", desc: "Clear airport security" },
    { icon: "[4]", title: "45 minutes", desc: "Arrive at boarding gate" },
  ];
  const tlColW = cw / 4;
  timelineItems.forEach((item, i) => {
    const tx = lm + i * tlColW + 3;
    if (i > 0) {
      doc.setDrawColor(220);
      doc.line(lm + i * tlColW, y + 2, lm + i * tlColW, y + 16);
    }
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text(`${item.icon}  ${item.title}`, tx, y + 6);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    const descLines = doc.splitTextToSize(item.desc, tlColW - 8);
    doc.text(descLines, tx, y + 10);
  });
  y += 21;

  // ═══════════════════════════════════════════════════════════
  // YOUR TRAVEL INFORMATION
  // ═══════════════════════════════════════════════════════════
  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.6);
  doc.line(lm, y, rm, y);

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  doc.text("Your travel information", lm, y + 7);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  setColor(doc, LIGHT);
  doc.text("All times shown are local for each city", rm, y + 7, { align: "right" });
  y += 11;

  // ═══════════════════════════════════════════════════════════
  // FLIGHT SEGMENTS — Emirates + Sabre hybrid layout
  // ═══════════════════════════════════════════════════════════
  for (let si = 0; si < allSegments.length; si++) {
    const seg = allSegments[si];
    y = checkPageBreak(y, 90);

    // ── Direction heading with arrow icon ──
    const fromCity = seg.originCity || seg.origin || "";
    if (si === 0 || (si > 0 && allSegments[si - 1].direction !== seg.direction)) {
      const isReturn = seg.direction === "RETURN";
      setFill(doc, isReturn ? [245, 158, 11] : [16, 185, 129]); // amber / emerald
      doc.roundedRect(lm, y, cw, 8, 1, 1, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      const dirIcon = isReturn ? "<<" : ">>";
      const dirLabel = isReturn ? "Returning" : "Departing";
      doc.text(`  ${dirIcon}  ${dirLabel}  --  From ${fromCity}`, lm + 2, y + 5.5);
      y += 10;
    }

    // ── Leg label bar (grey) ──
    doc.setFillColor(240, 240, 245);
    doc.rect(lm, y, cw, 6, "F");
    doc.setDrawColor(220);
    doc.rect(lm, y, cw, 6);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    setColor(doc, MID);
    const operatedBy = seg.operatingCarrier || seg.airline || "";
    doc.text(`Leg ${si + 1} of ${totalLegs} | ${seg.origin}${seg.originCity ? " (" + seg.originCity + ")" : ""} to ${seg.destination}${seg.destinationCity ? " (" + seg.destinationCity + ")" : ""}${operatedBy ? " | Operated by " + operatedBy : ""}`, lm + 3, y + 4);
    y += 7;

    // ══════ MAIN FLIGHT INFO — 4 columns: Flight | Departure | Status+Arrival | Technical ══════
    const mainH = 36;
    doc.setFillColor(255, 255, 255);
    doc.rect(lm, y, cw, mainH, "F");
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.rect(lm, y, cw, mainH);

    // Column widths
    const col1W = cw * 0.2;  // Flight info
    const col2W = cw * 0.28; // Departure
    const col3W = cw * 0.28; // Arrival
    const col4W = cw * 0.24; // Technical details

    const c1 = lm;
    const c2 = lm + col1W;
    const c3 = c2 + col2W;
    const c4 = c3 + col3W;

    // Column dividers
    [c2, c3, c4].forEach(cx => {
      doc.setDrawColor(220);
      doc.line(cx, y, cx, y + mainH);
    });

    // ── COL 1: Airline + Flight ──
    if (airlineLogo) {
      try { doc.addImage(airlineLogo, "PNG", c1 + 3, y + 2, 12, 7); } catch { /* */ }
    }
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text(seg.airline?.toUpperCase() || "", c1 + 3, y + (airlineLogo ? 13 : 6));
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text(seg.flightNumber || "--", c1 + 3, y + (airlineLogo ? 19 : 12));

    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    doc.text(`Duration:`, c1 + 3, y + 23);
    doc.setFont("helvetica", "bold");
    doc.text(seg.duration || "--", c1 + 3, y + 27);
    doc.setFont("helvetica", "normal");
    doc.text(`Cabin:`, c1 + 3, y + 31);
    doc.setFont("helvetica", "bold");
    doc.text(seg.cabinClass || "Economy", c1 + 18, y + 31);

    // ── COL 2: Departure — large city name + flight path + time ──
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text(seg.origin || "--", c2 + 3, y + 5);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    const depFullCity = seg.originCity ? `${seg.originCity.toUpperCase()}` : "";
    if (depFullCity) doc.text(depFullCity, c2 + 3, y + 9);

    // Flight path icon
    drawFlightPath(c2 + 3, y + 11, col2W - 10, false);

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    doc.text("Departing At:", c2 + 3, y + 18);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text(safeTime(seg.departureTime), c2 + 3, y + 24);

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    doc.text("Terminal:", c2 + 3, y + 28);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, MID);
    doc.text(seg.terminal ? `TERMINAL ${seg.terminal}` : "--", c2 + 3, y + 32);

    // ── COL 3: Arrival — large city name + flight path + time ──
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text(seg.destination || "--", c3 + 3, y + 5);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    const arrFullCity = seg.destinationCity ? `${seg.destinationCity.toUpperCase()}` : "";
    if (arrFullCity) doc.text(arrFullCity, c3 + 3, y + 9);

    // Flight path icon (arrival)
    drawFlightPath(c3 + 3, y + 11, col3W - 10, true);

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    doc.text("Arriving At:", c3 + 3, y + 18);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text(safeTime(seg.arrivalTime), c3 + 3, y + 24);

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    doc.text("Terminal:", c3 + 3, y + 28);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, MID);
    doc.text(seg.arrivalTerminal ? `TERMINAL ${seg.arrivalTerminal}` : "--", c3 + 3, y + 32);

    // ── COL 4: Technical details (Sabre-style) ──
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, LIGHT);
    const techItems = [
      { label: "Aircraft:", value: seg.aircraft || "--" },
      { label: "Distance:", value: seg.distance ? `${seg.distance} mi` : "--" },
      { label: "Meals:", value: seg.meal || "Meals" },
      { label: "Status:", value: seg.status || "Confirmed", color: GREEN },
      { label: "Est. emission:", value: seg.emission || "--" },
    ];
    let ty = y + 5;
    techItems.forEach(item => {
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      setColor(doc, LIGHT);
      doc.text(item.label, c4 + 3, ty);
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      if (item.color) {
        setColor(doc, item.color);
      } else {
        setColor(doc, DARK);
      }
      doc.text(String(item.value), c4 + 3, ty + 3.5);
      ty += 7;
    });

    y += mainH + 1;

    // ── Departure/Arrival date line ──
    doc.setFillColor(252, 250, 255);
    doc.rect(lm, y, cw, 6, "F");
    doc.setDrawColor(230);
    doc.rect(lm, y, cw, 6);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    doc.text(`Departure: ${safeDateFull(seg.departureTime)}`, lm + 3, y + 4);
    doc.text(`Arrival: ${safeDateFull(seg.arrivalTime)}`, lm + cw * 0.55, y + 4);
    y += 7;

    // ── Coupon validity + Baggage ──
    doc.setFontSize(6);
    doc.setFont("helvetica", "italic");
    setColor(doc, LIGHT);
    const depDate = safeDateShort(seg.departureTime) || "--";
    doc.text(`Coupon validity: not before ${depDate} / not after ${depDate}`, lm + 3, y + 3);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text(`Baggage: ${baggageStr(seg.baggage) || "As per airline policy"}`, lm + cw * 0.6, y + 3);
    y += 6;

    // ══════ PER-SEGMENT PASSENGER TABLE ══════
    const pxHdrH = 6;
    doc.setFillColor(248, 247, 252);
    doc.rect(lm, y, cw, pxHdrH, "F");
    doc.setDrawColor(200);
    doc.setLineWidth(0.15);
    doc.rect(lm, y, cw, pxHdrH);

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    setColor(doc, LIGHT);
    const pc1 = lm + 4;
    const pc2 = lm + cw * 0.5;
    const pc3 = lm + cw * 0.72;
    doc.text("Passenger Name:", pc1, y + 4);
    doc.text("Seats:", pc2, y + 4);
    doc.text("Status:", pc3, y + 4);
    y += pxHdrH;

    passengers.forEach((p, pi) => {
      const rowH = 6;
      doc.setFillColor(pi % 2 === 0 ? 255 : 252, pi % 2 === 0 ? 255 : 250, pi % 2 === 0 ? 255 : 255);
      doc.rect(lm, y, cw, rowH, "F");
      doc.setDrawColor(235);
      doc.rect(lm, y, cw, rowH);

      const pName = (p.name || `${p.title ? p.title + " " : ""}${p.firstName} ${p.lastName}`).trim().toUpperCase();

      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      setColor(doc, DARK);
      doc.text(`» ${pName}`, pc1, y + 4);

      doc.setFont("helvetica", "normal");
      setColor(doc, MID);
      doc.text(p.seat || p.seatNo || "Check-In Required", pc2, y + 4);

      doc.setFont("helvetica", "bold");
      setColor(doc, GREEN);
      doc.text("Confirmed", pc3, y + 4);
      y += rowH;
    });

    y += 5;
  }

  // ═══════════════════════════════════════════════════════════
  // FARE INFORMATION
  // ═══════════════════════════════════════════════════════════
  const totalAmount = ticket.totalFare || ticket.totalAmount || 0;
  const baseFare = ticket.baseFare || 0;
  const taxes = ticket.taxes || 0;
  const svcCharge = ticket.serviceCharge || 0;

  if (totalAmount > 0 || baseFare > 0) {
    y = checkPageBreak(y, 55);

    doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
    doc.setLineWidth(0.6);
    doc.line(lm, y, rm, y);
    y += 3;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    setColor(doc, DARK);
    doc.text("Fare information", lm, y + 4);
    y += 8;

    // Fare table header
    doc.setFillColor(248, 247, 252);
    doc.rect(lm, y, cw, 7, "F");
    doc.setDrawColor(200);
    doc.rect(lm, y, cw, 7);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    setColor(doc, LIGHT);
    doc.text("Fare", lm + 4, y + 5);
    doc.text("Equivalent fare", lm + cw * 0.25, y + 5);
    doc.text("Taxes / Fees / Charges (TFC)", lm + cw * 0.45, y + 5);
    doc.text("Total fare (Incl. TFC)", lm + cw * 0.75, y + 5);
    doc.text("Form of payment", rm - 4, y + 5, { align: "right" });
    y += 7;

    // Fare data row
    doc.setFillColor(255, 255, 255);
    doc.rect(lm, y, cw, 8, "F");
    doc.setDrawColor(230);
    doc.rect(lm, y, cw, 8);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(doc, DARK);
    doc.text(baseFare > 0 ? `${currency} ${baseFare.toLocaleString("en-IN")}` : "--", lm + 4, y + 5.5);
    doc.text("—", lm + cw * 0.25, y + 5.5);
    doc.text(taxes > 0 ? `${currency} ${taxes.toLocaleString("en-IN")}` : "--", lm + cw * 0.45, y + 5.5);
    doc.setFont("helvetica", "bold");
    const total = totalAmount || (baseFare + taxes + svcCharge);
    doc.text(`${currency} ${total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, lm + cw * 0.75, y + 5.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    doc.text("ONLINE", rm - 4, y + 5.5, { align: "right" });
    y += 9;

    if (svcCharge > 0) {
      doc.setFontSize(6);
      setColor(doc, LIGHT);
      doc.text(`Service charge: ${currency} ${svcCharge.toLocaleString("en-IN")}`, lm + 4, y + 3);
      y += 5;
    }

    // Total bar
    setFill(doc, PURPLE);
    doc.rect(lm, y, cw, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Total fare (Incl. Taxes)", lm + 4, y + 6.5);
    doc.text(`${currency} ${total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, rm - 4, y + 6.5, { align: "right" });
    y += 12;
  }

  // ═══════════════════════════════════════════════════════════
  // BAGGAGE ALLOWANCE TABLE
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 45);

  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.6);
  doc.line(lm, y, rm, y);
  y += 3;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  doc.text("Baggage allowance", lm, y + 4);
  y += 8;

  // Checked baggage header
  doc.setFillColor(248, 247, 252);
  doc.rect(lm, y, cw, 6, "F");
  doc.setDrawColor(200);
  doc.rect(lm, y, cw, 6);
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  setColor(doc, LIGHT);
  doc.text("Passenger type", lm + 4, y + 4);
  doc.text("Route", lm + 40, y + 4);
  doc.text("Baggage allowance", lm + cw * 0.65, y + 4);
  y += 6;

  allSegments.forEach((seg, i) => {
    doc.setFillColor(i % 2 === 0 ? 255 : 252, i % 2 === 0 ? 255 : 250, i % 2 === 0 ? 255 : 255);
    doc.rect(lm, y, cw, 6, "F");
    doc.setDrawColor(235);
    doc.rect(lm, y, cw, 6);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, DARK);
    doc.text("ADULT", lm + 4, y + 4);
    doc.text(`${seg.origin} - ${seg.destination}`, lm + 40, y + 4);
    doc.setFont("helvetica", "bold");
    doc.text(baggageStr(seg.baggage) || "--", lm + cw * 0.65, y + 4);
    y += 6;
  });
  y += 2;

  // Carry-on header
  doc.setFillColor(248, 247, 252);
  doc.rect(lm, y, cw, 6, "F");
  doc.setDrawColor(200);
  doc.rect(lm, y, cw, 6);
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  setColor(doc, LIGHT);
  doc.text("Passenger type", lm + 4, y + 4);
  doc.text("Route", lm + 40, y + 4);
  doc.text("Carry on baggage", lm + cw * 0.65, y + 4);
  y += 6;

  allSegments.forEach((seg, i) => {
    doc.setFillColor(i % 2 === 0 ? 255 : 252, i % 2 === 0 ? 255 : 250, i % 2 === 0 ? 255 : 255);
    doc.rect(lm, y, cw, 6, "F");
    doc.setDrawColor(235);
    doc.rect(lm, y, cw, 6);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, DARK);
    doc.text("ADULT", lm + 4, y + 4);
    doc.text(`${seg.origin} - ${seg.destination}`, lm + 40, y + 4);
    doc.setFont("helvetica", "bold");
    doc.text(baggageStr(seg.handBaggage) || "1PC", lm + cw * 0.65, y + 4);
    y += 6;
  });
  y += 3;

  // Baggage note
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, MID);
  const bagNote = "BAG 1 — NO FEE  CARRY 7KG 15LB UPTO 45LI 115LCM. If you go over the baggage allowance you may be charged. Please check with your airline for exact baggage policies.";
  const bagLines = doc.splitTextToSize(bagNote, cw - 6);
  doc.text(bagLines, lm + 3, y + 2);
  y += bagLines.length * 3 + 4;

  // ═══════════════════════════════════════════════════════════
  // CABIN BAGGAGE POLICY (Emirates-style)
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 55);

  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.6);
  doc.line(lm, y, rm, y);
  y += 3;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  doc.text("Cabin baggage allowances", lm, y + 4);
  y += 8;

  const cabinPolicies = [
    { cls: "Economy Class:", desc: "One piece of carry-on baggage is permitted with maximum dimensions: 55 x 38 x 20cm (22 x 15 x 8 inches) and maximum weight: 7kg (15lb)." },
    { cls: "Business Class:", desc: "Two pieces of carry-on baggage permitted: one briefcase plus either one handbag or one garment bag. Each piece must not exceed 7kg (15lb). Total combined weight max 14kg (30lb)." },
    { cls: "First Class:", desc: "Two pieces of carry-on baggage permitted. The briefcase may not exceed 45 x 35 x 20cm; the handbag may not exceed 55 x 38 x 20cm. Total combined weight max 14kg (30lb)." },
  ];

  cabinPolicies.forEach(policy => {
    y = checkPageBreak(y, 14);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, PURPLE);
    doc.text(policy.cls, lm + 3, y + 3);
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    setColor(doc, MID);
    const pLines = doc.splitTextToSize(policy.desc, cw - 10);
    doc.text(pLines, lm + 3, y + 7);
    y += 7 + pLines.length * 3 + 2;
  });

  // ═══════════════════════════════════════════════════════════
  // IMPORTANT INFORMATION
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 50);

  doc.setDrawColor(PURPLE[0], PURPLE[1], PURPLE[2]);
  doc.setLineWidth(0.6);
  doc.line(lm, y, rm, y);
  y += 3;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  doc.text("Important information", lm, y + 4);
  y += 9;

  doc.setFillColor(255, 252, 245);
  const notices = [
    "Please arrive at the airport at least 3 hours before departure for international flights and 2 hours for domestic flights.",
    "Please carry a valid passport (with minimum 6 months validity) and visa for international travel.",
    "Baggage allowance and cabin baggage limits are subject to airline policy. Excess baggage charges may apply.",
    ticket.refundable
      ? "This ticket is refundable subject to airline cancellation fees."
      : "This ticket is non-refundable. Cancellation and date change fees apply as per airline policy.",
    "Flight schedules are subject to change. Please reconfirm your flight 24 hours before departure.",
    "You might need to show this receipt to enter the airport or to prove your return or onwards travel to immigration.",
    "The carriage of certain hazardous materials aboard the aircraft is forbidden. Please check with your airline for details.",
  ];

  const noticeBlockH = notices.length * 5 + 6;
  doc.rect(lm, y, cw, noticeBlockH, "F");
  doc.setDrawColor(240, 210, 160);
  doc.setLineWidth(0.2);
  doc.rect(lm, y, cw, noticeBlockH);

  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, [70, 70, 70]);
  let ny = y + 4;
  notices.forEach(n => {
    doc.text(`•  ${n}`, lm + 4, ny, { maxWidth: cw - 10 });
    ny += 5;
  });
  y += noticeBlockH + 4;

  // ── TRAVEL CONSULTANT ──
  y = checkPageBreak(y, 15);
  setFill(doc, PURPLE);
  doc.rect(lm, y, cw, 1, "F");
  y += 3;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  setColor(doc, DARK);
  doc.text("TRAVEL CONSULTANT", lm + 3, y + 3);
  doc.setFont("helvetica", "normal");
  setColor(doc, MID);
  doc.text(COMPANY.name, lm + 45, y + 3);
  y += 8;

  // ═══════════════════════════════════════════════════════════
  // FOOTER — Company info on every page
  // ═══════════════════════════════════════════════════════════
  const numPages = doc.getNumberOfPages();
  for (let i = 1; i <= numPages; i++) {
    doc.setPage(i);

    // Bottom bar
    const footY = pageH - 18;
    setFill(doc, PURPLE);
    doc.rect(0, footY, w, 18, "F");
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.rect(0, footY, w, 1.5, "F");

    // QR in footer
    if (qr) {
      try { doc.addImage(qr, "PNG", lm, footY + 3, 12, 12); } catch { /* */ }
    }

    doc.setTextColor(220, 210, 240);
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(COMPANY.name.toUpperCase(), lm + 16, footY + 6);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 170, 210);
    doc.text(`A concern of ${COMPANY.parent} | ${COMPANY.phone} | ${COMPANY.website}`, lm + 16, footY + 10);
    doc.text(COMPANY.address, lm + 16, footY + 14);

    // Page number
    doc.setFontSize(6);
    doc.setTextColor(160, 150, 200);
    doc.text(`Page ${i} of ${numPages}`, rm, footY + 6, { align: "right" });

    if (gdsSource && gdsSource !== "db") {
      doc.setFontSize(4.5);
      doc.setTextColor(140, 130, 180);
      doc.text(`Powered by ${gdsSource.toUpperCase()} GDS`, rm, footY + 10, { align: "right" });
    }

    doc.setFontSize(4.5);
    doc.setTextColor(140, 130, 180);
    doc.text("This is a computer-generated electronic ticket and does not require a physical signature.", rm, footY + 14, { align: "right" });
  }

  return doc;
}

export async function generateTicketPDF(ticket: TicketData) {
  const doc = await buildPremiumTicketDoc(ticket);
  const bookingRef = ticket.bookingRef || ticket.pnr || ticket.gdsPnr || ticket.id || "ticket";
  doc.save(`E-Ticket-${bookingRef}.pdf`);
}

export async function printTicketPDF(ticket: TicketData) {
  const doc = await buildPremiumTicketDoc(ticket);
  const pdfBlob = doc.output("blob");
  const url = URL.createObjectURL(pdfBlob);
  const printWindow = window.open(url);
  if (printWindow) {
    printWindow.onload = () => { printWindow.print(); };
  }
}
