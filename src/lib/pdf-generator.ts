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
      doc.text(`${item.unitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, colUnit + 10, y + 7, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(`${item.totalPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, colTotal - 4, y + 7, { align: "right" });
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
  doc.text(`${data.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Due
  doc.setFillColor(240, 230, 245);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Due", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.due.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Adjustment/Discount
  doc.setFillColor(240, 230, 245);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFont("helvetica", "bold");
  doc.text("Adjustment/Discount", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.discount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Grand Total — pink background
  doc.setFillColor(235, 210, 230);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
  doc.setDrawColor(220);
  doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Grand Total", totalsValueX - 45, y + 6, { align: "right" });
  doc.text(`${data.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
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
      doc.text(`${item.unitPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, tableRight - 38, y + 7, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(`${item.totalPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, tableRight - 4, y + 7, { align: "right" });
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
  doc.text(`${(inv.subtotal || inv.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
  y += totalsRowH;

  // Tax (if applicable)
  if (inv.tax > 0) {
    doc.setFillColor(240, 230, 245);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "F");
    doc.setDrawColor(220);
    doc.rect(totalsLabelX - 5, y, tableRight - totalsLabelX + 5, totalsRowH, "S");
    doc.text("Tax", totalsValueX - 45, y + 6, { align: "right" });
    doc.text(`${inv.tax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
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
    doc.text(`-${inv.discount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
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
  doc.text(`${inv.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}৳`, totalsValueX, y + 6, { align: "right" });
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
  const contentW = rm - lm;
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

  // QR Code
  const qrText = `SevenTrip E-Ticket | PNR: ${bookingRef} | ${passengers.map(p => p.name || `${p.firstName} ${p.lastName}`).join(", ")} | ${allSegments[0]?.origin || ""}-${allSegments[allSegments.length - 1]?.destination || ""}`;
  const qr = await generateQRDataUrl(qrText);

  // Airline logo
  const firstCode = outbound[0]?.airlineCode || ticket.airlineCode || "";
  let airlineLogo: string | null = null;
  if (firstCode) {
    airlineLogo = await loadImageBase64(`https://images.kiwi.com/airlines/64/${firstCode}.png`);
  }

  // Track page number
  let currentPage = 1;
  let totalPages = 1; // We'll update after building

  function checkPageBreak(y: number, needed: number): number {
    if (y + needed > pageH - 25) {
      doc.addPage();
      currentPage++;
      return drawPageHeader(doc, logo, w, lm, rm, ticketNo, currentPage);
    }
    return y;
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE HEADER — Emirates-inspired with Seven Trip branding
  // ═══════════════════════════════════════════════════════════
  function drawPageHeader(d: jsPDF, lg: string | null, pw: number, plm: number, prm: number, tktNo: string, pg: number): number {
    // Top accent bar — gradient-like purple-to-teal
    d.setFillColor(88, 55, 160); // Seven Trip purple
    d.rect(0, 0, pw, 3, "F");
    d.setFillColor(0, 180, 200); // Seven Trip teal accent
    d.rect(pw * 0.6, 0, pw * 0.4, 3, "F");

    // Logo — large and prominent
    if (lg) {
      try {
        const imgProps = d.getImageProperties(lg);
        const maxW = 55, maxH = 20;
        const ratio = Math.min(maxW / imgProps.width, maxH / imgProps.height);
        const logoW = imgProps.width * ratio;
        const logoH = imgProps.height * ratio;
        d.addImage(lg, "PNG", plm, 6, logoW, logoH);
      } catch { /* skip */ }
    } else {
      d.setFontSize(20);
      d.setFont("helvetica", "bold");
      d.setTextColor(88, 55, 160);
      d.text("Seven Trip", plm, 20);
    }

    // Right side: "Ticket & receipt" title
    d.setFontSize(16);
    d.setFont("helvetica", "bold");
    d.setTextColor(88, 55, 160);
    d.text("Ticket & receipt", prm, 14, { align: "right" });

    // Ticket number line
    let hy = 28;
    if (tktNo) {
      d.setFontSize(9);
      d.setFont("helvetica", "bold");
      d.setTextColor(40);
      d.text(`Ticket number: ${tktNo}`, plm, hy);
    }
    d.setFontSize(6.5);
    d.setFont("helvetica", "normal");
    d.setTextColor(120);
    d.text("Scan the QR code or use the ticket number above at the self check-in points in the airport.", plm, hy + 5);

    // Thin divider
    d.setDrawColor(200);
    d.setLineWidth(0.3);
    d.line(plm, hy + 9, prm, hy + 9);

    return hy + 13;
  }

  let y = drawPageHeader(doc, logo, w, lm, rm, ticketNo, 1);

  // ═══════════════════════════════════════════════════════════
  // PASSENGER & BOOKING INFO TABLE — Emirates style
  // ═══════════════════════════════════════════════════════════
  // Passenger name row
  const paxTableH = 12;
  doc.setFillColor(245, 245, 250);
  doc.rect(lm, y, contentW, paxTableH, "F");
  doc.setDrawColor(200);
  doc.rect(lm, y, contentW, paxTableH);

  // Headers
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100);
  doc.text("Passenger name", lm + 3, y + 3.5);
  doc.text("Issued by / Date", lm + contentW * 0.55, y + 3.5);

  // Values
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30);
  const allPaxNames = passengers.map(p => {
    const name = p.name || `${p.lastName}/ ${p.firstName}${p.title || ""}`.trim();
    return name.toUpperCase();
  }).join(", ");
  doc.text(allPaxNames.substring(0, 45), lm + 3, y + 9.5);

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60);
  const issuedInfo = `${COMPANY.name} | ${safeDateShort(ticket.issuedAt) || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
  doc.text(issuedInfo, lm + contentW * 0.55, y + 9.5);
  y += paxTableH + 4;

  // ═══════════════ BOOKING REFERENCE — highlighted box ═══════════════
  doc.setFillColor(88, 55, 160); // Purple
  doc.roundedRect(lm, y, contentW, 14, 2, 2, "F");

  doc.setTextColor(255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Your booking reference:", lm + 5, y + 5.5);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(bookingRef || "—", lm + 55, y + 10.5);

  // Airlines PNR if different
  if (airlinesPnr && airlinesPnr !== bookingRef) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Airlines PNR:", lm + contentW * 0.55, y + 5.5);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 200, 100);
    doc.text(airlinesPnr, lm + contentW * 0.55 + 35, y + 10.5);
  }

  // QR code in booking ref bar
  if (qr) {
    try { doc.addImage(qr, "PNG", rm - 16, y + 1, 12, 12); } catch { /* */ }
  }
  y += 18;

  // Ticket storage note
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  const storageNote = "Your ticket is stored in our booking system. This receipt is your record of your ticket and is part of your conditions of carriage.";
  const noteLines = doc.splitTextToSize(storageNote, contentW - 4);
  doc.text(noteLines, lm + 2, y + 3);
  y += noteLines.length * 3.5 + 3;

  doc.setFontSize(6);
  doc.setTextColor(100);
  doc.text("Check in at the airport. At most airports you need to arrive 3 hours before departure for international flights.", lm + 2, y + 2);
  y += 6;

  // ═══════════════════════════════════════════════════════════
  // TRAVEL INFORMATION HEADING
  // ═══════════════════════════════════════════════════════════
  doc.setDrawColor(88, 55, 160);
  doc.setLineWidth(0.8);
  doc.line(lm, y, rm, y);
  y += 5;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(88, 55, 160);
  doc.text("Your travel information", lm, y + 4);
  y += 7;

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("All times shown are local for each city", lm, y + 2);
  y += 7;

  // ═══════════════════════════════════════════════════════════
  // FLIGHT SEGMENTS — Emirates leg-by-leg layout
  // ═══════════════════════════════════════════════════════════
  for (let si = 0; si < allSegments.length; si++) {
    const seg = allSegments[si];
    y = checkPageBreak(y, 70);

    // "Departing >> From City" heading
    const fromCity = seg.originCity || seg.origin || "";
    if (si === 0 || (si > 0 && allSegments[si - 1].direction !== seg.direction)) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(88, 55, 160);
      const dirLabel = seg.direction === "RETURN" ? "Returning" : "Departing";
      doc.text(`${dirLabel}  >>  From ${fromCity}`, lm, y + 3);
      y += 8;
    }

    // Leg label
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(40);
    const legLabel = `Leg ${si + 1} of ${totalLegs} | ${seg.origin} to ${seg.destination}`;
    const operatedBy = seg.operatingCarrier || seg.airline || "";
    doc.text(legLabel + (operatedBy ? ` | Operated by ${operatedBy}` : ""), lm, y + 3);
    y += 7;

    // Flight info table — Emirates-style
    const tableH = 13;
    // Header row
    doc.setFillColor(245, 245, 250);
    doc.rect(lm, y, contentW, 7, "F");
    doc.setDrawColor(200);
    doc.rect(lm, y, contentW, 7);
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100);

    const flCol1 = lm + 3;
    const flCol2 = lm + 28;
    const flCol3 = lm + 60;
    const flCol4 = lm + 100;
    const flCol5 = lm + 135;

    doc.text("Flight", flCol1, y + 5);
    doc.text("Check-in at", flCol2, y + 5);
    doc.text("Departure", flCol3, y + 5);
    doc.text("Status", flCol4, y + 5);
    doc.text("Arrival", flCol5, y + 5);
    y += 7;

    // Data row
    doc.setFillColor(255, 255, 255);
    doc.rect(lm, y, contentW, tableH, "F");
    doc.setDrawColor(200);
    doc.rect(lm, y, contentW, tableH);

    // Flight number with airline logo
    if (airlineLogo) {
      try { doc.addImage(airlineLogo, "PNG", flCol1, y + 1, 8, 5); } catch { /* */ }
    }
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(seg.flightNumber || "", flCol1 + (airlineLogo ? 10 : 0), y + 5);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.text(seg.airline || "", flCol1 + (airlineLogo ? 10 : 0), y + 9.5);

    // Check-in date
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30);
    doc.text(safeDateShort(seg.departureTime), flCol2, y + 5);

    // Departure time + date
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(safeTime(seg.departureTime), flCol3, y + 5);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.text(safeDateFull(seg.departureTime), flCol3, y + 9.5);

    // Status
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 130, 60);
    doc.text(seg.status || "Confirmed", flCol4, y + 5);

    // Arrival time + date
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(safeTime(seg.arrivalTime), flCol5, y + 5);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80);
    doc.text(safeDateFull(seg.arrivalTime), flCol5, y + 9.5);

    y += tableH + 2;

    // Airport details line
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60);
    const depTerminal = seg.terminal ? ` Terminal ${seg.terminal}` : "";
    const arrTerminal = seg.arrivalTerminal ? ` Terminal ${seg.arrivalTerminal}` : "";
    doc.text(`Departing ${seg.origin}${seg.originCity ? ", " + seg.originCity : ""}${depTerminal}`, lm + 3, y + 2);
    y += 4;
    doc.text(`Arriving ${seg.destination}${seg.destinationCity ? ", " + seg.destinationCity : ""}${arrTerminal}`, lm + 3, y + 2);
    y += 5;

    // Class + duration + baggage info row
    doc.setFillColor(250, 248, 255);
    doc.rect(lm, y, contentW, 12, "F");
    doc.setDrawColor(220);
    doc.rect(lm, y, contentW, 12);

    const infoItems = [
      { label: "Class", value: seg.cabinClass || "Economy" },
      { label: "Duration", value: seg.duration || "--" },
      { label: "Aircraft", value: seg.aircraft || "--" },
      { label: "Checked Baggage", value: baggageStr(seg.baggage) },
      { label: "Hand Baggage", value: baggageStr(seg.handBaggage) || "7kg" },
      ...(seg.meal ? [{ label: "Meal", value: seg.meal }] : []),
    ];

    const infoColW = contentW / Math.min(infoItems.length, 6);
    infoItems.slice(0, 6).forEach((item, idx) => {
      const ix = lm + idx * infoColW + 3;
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text(item.label, ix, y + 4);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40);
      doc.text(String(item.value || "--"), ix, y + 9);
    });
    y += 15;

    // Per-segment passenger list
    passengers.forEach((p) => {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80);
      const pName = (p.name || `${p.title ? p.title + " " : ""}${p.firstName} ${p.lastName}`).trim().toUpperCase();
      const pType = p.type === "ADT" ? "Adult" : p.type === "CHD" ? "Child" : p.type === "INF" ? "Infant" : p.type || "Adult";
      doc.text(`${pName} (${pType})  |  Seat: ${p.seat || p.seatNo || "At Check-In"}  |  Ticket: ${p.ticketNumber || p.ticketNo || "--"}`, lm + 3, y + 2);
      y += 4;
    });

    y += 4;
  }

  // ═══════════════════════════════════════════════════════════
  // FARE INFORMATION — Emirates-style table
  // ═══════════════════════════════════════════════════════════
  const totalAmount = ticket.totalFare || ticket.totalAmount || 0;
  const baseFare = ticket.baseFare || 0;
  const taxes = ticket.taxes || 0;
  const svcCharge = ticket.serviceCharge || 0;

  if (totalAmount > 0 || baseFare > 0) {
    y = checkPageBreak(y, 50);

    doc.setDrawColor(88, 55, 160);
    doc.setLineWidth(0.8);
    doc.line(lm, y, rm, y);
    y += 5;

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(88, 55, 160);
    doc.text("Fare information", lm, y + 4);
    y += 9;

    // Fare table header
    doc.setFillColor(245, 245, 250);
    doc.rect(lm, y, contentW, 8, "F");
    doc.setDrawColor(200);
    doc.rect(lm, y, contentW, 8);
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100);
    doc.text("Description", lm + 4, y + 5.5);
    doc.text("Amount", rm - 4, y + 5.5, { align: "right" });
    y += 8;

    const fareRows: [string, number][] = [];
    if (baseFare > 0) fareRows.push(["Base Fare", baseFare]);
    if (taxes > 0) fareRows.push(["Taxes / Fees / Charges", taxes]);
    if (svcCharge > 0) fareRows.push(["Service Charge", svcCharge]);

    fareRows.forEach(([label, amount], i) => {
      if (i % 2 === 0) {
        doc.setFillColor(255, 255, 255);
      } else {
        doc.setFillColor(252, 252, 255);
      }
      doc.rect(lm, y, contentW, 8, "F");
      doc.setDrawColor(230);
      doc.rect(lm, y, contentW, 8);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(50);
      doc.text(label, lm + 4, y + 5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30);
      doc.text(`${currency} ${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, rm - 4, y + 5.5, { align: "right" });
      y += 8;
    });

    // Total row — purple
    doc.setFillColor(88, 55, 160);
    doc.rect(lm, y, contentW, 10, "F");
    doc.setTextColor(255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Total fare (Incl. Taxes)", lm + 4, y + 7);
    doc.text(`${currency} ${Number(totalAmount || (baseFare + taxes + svcCharge)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, rm - 4, y + 7, { align: "right" });
    y += 14;
  }

  // ═══════════════════════════════════════════════════════════
  // BAGGAGE ALLOWANCE — Emirates-style
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 40);

  doc.setDrawColor(88, 55, 160);
  doc.setLineWidth(0.8);
  doc.line(lm, y, rm, y);
  y += 5;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(88, 55, 160);
  doc.text("Baggage allowance", lm, y + 4);
  y += 9;

  // Baggage table header
  doc.setFillColor(245, 245, 250);
  doc.rect(lm, y, contentW, 7, "F");
  doc.setDrawColor(200);
  doc.rect(lm, y, contentW, 7);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(100);
  doc.text("Passenger type", lm + 4, y + 5);
  doc.text("Route", lm + 45, y + 5);
  doc.text("Checked baggage", lm + 100, y + 5);
  doc.text("Carry-on baggage", rm - 4, y + 5, { align: "right" });
  y += 7;

  // Baggage rows from segments
  allSegments.forEach((seg, i) => {
    if (i % 2 === 0) doc.setFillColor(255, 255, 255);
    else doc.setFillColor(252, 252, 255);
    doc.rect(lm, y, contentW, 7, "F");
    doc.setDrawColor(230);
    doc.rect(lm, y, contentW, 7);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40);
    doc.text("ADULT", lm + 4, y + 5);
    doc.text(`${seg.origin} - ${seg.destination}`, lm + 45, y + 5);
    doc.setFont("helvetica", "bold");
    doc.text(baggageStr(seg.baggage) || "--", lm + 100, y + 5);
    doc.text(baggageStr(seg.handBaggage) || "7kg (1PC)", rm - 4, y + 5, { align: "right" });
    y += 7;
  });
  y += 6;

  // ═══════════════════════════════════════════════════════════
  // IMPORTANT INFORMATION
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 45);

  doc.setDrawColor(88, 55, 160);
  doc.setLineWidth(0.8);
  doc.line(lm, y, rm, y);
  y += 5;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(88, 55, 160);
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
  ];

  const noticeBlockH = notices.length * 5 + 6;
  doc.rect(lm, y, contentW, noticeBlockH, "F");
  doc.setDrawColor(240, 210, 160);
  doc.rect(lm, y, contentW, noticeBlockH);

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(70);
  let ny = y + 4;
  notices.forEach(n => {
    doc.text(`•  ${n}`, lm + 4, ny, { maxWidth: contentW - 10 });
    ny += 5;
  });

  y += noticeBlockH + 6;

  // ═══════════════════════════════════════════════════════════
  // FOOTER — Company info + copyright
  // ═══════════════════════════════════════════════════════════
  y = checkPageBreak(y, 25);

  // Footer bar
  doc.setFillColor(88, 55, 160);
  doc.rect(0, y, w, 20, "F");
  // Teal accent stripe
  doc.setFillColor(0, 180, 200);
  doc.rect(0, y, w, 1.5, "F");

  if (qr) {
    try { doc.addImage(qr, "PNG", lm, y + 3, 14, 14); } catch { /* */ }
  }

  doc.setTextColor(220, 210, 240);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(COMPANY.name.toUpperCase(), lm + 18, y + 7);
  doc.setFontSize(5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(170, 160, 200);
  doc.text(`A concern of ${COMPANY.parent} | ${COMPANY.phone} | ${COMPANY.website}`, lm + 18, y + 11);
  doc.text(COMPANY.address, lm + 18, y + 15);

  doc.setFontSize(5);
  doc.setTextColor(140, 130, 180);
  doc.text("This is a computer-generated electronic ticket and does not require a physical signature.", rm, y + 18, { align: "right" });

  if (gdsSource && gdsSource !== "db") {
    doc.setFontSize(4.5);
    doc.setTextColor(120, 110, 160);
    doc.text(`Powered by ${gdsSource.toUpperCase()} GDS`, rm, y + 7, { align: "right" });
  }

  // Page footer text on all pages
  const numPages = doc.getNumberOfPages();
  for (let i = 1; i <= numPages; i++) {
    doc.setPage(i);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    doc.text(`© ${COMPANY.name}. All rights reserved`, lm, pageH - 5);
    doc.text(`Page ${i} of ${numPages}`, rm, pageH - 5, { align: "right" });
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
